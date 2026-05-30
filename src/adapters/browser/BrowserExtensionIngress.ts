import http from 'node:http';
import { BaseAdapter } from '../BaseAdapter.js';
import type { IngressContext, RawContent } from '../../models/IngressContext.js';
import type { ProgressReporter } from '../../progress/ProgressReporter.js';
import { SSEProgressReporter } from './SSEProgressReporter.js';
import { Logger } from '../../logging/Logger.js';

export type BrowserMessageHandler = (
    context: IngressContext,
    reporter: ProgressReporter,
) => Promise<void>;

export class BrowserExtensionIngress extends BaseAdapter {
    readonly name = 'browser-extension';
    private server: http.Server | null = null;
    private log = new Logger('browser');

    constructor(
        private port: number,
        private onMessage: BrowserMessageHandler,
    ) {
        super();
    }

    async start(): Promise<void> {
        this.server = http.createServer(async (req, res) => {
            if (req.method === 'POST' && req.url === '/collect') {
                await this.handleCollect(req, res);
            } else if (req.method === 'GET' && req.url === '/health') {
                res.writeHead(200);
                res.end('ok');
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        await new Promise<void>((resolve) => {
            this.server!.listen(this.port, () => {
                this.log.info(`浏览器扩展 HTTP 服务已启动`, { port: this.port });
                resolve();
            });
        });
    }

    async stop(): Promise<void> {
        if (this.server) {
            await new Promise<void>((resolve, reject) => {
                this.server!.close((err) => (err ? reject(err) : resolve()));
            });
            this.server = null;
        }
    }

    async healthCheck(): Promise<boolean> {
        return this.server !== null;
    }

    private async handleCollect(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
        });

        try {
            const body = await this.readBody(req);
            const context = this.parseRequest(body);
            this.log.info('收到浏览器扩展请求', { url: context.metadata?.url });
            const reporter = new SSEProgressReporter(res);
            await this.onMessage(context, reporter);
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            this.log.error('处理浏览器请求失败', { error: msg });
            res.write(`data: ${JSON.stringify({ type: 'fail', data: { error: msg } })}\n\n`);
            res.end();
        }
    }

    private readBody(req: http.IncomingMessage): Promise<string> {
        return new Promise((resolve, reject) => {
            let data = '';
            req.on('data', (chunk) => (data += chunk));
            req.on('end', () => resolve(data));
            req.on('error', reject);
        });
    }

    private parseRequest(body: string): IngressContext {
        const data = JSON.parse(body);

        const contents: RawContent[] = [];
        const text = data.text ?? data.selectedText ?? data.url ?? '';
        if (text) {
            contents.push({ type: 'text', text });
        }

        return {
            source: 'browser-extension',
            chatId: data.tabId ?? 'browser',
            contents,
            metadata: {
                url: data.url,
                title: data.title,
                selectedText: data.selectedText,
            },
        };
    }
}
