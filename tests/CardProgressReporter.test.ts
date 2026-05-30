import { describe, expect, it, vi } from 'vitest';
import { CardProgressReporter } from '../src/adapters/feishu/CardProgressReporter.js';

describe('CardProgressReporter reprocess button', () => {
    it('adds document and reprocess buttons to completion cards', async () => {
        const client = makeClient();
        const reporter = new CardProgressReporter(client as any, 'chat-1');

        await reporter.start('知识收集');
        await reporter.complete({
            title: 'Title',
            summary: 'Summary',
            docUrl: 'https://feishu.cn/docx/doc-token',
            knowledgeId: 'knowledge-1',
        });

        const card = latestPatchedCard(client);
        const action = card.elements.find((element: any) => element.tag === 'action');
        expect(action.actions).toEqual([
            expect.objectContaining({
                tag: 'button',
                url: 'https://feishu.cn/docx/doc-token',
            }),
            expect.objectContaining({
                tag: 'button',
                text: { tag: 'plain_text', content: '重新处理' },
                value: {
                    action: 'reprocess_knowledge',
                    knowledgeId: 'knowledge-1',
                },
            }),
        ]);
    });

    it('adds reprocess button to failure cards', async () => {
        const client = makeClient();
        const reporter = new CardProgressReporter(client as any, 'chat-1');

        await reporter.start('知识收集');
        await reporter.fail({
            error: 'failed',
            knowledgeId: 'knowledge-1',
            reprocessable: true,
        });

        const card = latestPatchedCard(client);
        const action = card.elements.find((element: any) => element.tag === 'action');
        expect(action.actions).toEqual([
            expect.objectContaining({
                tag: 'button',
                text: { tag: 'plain_text', content: '重新处理' },
                type: 'primary',
                value: {
                    action: 'reprocess_knowledge',
                    knowledgeId: 'knowledge-1',
                },
            }),
        ]);
    });
});

function makeClient() {
    return {
        im: {
            message: {
                create: vi.fn(async () => ({ data: { message_id: 'message-1' } })),
                patch: vi.fn(async () => undefined),
            },
        },
    };
}

function latestPatchedCard(client: ReturnType<typeof makeClient>): any {
    const patch = client.im.message.patch;
    const call = patch.mock.calls.at(-1);
    expect(call).toBeDefined();
    return JSON.parse(call![0].data.content);
}
