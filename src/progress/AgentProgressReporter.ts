import type { ProgressReporter } from './ProgressReporter.js';
import { Logger } from '../logging/Logger.js';
import { asRunnerEventSource, type AgentToolDetails, type AgentToolLike, type RunnerEventHandler, type RunnerEventSource } from '../agent/RunnerEvents.js';

/**
 * Bridges Agent lifecycle events to ProgressReporter.
 * Hooks into Agent SDK runner events and translates them into progress steps.
 * Tool calls are added as sub-steps under the "AI 分析与提取" step (index 1).
 */
export class AgentProgressReporter {
    private readonly AI_STEP_INDEX = 1;
    private subStepMap = new Map<string, number>();
    private log = new Logger('progress');
    private detachRunner: (() => void) | null = null;

    constructor(private reporter: ProgressReporter) {}

    attachToRunner(runner: unknown): void {
        this.detach();
        const eventSource = asRunnerEventSource(runner);
        if (!eventSource) return;

        const onAgentStart = async () => {
            this.log.debug('Agent started');
        };

        const onAgentToolStart = async (_ctx: unknown, _agent: unknown, tool: AgentToolLike, details: AgentToolDetails) => {
            const callId = details.toolCall?.callId;
            if (!callId) return;
            const toolName = tool.name ?? 'tool';
            this.log.debug('Tool started', { callId, tool: toolName });
            const subStepIndex = await this.reporter.addSubStep(this.AI_STEP_INDEX, `调用 ${toolName}...`);
            this.subStepMap.set(callId, subStepIndex);
            await this.reporter.startSubStep(this.AI_STEP_INDEX, subStepIndex);
        };

        const onAgentToolEnd = async (_ctx: unknown, _agent: unknown, _tool: unknown, _result: unknown, details: AgentToolDetails) => {
            const callId = details.toolCall?.callId;
            if (!callId) return;
            this.log.debug('Tool ended', { callId });
            const subStepIndex = this.subStepMap.get(callId);
            if (subStepIndex !== undefined) {
                await this.reporter.completeSubStep(this.AI_STEP_INDEX, subStepIndex);
            }
        };

        eventSource.on('agent_start', onAgentStart);
        eventSource.on('agent_tool_start', onAgentToolStart as RunnerEventHandler);
        eventSource.on('agent_tool_end', onAgentToolEnd as RunnerEventHandler);

        this.detachRunner = () => {
            removeRunnerListener(eventSource, 'agent_start', onAgentStart);
            removeRunnerListener(eventSource, 'agent_tool_start', onAgentToolStart as RunnerEventHandler);
            removeRunnerListener(eventSource, 'agent_tool_end', onAgentToolEnd as RunnerEventHandler);
        };
    }

    detach(): void {
        if (this.detachRunner) {
            this.detachRunner();
            this.detachRunner = null;
        }
    }
}

function removeRunnerListener(runner: RunnerEventSource, event: string, handler: RunnerEventHandler): void {
    if (runner.off) runner.off(event, handler);
    else runner.removeListener?.(event, handler);
}
