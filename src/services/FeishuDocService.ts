import * as Lark from '@larksuiteoapi/node-sdk';
import type { FeishuConfig } from '../config/Config.js';
import { Logger } from '../logging/Logger.js';
import type { AttachmentInfo } from '../models/Knowledge.js';
import { ArtifactUploader } from './feishu/ArtifactUploader.js';
import { asFeishuDocxClient, type FeishuConvertedBlock, type FeishuDescendantBlock, type FeishuDocxClient } from './feishu/FeishuSdkTypes.js';
import { expandInlineArtifactSegments, replaceInlineArtifactMarkers, splitMarkdownForNativeBlocks } from './feishu/MarkdownSegments.js';
import { createTableBlocks, MAX_NATIVE_TABLE_CELLS, shouldSplitTable, splitLargeTable } from './feishu/TableBlocks.js';

export interface DocCreateResult {
    documentId: string;
    wikiNodeToken?: string;
}

const BLOCK_BATCH_SIZE = 50;
const FEISHU_WRITE_INTERVAL_MS = 360;
const FEISHU_STATUS_READ_INTERVAL_MS = 220;
const FEISHU_RESOURCE_DELETED_CODE = 1770003;

export class FeishuDocService {
    private client: FeishuDocxClient;
    private log = new Logger('feishu-doc');
    private artifactUploader: ArtifactUploader;
    private lastStatusReadAt = 0;

    constructor(
        private config: FeishuConfig,
        dataDir?: string,
    ) {
        const client = new Lark.Client({
            appId: config.appId,
            appSecret: config.appSecret,
        });
        this.client = asFeishuDocxClient(client);
        this.artifactUploader = new ArtifactUploader(client, dataDir, FEISHU_WRITE_INTERVAL_MS);
    }

    async createDocument(
        title: string,
        contentMarkdown: string,
        attachments: AttachmentInfo[] = [],
        wikiSpaceId?: string,
        parentNodeToken?: string,
    ): Promise<DocCreateResult> {
        this.log.info('正在创建飞书文档...', { title, contentLength: contentMarkdown.length });
        this.log.debug('文档内容预览', { preview: contentMarkdown.slice(0, 500) });

        const spaceId = wikiSpaceId ?? this.config.wikiSpaceId;
        const parentToken = parentNodeToken ?? this.config.defaultParentNode;
        const createResult = spaceId
            ? await this.createWikiDocument(spaceId, title, parentToken)
            : await this.createDriveDocument(title);
        const documentId = createResult.documentId;
        if (!documentId) {
            throw new Error(`Failed to create document: ${JSON.stringify(createResult)}`);
        }
        this.log.debug('文档已创建', { documentId, wikiNodeToken: createResult.wikiNodeToken });

        // Step 1: Add content blocks under the document root. Plain Markdown
        // goes through Feishu's converter; tables/images use native docx APIs
        // because converted table/image blocks cannot be inserted reliably.
        await this.writeMarkdownWithNativeBlocks(documentId, contentMarkdown, attachments);

        return createResult;
    }

    async replaceDocumentContent(
        documentId: string,
        title: string,
        contentMarkdown: string,
        attachments: AttachmentInfo[] = [],
        wikiNodeToken?: string,
    ): Promise<void> {
        this.log.info('正在覆盖飞书文档...', { documentId, title, contentLength: contentMarkdown.length });
        await this.updateWikiDocumentTitle(title, wikiNodeToken);
        await this.clearDocumentRootChildren(documentId);
        await this.writeMarkdownWithNativeBlocks(documentId, contentMarkdown, attachments);
    }

    async isDocumentDeleted(documentId: string): Promise<boolean> {
        try {
            await this.throttleStatusRead();
            await this.client.docx.document.get({
                path: { document_id: documentId },
            });
            return false;
        } catch (error) {
            const feishuError = extractFeishuError(error);
            if (feishuError.code === FEISHU_RESOURCE_DELETED_CODE || feishuError.msg === 'resource deleted') {
                return true;
            }
            this.log.warn('检查飞书文档删除状态失败，暂不删除本地记录', {
                documentId,
                code: feishuError.code,
                msg: feishuError.msg,
                error: feishuError.message,
            });
            return false;
        }
    }

    private async createWikiDocument(spaceId: string, title: string, parentNodeToken?: string): Promise<DocCreateResult> {
        const res = await this.client.wiki.spaceNode.create({
            path: { space_id: spaceId },
            data: {
                obj_type: 'docx',
                node_type: 'origin',
                parent_node_token: parentNodeToken ?? '',
                title,
            },
        });
        const node = res.data?.node;
        const documentId = node?.obj_token;
        if (!documentId) {
            throw new Error(`Failed to create wiki document: ${JSON.stringify(res)}`);
        }
        this.log.info('知识库文档节点已创建', {
            documentId,
            wikiNodeToken: node.node_token,
            spaceId,
        });
        return {
            documentId,
            wikiNodeToken: node.node_token,
        };
    }

