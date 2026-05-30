import * as Lark from '@larksuiteoapi/node-sdk';
import type { ProgressReporter, CompleteInfo, FailInfo } from '../../progress/ProgressReporter.js';
import { Logger } from '../../logging/Logger.js';

interface Step {
    id: string;
    text: string;
    status: 'pending' | 'running' | 'done' | 'error';
    subSteps: Step[];
}

export class CardProgressReporter implements ProgressReporter {
    private messageId: string | null = null;
    private steps: Step[] = [];
    private startTime: number = Date.now();
    private lastUpdateAt = 0;
    private pendingUpdateTimer: ReturnType<typeof setTimeout> | null = null;
    private pendingUpdateCards: Record<string, unknown>[] = [];
    private inFlightUpdate: Promise<void> | null = null;
    private readonly minUpdateIntervalMs = 1000;
    private log = new Logger('feishu-card');

    constructor(
        private client: Lark.Client,
        private chatId: string,
    ) {}

    async start(_title: string): Promise<void> {
        this.startTime = Date.now();
        const card = this.buildCard('processing');
        const res = await this.client.im.message.create({
            data: {
                receive_id: this.chatId,
                msg_type: 'interactive',
                content: JSON.stringify(card),
            },
            params: { receive_id_type: 'chat_id' },
        });
        this.messageId = res.data?.message_id || null;
    }

    addStep(text: string): void {
        this.steps.push({
            id: String(this.steps.length),
            text,
            status: 'pending',
            subSteps: [],
        });
    }

