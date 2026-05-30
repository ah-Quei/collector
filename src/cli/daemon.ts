import { mkdirSync, openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { DAEMON_ENV, getConfigDir, getLogPath } from './paths.js';
import { isProcessRunning, readPid, removePidFile, writePid } from './pid.js';

export async function runStartDaemon(entrypointPath: string): Promise<void> {
    const configDir = getConfigDir();
    mkdirSync(configDir, { recursive: true });

    const logPath = getLogPath();
    const existingPid = readPid();
    if (existingPid && isProcessRunning(existingPid)) {
        console.log(`Collector 已在后台运行 (PID ${existingPid})`);
        console.log(`日志: ${logPath}`);
        process.exit(0);
    }
    if (existingPid) {
        removePidFile();
    }

    const out = openSync(logPath, 'a');
    const err = openSync(logPath, 'a');
    const child = spawn(process.execPath, [entrypointPath, 'start'], {
        detached: true,
        stdio: ['ignore', out, err],
        env: { ...process.env, [DAEMON_ENV]: '1' },
    });

    if (!child.pid) {
        console.error('Collector 后台启动失败，无法获取进程 PID');
        console.error(`日志: ${logPath}`);
        process.exit(1);
    }

    const pid = child.pid;
    child.unref();
    writePid(pid);

    await new Promise((resolve) => setTimeout(resolve, 500));
    if (!isProcessRunning(pid)) {
        if (readPid() === pid) {
            removePidFile();
        }
        console.error('Collector 后台启动失败，请查看日志');
        console.error(`日志: ${logPath}`);
        process.exit(1);
    }

    console.log(`Collector 已在后台启动 (PID ${pid})`);
    console.log(`日志: ${logPath}`);
}

export async function runStop(): Promise<void> {
    const pid = readPid();
    if (!pid) {
        console.log('Collector 未在后台运行');
        return;
    }

    if (!isProcessRunning(pid)) {
        removePidFile();
        console.log('Collector 未在后台运行，已清理过期 PID 文件');
        return;
    }

    process.kill(pid, 'SIGTERM');
    const stopped = await waitForExit(pid, 10000);
    if (!stopped) {
        console.error(`Collector 停止超时 (PID ${pid})`);
        process.exit(1);
    }

    removePidFile();
    console.log(`Collector 已停止 (PID ${pid})`);
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (!isProcessRunning(pid)) return true;
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return !isProcessRunning(pid);
}
