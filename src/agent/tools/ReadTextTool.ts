import { tool } from '@openai/agents';
import { z } from 'zod';
import { readFileSync, statSync, existsSync } from 'node:fs';
import { resolveJobPath, toolFailure, toolSuccess, truncateText } from './helpers.js';

const MAX_READ_BYTES = 500 * 1024;

export function readTextTool(dataDir: string) {
    return tool({
        name: 'read_text_asset',
        description: 'Read a text file (Markdown, HTML, JSON, plain text, etc.) from the job asset directory.',
        parameters: z.object({
            path: z.string().describe('Relative path to a text file within the job asset directory'),
        }),
        async execute({ path }, runContext) {
            const resolved = resolveJobPath(dataDir, runContext, path);
            if (!resolved.ok) return toolFailure(resolved.error);
            const { targetPath } = resolved;

            if (!existsSync(targetPath)) return toolFailure(`File not found: ${path}`);
            if (statSync(targetPath).isDirectory()) return toolFailure(`Path is a directory, not a file: ${path}`);

            const { text, truncated } = truncateText(readFileSync(targetPath, 'utf-8'), MAX_READ_BYTES);
            return toolSuccess({ content: text, truncated });
        },
    });
}
