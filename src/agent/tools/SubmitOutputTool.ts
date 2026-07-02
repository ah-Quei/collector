import { tool } from '@openai/agents';
import { AgentOutputSchema, type AgentOutput } from '../schemas.js';

/**
 * Mutable holder for the structured output captured from a `submit_output`
 * tool call during one agent run. The runner reads the captured value after
 * `runner.run()` finishes instead of relying on `response_format` /
 * `text.format=json_schema` (which many non-OpenAI-compatible providers,
 * including MiniMax-M3, do not implement).
 */
export interface OutputCapture {
    get(): AgentOutput | undefined;
    set(value: AgentOutput): void;
    clear(): void;
}

export function createOutputCapture(): OutputCapture {
    let captured: AgentOutput | undefined;
    return {
        get: () => captured,
        set: (value) => {
            captured = value;
        },
        clear: () => {
            captured = undefined;
        },
    };
}

export function submitOutputTool(capture: OutputCapture) {
    return tool({
        name: 'submit_output',
        description:
            'Submit the final structured knowledge article. You MUST call this exactly once at the very end of your task, after all collection and skill steps are complete. Do not return the structured article as plain text; always submit it through this tool.',
        parameters: AgentOutputSchema,
        async execute(args) {
            // The SDK has already validated `args` against AgentOutputSchema via
            // the `parameters` definition, so we can capture it directly.
            capture.set(args as AgentOutput);
            return 'Output received. You may end the conversation.';
        },
    });
}
