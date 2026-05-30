import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type http from 'node:http';
import { z } from 'zod';
import type { KnowledgeRepository } from '../data/KnowledgeRepository.js';
import type { TagRepository } from '../data/TagRepository.js';
import type { Knowledge } from '../models/Knowledge.js';
import { Logger } from '../logging/Logger.js';

type SyncBeforeRead = () => Promise<unknown>;

interface ArticleIndexItem {
    id: string;
    title: string;
    summary: string;
    platform: string;
    tags: string[];
    createdAt: Date;
}

interface ArticleResourceItem {
    uri: string;
    name: string;
    description: string;
    mimeType: 'text/markdown';
}

interface ArticleSearchItem extends ArticleIndexItem {
    sourceUrl: string | null;
}

interface ArticleSummary extends ArticleSearchItem {}

interface ArticleForTool extends ArticleSummary {
    contentMarkdown: string;
    canonicalUrl: string | null;
    author: string | null;
    publishedAt: string | null;
    contentType: string;
    updatedAt: Date;
}

export class KnowledgeBaseMCPServer {
    private stdioServer: McpServer | null = null;
    private httpServer: http.Server | null = null;
    private log = new Logger('mcp');

    constructor(
        private knowledgeRepo: KnowledgeRepository,
        private tagRepo: TagRepository,
        private syncBeforeRead?: SyncBeforeRead,
    ) {}

    private createServer(): McpServer {
        const server = new McpServer({
            name: 'collector-knowledge-base',
            version: '1.0.0',
        });

        this.registerResources(server);
        this.registerTools(server);
        return server;
    }

    private registerResources(server: McpServer): void {
        server.registerResource(
            'kb-index',
            'kb://articles/index',
            {
                title: '知识库索引',
                description: '所有知识库文章的索引列表',
                mimeType: 'application/json',
            },
            async (uri) => ({
                contents: [{
                    uri: uri.href,
                    text: JSON.stringify(await this.getArticleIndex()),
                }],
            })
        );

        server.registerResource(
            'kb-article',
            new ResourceTemplate('kb://articles/{articleId}', {
                list: async () => ({
                    resources: await this.listArticleResources(),
                }),
            }),
            {
                title: '知识库文章',
                description: '获取特定知识库文章的完整内容',
                mimeType: 'text/markdown',
            },
            async (uri, { articleId }) => ({
                contents: [{
                    uri: uri.href,
                    text: await this.getArticleContent(articleId as string),
                }],
            })
        );
    }

