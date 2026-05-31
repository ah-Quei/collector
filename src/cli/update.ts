import { spawn } from 'node:child_process';
import { basename, dirname } from 'node:path';

const DEFAULT_REPO = 'ah-Quei/collector';

interface UpdateArgs {
    version?: string;
    repo?: string;
    installDir?: string;
    scriptUrl?: string;
    help: boolean;
}

export async function runUpdate(args: string[] = []): Promise<void> {
    const parsed = parseUpdateArgs(args);
    if (parsed.help) {
        printUpdateHelp();
        return;
    }

    const repo = parsed.repo ?? process.env.COLLECTOR_REPO ?? DEFAULT_REPO;
    const scriptUrl = parsed.scriptUrl
        ?? process.env.COLLECTOR_INSTALL_SCRIPT_URL
        ?? `https://raw.githubusercontent.com/${repo}/main/scripts/install.sh`;

    const env: NodeJS.ProcessEnv = {
        ...process.env,
        COLLECTOR_REPO: repo,
    };
    if (parsed.version) env.COLLECTOR_VERSION = parsed.version;
    if (parsed.installDir) {
        env.COLLECTOR_INSTALL_DIR = parsed.installDir;
    } else {
        const inferredInstallDir = inferCurrentInstallDir();
        if (inferredInstallDir && !env.COLLECTOR_INSTALL_DIR) {
            env.COLLECTOR_INSTALL_DIR = inferredInstallDir;
        }
    }

    const installerPath = process.env.COLLECTOR_INSTALLER_PATH;
    const child = installerPath
        ? spawn('bash', [installerPath], { env, stdio: 'inherit' })
        : spawn('bash', ['-c', 'curl -fsSL "$COLLECTOR_INSTALL_SCRIPT_URL" | bash'], {
            env: { ...env, COLLECTOR_INSTALL_SCRIPT_URL: scriptUrl },
            stdio: 'inherit',
        });

    const code = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });

    if (code !== 0) {
        throw new Error(`collector update failed with exit code ${code ?? 'unknown'}`);
    }
}

function parseUpdateArgs(args: string[]): UpdateArgs {
    const parsed: UpdateArgs = { help: false };

    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                parsed.help = true;
                break;
            case '--version':
                parsed.version = readRequiredValue(args, ++i, arg);
                break;
            case '--repo':
                parsed.repo = readRequiredValue(args, ++i, arg);
                break;
            case '--install-dir':
                parsed.installDir = readRequiredValue(args, ++i, arg);
                break;
            case '--script-url':
                parsed.scriptUrl = readRequiredValue(args, ++i, arg);
                break;
            default:
                throw new Error(`Unknown update option: ${arg}`);
        }
    }

    return parsed;
}

function readRequiredValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${option}`);
    }
    return value;
}

function inferCurrentInstallDir(): string | null {
    const executable = process.execPath;
    const executableName = basename(executable);
    return executableName === 'collector' || executableName.startsWith('collector-')
        ? dirname(executable)
        : null;
}

function printUpdateHelp(): void {
    console.log(`
用法:
  collector update
  collector update --version v0.2.0

选项:
  --version <tag>      更新到指定版本，默认 latest
  --repo <owner/repo>  指定 GitHub 仓库，默认 ${DEFAULT_REPO}
  --install-dir <dir>  指定 collector 安装目录
  --script-url <url>   指定安装脚本 URL
`);
}