    private async createDriveDocument(title: string): Promise<DocCreateResult> {
        const docRes = await this.client.docx.document.create({
            data: { title },
        });
        const documentId = docRes.data?.document?.document_id;
        if (!documentId) {
            throw new Error(`Failed to create document: ${JSON.stringify(docRes)}`);
        }
        return { documentId };
    }

    private async updateWikiDocumentTitle(title: string, wikiNodeToken?: string): Promise<void> {
        const spaceId = this.config.wikiSpaceId;
        if (!spaceId || !wikiNodeToken) return;

        await this.client.wiki.spaceNode.updateTitle({
            path: { space_id: spaceId, node_token: wikiNodeToken },
            data: { title },
        });
        await sleep(FEISHU_WRITE_INTERVAL_MS);
        this.log.debug('知识库文档标题已更新', { wikiNodeToken, title });
    }

    private async clearDocumentRootChildren(documentId: string): Promise<void> {
        const rootChildren = await this.client.docx.documentBlockChildren.get({
            path: { document_id: documentId, block_id: documentId },
            params: { document_revision_id: -1, page_size: 500 },
        });
        const children = rootChildren.data?.items ?? rootChildren.data?.children ?? [];
        const childCount = Array.isArray(children) ? children.length : 0;
        if (childCount === 0) {
            this.log.debug('飞书文档没有旧内容块，无需清空', { documentId });
            return;
        }

        await this.client.docx.documentBlockChildren.batchDelete({
            path: { document_id: documentId, block_id: documentId },
            params: { document_revision_id: -1 },
            data: {
                start_index: 0,
                end_index: childCount,
            },
        });
        await sleep(FEISHU_WRITE_INTERVAL_MS);
        this.log.debug('飞书文档旧内容块已清空', { documentId, childCount });
    }

    private async writeMarkdownWithNativeBlocks(
        documentId: string,
        contentMarkdown: string,
        attachments: AttachmentInfo[],
    ): Promise<void> {
        const attachmentById = new Map(attachments.filter((item) => item.id).map((item) => [item.id!, item]));
        const segments = expandInlineArtifactSegments(splitMarkdownForNativeBlocks(contentMarkdown), attachmentById);
        this.log.debug('Markdown 已切分为飞书块段落', {
            segmentCount: segments.length,
            tableCount: segments.filter((segment) => segment.type === 'table').length,
            imageCount: segments.filter((segment) => segment.type === 'image').length,
            artifactCount: segments.filter((segment) => segment.type === 'artifact').length,
        });

        for (const segment of segments) {
            if (segment.type === 'markdown') {
                await this.insertConvertedMarkdown(documentId, segment.content, attachmentById);
            } else if (segment.type === 'table') {
                await this.insertNativeTable(documentId, segment.rows, attachmentById);
            } else if (segment.type === 'image') {
                await this.insertNativeImage(documentId, segment.url, segment.alt);
            } else {
                const attachment = attachmentById.get(segment.id);
                if (!attachment) {
                    throw new Error(`Missing artifactRef for marker [[artifact:${segment.id}]]`);
                }
                await this.insertArtifact(documentId, attachment);
            }
        }
    }

    private async insertConvertedMarkdown(
        documentId: string,
        contentMarkdown: string,
        attachmentById: Map<string, AttachmentInfo> = new Map(),
    ): Promise<void> {
        if (!contentMarkdown.trim()) return;

        const convertedMarkdown = replaceInlineArtifactMarkers(contentMarkdown, attachmentById);
        const converted = await this.client.docx.document.convert({
            data: {
                content_type: 'markdown',
                content: convertedMarkdown,
            },
        });
        const blocks = converted.data?.blocks ?? [];
        const firstLevelBlockIds = converted.data?.first_level_block_ids ?? [];
        const topLevelBlocks = selectTopLevelBlocksInOrder(blocks, firstLevelBlockIds);

        if (topLevelBlocks.length === 0) {
            throw new Error(`Feishu markdown convert returned no top-level blocks: ${JSON.stringify(converted)}`);
        }

        this.log.debug('飞书原生 Markdown 转换完成', {
            blockCount: blocks.length,
            topLevelBlockCount: topLevelBlocks.length,
        });

        for (let i = 0; i < topLevelBlocks.length; i += BLOCK_BATCH_SIZE) {
            const batch = topLevelBlocks.slice(i, i + BLOCK_BATCH_SIZE);
            await this.client.docx.documentBlockDescendant.create({
                path: { document_id: documentId, block_id: documentId },
                params: { document_revision_id: -1 },
                data: {
                    children_id: batch.map((block) => block.block_id),
                    descendants: collectDescendants(blocks, batch),
                },
            });
            this.log.debug('原生块已写入', { batch: `${i}-${i + batch.length}/${topLevelBlocks.length}` });
            await sleep(FEISHU_WRITE_INTERVAL_MS);
        }
    }

