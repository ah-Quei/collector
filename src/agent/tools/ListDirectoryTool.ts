import { tool } from '@openai/agents';
import { z } from 'zod';
import { statSync, existsSync } from 'node:fs';
import { listRecursive, listShallow, resolveJobPath, toolFailure, toolSuccess } from './helpers.js';

export function listDirectoryTool(dataDir: string) {
    return tool({
        name: 'list_asset_directory',
        description: 'List files and directories in the job asset directory. Useful for discovering downloaded content.',
        parameters: z.object({
            path: z.string().nullable().describe('Relative path within the job asset directory (defaults to root)'),
            recursive: z.boolean().nullable().describe('Whether to list recursively (defaults to false)'),
        }),
        async execute({ path, recursive }, runContext) {
            const resolved = resolveJobPath(dataDir, runContext, path);
            if (!resolved.ok) return toolFailure(resolved.error);
            const { jobRoot, targetPath } = resolved;

            if (!existsSync(targetPath)) return toolFailure(`Directory not found: ${path ?? '.'}`);
            if (!statSync(targetPath).isDirectory()) return toolFailure(`Path is a file, not a directory: ${path ?? '.'}`);

            const entries = recursive ? listRecursive(jobRoot, targetPath) : listShallow(jobRoot, targetPath);
            return toolSuccess(entries);
        },
    });
}
