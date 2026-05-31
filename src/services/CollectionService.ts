import { existsSync, rmSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';
import type { KnowledgeRepository } from '../data/KnowledgeRepository.js';
import type { TagRepository } from '../data/TagRepository.js';
import type { IngressContext } from '../models/IngressContext.js';
import { Knowledge } from '../models/Knowledge.js';
import type { AgentOutput } from '../agent/schemas.js';
import type { IngestionAgentRunner } from '../agent/IngestionAgentRunner.js';
import type { ProgressReporter } from '../progress/ProgressReporter.js';
import { AgentProgressReporter } from '../progress/AgentProgressReporter.js';
import type { FeishuDocService } from './FeishuDocService.js';
import { Logger } from '../logging/Logger.js';

export interface FeishuDocumentSyncResult {
    checked: number;
    deleted: number;
    reprocessed: number;
    failedReprocess: number;
    skipped: boolean;
}

const SILENT_PROGRESS_REPORTER: ProgressReporter = {
    start: async () => undefined,
    addStep: () => undefined,
    startStep: async () => undefined,
    completeStep: async () => undefined,
    failStep: async () => undefined,
    addSubStep: async () => 0,
    startSubStep: async () => undefined,
    addAndStartSubStep: async () => 0,
    completeSubStep: async () => undefined,
    complete: async () => undefined,
    fail: async () => undefined,
};

function emptySyncResult(skipped: boolean): FeishuDocumentSyncResult {
    return { checked: 0, deleted: 0, reprocessed: 0, failedReprocess: 0, skipped };
}

export class CollectionService {
    private log = new Logger('collection');
    private reprocessing = new Set<string>();
    private activeProcessing = new Set<string>();
    private feishuDocumentSyncPromise: Promise<FeishuDocumentSyncResult> | null = null;

    constructor(
        private knowledgeRepo: KnowledgeRepository,
        private tagRepo: TagRepository,
        private agentRunner: IngestionAgentRunner,
        private feishuDoc: FeishuDocService,
        private dataDir?: string,
    ) {}

    async handleIngress(context: IngressContext, reporter: ProgressReporter): Promise<void> {
        const preview = context.contents.find(c => c.text)?.text?.slice(0, 60) ?? '(non-text)';
        this.log.info(`收到消息 [${context.source}]`, { chatId: context.chatId, preview });

        await this.processContext(context, reporter);
    }

    async reprocessKnowledge(knowledgeId: string, chatId: string, reporter: ProgressReporter): Promise<void> {
        if (this.reprocessing.has(knowledgeId)) {
            await reporter.start('重新处理');
            await reporter.fail({ error: '该条目正在重新处理中，请稍后再试', knowledgeId, reprocessable: true });
            return;
        }

        const existing = this.knowledgeRepo.findById(knowledgeId);
        if (!existing) {
            await reporter.start('重新处理');
            await reporter.fail({ error: `未找到知识条目: ${knowledgeId}`, knowledgeId, reprocessable: false });
            return;
        }
        if (!existing.ingressContext) {
            await reporter.start('重新处理');
            await reporter.fail({ error: '该条目缺少原始输入，无法重新处理', knowledgeId, reprocessable: false });
            return;
        }

        this.reprocessing.add(knowledgeId);
        try {
            await this.processContext(
                {
                    ...existing.ingressContext,
                    chatId,
                },
                reporter,
                existing,
            );
        } finally {
            this.reprocessing.delete(knowledgeId);
        }
    }

    private async processContext(context: IngressContext, reporter: ProgressReporter, existing?: Knowledge): Promise<void> {
        await reporter.start('知识收集');

        reporter.addStep('解析输入内容');
        reporter.addStep('AI 分析与提取');
        reporter.addStep('保存知识条目');
        reporter.addStep('发布到飞书知识库');

        let knowledge: Knowledge | undefined;
        let activeKnowledgeId: string | null = null;

        try {
            // Step 0: Parse input
            await reporter.startStep(0);
            if (existing) {
                knowledge = existing;
                knowledge.status = 'processing';
                knowledge.errorMessage = null;
                this.knowledgeRepo.update(knowledge);
                this.log.info('Knowledge 开始重新处理', { knowledgeId: knowledge.id });
                this.clearJobDirectory(knowledge.id);
            } else {
                knowledge = Knowledge.createProcessing(context);
                this.knowledgeRepo.create(knowledge);
                this.log.info(`Knowledge 已创建`, { knowledgeId: knowledge.id });
            }
            activeKnowledgeId = knowledge.id;
            this.activeProcessing.add(activeKnowledgeId);
            await reporter.completeStep(0);

            // Step 1: Run agent
            await reporter.startStep(1);
            this.log.info('Agent 开始运行...');
            const agentReporter = new AgentProgressReporter(reporter);
            agentReporter.attachToRunner(this.agentRunner);
            let result: AgentOutput;
            try {
                result = await this.agentRunner.run(context, knowledge.id);
            } finally {
                agentReporter.detach();
            }
            this.log.info('Agent 运行完成', { title: result.title, platform: result.platform });
            await reporter.completeStep(1);

            // Step 2: Save results
            await reporter.startStep(2);
            this.applyResult(knowledge, result);
            knowledge.ingressContext = existing?.ingressContext ?? context;
            this.knowledgeRepo.update(knowledge);
            this.processTags(knowledge, result);
            this.log.info('结果已保存', { knowledgeId: knowledge.id, tags: knowledge.tags });
            await reporter.completeStep(2);

            // Step 3: Publish to Feishu
            await reporter.startStep(3);
            this.log.info('正在发布到飞书知识库...');
            const docResult = await this.publishToFeishu(knowledge, existing !== undefined);
            knowledge.feishuDocId = docResult.documentId;
            knowledge.feishuWikiNode = docResult.wikiNodeToken ?? null;
            knowledge.status = 'done';
            this.knowledgeRepo.update(knowledge);
            this.log.info('发布完成', { docId: docResult.documentId });
            await reporter.completeStep(3);

            await reporter.complete({
                title: knowledge.title,
                summary: knowledge.summary,
                docUrl: `https://feishu.cn/docx/${docResult.documentId}`,
                knowledgeId: knowledge.id,
                reprocessable: true,
            });
        } catch (error) {
            this.log.error('处理失败', { error: String(error) });
            if (knowledge) {
                knowledge.status = 'failed';
                knowledge.errorMessage = String(error);
                this.knowledgeRepo.update(knowledge);
            }
            await reporter.fail({
                error: String(error),
                knowledgeId: knowledge?.id,
                docUrl: knowledge?.feishuDocId ? `https://feishu.cn/docx/${knowledge.feishuDocId}` : undefined,
                reprocessable: Boolean(knowledge?.ingressContext),
            });
        } finally {
            if (activeKnowledgeId) {
                this.activeProcessing.delete(activeKnowledgeId);
            }
        }
    }

    async syncFeishuDocumentsForMcp(): Promise<FeishuDocumentSyncResult> {
        if (this.feishuDocumentSyncPromise) {
            return this.feishuDocumentSyncPromise;
        }

        const candidates = this.knowledgeRepo.findDocumentSyncCandidates();
        if (candidates.length === 0) {
            return emptySyncResult(true);
        }

        this.feishuDocumentSyncPromise = this.syncFeishuDocuments(candidates).finally(() => {
            this.feishuDocumentSyncPromise = null;
        });
        return this.feishuDocumentSyncPromise;
    }

    private async syncFeishuDocuments(candidates: Knowledge[]): Promise<FeishuDocumentSyncResult> {
        let checked = 0;
        let deleted = 0;
        let reprocessed = 0;
        let failedReprocess = 0;

        for (const knowledge of candidates) {
            if (this.activeProcessing.has(knowledge.id) || this.reprocessing.has(knowledge.id)) {
                continue;
            }

            const feishuDocId = knowledge.feishuDocId;
            if (!feishuDocId) {
                if (knowledge.status !== 'done') {
                    if (this.queueMissingDocumentReprocess(knowledge)) {
                        reprocessed += 1;
                    } else {
                        failedReprocess += 1;
                    }
                }
                continue;
            }

            checked += 1;
            const isDeleted = await this.feishuDoc.isDocumentDeleted(feishuDocId);
            if (!isDeleted) continue;

            if (knowledge.status === 'done') {
                this.knowledgeRepo.delete(knowledge.id);
                deleted += 1;
                this.log.info('飞书文档已不可访问，数据库记录已同步删除', {
                    knowledgeId: knowledge.id,
                    feishuDocId,
                    feishuWikiNode: knowledge.feishuWikiNode,
                    title: knowledge.title,
                });
                continue;
            }

            if (this.queueMissingDocumentReprocess(knowledge)) {
                reprocessed += 1;
            } else {
                failedReprocess += 1;
            }
        }

        if (checked > 0 || deleted > 0 || reprocessed > 0 || failedReprocess > 0) {
            this.log.debug('飞书文档状态同步完成', {
                checked,
                deleted,
                reprocessed,
                failedReprocess,
            });
        }

        return { checked, deleted, reprocessed, failedReprocess, skipped: false };
    }

    private queueMissingDocumentReprocess(knowledge: Knowledge): boolean {
        if (!knowledge.ingressContext) {
            this.log.warn('飞书文档缺失但缺少原始输入，无法自动重新处理', {
                knowledgeId: knowledge.id,
                status: knowledge.status,
                feishuDocId: knowledge.feishuDocId,
            });
            return false;
        }

        this.log.info('飞书文档缺失，已加入异步重新处理队列', {
            knowledgeId: knowledge.id,
            status: knowledge.status,
            feishuDocId: knowledge.feishuDocId,
        });
        this.reprocessKnowledge(knowledge.id, knowledge.ingressContext.chatId, SILENT_PROGRESS_REPORTER)
            .catch(error => {
                this.log.error('异步重新处理飞书文档缺失条目失败', {
                    knowledgeId: knowledge.id,
                    error: String(error),
                });
            });
        return true;
    }

    private applyResult(knowledge: Knowledge, result: AgentOutput): void {
        knowledge.title = result.title;
        knowledge.summary = result.summary;
        knowledge.contentMarkdown = result.contentMarkdown;
        knowledge.platform = result.platform;
        knowledge.sourceUrl = result.sourceUrl;
        knowledge.canonicalUrl = result.canonicalUrl;
        knowledge.author = result.author;
        knowledge.publishedAt = result.publishedAt;
        knowledge.contentType = result.contentType;
        knowledge.confidence = result.confidence;
        knowledge.needsReview = result.needsReview;
        knowledge.qualityNotes = result.qualityNotes;
        knowledge.attachments = result.artifactRefs.map(ref => ({
            id: ref.id,
            path: ref.path,
            kind: ref.kind,
            sourceUrl: ref.sourceUrl,
            mimeType: ref.mimeType,
            caption: ref.caption,
            size: ref.size,
            error: ref.error,
        }));
    }

    private processTags(knowledge: Knowledge, result: AgentOutput): void {
        this.tagRepo.unlinkAllFromKnowledge(knowledge.id);
        const tagIds: string[] = [];

        for (const existingTagId of result.selectedExistingTags) {
            const tag = this.tagRepo.findById(existingTagId);
            if (tag) {
                this.tagRepo.linkToKnowledge(knowledge.id, tag.id);
                tagIds.push(tag.id);
            }
        }

        for (const newTag of result.newTags) {
            const tag = this.tagRepo.findOrCreate(newTag.name, newTag.kind);
            this.tagRepo.linkToKnowledge(knowledge.id, tag.id);
            tagIds.push(tag.id);
        }

        knowledge.tags = tagIds
            .map(id => this.tagRepo.findById(id))
            .filter((t): t is NonNullable<typeof t> => t !== null)
            .map(t => t.name);
        this.knowledgeRepo.update(knowledge);
    }

    private async publishToFeishu(knowledge: Knowledge, preferExistingDocument: boolean): Promise<{ documentId: string; wikiNodeToken?: string }> {
        const attachments = this.attachmentsForPublish(knowledge);

        if (preferExistingDocument && knowledge.feishuDocId) {
            const isDeleted = await this.feishuDoc.isDocumentDeleted(knowledge.feishuDocId);
            if (!isDeleted) {
                await this.feishuDoc.replaceDocumentContent(
                    knowledge.feishuDocId,
                    knowledge.title,
                    knowledge.contentMarkdown,
                    attachments,
                    knowledge.feishuWikiNode ?? undefined,
                );
                return {
                    documentId: knowledge.feishuDocId,
                    wikiNodeToken: knowledge.feishuWikiNode ?? undefined,
                };
            }
            this.log.warn('旧飞书文档已删除，将重新创建文档', {
                knowledgeId: knowledge.id,
                feishuDocId: knowledge.feishuDocId,
            });
        }

        return this.feishuDoc.createDocument(
            knowledge.title,
            knowledge.contentMarkdown,
            attachments,
        );
    }

    private attachmentsForPublish(knowledge: Knowledge) {
        return knowledge.attachments.map(attachment => ({
            ...attachment,
            path: this.pathForStorageDataDir(knowledge, attachment.path),
        }));
    }

    private pathForStorageDataDir(knowledge: Knowledge, path: string): string {
        if (/^https?:\/\//i.test(path)) return path;
        if (path.startsWith('/')) {
            throw new Error(`Local artifact path must be relative to the job directory: ${path}`);
        }

        const cleanPath = path.replace(/^\.\/+/, '');
        return `${knowledge.id}/${cleanPath}`;
    }

    private clearJobDirectory(knowledgeId: string): void {
        if (!this.dataDir) return;

        const dataRoot = resolve(this.dataDir);
        const jobRoot = resolve(dataRoot, knowledgeId);
        if (!isInside(dataRoot, jobRoot)) {
            throw new Error(`Refusing to clear job directory outside storage data dir: ${jobRoot}`);
        }

        if (!existsSync(jobRoot)) return;
        rmSync(jobRoot, { recursive: true, force: true });
        this.log.debug('Knowledge 重新处理目录已清空', { knowledgeId, path: jobRoot });
    }
}

function isInside(root: string, child: string): boolean {
    const childRelativeToRoot = relative(root, child);
    return childRelativeToRoot === '' || (!childRelativeToRoot.startsWith('..') && !isAbsolute(childRelativeToRoot));
}
