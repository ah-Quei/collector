import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import yaml from 'js-yaml';
import type { LogLevel } from '../logging/Logger.js';
import { isRecord } from '../utils/guards.js';

export interface FeishuConfig {
    appId: string;
    appSecret: string;
    wikiSpaceId: string;
    defaultParentNode?: string;
}

export interface LLMConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    maxTokens: number;
    vision: boolean;
    audio: boolean;
    functionCalling: boolean;
}

export interface OpenCLIConfig {
    enabled: boolean;
    bin: string;
    timeout: number;
}

export interface DatabaseConfig {
    path: string;
}

export interface StorageConfig {
    dataDir: string;
}

export interface SkillsConfig {
    dir: string;
}

export interface AgentConfig {
    maxSteps: number;
    maxOutputTokens: number;
}

export interface BrowserExtensionConfig {
    enabled: boolean;
    port: number;
}

export interface MCPConfig {
    enabled: boolean;
    transport: 'stdio' | 'http';
    port: number;
}

export interface LoggingConfig {
    level: LogLevel;
}

export interface AppConfig {
    feishu: FeishuConfig;
    llm: LLMConfig;
    opencli: OpenCLIConfig;
    database: DatabaseConfig;
    storage: StorageConfig;
    skills: SkillsConfig;
    agent: AgentConfig;
    browserExtension: BrowserExtensionConfig;
    mcp: MCPConfig;
    logging: LoggingConfig;
}

const DEFAULT_CONFIG_PATH = join(homedir(), '.collector', 'config.yaml');
export const DEFAULT_LLM_MODEL = 'gpt-4o-mini';

export class Config {
    public readonly feishu: FeishuConfig;
    public readonly llm: LLMConfig;
    public readonly opencli: OpenCLIConfig;
    public readonly database: DatabaseConfig;
    public readonly storage: StorageConfig;
    public readonly skills: SkillsConfig;
    public readonly agent: AgentConfig;
    public readonly browserExtension: BrowserExtensionConfig;
    public readonly mcp: MCPConfig;
    public readonly logging: LoggingConfig;

    constructor(data: Partial<AppConfig> = {}) {
        this.feishu = {
            appId: data.feishu?.appId ?? '',
            appSecret: data.feishu?.appSecret ?? '',
            wikiSpaceId: data.feishu?.wikiSpaceId ?? '',
            defaultParentNode: data.feishu?.defaultParentNode,
        };

        this.llm = {
            baseUrl: data.llm?.baseUrl ?? 'https://api.openai.com/v1',
            apiKey: data.llm?.apiKey ?? '',
            model: data.llm?.model ?? DEFAULT_LLM_MODEL,
            maxTokens: data.llm?.maxTokens ?? 16000,
            vision: data.llm?.vision ?? false,
            audio: data.llm?.audio ?? false,
            functionCalling: data.llm?.functionCalling ?? true,
        };

        this.opencli = {
            enabled: data.opencli?.enabled ?? true,
            bin: data.opencli?.bin ?? 'opencli',
            timeout: data.opencli?.timeout ?? 120,
        };

        this.database = {
            path: data.database?.path ?? join(homedir(), '.collector', 'data.db'),
        };

        this.storage = {
            dataDir: data.storage?.dataDir ?? join(homedir(), '.collector', 'data'),
        };

        this.skills = {
            dir: data.skills?.dir ?? join(homedir(), '.collector', 'skills'),
        };

        this.agent = {
            maxSteps: data.agent?.maxSteps ?? 12,
            maxOutputTokens: data.agent?.maxOutputTokens ?? 16000,
        };

        this.browserExtension = {
            enabled: data.browserExtension?.enabled ?? true,
            port: data.browserExtension?.port ?? 3001,
        };

        this.mcp = {
            enabled: data.mcp?.enabled ?? true,
            transport: data.mcp?.transport ?? 'http',
            port: data.mcp?.port ?? 3000,
        };

        this.logging = {
            level: data.logging?.level ?? 'info',
        };
    }

