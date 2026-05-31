import { existsSync, mkdirSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { Config, DEFAULT_LLM_MODEL } from '../config/Config.js';
import { getBotOpenId } from './auth.js';
import { confirm, prompt } from './prompt.js';
import { getConfigPath, getDefaultDataDir, getDefaultSkillsDir } from './paths.js';

export async function runInit(): Promise<void> {
    printInitBanner();

    printStep('1. 飞书应用');
    printFeishuBotSetupIntro();
    const detectedAppId = runLarkCliAppConfig();

    const appId = detectedAppId ?? await promptWithRequired('飞书 App ID');
    if (detectedAppId) {
        console.log(`  App ID: ${appId}`);
    }

    printStep('2. 应用密钥');
    printAppSecretHelp(appId);
    const appSecret = await promptWithRequired('飞书 App Secret');

    printStep('3. 权限与回调');
    printFeishuManualChecklist(appId);

    printStep('4. 知识库');
    const useExisting = await confirm('使用已有知识库? (输入 N 自动创建)', true);
    const wikiSpaceId = useExisting
        ? await promptWithRequired('知识库 Space ID')
        : await createWikiSpaceWithUserAuth(appId, appSecret);
    const defaultParentNode = useExisting ? await prompt('默认父节点 Token (可选)') || undefined : undefined;

    printStep('5. 模型与本地服务');
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
    const skillsDir = process.env.COLLECTOR_SKILLS_DIR ?? getDefaultSkillsDir();

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
        skills: { dir: skillsDir },
        mcp: { enabled: enableMcp, transport: 'http', port: mcpPort },
        browserExtension: { enabled: enableBrowserExt, port: browserExtPort },
    });

    config.save(configPath);

    console.log(`\n${style.success('✓')} 配置已保存: ${style.path(configPath)}`);
    printPostInitSummary(configPath, skillsDir);
    console.log(`\n${style.success('✓ 初始化完成')}\n`);
}

function printInitBanner(): void {
    console.log('');
    console.log(style.accent('╔═══════════════════════════════════════════════════════════════╗'));
    console.log(style.accent('║') + style.title('                    Collector 2.0 初始化向导                   ') + style.accent('║'));
    console.log(style.accent('║') + style.muted('              飞书机器人、知识库与本地服务配置                 ') + style.accent('║'));
    console.log(style.accent('╚═══════════════════════════════════════════════════════════════╝'));
}

function printStep(title: string): void {
    console.log(`\n${style.accent('┌─')} ${style.step(title)}`);
    console.log(style.muted('└──────────────────────────────────────────────────────────────'));
}

function printFeishuBotSetupIntro(): void {
    console.log('  Collector 使用飞书企业自建应用的机器人能力接收消息。');
    console.log('  接下来会进入 lark-cli 一键配置流程，请按二维码或链接完成授权。');
    console.log('  权限、回调和发布仍需要在飞书开放平台确认。');
}

function runLarkCliAppConfig(): string | null {
    if (!hasLarkCli()) {
        console.log('\n未检测到 lark-cli，无法自动打开飞书应用配置流程。');
        console.log('请安装/配置 lark-cli，或手动进入 https://open.feishu.cn/app 创建/选择企业自建应用。');
        return null;
    }

    const result = spawnSync('lark-cli', ['config', 'init', '--new', '--brand', 'feishu', '--lang', 'zh'], {
        stdio: 'inherit',
    });
    if (result.error) {
        console.log(`\nlark-cli 启动失败: ${result.error.message}`);
        console.log('请手动进入 https://open.feishu.cn/app 创建/选择企业自建应用。');
        return null;
    }
    if (result.status !== 0) {
        console.log(`\n${style.warn('⚠')} lark-cli 应用配置流程未正常完成，退出码: ${result.status ?? 'unknown'}`);
        console.log('如果你已经有可用应用，可以继续填写 App ID 和 App Secret。');
        return null;
    }

    const appId = readLarkCliAppId();
    if (appId) {
        return appId;
    } else {
        console.log('\n未能从 lark-cli 读取 App ID，请从飞书开放平台应用详情页复制。');
        return null;
    }
}


