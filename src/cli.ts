#!/usr/bin/env node

import { runCheck } from './cli/check.js';
import { runStartDaemon, runStop } from './cli/daemon.js';
import { runInit } from './cli/init.js';
import { getBundledSkillsDir, getEntrypointPath } from './cli/paths.js';
import { runStart } from './cli/start.js';

const command = process.argv[2];
const args = process.argv.slice(3);

switch (command) {
    case 'init':
        await runInit();
        process.exit(0);
    case 'start':
        if (args.includes('-d') || args.includes('--daemon')) {
            await runStartDaemon(getEntrypointPath(import.meta.url));
            process.exit(0);
        } else {
            await runStart(getBundledSkillsDir(import.meta.url));
        }
        break;
    case 'stop':
        await runStop();
        process.exit(0);
    case 'check':
        await runCheck();
        process.exit(0);
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
`);
        process.exit(command ? 1 : 0);
}
