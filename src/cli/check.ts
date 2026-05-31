import { existsSync } from 'node:fs';
import { Config } from '../config/Config.js';

export async function runCheck(): Promise<void> {
    console.log('\n配置校验中...\n');

    const config = Config.load();

    console.log('飞书配置:');
    console.log(`  App ID: ${config.feishu.appId ? '✓' : '✗ 未配置'}`);
    console.log(`  App Secret: ${config.feishu.appSecret ? '✓' : '✗ 未配置'}`);
    console.log(`  Wiki Space ID: ${config.feishu.wikiSpaceId ? '✓' : '✗ 未配置'}`);

    console.log('\nLLM 配置:');
    console.log(`  API Base URL: ${config.llm.baseUrl}`);
    console.log(`  API Key: ${config.llm.apiKey ? '✓' : '✗ 未配置'}`);
    console.log(`  Model: ${config.llm.model}`);
    console.log(`  Vision: ${config.llm.vision ? '是' : '否'}`);
    console.log(`  Audio: ${config.llm.audio ? '是' : '否'}`);

    console.log('\nMCP 配置:');
    console.log(`  启用: ${config.mcp.enabled ? '是' : '否'}`);
    console.log(`  传输: ${config.mcp.transport}`);
    console.log(`  端口: ${config.mcp.port}`);

    console.log('\n数据库:');
    console.log(`  路径: ${config.database.path}`);
    console.log(`  存在: ${existsSync(config.database.path) ? '是' : '否'}`);

    console.log('\nSkills:');
    console.log(`  路径: ${config.skills.dir}`);
    console.log(`  存在: ${existsSync(config.skills.dir) ? '是' : '否'}`);

    console.log('\n校验完成');
}
