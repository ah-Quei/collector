import { existsSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { runStop } from './daemon.js';
import { isProcessRunning, readPid } from './pid.js';
import { getConfigDir } from './paths.js';

interface UninstallArgs {
    purge: boolean;
    installDir?: string;
    appDir?: string;
    help: boolean;
}

export async function runUninstall(args: string[] = []): Promise<void> {
    const parsed = parseUninstallArgs(args);
    if (parsed.help) {
        printUninstallHelp();
        return;
    }

    const installDir = parsed.installDir ?? inferInstallDir();
    const appDir = parsed.appDir ?? process.env.COLLECTOR_APP_DIR ?? join(homedir(), '.local', 'lib', 'collector');
    const binaryPath = join(installDir, 'collector');
    const configDir = getConfigDir();

    const pid = readPid();
    if (pid && isProcessRunning(pid)) {
        await runStop();
    }

    removePath(binaryPath);
    removePath(appDir);

    if (parsed.purge) {
        removePath(configDir);
    }

    console.log('Collector 已卸载');
    if (!parsed.purge) {
        console.log(`已保留配置和数据: ${configDir}`);
        console.log('如需彻底删除，请运行: collector uninstall --purge');
    }
}

function parseUninstallArgs(args: string[]): UninstallArgs {
    const parsed: UninstallArgs = { purge: false, help: false };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                parsed.help = true;
                break;
            case '--purge':
                parsed.purge = true;
                break;
            case '--install-dir':
                parsed.installDir = readRequiredValue(args, ++i, arg);
                break;
            case '--app-dir':
                parsed.appDir = readRequiredValue(args, ++i, arg);
                break;
            default:
                throw new Error(`Unknown uninstall option: ${arg}`);
        }
    }
    return parsed;
}

function inferInstallDir(): string {
    const executable = process.argv[1] ?? '';
    if (executable.endsWith('/collector')) return dirname(executable);
    return process.env.COLLECTOR_INSTALL_DIR ?? join(homedir(), '.local', 'bin');
}

function removePath(path: string): void {
    if (!existsSync(path)) return;
    rmSync(path, { recursive: true, force: true });
    console.log(`已删除: ${path}`);
}

function readRequiredValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${option}`);
    }
    return value;
}

function printUninstallHelp(): void {
    console.log(`
用法:
  collector uninstall
  collector uninstall --purge

选项:
  --purge             同时删除配置、数据库、日志和 Skills
  --install-dir <dir> 指定 collector 命令安装目录
  --app-dir <dir>     指定 Collector 应用包目录
`);
}
