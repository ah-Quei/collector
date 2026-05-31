import { afterEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/logging/Logger.js';
import { AgentProgressReporter } from '../src/progress/AgentProgressReporter.js';
import type { ProgressReporter } from '../src/progress/ProgressReporter.js';

describe('AgentProgressReporter', () => {
    afterEach(() => {
        Logger.setLevel('info');
        vi.restoreAllMocks();
    });

    it('detaches runner hooks after a run', async () => {
        const runner = new FakeRunner();
        const reporter = makeReporter();
        const progress = new AgentProgressReporter(reporter);

        progress.attachToRunner(runner);

        await runner.emit('agent_tool_start', {}, {}, { name: 'fetch_url' }, { toolCall: { callId: 'call-1' } });
        await runner.emit('agent_tool_end', {}, {}, { name: 'fetch_url' }, {}, { toolCall: { callId: 'call-1' } });

        expect(reporter.addSubStep).toHaveBeenCalledTimes(1);
        expect(reporter.completeSubStep).toHaveBeenCalledTimes(1);

        progress.detach();

        await runner.emit('agent_tool_start', {}, {}, { name: 'opencli_run' }, { toolCall: { callId: 'call-2' } });
        await runner.emit('agent_tool_end', {}, {}, { name: 'opencli_run' }, {}, { toolCall: { callId: 'call-2' } });

        expect(reporter.addSubStep).toHaveBeenCalledTimes(1);
        expect(reporter.completeSubStep).toHaveBeenCalledTimes(1);
    });

    it('logs tool arguments at debug level', async () => {
        Logger.setLevel('debug');
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const runner = new FakeRunner();
        const reporter = makeReporter();
        const progress = new AgentProgressReporter(reporter);

        progress.attachToRunner(runner);

        await runner.emit('agent_tool_start', {}, {}, { name: 'fetch_url' }, {
            toolCall: {
                callId: 'call-1',
                arguments: JSON.stringify({ url: 'https://example.com', depth: 1 }),
            },
        });

        const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('"tool":"fetch_url"');
        expect(output).toContain('"arguments":{"url":"https://example.com","depth":1}');
    });

    it('logs tool results at debug level', async () => {
        Logger.setLevel('debug');
        const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const runner = new FakeRunner();
        const reporter = makeReporter();
        const progress = new AgentProgressReporter(reporter);

        progress.attachToRunner(runner);

        await runner.emit('agent_tool_start', {}, {}, { name: 'fetch_url' }, { toolCall: { callId: 'call-1' } });
        await runner.emit('agent_tool_end', {}, {}, { name: 'fetch_url' }, JSON.stringify({
            ok: true,
            data: { title: 'Example' },
        }), { toolCall: { callId: 'call-1' } });

        const output = stdout.mock.calls.map(([chunk]) => String(chunk)).join('');
        expect(output).toContain('"callId":"call-1"');
        expect(output).toContain('"result":{"ok":true,"data":{"title":"Example"}}');
    });
});

class FakeRunner {
    private handlers = new Map<string, Set<(...args: any[]) => Promise<void>>>();

    on(event: string, handler: (...args: any[]) => Promise<void>): void {
        const handlers = this.handlers.get(event) ?? new Set();
        handlers.add(handler);
        this.handlers.set(event, handlers);
    }

    off(event: string, handler: (...args: any[]) => Promise<void>): void {
        this.handlers.get(event)?.delete(handler);
    }

    async emit(event: string, ...args: any[]): Promise<void> {
        for (const handler of this.handlers.get(event) ?? []) {
            await handler(...args);
        }
    }
}

function makeReporter(): ProgressReporter {
    return {
        start: vi.fn(async () => undefined),
        addStep: vi.fn(() => undefined),
        startStep: vi.fn(async () => undefined),
        completeStep: vi.fn(async () => undefined),
        failStep: vi.fn(async () => undefined),
        addSubStep: vi.fn(async () => 0),
        startSubStep: vi.fn(async () => undefined),
        addAndStartSubStep: vi.fn(async () => 0),
        completeSubStep: vi.fn(async () => undefined),
        complete: vi.fn(async () => undefined),
        fail: vi.fn(async () => undefined),
    };
}