function printAppSecretHelp(appId: string): void {
    const { baseinfo } = getFeishuConsoleLinks(appId);
    console.log('  lark-cli 只会显示脱敏 App Secret，Collector 需要明文写入本机配置。');
    console.log(`  打开: ${style.link(baseinfo)}`);
    console.log('  位置: 凭证与基础信息 -> App Secret -> 显示/复制');
}

function printFeishuManualChecklist(appId: string): void {
    const links = getFeishuConsoleLinks(appId);
    console.log(`  ${style.label('应用身份权限')}`);
    console.log(`  - 知识库写入: ${style.link(links.wikiNodeAuth)}`);
    console.log(`    开通任一权限: ${style.code('wiki:wiki')} / ${style.code('wiki:node:create')}`);
    console.log(`  - 素材上传: ${style.link(links.mediaUploadAuth)}`);
    console.log(`    开通任一权限: ${style.code('docs:document.media:upload')} / ${style.code('drive:drive')}`);
    console.log('');
    console.log(`  ${style.label('事件与回调')}`);
    console.log(`  - 卡片回调: ${style.link(links.event)}`);
    console.log(`    添加回调: ${style.code('card.action.trigger')}`);
    console.log('');
    console.log(`  ${style.warn('!')} 最后创建新版本并发布应用，否则以上配置不会生效。`);
}

async function createWikiSpaceWithUserAuth(appId: string, appSecret: string): Promise<string> {
    const name = await prompt('知识库名称', '我的知识库');
    const description = await prompt('知识库描述', '个人知识收集与整理');

    try {
        console.log('  将使用 lark-cli 用户身份创建知识库。');
        ensureLarkCliAvailable();
        ensureLarkCliUserAuth();

        const wikiSpaceId = createWikiSpaceByLarkCli(name, description);
        console.log(`  ${style.success('✓')} 已创建知识库: ${name}`);
        console.log(`    Space ID: ${style.code(wikiSpaceId)}`);

        const addResult = await addBotAsWikiAdminByLarkCli(appId, appSecret, wikiSpaceId);
        if (addResult) {
            console.log(`  ${style.success('✓')} 已将机器人添加为知识库管理员`);
        } else {
            console.log(`  ${style.warn('⚠')} 添加机器人到知识库失败，可稍后重新执行 init 或手动排查 wiki:member:create 权限`);
        }

        return wikiSpaceId;
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`\n创建知识库失败: ${msg}`);
        console.error('请手动输入知识库 Space ID 继续初始化。');
        return await promptWithRequired('知识库 Space ID');
    }
}

function ensureLarkCliAvailable(): void {
    if (!hasLarkCli()) {
        throw new Error('未检测到 lark-cli，无法使用用户身份自动创建知识库');
    }
}

function ensureLarkCliUserAuth(): void {
    console.log('  正在检查/获取 lark-cli 用户授权...');
    const result = spawnSync('lark-cli', ['auth', 'login', '--scope', 'wiki:wiki'], {
        stdio: 'inherit',
    });
    if (result.error) {
        throw new Error(`lark-cli 用户授权启动失败: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`lark-cli 用户授权失败，退出码: ${result.status ?? 'unknown'}`);
    }
}

function createWikiSpaceByLarkCli(name: string, description: string): string {
    console.log('  正在使用 lark-cli --as user 创建知识库...');
    const data = JSON.stringify({ name, description });
    const result = spawnSync('lark-cli', [
        'wiki',
        'spaces',
        'create',
        '--as',
        'user',
        '--yes',
        '--format',
        'json',
        '--data',
        data,
    ], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.error) {
        throw new Error(`lark-cli 创建知识库启动失败: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`lark-cli 创建知识库失败: ${result.stderr || result.stdout || result.status}`);
    }

    const dataOut = parseJsonObject(result.stdout);
    const space = getRecord(dataOut.data)?.space ?? dataOut.space;
    const spaceId = getRecord(space)?.space_id;
    if (typeof spaceId !== 'string' || !spaceId) {
        throw new Error(`lark-cli 创建知识库成功但未返回 space_id: ${result.stdout}`);
    }
    return spaceId;
}

