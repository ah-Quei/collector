import * as Lark from '@larksuiteoapi/node-sdk';
import { BaseAdapter } from '../BaseAdapter.js';
import type { FeishuConfig } from '../../config/Config.js';
import type { IngressContext, RawContent } from '../../models/IngressContext.js';
import type { ProgressReporter } from '../../progress/ProgressReporter.js';
import { CardProgressReporter } from './CardProgressReporter.js';
import { Logger } from '../../logging/Logger.js';
import { isRecord } from '../../utils/guards.js';

export type FeishuMessageHandler = (
    context: IngressContext,
    reporter: ProgressReporter,
) => Promise<void>;

export type FeishuCardActionHandler = (
    knowledgeId: string,
    chatId: string,
    reporter: ProgressReporter,
) => Promise<void>;

export class FeishuIngress extends BaseAdapter {
    readonly name = 'feishu';
    private client: Lark.Client;
    private wsClient: Lark.WSClient | null = null;
    private log = new Logger('feishu');

    constructor(
        private config: FeishuConfig,
        private onMessage: FeishuMessageHandler,
        private onReprocess?: FeishuCardActionHandler,
    ) {
        super();
        this.client = new Lark.Client({
            appId: config.appId,
            appSecret: config.appSecret,
        });
    }

    async start(): Promise<void> {
        this.log.info('正在连接飞书 WebSocket...');
        this.wsClient = new Lark.WSClient({
            appId: this.config.appId,
            appSecret: this.config.appSecret,
            loggerLevel: Lark.LoggerLevel.info,
        });

        this.wsClient.start({
            eventDispatcher: new Lark.EventDispatcher({}).register({
                'im.message.receive_v1': async (data) => {
                    const { message } = data;
                    const msgType = message.message_type as string;
                    this.log.debug(`收到飞书消息`, { type: msgType, chatId: message.chat_id });
                    const context = this.parseMessage(message);

                    // Return immediately to avoid Feishu 3-second timeout retry
                    if (context) {
                        const reporter = new CardProgressReporter(this.client, context.chatId);
                        this.onMessage(context, reporter).catch(e => {
                            this.log.error('处理飞书消息失败', { error: String(e) });
                        });
                    }
                },
                'card.action.trigger': async (data: unknown) => {
                    const action = extractCardAction(data);
                    if (!action) {
                        this.log.warn('收到未知飞书卡片动作，已忽略', { data });
                        return;
                    }

                    this.log.info('收到飞书重新处理请求', {
                        knowledgeId: action.knowledgeId,
                        chatId: action.chatId,
                    });
                    const reporter = new CardProgressReporter(this.client, action.chatId);
                    this.onReprocess?.(action.knowledgeId, action.chatId, reporter).catch(e => {
                        this.log.error('重新处理飞书消息失败', { error: String(e), knowledgeId: action.knowledgeId });
                    });
                },
            }),
        });
        this.log.info('飞书 WebSocket 已连接');
    }

    async stop(): Promise<void> {
        this.wsClient?.close();
        this.wsClient = null;
    }

    async healthCheck(): Promise<boolean> {
        return this.wsClient !== null;
    }

    private parseMessage(message: Record<string, unknown>): IngressContext | null {
        const chatId = message.chat_id as string;
        if (!chatId) return null;

        const msgType = message.message_type as string;
        const content = parseMessageContent(message.content);

        const contents: RawContent[] = [];

        switch (msgType) {
            case 'text':
                contents.push({ type: 'text', text: stringValue(content.text, '') });
                break;
            case 'image':
                contents.push({
                    type: 'image',
                    mimeType: 'image/jpeg',
                    storageUri: optionalString(content.image_key),
                });
                break;
            case 'audio':
                contents.push({
                    type: 'audio',
                    mimeType: 'audio/m4a',
                    storageUri: optionalString(content.file_key),
                });
                break;
            case 'media':
                contents.push({
                    type: 'video',
                    mimeType: 'video/mp4',
                    storageUri: optionalString(content.file_key),
                });
                break;
            case 'file':
                contents.push({
                    type: 'file',
                    mimeType: stringValue(content.file_type, 'application/octet-stream'),
                    storageUri: optionalString(content.file_key),
                });
                break;
            default:
                return null;
        }

        return {
            source: 'feishu',
            chatId,
            contents,
            metadata: {
                messageId: message.message_id as string,
            },
        };
    }
}

function stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function extractCardAction(data: unknown): { knowledgeId: string; chatId: string } | null {
    if (!isRecord(data)) return null;
    const event = isRecord(data.event) ? data.event : undefined;
    const action = isRecord(data.action)
        ? data.action
        : isRecord(event?.action) ? event.action : undefined;
    const value = isRecord(action?.value) ? action.value : undefined;
    const context = isRecord(data.context)
        ? data.context
        : isRecord(event?.context) ? event.context : undefined;
    const knowledgeId = value?.knowledgeId;
    const actionName = value?.action;
    const chatId = context?.open_chat_id ?? data.open_chat_id ?? event?.open_chat_id;

    if (actionName !== 'reprocess_knowledge') return null;
    if (typeof knowledgeId !== 'string' || knowledgeId.length === 0) return null;
    if (typeof chatId !== 'string' || chatId.length === 0) return null;

    return { knowledgeId, chatId };
}

function parseMessageContent(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'string') return {};
    try {
        const parsed = JSON.parse(raw);
        return isRecord(parsed) ? parsed : {};
    } catch {
        return {};
    }
}
