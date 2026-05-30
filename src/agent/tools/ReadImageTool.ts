import { tool } from '@openai/agents';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, relative } from 'node:path';
import { z } from 'zod';
import { ImageInputRegistry } from '../ImageInputRegistry.js';
import { resolveJobPath, toolFailure, toolSuccess } from './helpers.js';

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp']);

const MIME_MAP: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.webp': 'image/webp',
};

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

export function readImageTool(dataDir: string, imageInputRegistry?: ImageInputRegistry) {
    return tool({
        name: 'read_image_asset',
        description: 'Read one image file from the job asset directory and attach it to the next agent model turn as multimodal image input. Use the exact relative file path returned by opencli_run or list_asset_directory.',
        parameters: z.object({
            path: z.string().describe('Relative path to one image file within the job asset directory'),
        }),
        async execute({ path }, runContext) {
            const resolved = resolveJobPath(dataDir, runContext, path);
            if (!resolved.ok) return toolFailure(resolved.error);
            const { jobRoot, targetPath } = resolved;

            if (!existsSync(targetPath)) return toolFailure(`Image file not found: ${path}`);

            const stat = statSync(targetPath);
            if (stat.isDirectory()) {
                return toolFailure(`Path is a directory, not an image file: ${path}. Use a concrete image path from opencli_run or list_asset_directory.`);
            }
            if (!stat.isFile()) return toolFailure(`Path is not a file: ${path}`);
            if (stat.size > MAX_IMAGE_BYTES) return toolFailure(`Image file is too large (${stat.size} bytes, max ${MAX_IMAGE_BYTES}): ${path}`);

            const ext = extname(targetPath).toLowerCase();
            if (!IMAGE_EXTENSIONS.has(ext)) {
                return toolFailure(`Unsupported image format: ${path}. Supported formats: jpg, jpeg, png, gif, webp.`);
            }
            if (!imageInputRegistry) return toolFailure('Image input registry is unavailable; cannot attach image to agent conversation.');

            const mimeType = MIME_MAP[ext] ?? 'application/octet-stream';
            const data = readFileSync(targetPath);
            const image = imageInputRegistry.add({
                path: relative(jobRoot, targetPath),
                mimeType,
                size: data.length,
                dataUrl: `data:${mimeType};base64,${data.toString('base64')}`,
            });

            return toolSuccess({
                mode: 'image_inputs',
                count: 1,
                imageInputIds: [image.id],
                images: [image],
                note: 'The image content has been attached to the next agent model turn as multimodal input. Inspect it before finalizing the article.',
            });
        },
    });
}