    async startStep(index: number): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'running';
            await this.throttledUpdate();
        }
    }

    async completeStep(index: number): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'done';
            // Mark all sub-steps as done when parent completes
            for (const subStep of this.steps[index].subSteps) {
                if (subStep.status === 'running' || subStep.status === 'pending') {
                    subStep.status = 'done';
                }
            }
            await this.throttledUpdate();
        }
    }

    async failStep(index: number, error: string): Promise<void> {
        if (index < this.steps.length) {
            this.steps[index].status = 'error';
            this.steps[index].text += ` (failed: ${error})`;
            await this.throttledUpdate();
        }
    }

    async addSubStep(stepIndex: number, text: string): Promise<number> {
        if (stepIndex < this.steps.length) {
            const subStep: Step = {
                id: `${stepIndex}_${this.steps[stepIndex].subSteps.length}`,
                text,
                status: 'pending',
                subSteps: [],
            };
            this.steps[stepIndex].subSteps.push(subStep);
            return this.steps[stepIndex].subSteps.length - 1;
        }
        return -1;
    }

    async startSubStep(stepIndex: number, subStepIndex: number): Promise<void> {
        if (stepIndex < this.steps.length && subStepIndex < this.steps[stepIndex].subSteps.length) {
            this.steps[stepIndex].subSteps[subStepIndex].status = 'running';
            await this.throttledUpdate();
        }
    }

    async addAndStartSubStep(stepIndex: number, text: string): Promise<number> {
        if (stepIndex < this.steps.length) {
            const subStep: Step = {
                id: `${stepIndex}_${this.steps[stepIndex].subSteps.length}`,
                text,
                status: 'running',
                subSteps: [],
            };
            this.steps[stepIndex].subSteps.push(subStep);
            await this.throttledUpdate();
            return this.steps[stepIndex].subSteps.length - 1;
        }
        return -1;
    }

    async completeSubStep(stepIndex: number, subStepIndex: number): Promise<void> {
        if (stepIndex < this.steps.length && subStepIndex < this.steps[stepIndex].subSteps.length) {
            this.steps[stepIndex].subSteps[subStepIndex].status = 'done';
            await this.throttledUpdate();
        }
    }

    async complete(info: CompleteInfo): Promise<void> {
        await this.cancelPendingUpdates();
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);

        // Build final card with all steps
        const elements: Record<string, unknown>[] = [];

        // Show all steps with their final status
        if (this.steps.length > 0) {
            const text = this.buildStepsMarkdown();
            elements.push({ tag: 'markdown', content: text });
        }

        // Add summary
        elements.push({
            tag: 'markdown',
            content: `---\n**${info.title}**\n\n${info.summary}\n\n⏱️ 耗时 ${elapsed} 秒`,
        });

        const actions = this.buildFinalActions(info);
        if (actions.length > 0) {
            elements.push({ tag: 'action', actions });
        }

        await this.updateCard({
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: '✅ 处理完成' }, template: 'green' },
            elements,
        });
    }

    async fail(error: string | FailInfo): Promise<void> {
        await this.cancelPendingUpdates();
        const info = typeof error === 'string' ? { error } : error;
        const elapsed = Math.round((Date.now() - this.startTime) / 1000);
        const elements: Record<string, unknown>[] = [];

        // Show all steps with their final status
        if (this.steps.length > 0) {
            const text = this.buildStepsMarkdown();
            elements.push({ tag: 'markdown', content: text });
        }

        elements.push({
            tag: 'markdown',
            content: `---\n**错误信息：**\n\n${info.error}\n\n⏱️ 耗时 ${elapsed} 秒`,
        });

        const actions = this.buildFinalActions(info);
        if (actions.length > 0) {
            elements.push({ tag: 'action', actions });
        }

        await this.updateCard({
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: '❌ 处理失败' }, template: 'red' },
            elements,
        });
    }

    private buildFinalActions(info: CompleteInfo | FailInfo): Record<string, unknown>[] {
        const actions: Record<string, unknown>[] = [];

        if (info.docUrl) {
            actions.push({
                tag: 'button',
                text: { tag: 'plain_text', content: '📄 查看文档' },
                url: info.docUrl,
                type: 'primary',
            });
        }

        if (info.knowledgeId && info.reprocessable !== false) {
            actions.push({
                tag: 'button',
                text: { tag: 'plain_text', content: '重新处理' },
                type: info.docUrl ? 'default' : 'primary',
                value: {
                    action: 'reprocess_knowledge',
                    knowledgeId: info.knowledgeId,
                },
            });
        }

        return actions;
    }

    private buildStepsMarkdown(): string {
        return this.steps.map(step => {
            const icon = step.status === 'done' ? '✅' : step.status === 'running' ? '🔄' : step.status === 'error' ? '❌' : '⬜';
            let line = `${icon} ${step.text}`;

            // Add sub-steps (tool calls)
            if (step.subSteps.length > 0) {
                const subLines = step.subSteps.map(sub => {
                    const subIcon = sub.status === 'done' ? '✅' : sub.status === 'running' ? '🔄' : sub.status === 'error' ? '❌' : '⬜';
                    return `   ${subIcon} ${sub.text}`;
                });
                line += '\n' + subLines.join('\n');
            }

            return line;
        }).join('\n');
    }

    private buildCard(status: 'processing' | 'done' | 'error'): Record<string, unknown> {
        const template = status === 'done' ? 'green' : status === 'error' ? 'red' : 'blue';
        const icon = status === 'done' ? '✅' : status === 'error' ? '❌' : '⏳';
        const headerText = status === 'done' ? '处理完成' : status === 'error' ? '处理失败' : '正在处理';
        const elements: Record<string, unknown>[] = [];

        if (this.steps.length > 0) {
            const text = this.buildStepsMarkdown();
            elements.push({ tag: 'markdown', content: text });
        }

        if (status === 'processing') {
            const elapsed = Math.round((Date.now() - this.startTime) / 1000);
            elements.push({ tag: 'markdown', content: `⏱️ 已耗时 ${elapsed} 秒` });
        }

        return {
            config: { wide_screen_mode: true },
            header: { title: { tag: 'plain_text', content: `${icon} ${headerText}` }, template },
            elements,
        };
    }

    private async throttledUpdate(): Promise<void> {
        if (!this.messageId) return;
        this.pendingUpdateCards.push(this.buildCard('processing'));
        this.scheduleQueuedUpdate();
    }

    private scheduleQueuedUpdate(): void {
        if (!this.messageId || this.pendingUpdateTimer || this.inFlightUpdate || this.pendingUpdateCards.length === 0) {
            return;
        }

        const waitMs = Math.max(0, this.minUpdateIntervalMs - (Date.now() - this.lastUpdateAt));
        this.pendingUpdateTimer = setTimeout(() => {
            this.pendingUpdateTimer = null;
            void this.consumeQueuedUpdate();
        }, waitMs);
    }

    private async consumeQueuedUpdate(): Promise<void> {
        if (!this.messageId || this.inFlightUpdate) return;
        const card = this.pendingUpdateCards.shift();
        if (!card) return;

        this.lastUpdateAt = Date.now();
        this.inFlightUpdate = this.updateCard(card).finally(() => {
            this.inFlightUpdate = null;
            this.scheduleQueuedUpdate();
        });
        await this.inFlightUpdate;
    }

    private async cancelPendingUpdates(): Promise<void> {
        if (this.pendingUpdateTimer) {
            clearTimeout(this.pendingUpdateTimer);
            this.pendingUpdateTimer = null;
        }
        this.pendingUpdateCards = [];
        if (this.inFlightUpdate) {
            await this.inFlightUpdate;
        }
    }

    private async updateCard(card: Record<string, unknown>): Promise<void> {
        if (!this.messageId) return;
        try {
            await this.client.im.message.patch({
                path: { message_id: this.messageId },
                data: { content: JSON.stringify(card) },
            });
        } catch (e) {
            this.log.error('飞书卡片更新失败', { error: String(e) });
        }
    }
}
