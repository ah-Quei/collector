import { Agent, Runner, OpenAIProvider, setTraceProcessors, setTracingDisabled } from '@openai/agents';
import type { SkillLoader } from './SkillLoader.js';
import type { IngressContext } from '../models/IngressContext.js';
import { type AgentOutput } from './schemas.js';
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

        this.log.error('Agent 未调用 submit_output', {
            finalOutputType: typeof result.finalOutput,
            finalOutputPreview: typeof result.finalOutput === 'string' ? result.finalOutput.slice(0, 200) : undefined,
        });
        throw new Error('Agent produced no output: did not call submit_output');
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
