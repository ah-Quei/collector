import { existsSync } from 'node:fs';
import { Config } from '../config/Config.js';
import { DatabaseManager } from '../data/Database.js';
import { KnowledgeRepository } from '../data/KnowledgeRepository.js';
import { TagRepository } from '../data/TagRepository.js';
import { SkillLoader } from '../agent/SkillLoader.js';
import { IngestionAgentRunner } from '../agent/IngestionAgentRunner.js';
import { CollectionService } from '../services/CollectionService.js';
import { FeishuDocService } from '../services/FeishuDocService.js';
import { FeishuIngress } from '../adapters/feishu/FeishuIngress.js';
import { BrowserExtensionIngress } from '../adapters/browser/BrowserExtensionIngress.js';
import { KnowledgeBaseMCPServer } from '../mcp/KnowledgeBaseMCPServer.js';
import { Logger } from '../logging/Logger.js';
import type { BaseAdapter } from '../adapters/BaseAdapter.js';
import { DAEMON_ENV } from './paths.js';
import { readPid, registerDaemonPid, removePidFile } from './pid.js';

const FEISHU_DOCUMENT_SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000;

export async function runStart(): Promise<void> {
    const config = Config.load();
    const log = new Logger('main');

    Logger.setLevel(config.logging.level);

    log.info('Collector 2.0 启动中...');

    if (process.env[DAEMON_ENV] === '1') {
        registerDaemonPid();
    }

    if (!config.feishu.appId || !config.feishu.appSecret) {
        log.error('飞书 App ID 和 App Secret 未配置。请运行 "collector init" 初始化。');
        process.exit(1);
    }

    if (!config.llm.apiKey) {
        log.error('LLM API Key 未配置。请运行 "collector init" 初始化。');
        process.exit(1);
    }

    log.debug('配置已加载', {
        feishuAppId: config.feishu.appId,
        wikiSpaceId: config.feishu.wikiSpaceId,
        llmModel: config.llm.model,
        llmBaseUrl: config.llm.baseUrl,
        mcpEnabled: config.mcp.enabled,
        browserExtEnabled: config.browserExtension.enabled,
        skillsDir: config.skills.dir,
    });

    log.info('正在初始化数据库...');
    const dbManager = new DatabaseManager(config.database.path);
    const db = dbManager.connect();
    const knowledgeRepo = new KnowledgeRepository(db);
    const tagRepo = new TagRepository(db);
    log.info('数据库已连接', { path: config.database.path });

    log.info('正在加载 Agent 和 Skills...');
    const skillLoader = new SkillLoader();
    if (existsSync(config.skills.dir)) {
        skillLoader.loadFromDir(config.skills.dir);
    } else {
        log.warn('Skills 目录不存在，请重新运行安装脚本同步模板', {
            path: config.skills.dir,
        });
    }
    const agentRunner = new IngestionAgentRunner(config, skillLoader, tagRepo);

    const feishuDoc = new FeishuDocService(config.feishu, config.storage.dataDir);
    const collectionService = new CollectionService(
        knowledgeRepo, tagRepo, agentRunner, feishuDoc,
    );
    let feishuDocumentSyncTimer: ReturnType<typeof setInterval> | null = null;
    const runFeishuDocumentSync = (reason: 'startup' | 'scheduled') => {
        collectionService.syncFeishuDocumentsForMcp()
            .then(result => {
                log.info('飞书文档状态同步完成', { reason, ...result });
            })
            .catch(error => {
                log.error('飞书文档状态同步失败', { reason, error: String(error) });
            });
    };

    const adapters: BaseAdapter[] = [];

    const feishuIngress = new FeishuIngress(
        config.feishu,
        (ctx, reporter) => collectionService.handleIngress(ctx, reporter),
        (knowledgeId, chatId, reporter) => collectionService.reprocessKnowledge(knowledgeId, chatId, reporter),
    );
    adapters.push(feishuIngress);

    if (config.browserExtension.enabled) {
        const browserIngress = new BrowserExtensionIngress(config.browserExtension.port, (ctx, reporter) =>
            collectionService.handleIngress(ctx, reporter),
        );
        adapters.push(browserIngress);
    }

    let mcpServer: KnowledgeBaseMCPServer | null = null;
    if (config.mcp.enabled) {
        mcpServer = new KnowledgeBaseMCPServer(
            knowledgeRepo,
            tagRepo,
        );
    }

    const shutdown = async () => {
        log.info('正在关闭服务...');
        if (feishuDocumentSyncTimer) {
            clearInterval(feishuDocumentSyncTimer);
            feishuDocumentSyncTimer = null;
        }
        for (const adapter of adapters) {
            await adapter.stop();
        }
        await mcpServer?.stop();
        dbManager.close();
        if (process.env[DAEMON_ENV] === '1' && readPid() === process.pid) {
            removePidFile();
        }
        log.info('服务已停止');
        process.exit(0);
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    for (const adapter of adapters) {
        await adapter.start();
        log.info(`${adapter.name} 已启动`);
    }

    if (mcpServer) {
        if (config.mcp.transport === 'stdio') {
            await mcpServer.startStdio();
            log.info('MCP 服务已启动 (stdio)');
        } else {
            await mcpServer.startHttp(config.mcp.port);
            log.info(`MCP 服务已启动 (http, 端口 ${config.mcp.port})`);
        }
    }

    log.info('服务已就绪，等待消息...');
    runFeishuDocumentSync('startup');
    feishuDocumentSyncTimer = setInterval(
        () => runFeishuDocumentSync('scheduled'),
        FEISHU_DOCUMENT_SYNC_INTERVAL_MS,
    );
    feishuDocumentSyncTimer.unref?.();
}
