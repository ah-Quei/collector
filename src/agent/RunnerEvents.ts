export type RunnerEventHandler = (...args: unknown[]) => Promise<void>;

export interface RunnerEventSource {
    on(event: string, handler: RunnerEventHandler): void;
    off?(event: string, handler: RunnerEventHandler): void;
    removeListener?(event: string, handler: RunnerEventHandler): void;
}

export interface AgentToolLike {
    name?: string;
}

export interface AgentToolDetails {
    toolCall?: {
        callId?: string;
    };
}

export function asRunnerEventSource(value: unknown): RunnerEventSource | null {
    if (typeof value !== 'object' || value === null) return null;
    const candidate = value as Partial<RunnerEventSource>;
    return typeof candidate.on === 'function' ? candidate as RunnerEventSource : null;
}
