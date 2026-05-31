import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULT_CONFIG_PATH = join(homedir(), '.collector', 'config.yaml');
export const DAEMON_ENV = 'COLLECTOR_DAEMON';

export function getConfigPath(): string {
    return process.env.COLLECTOR_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;
}

export function getConfigDir(): string {
    return dirname(getConfigPath());
}

export function getPidPath(): string {
    return join(getConfigDir(), 'collector.pid');
}

export function getLogPath(): string {
    return join(getConfigDir(), 'collector.log');
}

export function getDefaultDataDir(): string {
    return join(homedir(), '.collector');
}

export function getDefaultSkillsDir(): string {
    return join(getConfigDir(), 'skills');
}

export function getEntrypointPath(importMetaUrl: string): string {
    return fileURLToPath(importMetaUrl);
}