async function addBotAsWikiAdminByLarkCli(appId: string, appSecret: string, wikiSpaceId: string): Promise<boolean> {
    const botOpenId = await getBotOpenId(appId, appSecret);
    if (!botOpenId) {
        console.log('⚠ 未能获取机器人 Open ID，请确认应用已启用机器人能力');
        return false;
    }

    const params = JSON.stringify({ space_id: wikiSpaceId });
    const data = JSON.stringify({
        member_type: 'openid',
        member_id: botOpenId,
        member_role: 'admin',
    });
    const result = spawnSync('lark-cli', [
        'wiki',
        'members',
        'create',
        '--as',
        'user',
        '--yes',
        '--format',
        'json',
        '--params',
        params,
        '--data',
        data,
    ], {
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (result.status === 0) {
        return true;
    }
    console.log(result.stderr || result.stdout || `lark-cli 退出码: ${result.status ?? 'unknown'}`);
    return false;
}

function parseJsonObject(text: string): Record<string, unknown> {
    const parsed: unknown = JSON.parse(text);
    return getRecord(parsed) ?? {};
}

function getRecord(value: unknown): Record<string, unknown> | null {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getFeishuConsoleLinks(appId: string): {
    baseinfo: string;
    auth: string;
    event: string;
    wikiNodeAuth: string;
    mediaUploadAuth: string;
} {
    const base = `https://open.feishu.cn/app/${encodeURIComponent(appId)}`;
    return {
        baseinfo: `${base}/baseinfo`,
        auth: `${base}/auth`,
        event: `${base}/event`,
        wikiNodeAuth: `${base}/auth?q=wiki%3Awiki%2Cwiki%3Anode%3Acreate&op_from=openapi&token_type=tenant`,
        mediaUploadAuth: `${base}/auth?q=docs%3Adoc%2Cdrive%3Adrive%2Csheets%3Aspreadsheet%2Cvc%3Amaterial%2Cbitable%3Aapp%2Cmoments%3Amoments%2Cdocs%3Adocument.media%3Aupload%2Cmail%3Auser_mailbox.message%3Amodify&op_from=openapi&token_type=tenant`,
    };
}

function printPostInitSummary(configPath: string, skillsDir: string): void {
    console.log(`\n${style.step('下一步')}`);
    console.log(`  配置文件: ${style.path(configPath)}`);
    console.log(`  Skills 目录: ${style.path(skillsDir)}`);
    if (!existsSync(skillsDir)) {
        console.log(`  ${style.warn('!')} Skills 目录尚未初始化，请重新运行安装脚本同步模板`);
    }
    console.log(`  1. ${style.code('collector check')}`);
    console.log(`  2. ${style.code('collector start')}`);
    console.log('  3. 给机器人发送一条消息，确认能收到处理进度卡片');
    console.log('  收不到消息时，优先检查应用是否已发布、事件是否订阅为长连接、机器人是否在群里。');
}

async function promptWithRequired(question: string, defaultValue?: string): Promise<string> {
    while (true) {
        const answer = await prompt(question, defaultValue);
        if (answer.length > 0) return answer;
        console.log(`${question} 不能为空。`);
    }
}

function hasLarkCli(): boolean {
    try {
        execFileSync('lark-cli', ['--version'], { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

function readLarkCliAppId(): string | null {
    try {
        const output = execFileSync('lark-cli', ['config', 'show'], {
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        });
        const match = output.match(/"appId"\s*:\s*"([^"]+)"/);
        return match?.[1] ?? null;
    } catch {
        return null;
    }
}

const colorEnabled = process.stdout.isTTY && !process.env.NO_COLOR;

function color(code: number, text: string): string {
    return colorEnabled ? `\x1b[${code}m${text}\x1b[0m` : text;
}

const style = {
    accent: (text: string) => color(36, text),
    title: (text: string) => color(1, text),
    step: (text: string) => color(96, text),
    label: (text: string) => color(1, text),
    link: (text: string) => color(4, color(36, text)),
    code: (text: string) => color(33, text),
    path: (text: string) => color(32, text),
    success: (text: string) => color(32, text),
    warn: (text: string) => color(33, text),
    muted: (text: string) => color(2, text),
};
