import type http from 'node:http';
import type { ProgressReporter, ProgressStep, CompleteInfo, FailInfo } from '../../progress/ProgressReporter.js';

interface SSEEvent {
    type: 'start' | 'step_add' | 'step_start' | 'step_done' | 'step_error' | 'substep_add' | 'substep_start' | 'substep_done' | 'complete' | 'fail';
    data: Record<string, unknown>;
}

export class SSEProgressReporter implements ProgressReporter {
    private steps: ProgressStep[] = [];
    private subStepCounters = new Map<number, number>();
    private closed = false;

    constructor(private res: http.ServerResponse) {}

    async start(title: string): Promise<void> {
        this.send({ type: 'start', data: { title } });
    }

    addStep(text: string): void {
        const step: ProgressStep = { id: String(this.steps.length), text, status: 'pending' };
        this.steps.push(step);
        this.send({ type: 'step_add', data: { index: step.id, text } });
    }

    async startStep(index: number): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'running';
            this.send({ type: 'step_start', data: { index } });
        }
    }

    async completeStep(index: number): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'done';
            this.send({ type: 'step_done', data: { index } });
        }
    }

    async failStep(index: number, error: string): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'error';
            this.send({ type: 'step_error', data: { index, error } });
        }
    }

    async addSubStep(stepIndex: number, text: string): Promise<number> {
        const count = this.subStepCounters.get(stepIndex) ?? 0;
        this.subStepCounters.set(stepIndex, count + 1);
        this.send({ type: 'substep_add', data: { stepIndex, text } });
        return count;
    }

    async startSubStep(stepIndex: number, subStepIndex: number): Promise<void> {
        this.send({ type: 'substep_start', data: { stepIndex, subStepIndex } });
    }

    async addAndStartSubStep(stepIndex: number, text: string): Promise<number> {
        const count = this.subStepCounters.get(stepIndex) ?? 0;
        this.subStepCounters.set(stepIndex, count + 1);
        this.send({ type: 'substep_add', data: { stepIndex, text, status: 'running' } });
        return count;
    }

    async completeSubStep(stepIndex: number, subStepIndex: number): Promise<void> {
        this.send({ type: 'substep_done', data: { stepIndex, subStepIndex } });
    }

    async complete(info: CompleteInfo): Promise<void> {
        this.send({ type: 'complete', data: info as unknown as Record<string, unknown> });
        this.close();
    }

    async fail(error: string | FailInfo): Promise<void> {
        this.send({ type: 'fail', data: typeof error === 'string' ? { error } : error as unknown as Record<string, unknown> });
        this.close();
    }

    private send(event: SSEEvent): void {
        if (this.closed) return;
        this.res.write(`data: ${JSON.stringify(event)}\n\n`);
    }

    private close(): void {
        this.closed = true;
        this.res.end();
    }
}