    /**
     * Load config from YAML file
     */
    static load(configPath?: string): Config {
        const path = configPath ?? process.env.COLLECTOR_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
        const loaded = existsSync(path) ? yaml.load(readFileSync(path, 'utf-8')) : {};
        const data = isRecord(loaded) ? loaded : {};
        const feishu = isRecord(data.feishu) ? data.feishu : {};
        const llm = isRecord(data.llm) ? data.llm : {};
        const llmCapabilities = isRecord(llm.capabilities) ? llm.capabilities : {};
        const opencli = isRecord(data.opencli) ? data.opencli : {};
        const database = isRecord(data.database) ? data.database : {};
        const storage = isRecord(data.storage) ? data.storage : {};
        const skills = isRecord(data.skills) ? data.skills : {};
        const agent = isRecord(data.agent) ? data.agent : {};
        const browserExtension = isRecord(data.browser_extension) ? data.browser_extension : {};
        const mcp = isRecord(data.mcp) ? data.mcp : {};
        const logging = isRecord(data.logging) ? data.logging : {};
        const defaultSkillsDir = join(dirname(path), 'skills');

        return new Config({
            feishu: {
                appId: process.env.COLLECTOR_FEISHU_APP_ID ?? stringValue(feishu.app_id, ''),
                appSecret: process.env.COLLECTOR_FEISHU_APP_SECRET ?? stringValue(feishu.app_secret, ''),
                wikiSpaceId: process.env.COLLECTOR_FEISHU_WIKI_SPACE_ID ?? stringValue(feishu.wiki_space_id, ''),
                defaultParentNode: optionalStringValue(feishu.default_parent_node),
            },
            llm: {
                baseUrl: process.env.COLLECTOR_LLM_BASE_URL ?? stringValue(llm.base_url, 'https://api.openai.com/v1'),
                apiKey: process.env.COLLECTOR_LLM_API_KEY ?? stringValue(llm.api_key, ''),
                model: process.env.COLLECTOR_LLM_MODEL ?? stringValue(llm.model, DEFAULT_LLM_MODEL),
                maxTokens: Number(process.env.COLLECTOR_LLM_MAX_TOKENS ?? numberValue(llm.max_tokens, 16000)),
                vision: process.env.COLLECTOR_LLM_VISION !== undefined
                    ? process.env.COLLECTOR_LLM_VISION === 'true'
                    : booleanValue(llmCapabilities.vision, false),
                audio: booleanValue(llmCapabilities.audio, false),
                functionCalling: booleanValue(llmCapabilities.function_calling, true),
            },
            opencli: {
                enabled: booleanValue(opencli.enabled, true),
                bin: stringValue(opencli.bin, 'opencli'),
                timeout: numberValue(opencli.timeout, 120),
            },
            database: {
                path: process.env.COLLECTOR_DATA_DIR
                    ? join(process.env.COLLECTOR_DATA_DIR, 'data.db')
                    : stringValue(database.path, join(homedir(), '.collector', 'data.db')),
            },
            storage: {
                dataDir: process.env.COLLECTOR_DATA_DIR ?? stringValue(storage.data_dir, join(homedir(), '.collector', 'data')),
            },
            skills: {
                dir: process.env.COLLECTOR_SKILLS_DIR ?? stringValue(skills.dir, defaultSkillsDir),
            },
            agent: {
                maxSteps: numberValue(agent.max_steps, 12),
                maxOutputTokens: numberValue(agent.max_output_tokens, 16000),
            },
            browserExtension: {
                enabled: booleanValue(browserExtension.enabled, true),
                port: Number(process.env.COLLECTOR_BROWSER_EXT_PORT ?? numberValue(browserExtension.port, 3001)),
            },
            mcp: {
                enabled: process.env.COLLECTOR_MCP_ENABLED !== undefined
                    ? process.env.COLLECTOR_MCP_ENABLED !== 'false'
                    : booleanValue(mcp.enabled, true),
                transport: mcp.transport === 'stdio' ? 'stdio' : 'http',
                port: Number(process.env.COLLECTOR_MCP_PORT ?? numberValue(mcp.port, 3000)),
            },
            logging: {
                level: parseLogLevel(process.env.COLLECTOR_LOG_LEVEL ?? logging.level),
            },
        });
    }

    /**
     * Save config to YAML file
     */
    save(configPath?: string): void {
        const path = configPath ?? DEFAULT_CONFIG_PATH;
        const dir = dirname(path);
        mkdirSync(dir, { recursive: true });

        const data = {
            feishu: {
                app_id: this.feishu.appId,
                app_secret: this.feishu.appSecret,
                wiki_space_id: this.feishu.wikiSpaceId,
                default_parent_node: this.feishu.defaultParentNode,
            },
            llm: {
                base_url: this.llm.baseUrl,
                api_key: this.llm.apiKey,
                model: this.llm.model,
                max_tokens: this.llm.maxTokens,
                capabilities: {
                    vision: this.llm.vision,
                    audio: this.llm.audio,
                    function_calling: this.llm.functionCalling,
                },
            },
            opencli: this.opencli,
            database: { path: this.database.path },
            storage: { data_dir: this.storage.dataDir },
            skills: { dir: this.skills.dir },
            agent: {
                max_steps: this.agent.maxSteps,
                max_output_tokens: this.agent.maxOutputTokens,
            },
            browser_extension: this.browserExtension,
            mcp: this.mcp,
            logging: this.logging,
        };

        writeFileSync(path, yaml.dump(data, { lineWidth: -1 }), 'utf-8');
    }
}

function stringValue(value: unknown, fallback: string): string {
    return typeof value === 'string' ? value : fallback;
}

function optionalStringValue(value: unknown): string | undefined {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function parseLogLevel(value: unknown): LogLevel {
    return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
        ? value
        : 'info';
}
