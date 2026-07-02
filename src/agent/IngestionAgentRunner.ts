import { Agent, Runner, OpenAIProvider, setTraceProcessors, setTracingDisabled } from '@openai/agents';
import type { SkillLoader } from './SkillLoader.js';
import type { IngressContext } from '../models/IngressContext.js';
import { AgentOutputSchema, type AgentOutput } from './schemas.js';
import { buildSystemPrompt } from './prompts.js';
import { createTools } from './tools/registry.js';
import { createOutputCapture } from './tools/SubmitOutputTool.js';
import { ImageInjectingModelProvider, ImageInputRegistry } from './ImageInputRegistry.js';
import type { Config } from '../config/Config.js';
import type { TagRepository } from '../data/TagRepository.js';
import { Logger } from '../logging/Logger.js';
import { asRunnerEventSource, type RunnerEventHandler } from './RunnerEvents.js';

setTracingDisabled(true);
setTraceProcessors([]);

export class IngestionAgentRunner {
    private runner: Runner;
    private log = new Logger('agent');
    private imageInputRegistry = new ImageInputRegistry();

    constructor(
        private config: Config,
        private skillLoader: SkillLoader,
        private tagRepo: TagRepository,
    ) {
        this.runner = new Runner({
            modelProvider: new ImageInjectingModelProvider(
                new OpenAIProvider({
                    apiKey: config.llm.apiKey,
                    baseURL: config.llm.baseUrl,
                }),
                () => this.imageInputRegistry,
            ),
            tracingDisabled: true,
        });
    }

    on(event: string, handler: RunnerEventHandler): void {
        asRunnerEventSource(this.runner)?.on(event, handler);
    }

    off(event: string, handler: RunnerEventHandler): void {
        const runner = asRunnerEventSource(this.runner);
        if (!runner) return;
        if (runner.off) runner.off(event, handler);
        else runner.removeListener?.(event, handler);
    }

    async run(context: IngressContext, knowledgeId: string): Promise<AgentOutput> {
        const existingTags = this.tagRepo.findAll();
        this.imageInputRegistry = new ImageInputRegistry();
        const systemPrompt = buildSystemPrompt(this.config.llm, this.skillLoader, existingTags);
        const userInput = this.buildUserMessage(context);
        // Structured output is delivered via the `submit_output` function tool
        // (captured here) rather than via `response_format`/json_schema, which many
        // providers (e.g. MiniMax-M3) do not support.
        const outputCapture = createOutputCapture();
        const tools = createTools(this.config, this.skillLoader, this.imageInputRegistry, outputCapture);

        this.log.debug('Agent 配置', {
            model: this.config.llm.model,
            maxTurns: this.config.agent.maxSteps,
            toolCount: tools.length,
            inputLength: userInput.length,
        });

        const agent = new Agent({
            name: 'collector',
            instructions: systemPrompt,
            tools,
            model: this.config.llm.model,
            modelSettings: {
                maxTokens: this.config.llm.maxTokens,
            },
        });

        this.log.info('开始 Agent 执行', { knowledgeId });
        const result = await this.runner.run(agent, userInput, {
            context: { knowledgeId },
            maxTurns: this.config.agent.maxSteps,
        }).finally(() => {
            this.imageInputRegistry.clear();
        });

        const captured = outputCapture.get();
        if (captured) {
            this.log.debug('Agent 输出方式', { source: 'submit_output_tool' });
            return captured;
        }

        // Fallback: the model did not call `submit_output`. Try to recover an
        // AgentOutput from the final text output (e.g. a fenced JSON block).
        const finalText = typeof result.finalOutput === 'string' ? result.finalOutput : undefined;
        const recovered = finalText ? this.recoverOutputFromText(finalText) : undefined;
        if (recovered) {
            this.log.warn('Agent 未调用 submit_output，已从最终文本中恢复输出', {
                finalTextLength: finalText?.length,
            });
            return recovered;
        }

        this.log.error('Agent 未产生输出', {
            calledSubmitOutput: false,
            finalOutputType: typeof result.finalOutput,
            finalOutputPreview: finalText?.slice(0, 200),
        });
        throw new Error('Agent produced no output: did not call submit_output and no JSON could be recovered from the final text');
    }

    private recoverOutputFromText(text: string): AgentOutput | undefined {
        // Prefer a fenced ```json ... ``` block, then a raw JSON object.
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const candidates = fenced ? [fenced[1]] : [text];
        for (const candidate of candidates) {
            const start = candidate.indexOf('{');
            const end = candidate.lastIndexOf('}');
            if (start === -1 || end === -1 || end <= start) continue;
            const jsonStr = candidate.slice(start, end + 1);
            try {
                const parsed = AgentOutputSchema.parse(JSON.parse(jsonStr));
                return parsed;
            } catch {
                // try next candidate
            }
        }
        return undefined;
    }

    private buildUserMessage(context: IngressContext): string {
        const parts: string[] = [];

        for (const content of context.contents) {
            if (content.type === 'text' && content.text) {
                parts.push(content.text);
            } else if (content.type === 'image') {
                parts.push(`[Image: ${content.storageUri ?? 'unknown'} (${content.mimeType ?? 'unknown'})]`);
            } else if (content.type === 'audio') {
                parts.push(`[Audio: ${content.storageUri ?? 'unknown'} (${content.mimeType ?? 'unknown'})]`);
            } else if (content.type === 'video') {
                parts.push(`[Video: ${content.storageUri ?? 'unknown'} (${content.mimeType ?? 'unknown'})]`);
            } else if (content.type === 'file') {
                const name = content.fileName ? ` name="${content.fileName}"` : '';
                const error = content.downloadError ? ` download_error="${content.downloadError}"` : '';
                parts.push(`[File: ${content.storageUri ?? 'unknown'} (${content.mimeType ?? 'unknown'})${name}${error}]`);
            }
        }

        if (context.metadata?.url) {
            parts.push(`\nSource URL: ${context.metadata.url}`);
        }
        if (context.metadata?.title) {
            parts.push(`Page title: ${context.metadata.title}`);
        }

        return parts.join('\n');
    }
}
