import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Config, DEFAULT_LLM_MODEL } from '../config/Config.js';
import { FeishuDocService } from '../services/FeishuDocService.js';
import { addBotAsWikiAdmin, getUserAccessToken } from './auth.js';
import { confirm, prompt } from './prompt.js';
import { getConfigPath, getDefaultDataDir } from './paths.js';

export async function runInit(): Promise<void> {
    console.log('\n╔═══════════════════════════════════════════════════════════════╗');
    console.log('║                    Collector 2.0 初始化向导                    ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝\n');

    const appId = await prompt('飞书 App ID');
    const appSecret = await prompt('飞书 App Secret');

    const useExisting = await confirm('使用已有知识库? (输入 N 自动创建)', true);

    let wikiSpaceId: string;
    let defaultParentNode: string | undefined;

    if (useExisting) {
        wikiSpaceId = await prompt('知识库 Space ID');
        defaultParentNode = await prompt('默认父节点 Token (可选)') || undefined;
    } else {
        const name = await prompt('知识库名称', '我的知识库');
        const description = await prompt('知识库描述', '个人知识收集与整理');

        try {
            console.log('\n正在获取授权...');
            const userAccessToken = await getUserAccessToken(appId, appSecret);
            console.log('✓ 授权成功');

            const feishuDoc = new FeishuDocService({ appId, appSecret, wikiSpaceId: '' });
            wikiSpaceId = await feishuDoc.createWikiSpace(name, description, userAccessToken);
            console.log(`✓ 已创建知识库: ${name} (Space ID: ${wikiSpaceId})`);

            const addResult = await addBotAsWikiAdmin(appId, appSecret, wikiSpaceId, userAccessToken);
            if (addResult === 'added') {
                console.log('✓ 已将 bot 添加为知识库管理员');
            } else if (addResult === 'failed') {
                console.log('⚠ 添加 bot 到知识库失败，可稍后手动添加');
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : String(error);
            console.error(`\n创建知识库失败: ${msg}`);
            console.error('\n请手动输入知识库 Space ID:');
            wikiSpaceId = await prompt('知识库 Space ID');
            defaultParentNode = await prompt('默认父节点 Token (可选)') || undefined;
        }
    }

    const llmBaseUrl = await prompt('LLM API Base URL', 'https://api.openai.com/v1');
    const llmApiKey = await prompt('LLM API Key');
    const llmModel = await prompt('LLM Model', DEFAULT_LLM_MODEL);

    const supportVision = await confirm('模型是否支持图片理解?', true);
    const supportAudio = await confirm('模型是否支持音频理解?', false);

    const enableMcp = await confirm('是否启用 MCP 服务?', true);
    const mcpPort = enableMcp ? Number(await prompt('MCP 服务端口', '3000')) : 3000;

    const enableBrowserExt = await confirm('是否启用浏览器扩展入口?', true);
    const browserExtPort = enableBrowserExt ? Number(await prompt('浏览器扩展端口', '3001')) : 3001;

    const configPath = getConfigPath();
    const dataDir = getDefaultDataDir();

    mkdirSync(dirname(configPath), { recursive: true });

    const config = new Config({
        feishu: { appId, appSecret, wikiSpaceId, defaultParentNode },
        llm: {
            baseUrl: llmBaseUrl,
            apiKey: llmApiKey,
            model: llmModel,
            maxTokens: 16000,
            vision: supportVision,
            audio: supportAudio,
            functionCalling: true,
        },
        database: { path: join(dataDir, 'data.db') },
        storage: { dataDir: join(dataDir, 'data') },
        mcp: { enabled: enableMcp, transport: 'http', port: mcpPort },
        browserExtension: { enabled: enableBrowserExt, port: browserExtPort },
    });

    config.save(configPath);

    console.log(`\n✓ 配置已保存到 ${configPath}`);
    console.log('✓ 初始化完成\n');
}
