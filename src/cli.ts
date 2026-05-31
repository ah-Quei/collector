#!/usr/bin/env node

import { createRequire } from 'node:module';
import { runCheck } from './cli/check.js';
import { runStartDaemon, runStop } from './cli/daemon.js';
import { runInit } from './cli/init.js';
import { getEntrypointPath } from './cli/paths.js';
import { runStart } from './cli/start.js';
import { runUpdate } from './cli/update.js';

const command = process.argv[2];
const args = process.argv.slice(3);

if (command === '--version' || command === '-v' || command === 'version') {
    console.log(`collector ${getPackageVersion()}`);
    process.exit(0);
}

switch (command) {
    case 'init':
        await runInit();
        process.exit(0);
    case 'start':
        if (args.includes('-d') || args.includes('--daemon')) {
            await runStartDaemon(getEntrypointPath(import.meta.url));
            process.exit(0);
        } else {
            await runStart();
        }
        break;
    case 'stop':
        await runStop();
        process.exit(0);
    case 'check':
        await runCheck();
        process.exit(0);
    case 'update':
        try {
            await runUpdate(args);
            process.exit(0);
        } catch (error) {
            console.error(error instanceof Error ? error.message : String(error));
            process.exit(1);
        }
    default:
        console.log(`
Collector 2.0 - 个人知识收集系统

用法:
  collector init    初始化配置
  collector start   前台启动服务
  collector start -d
                   后台启动服务，日志写入配置目录
  collector stop    停止后台服务
  collector check   校验配置
  collector update  更新 Collector 程序和默认 Skills 模板
  collector --version
                   输出版本号
`);
        process.exit(command ? 1 : 0);
}

function getPackageVersion(): string {
    try {
        const require = createRequire(import.meta.url);
        const pkg = require('../package.json') as { version?: unknown };
        return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
    } catch {
        return '0.0.0';
    }
}
