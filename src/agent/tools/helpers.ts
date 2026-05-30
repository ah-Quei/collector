import { existsSync, readdirSync, statSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { isRecord } from '../../utils/guards.js';

export interface ToolRunContext {
    context?: {
        knowledgeId?: unknown;
    };
}

export type ToolResult<T> =
    | { ok: true; data: T }
    | { ok: false; error: string; data?: unknown };

export interface FileEntry {
    path: string;
    type: 'directory' | 'file';
    size?: number;
    extension?: string;
}

export function toolSuccess<T>(data: T): string {
    return JSON.stringify({ ok: true, data } satisfies ToolResult<T>);
}

export function toolFailure(error: string, data?: unknown): string {
    return JSON.stringify({ ok: false, error, data } satisfies ToolResult<never>);
}

export function getKnowledgeId(runContext: unknown, fallback: string = ''): string {
    if (!isRecord(runContext)) return fallback;
    const context = runContext.context;
    if (!isRecord(context)) return fallback;
    return typeof context.knowledgeId === 'string' && context.knowledgeId.length > 0
        ? context.knowledgeId
        : fallback;
}

export function getJobRoot(dataDir: string, runContext: unknown, fallbackKnowledgeId: string = ''): string {
    return resolve(dataDir, getKnowledgeId(runContext, fallbackKnowledgeId));
}

export function resolveJobPath(
    dataDir: string,
    runContext: unknown,
    path: string | null | undefined,
    fallbackKnowledgeId: string = '',
): { ok: true; jobRoot: string; targetPath: string } | { ok: false; error: string } {
    const jobRoot = getJobRoot(dataDir, runContext, fallbackKnowledgeId);
    const targetPath = resolve(jobRoot, path ?? '.');

    if (!isInside(jobRoot, targetPath)) {
        return { ok: false, error: `Invalid path outside job asset directory: ${path ?? '.'}` };
    }

    return { ok: true, jobRoot, targetPath };
}

export function listShallow(jobRoot: string, dirPath: string): FileEntry[] {
    return readdirSync(dirPath).sort().map((name) => {
        const fullPath = join(dirPath, name);
        const stat = statSync(fullPath);
        const entry: FileEntry = {
            path: relative(jobRoot, fullPath),
            type: stat.isDirectory() ? 'directory' : 'file',
        };

        if (stat.isFile()) {
            entry.size = stat.size;
            entry.extension = extname(name);
        }

        return entry;
    });
}

export function listRecursive(jobRoot: string, dirPath: string = jobRoot): FileEntry[] {
    if (!existsSync(dirPath)) return [];

    const entries: FileEntry[] = [];
    for (const name of readdirSync(dirPath).sort()) {
        const fullPath = join(dirPath, name);
        const stat = statSync(fullPath);
        const entryPath = relative(jobRoot, fullPath);

        if (stat.isDirectory()) {
            entries.push({ path: entryPath, type: 'directory' });
            entries.push(...listRecursive(jobRoot, fullPath));
        } else if (stat.isFile()) {
            entries.push({ path: entryPath, type: 'file', size: stat.size, extension: extname(name) });
        }
    }
    return entries;
}

export function truncateText(text: string, maxChars: number): { text: string; truncated: boolean } {
    if (text.length <= maxChars) return { text, truncated: false };
    return { text: `${text.slice(0, maxChars)}\n...(truncated)`, truncated: true };
}

function isInside(root: string, child: string): boolean {
    const childRelativeToRoot = relative(root, child);
    return childRelativeToRoot === '' || (!childRelativeToRoot.startsWith('..') && !isAbsolute(childRelativeToRoot));
}
