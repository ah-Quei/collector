import { BaseEntity } from './BaseEntity.js';
import type { IngressContext } from './IngressContext.js';

export interface AttachmentInfo {
    id: string;
    kind: 'image' | 'audio' | 'video' | 'file';
    path: string;
    sourceUrl?: string | null;
    caption?: string | null;
    mimeType?: string | null;
    size?: number | null;
    error?: string | null;
    feishuFileId?: string | null;
}

export type KnowledgeStatus = 'processing' | 'done' | 'failed';

export interface KnowledgeData {
    title: string;
    summary: string;
    contentMarkdown: string;
    platform: string;
    status?: KnowledgeStatus;
    errorMessage?: string | null;
    sourceUrl?: string | null;
    canonicalUrl?: string | null;
    author?: string | null;
    publishedAt?: string | null;
    contentType?: string;
    feishuDocId?: string | null;
    feishuWikiNode?: string | null;
    tags?: string[];
    confidence?: number;
    needsReview?: boolean;
    qualityNotes?: string;
    attachments?: AttachmentInfo[];
    ingressContext?: IngressContext | null;
    id?: string;
    createdAt?: Date;
    updatedAt?: Date;
}

export class Knowledge extends BaseEntity {
    constructor(
        public title: string,
        public summary: string,
        public contentMarkdown: string,
        public platform: string,
        public status: KnowledgeStatus = 'processing',
        public errorMessage: string | null = null,
        public sourceUrl: string | null = null,
        public canonicalUrl: string | null = null,
        public author: string | null = null,
        public publishedAt: string | null = null,
        public contentType: string = 'text',
        public feishuDocId: string | null = null,
        public feishuWikiNode: string | null = null,
        public tags: string[] = [],
        public confidence: number = 1.0,
        public needsReview: boolean = false,
        public qualityNotes: string = '',
        public attachments: AttachmentInfo[] = [],
        public ingressContext: IngressContext | null = null,
        id?: string,
        createdAt?: Date,
        updatedAt?: Date,
    ) {
        super(id, createdAt, updatedAt);
    }

    static fromData(data: KnowledgeData): Knowledge {
        return new Knowledge(
            data.title,
            data.summary,
            data.contentMarkdown,
            data.platform,
            data.status ?? 'processing',
            data.errorMessage ?? null,
            data.sourceUrl ?? null,
            data.canonicalUrl ?? null,
            data.author ?? null,
            data.publishedAt ?? null,
            data.contentType ?? 'text',
            data.feishuDocId ?? null,
            data.feishuWikiNode ?? null,
            data.tags ?? [],
            data.confidence ?? 1.0,
            data.needsReview ?? false,
            data.qualityNotes ?? '',
            data.attachments ?? [],
            data.ingressContext ?? null,
            data.id,
            data.createdAt,
            data.updatedAt,
        );
    }

    static createProcessing(ingressContext: IngressContext): Knowledge {
        return Knowledge.fromData({
            title: '(processing)',
            summary: '',
            contentMarkdown: '',
            platform: '',
            status: 'processing',
            ingressContext,
        });
    }

    validate(): void {
        if (!this.title) {
            throw new Error('Knowledge title is required');
        }
    }

    static fromRow(row: {
        id: string;
        title: string;
        summary: string;
        content_markdown: string;
        platform: string;
        status: string;
        error_message: string | null;
        source_url: string | null;
        canonical_url: string | null;
        author: string | null;
        published_at: string | null;
        content_type: string;
        feishu_doc_id: string | null;
        feishu_wiki_node: string | null;
        tags: string;
        confidence: number;
        needs_review: number;
        quality_notes: string;
        attachments: string;
        ingress_context?: string | null;
        created_at: string;
        updated_at: string;
    }): Knowledge {
        return Knowledge.fromData({
            title: row.title,
            summary: row.summary,
            contentMarkdown: row.content_markdown,
            platform: row.platform,
            status: parseKnowledgeStatus(row.status),
            errorMessage: row.error_message,
            sourceUrl: row.source_url,
            canonicalUrl: row.canonical_url,
            author: row.author,
            publishedAt: row.published_at,
            contentType: row.content_type,
            feishuDocId: row.feishu_doc_id,
            feishuWikiNode: row.feishu_wiki_node,
            tags: parseStringArray(row.tags),
            confidence: row.confidence,
            needsReview: row.needs_review === 1,
            qualityNotes: row.quality_notes,
            attachments: parseAttachments(row.attachments),
            ingressContext: parseIngressContext(row.ingress_context),
            id: row.id,
            createdAt: new Date(row.created_at),
            updatedAt: new Date(row.updated_at),
        });
    }
}

function parseKnowledgeStatus(raw: string): KnowledgeStatus {
    return raw === 'processing' || raw === 'done' || raw === 'failed' ? raw : 'failed';
}

function parseStringArray(raw: string): string[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
    } catch {
        return [];
    }
}

function parseAttachments(raw: string): AttachmentInfo[] {
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.filter(isAttachmentInfo) : [];
    } catch {
        return [];
    }
}

function isAttachmentInfo(value: unknown): value is AttachmentInfo {
    if (typeof value !== 'object' || value === null) return false;
    const item = value as Partial<AttachmentInfo>;
    return typeof item.id === 'string'
        && typeof item.path === 'string'
        && (item.kind === 'image' || item.kind === 'audio' || item.kind === 'video' || item.kind === 'file');
}

function parseIngressContext(raw: string | null | undefined): IngressContext | null {
    if (!raw) return null;
    try {
        const parsed = JSON.parse(raw);
        return isIngressContext(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function isIngressContext(value: unknown): value is IngressContext {
    if (typeof value !== 'object' || value === null) return false;
    const context = value as Partial<IngressContext>;
    return (context.source === 'feishu' || context.source === 'browser-extension')
        && typeof context.chatId === 'string'
        && Array.isArray(context.contents);
}
