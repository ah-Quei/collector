import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { getPidPath } from './paths.js';

export function isProcessRunning(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        return code === 'EPERM';
    }
}

export function readPid(): number | null {
    const pidPath = getPidPath();
    if (!existsSync(pidPath)) return null;

    const raw = readFileSync(pidPath, 'utf-8').trim();
    const pid = Number(raw);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function writePid(pid: number): void {
    const pidPath = getPidPath();
    mkdirSync(dirname(pidPath), { recursive: true });
    writeFileSync(pidPath, `${pid}\n`, 'utf-8');
}

export function removePidFile(): void {
    const pidPath = getPidPath();
    if (existsSync(pidPath)) {
        unlinkSync(pidPath);
    }
}

export function registerDaemonPid(): void {
    writePid(process.pid);

    process.once('exit', () => {
        if (readPid() === process.pid) {
            removePidFile();
        }
    });
}