    private registerTools(server: McpServer): void {
        server.registerTool(
            'search-knowledge-base',
            {
                title: '搜索知识库',
                description: '根据关键词搜索知识库文章',
                inputSchema: z.object({
                    query: z.string().describe('搜索关键词'),
                    tags: z.array(z.string()).optional().describe('按标签过滤'),
                    limit: z.number().optional().default(10).describe('最大返回数量'),
                }),
            },
            async ({ query, tags, limit }) => {
                const results = await this.searchArticles(query, tags, limit);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(results, null, 2),
                    }],
                };
            }
        );

        server.registerTool(
            'get-articles-by-tags',
            {
                title: '按标签获取文章',
                description: '根据标签获取相关文章列表',
                inputSchema: z.object({
                    tags: z.array(z.string()).describe('标签列表'),
                    matchMode: z.enum(['any', 'all']).optional().default('any')
                        .describe('匹配模式: any=任一匹配, all=全部匹配'),
                }),
            },
            async ({ tags, matchMode }) => {
                const articles = await this.getArticlesByTags(tags, matchMode);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(articles, null, 2),
                    }],
                };
            }
        );

        server.registerTool(
            'get-article-content',
            {
                title: '获取文章全文',
                description: '根据文章 ID 获取知识库文章全文',
                inputSchema: z.object({
                    articleId: z.string().describe('文章 ID'),
                }),
            },
            async ({ articleId }) => {
                const article = await this.getArticleForTool(articleId);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(article, null, 2),
                    }],
                };
            }
        );

        server.registerTool(
            'get-article-summary',
            {
                title: '获取文章摘要',
                description: '获取文章的摘要信息，不包含完整内容',
                inputSchema: z.object({
                    articleId: z.string().describe('文章 ID'),
                }),
            },
            async ({ articleId }) => {
                const summary = await this.getArticleSummary(articleId);
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(summary, null, 2),
                    }],
                };
            }
        );

        server.registerTool(
            'list-tags',
            {
                title: '列出所有标签',
                description: '获取知识库中所有可用的标签',
                inputSchema: z.object({}),
            },
            async () => {
                await this.ensureSynced();
                const tags = this.tagRepo.findAll();
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify(tags, null, 2),
                    }],
                };
            }
        );
    }

    async startStdio(): Promise<void> {
        const transport = new StdioServerTransport();
        this.stdioServer = this.createServer();
        await this.stdioServer.connect(transport);
    }

    async startHttp(port: number): Promise<void> {
        const httpModule = await import('node:http');

        const server = httpModule.createServer(async (req, res) => {
            if (req.url === '/mcp' && req.method === 'POST') {
                const mcpServer = this.createServer();
                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: undefined,
                });
                try {
                    await mcpServer.connect(transport);
                    await transport.handleRequest(req, res);
                } catch (error) {
                    this.log.error('MCP 请求处理失败', { error: String(error) });
                    if (!res.headersSent) {
                        res.writeHead(500);
                        res.end();
                    }
                } finally {
                    res.on('close', () => {
                        transport.close().catch(() => undefined);
                        mcpServer.close().catch(() => undefined);
                    });
                }
            } else if (req.url === '/mcp') {
                res.writeHead(405);
                res.end();
            } else {
                res.writeHead(404);
                res.end();
            }
        });

        this.httpServer = server;
        await new Promise<void>((resolve) => {
            server.listen(port, () => resolve());
        });
    }

    async stop(): Promise<void> {
        if (this.httpServer) {
            await new Promise<void>((resolve, reject) => {
                this.httpServer!.close((err) => (err ? reject(err) : resolve()));
            });
            this.httpServer = null;
        }
        if (this.stdioServer) {
            await this.stdioServer.close();
            this.stdioServer = null;
        }
    }

    private async getArticleIndex(): Promise<ArticleIndexItem[]> {
        await this.ensureSynced();
        const articles = this.knowledgeRepo.findAll();
        return articles.map(a => ({
            id: a.id,
            title: a.title,
            summary: a.summary,
            platform: a.platform,
            tags: a.tags,
            createdAt: a.createdAt,
        }));
    }

    private async listArticleResources(): Promise<ArticleResourceItem[]> {
        await this.ensureSynced();
        const articles = this.knowledgeRepo.findAll();
        return articles.map(a => ({
            uri: `kb://articles/${a.id}`,
            name: a.title,
            description: a.summary,
            mimeType: 'text/markdown',
        }));
    }

    private async getArticleContent(articleId: string): Promise<string> {
        const article = await this.getArticle(articleId);
        return article.contentMarkdown;
    }

    private async searchArticles(query: string, tags?: string[], limit?: number): Promise<ArticleSearchItem[]> {
        await this.ensureSynced();
        const results = this.knowledgeRepo.search(query, tags, limit);
        return results.map(a => ({
            id: a.id,
            title: a.title,
            summary: a.summary,
            platform: a.platform,
            tags: a.tags,
            sourceUrl: a.sourceUrl,
            createdAt: a.createdAt,
        }));
    }

    private async getArticlesByTags(tags: string[], matchMode: 'any' | 'all'): Promise<ArticleSearchItem[]> {
        await this.ensureSynced();
        const allArticles = this.knowledgeRepo.findAll();
        return allArticles.filter(a => {
            if (!a.tags || a.tags.length === 0) return false;
            if (matchMode === 'all') {
                return tags.every(t => a.tags.includes(t));
            }
            return tags.some(t => a.tags.includes(t));
        }).map(a => ({
            id: a.id,
            title: a.title,
            summary: a.summary,
            platform: a.platform,
            tags: a.tags,
            sourceUrl: a.sourceUrl,
            createdAt: a.createdAt,
        }));
    }

    private async getArticleSummary(articleId: string): Promise<ArticleSummary> {
        const article = await this.getArticle(articleId);
        return {
            id: article.id,
            title: article.title,
            summary: article.summary,
            platform: article.platform,
            tags: article.tags,
            sourceUrl: article.sourceUrl,
            createdAt: article.createdAt,
        };
    }

    private async getArticleForTool(articleId: string): Promise<ArticleForTool> {
        const article = await this.getArticle(articleId);
        return {
            id: article.id,
            title: article.title,
            summary: article.summary,
            contentMarkdown: article.contentMarkdown,
            platform: article.platform,
            tags: article.tags,
            sourceUrl: article.sourceUrl,
            canonicalUrl: article.canonicalUrl,
            author: article.author,
            publishedAt: article.publishedAt,
            contentType: article.contentType,
            createdAt: article.createdAt,
            updatedAt: article.updatedAt,
        };
    }

    private async getArticle(articleId: string): Promise<Knowledge> {
        await this.ensureSynced();
        const article = this.knowledgeRepo.findById(articleId);
        if (!article) {
            throw new Error(`Article not found: ${articleId}`);
        }
        return article;
    }

    private async ensureSynced(): Promise<void> {
        await this.syncBeforeRead?.();
    }
}
