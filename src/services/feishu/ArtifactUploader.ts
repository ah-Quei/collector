import * as Lark from '@larksuiteoapi/node-sdk';
import { readFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { Logger } from '../../logging/Logger.js';
import { asFeishuDocxClient, type FeishuDocxClient } from './FeishuSdkTypes.js';

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export interface UploadSource {
    buffer: Buffer;
    fileName: string;
}

export class ArtifactUploader {
    private log = new Logger('feishu-artifact');
    private docxClient: FeishuDocxClient;

    constructor(
        client: Lark.Client,
        private dataDir: string | undefined,
        private writeIntervalMs: number,
    ) {
        this.docxClient = asFeishuDocxClient(client);
    }

    async insertImage(
        documentId: string,
        pathOrUrl: string,
        alt: string,
    ): Promise<void> {
        const source = await this.readUploadSource(pathOrUrl);
        await this.insertImageBuffer(documentId, source.buffer, source.fileName, alt);
    }

    async insertFile(
        documentId: string,
        pathOrUrl: string,
    ): Promise<void> {
        const source = await this.readUploadSource(pathOrUrl);
        await this.insertFileBuffer(documentId, source.buffer, source.fileName);
    }

    private async insertFileBuffer(
        documentId: string,
        buffer: Buffer,
        fileName: string,
    ): Promise<void> {
        const fileBlockRes = await this.docxClient.docx.documentBlockChildren.create({
            path: { document_id: documentId, block_id: documentId },
            params: { document_revision_id: -1 },
            data: {
                children: [{
                    block_type: 23,
                    file: {
                        view_type: 2,
                    },
                }],
            },
        });
        const createdBlock = fileBlockRes.data?.children?.[0];
        const fileBlockId = createdBlock?.block_type === 23
            ? createdBlock.block_id
            : createdBlock?.children?.[0];
        if (!fileBlockId) {
            throw new Error(`Failed to create Feishu file block: ${JSON.stringify(fileBlockRes)}`);
        }
        await sleep(this.writeIntervalMs);

        if (buffer.length > MAX_UPLOAD_BYTES) {
            throw new Error(`File is too large for Feishu upload_all (${buffer.length} bytes): ${fileName}`);
        }

        const uploadRes = await this.docxClient.drive.media.uploadAll({
            data: {
                file_name: fileName,
                parent_type: 'docx_file',
                parent_node: fileBlockId,
                size: buffer.length,
                file: buffer,
            },
        });
        const fileToken = uploadRes?.file_token;
        if (!fileToken) {
            throw new Error(`Feishu file upload returned no file_token: ${fileName}`);
        }

        await sleep(this.writeIntervalMs);
        await this.docxClient.docx.documentBlock.patch({
            path: { document_id: documentId, block_id: fileBlockId },
            params: { document_revision_id: -1 },
            data: {
                replace_file: {
                    token: fileToken,
                },
            },
        });
        await sleep(this.writeIntervalMs);

        this.log.debug('飞书文件已写入', { fileName, bytes: buffer.length });
    }

    private async insertImageBuffer(
        documentId: string,
        buffer: Buffer,
        fileName: string,
        alt: string,
    ): Promise<void> {
        const imageBlockRes = await this.docxClient.docx.documentBlockChildren.create({
            path: { document_id: documentId, block_id: documentId },
            params: { document_revision_id: -1 },
            data: {
                children: [{
                    block_type: 27,
                    image: {
                        align: 2,
                        caption: alt ? { content: alt } : undefined,
                    },
                }],
            },
        });
        const imageBlock = imageBlockRes.data?.children?.[0];
        if (!imageBlock?.block_id) {
            throw new Error(`Failed to create Feishu image block: ${JSON.stringify(imageBlockRes)}`);
        }
        await sleep(this.writeIntervalMs);

        if (buffer.length > MAX_UPLOAD_BYTES) {
            throw new Error(`Image is too large for Feishu upload_all (${buffer.length} bytes): ${fileName}`);
        }

        let imageToken: string | undefined;
        try {
            const uploadRes = await this.docxClient.drive.media.uploadAll({
                data: {
                    file_name: fileName,
                    parent_type: 'docx_image',
                    parent_node: imageBlock.block_id,
                    size: buffer.length,
                    file: buffer,
                },
            });
            imageToken = uploadRes?.file_token;
        } catch (err) {
            if (extractFeishuCode(err) === 99991672) {
                throw new Error('Feishu image upload failed: app is missing media upload permission, e.g. docs:document.media:upload or drive:drive.');
            }
            throw err;
        }

        if (!imageToken) {
            throw new Error(`Feishu image upload returned no file_token: ${fileName}`);
        }

        await sleep(this.writeIntervalMs);
        await this.docxClient.docx.documentBlock.patch({
            path: { document_id: documentId, block_id: imageBlock.block_id },
            params: { document_revision_id: -1 },
            data: {
                replace_image: {
                    token: imageToken,
                    align: 2,
                    caption: alt ? { content: alt } : undefined,
                },
            },
        });
        await sleep(this.writeIntervalMs);

        this.log.debug('飞书图片已写入', { fileName, bytes: buffer.length });
    }

    private async readUploadSource(pathOrUrl: string): Promise<UploadSource> {
        if (/^https?:\/\//i.test(pathOrUrl)) {
            const remote = await fetch(pathOrUrl);
            if (!remote.ok) {
                throw new Error(`Failed to download artifact for Feishu upload: ${remote.status} ${remote.statusText}`);
            }
            return {
                buffer: Buffer.from(await remote.arrayBuffer()),
                fileName: fileNameFromUrl(pathOrUrl),
            };
        }

        if (!this.dataDir) {
            throw new Error('Artifact upload requires a storage data directory');
        }

        const absolutePath = join(this.dataDir, pathOrUrl);
        return {
            buffer: readFileSync(absolutePath),
            fileName: basename(absolutePath),
        };
    }
}

function fileNameFromUrl(url: string): string {
    try {
        const { pathname } = new URL(url);
        const name = pathname.split('/').filter(Boolean).pop();
        return name || 'artifact';
    } catch {
        return 'artifact';
    }
}

function extractFeishuCode(error: unknown): number | undefined {
    if (!isObject(error)) return undefined;
    const response = isObject(error.response) ? error.response : undefined;
    const data = isObject(response?.data) ? response.data : undefined;
    return typeof data?.code === 'number' ? data.code : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