    private async insertNativeTable(
        documentId: string,
        rows: string[][],
        attachmentById: Map<string, AttachmentInfo> = new Map(),
    ): Promise<void> {
        if (rows.length === 0) return;

        const columnSize = Math.max(...rows.map((row) => row.length));
        if (columnSize === 0) return;
        if (shouldSplitTable(rows)) {
            this.log.debug('飞书大表将拆分写入', {
                rows: rows.length,
                columns: columnSize,
                maxCells: MAX_NATIVE_TABLE_CELLS,
            });
            for (const chunk of splitLargeTable(rows)) {
                await this.insertNativeTable(documentId, chunk, attachmentById);
            }
            return;
        }

        const tableBlocks = createTableBlocks(rows, attachmentById);
        await this.client.docx.documentBlockDescendant.create({
            path: { document_id: documentId, block_id: documentId },
            params: { document_revision_id: -1 },
            data: {
                children_id: [tableBlocks.tableId],
                descendants: tableBlocks.descendants,
            },
        });
        await sleep(FEISHU_WRITE_INTERVAL_MS);

        this.log.debug('飞书表格已写入', {
            rows: tableBlocks.rows.length,
            columns: columnSize,
            columnWidth: tableBlocks.columnWidth,
            descendants: tableBlocks.descendants.length,
        });
    }

    private async insertNativeImage(documentId: string, imageUrl: string, alt: string): Promise<void> {
        await this.artifactUploader.insertImage(documentId, imageUrl, alt);
    }

    private async insertArtifact(documentId: string, attachment: AttachmentInfo): Promise<void> {
        if (attachment.kind === 'image') {
            await this.artifactUploader.insertImage(documentId, attachment.path, attachment.caption ?? '');
            return;
        }

        await this.artifactUploader.insertFile(documentId, attachment.path);
    }

    private async throttleStatusRead(): Promise<void> {
        const waitMs = FEISHU_STATUS_READ_INTERVAL_MS - (Date.now() - this.lastStatusReadAt);
        if (waitMs > 0) {
            await sleep(waitMs);
        }
        this.lastStatusReadAt = Date.now();
    }

}

function extractFeishuError(error: unknown): { code?: number; msg?: string; message: string } {
    const data = extractErrorData(error);
    return {
        code: typeof data.code === 'number' ? data.code : undefined,
        msg: typeof data.msg === 'string' ? data.msg : undefined,
        message: error instanceof Error ? error.message : String(error),
    };
}

function extractErrorData(error: unknown): Record<string, unknown> {
    if (!isObject(error)) return {};
    const response = isObject(error.response) ? error.response : undefined;
    const responseData = isObject(response?.data) ? response.data : undefined;
    const data = isObject(error.data) ? error.data : undefined;
    return responseData ?? data ?? error;
}

function collectDescendants(blocks: FeishuConvertedBlock[], roots: FeishuConvertedBlock[]): FeishuDescendantBlock[] {
    const blockById = new Map<string, FeishuConvertedBlock>();
    for (const block of blocks) {
        if (block.block_id) blockById.set(block.block_id, block);
    }

    const ordered: FeishuDescendantBlock[] = [];
    const visited = new Set<string>();
    const visit = (blockId: string): void => {
        if (visited.has(blockId)) return;
        const block = blockById.get(blockId);
        if (!block) return;
        visited.add(blockId);
        ordered.push(block);
        for (const childId of block.children ?? []) {
            visit(childId);
        }
    };

    for (const root of roots) {
        visit(root.block_id);
    }
    return ordered;
}

export function selectTopLevelBlocksInOrder(
    blocks: FeishuConvertedBlock[],
    firstLevelBlockIds: string[],
): FeishuConvertedBlock[] {
    const blockById = new Map<string, FeishuConvertedBlock>();
    for (const block of blocks) {
        if (isConvertedBlock(block)) {
            blockById.set(block.block_id, block);
        }
    }

    const ordered: FeishuConvertedBlock[] = [];
    const missing: string[] = [];
    for (const blockId of firstLevelBlockIds) {
        const block = blockById.get(blockId);
        if (block) {
            ordered.push(block);
        } else {
            missing.push(blockId);
        }
    }

    if (missing.length > 0) {
        throw new Error(`Feishu markdown convert returned missing top-level blocks: ${missing.join(', ')}`);
    }

    return ordered;
}

function isConvertedBlock(value: unknown): value is FeishuConvertedBlock {
    return isObject(value) && typeof value.block_id === 'string';
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
