import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { DatabaseManager } from '../src/data/Database.js';
import { KnowledgeRepository } from '../src/data/KnowledgeRepository.js';
import { TagRepository } from '../src/data/TagRepository.js';
import { Knowledge } from '../src/models/Knowledge.js';
import { CollectionService } from '../src/services/CollectionService.js';
import type { IngressContext } from '../src/models/IngressContext.js';
import type { ProgressReporter } from '../src/progress/ProgressReporter.js';

describe('CollectionService reprocessing', () => {
    it('stores ingress context for later replay', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('chat-1', 'hello');
        const agentRunner = makeAgentRunner('First title');
        const feishuDoc = {
            createDocument: vi.fn(async () => ({ documentId: 'doc-1', wikiNodeToken: 'wiki-1' })),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        await service.handleIngress(context, makeReporter());

        const [created] = knowledgeRepo.findAll();
        expect(created.ingressContext).toEqual(context);
        expect(feishuDoc.createDocument).toHaveBeenCalledWith('First title', '## First title', []);
        dbManager.close();
    });

    it('stores job-relative artifact paths and prefixes them only for publishing', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('chat-1', 'hello');
        const agentRunner = makeAgentRunnerWithOutput({
            ...makeAgentOutput('Artifact title'),
            contentMarkdown: '[[artifact:art_001]]',
            artifactRefs: [{
                id: 'art_001',
                path: 'xiaohongshu-downloads/note/image.jpg',
                kind: 'image' as const,
                sourceUrl: null,
                caption: null,
                mimeType: 'image/jpeg',
                size: 10,
                error: null,
            }],
        });
        const feishuDoc = {
            createDocument: vi.fn(async () => ({ documentId: 'doc-1', wikiNodeToken: 'wiki-1' })),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        await service.handleIngress(context, makeReporter());

        const [created] = knowledgeRepo.findAll();
        expect(created.attachments[0].path).toBe('xiaohongshu-downloads/note/image.jpg');
        expect(feishuDoc.createDocument).toHaveBeenCalledWith(
            'Artifact title',
            '[[artifact:art_001]]',
            [expect.objectContaining({ path: `${created.id}/xiaohongshu-downloads/note/image.jpg` })],
        );
        dbManager.close();
    });

    it('passes agent review notes to the progress reporter', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('chat-1', 'hello');
        const agentRunner = makeAgentRunnerWithOutput({
            ...makeAgentOutput('Needs review'),
            needsReview: true,
            qualityNotes: 'MODEL_API_KEY is not configured',
        });
        const feishuDoc = {
            createDocument: vi.fn(async () => ({ documentId: 'doc-1', wikiNodeToken: 'wiki-1' })),
        };
        const reporter = makeReporter();
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        await service.handleIngress(context, reporter);

        expect(reporter.complete).toHaveBeenCalledWith(expect.objectContaining({
            needsReview: true,
            qualityNotes: 'MODEL_API_KEY is not configured',
        }));
        dbManager.close();
    });

    it('reprocesses from stored ingress context and overwrites the existing Feishu document', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('old-chat', 'original input');
        const knowledge = new Knowledge(
            'Old title',
            'Old summary',
            'Old body',
            'test',
            'done',
            null,
            null,
            null,
            null,
            null,
            'text',
            'doc-token',
            'wiki-token',
            [],
            1,
            false,
            '',
            [],
            context,
        );
        knowledgeRepo.create(knowledge);
        const agentRunner = makeAgentRunner('New title');
        const feishuDoc = {
            isDocumentDeleted: vi.fn(async () => false),
            replaceDocumentContent: vi.fn(async () => undefined),
            createDocument: vi.fn(async () => ({ documentId: 'new-doc' })),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        await service.reprocessKnowledge(knowledge.id, 'new-chat', makeReporter());

        const updated = knowledgeRepo.findById(knowledge.id)!;
        expect(agentRunner.run).toHaveBeenCalledWith({ ...context, chatId: 'new-chat' }, knowledge.id);
        expect(feishuDoc.replaceDocumentContent).toHaveBeenCalledWith(
            'doc-token',
            'New title',
            '## New title',
            [],
            'wiki-token',
        );
        expect(feishuDoc.createDocument).not.toHaveBeenCalled();
        expect(updated.title).toBe('New title');
        expect(updated.feishuDocId).toBe('doc-token');
        expect(updated.feishuWikiNode).toBe('wiki-token');
        expect(updated.status).toBe('done');
        dbManager.close();
    });

    it('clears the existing knowledge asset directory before reprocessing', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'collector-reprocess-'));
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        try {
            const knowledgeRepo = new KnowledgeRepository(db);
            const tagRepo = new TagRepository(db);
            const context = makeContext('old-chat', 'original input');
            const knowledge = new Knowledge(
                'Old title', 'Old summary', 'Old body', 'test', 'done',
                null, null, null, null, null, 'text', 'doc-token', 'wiki-token',
                [], 1, false, '', [], context,
            );
            knowledgeRepo.create(knowledge);
            const staleFile = join(dataDir, knowledge.id, 'artifacts', 'stale.txt');
            mkdirSync(join(dataDir, knowledge.id, 'artifacts'), { recursive: true });
            writeFileSync(staleFile, 'stale');
            const agentRunner = makeAgentRunner('New title');
            const feishuDoc = {
                isDocumentDeleted: vi.fn(async () => false),
                replaceDocumentContent: vi.fn(async () => undefined),
            };
            const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any, dataDir);

            await service.reprocessKnowledge(knowledge.id, 'new-chat', makeReporter());

            expect(existsSync(staleFile)).toBe(false);
            expect(existsSync(join(dataDir, knowledge.id))).toBe(false);
            expect(agentRunner.run).toHaveBeenCalledWith({ ...context, chatId: 'new-chat' }, knowledge.id);
        } finally {
            dbManager.close();
            rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('creates a new Feishu document during reprocess when the old one is deleted', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('chat', 'original input');
        const knowledge = new Knowledge(
            'Old title', 'Old summary', 'Old body', 'test', 'done',
            null, null, null, null, null, 'text', 'deleted-doc', 'deleted-wiki',
            [], 1, false, '', [], context,
        );
        knowledgeRepo.create(knowledge);
        const agentRunner = makeAgentRunner('Replacement title');
        const feishuDoc = {
            isDocumentDeleted: vi.fn(async () => true),
            replaceDocumentContent: vi.fn(async () => undefined),
            createDocument: vi.fn(async () => ({ documentId: 'fresh-doc', wikiNodeToken: 'fresh-wiki' })),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        await service.reprocessKnowledge(knowledge.id, 'chat', makeReporter());

        const updated = knowledgeRepo.findById(knowledge.id)!;
        expect(feishuDoc.replaceDocumentContent).not.toHaveBeenCalled();
        expect(feishuDoc.createDocument).toHaveBeenCalledWith('Replacement title', '## Replacement title', []);
        expect(updated.feishuDocId).toBe('fresh-doc');
        expect(updated.feishuWikiNode).toBe('fresh-wiki');
        dbManager.close();
    });
});

describe('CollectionService MCP document sync', () => {
    it('deletes done records when the Feishu document is missing', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const knowledge = new Knowledge(
            'Deleted done doc',
            '',
            '',
            'test',
            'done',
            null,
            null,
            null,
            null,
            null,
            'text',
            'deleted-doc',
            'deleted-wiki',
        );
        knowledgeRepo.create(knowledge);
        const feishuDoc = {
            isDocumentDeleted: vi.fn(async () => true),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, makeAgentRunner('unused') as any, feishuDoc as any);

        const result = await service.syncFeishuDocumentsForMcp();

        expect(result).toMatchObject({ checked: 1, deleted: 1, reprocessed: 0, skipped: false });
        expect(knowledgeRepo.findById(knowledge.id)).toBeNull();
        dbManager.close();
    });

    it('queues non-done records without a Feishu document without blocking MCP sync', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const context = makeContext('chat-sync', 'retry input');
        const knowledge = new Knowledge(
            'Failed doc',
            '',
            '',
            'test',
            'failed',
            'publish failed',
            null,
            null,
            null,
            null,
            'text',
            null,
            null,
            [],
            1,
            false,
            '',
            [],
            context,
        );
        knowledgeRepo.create(knowledge);
        const deferred = createDeferred<ReturnType<typeof makeAgentOutput>>();
        const agentRunner = makeAgentRunnerWithDeferred(deferred.promise);
        const feishuDoc = {
            createDocument: vi.fn(async () => ({ documentId: 'recovered-doc', wikiNodeToken: 'recovered-wiki' })),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, agentRunner as any, feishuDoc as any);

        const result = await service.syncFeishuDocumentsForMcp();

        expect(result).toMatchObject({ checked: 0, deleted: 0, reprocessed: 1, skipped: false });
        expect(agentRunner.run).toHaveBeenCalledWith(context, knowledge.id);
        expect(feishuDoc.createDocument).not.toHaveBeenCalled();

        deferred.resolve(makeAgentOutput('Recovered title'));
        await vi.waitFor(() => {
            expect(feishuDoc.createDocument).toHaveBeenCalledWith('Recovered title', '## Recovered title', []);
        });
        const updated = knowledgeRepo.findById(knowledge.id)!;
        expect(feishuDoc.createDocument).toHaveBeenCalledWith('Recovered title', '## Recovered title', []);
        expect(updated.status).toBe('done');
        expect(updated.feishuDocId).toBe('recovered-doc');
        expect(updated.feishuWikiNode).toBe('recovered-wiki');
        dbManager.close();
    });

    it('checks Feishu documents each time the scheduled sync runs', async () => {
        const dbManager = new DatabaseManager(':memory:');
        const db = dbManager.connect();
        const knowledgeRepo = new KnowledgeRepository(db);
        const tagRepo = new TagRepository(db);
        const knowledge = new Knowledge(
            'Existing doc',
            '',
            '',
            'test',
            'done',
            null,
            null,
            null,
            null,
            null,
            'text',
            'existing-doc',
            'existing-wiki',
        );
        knowledgeRepo.create(knowledge);
        const feishuDoc = {
            isDocumentDeleted: vi.fn()
                .mockResolvedValueOnce(false)
                .mockResolvedValueOnce(true),
        };
        const service = new CollectionService(knowledgeRepo, tagRepo, makeAgentRunner('unused') as any, feishuDoc as any);

        const first = await service.syncFeishuDocumentsForMcp();
        const second = await service.syncFeishuDocumentsForMcp();

        expect(first).toMatchObject({ checked: 1, deleted: 0, reprocessed: 0, skipped: false });
        expect(second).toMatchObject({ checked: 1, deleted: 1, reprocessed: 0, skipped: false });
        expect(feishuDoc.isDocumentDeleted).toHaveBeenCalledTimes(2);
        expect(knowledgeRepo.findById(knowledge.id)).toBeNull();
        dbManager.close();
    });
});

function makeContext(chatId: string, text: string): IngressContext {
    return {
        source: 'feishu',
        chatId,
        contents: [{ type: 'text', text }],
        metadata: { messageId: 'message-1' },
    };
}

function makeAgentOutput(title: string) {
    return {
        title,
        summary: `${title} summary`,
        contentMarkdown: `## ${title}`,
        author: null,
        publishedAt: null,
        platform: 'test',
        contentType: 'text',
        sourceUrl: null,
        canonicalUrl: null,
        selectedExistingTags: [],
        newTags: [],
        artifactRefs: [],
        confidence: 1,
        needsReview: false,
        qualityNotes: '',
    };
}

function makeAgentRunner(title: string) {
    return makeAgentRunnerWithOutput(makeAgentOutput(title));
}

function makeAgentRunnerWithOutput(output: ReturnType<typeof makeAgentOutput>) {
    return {
        on: vi.fn(),
        run: vi.fn(async () => output),
    };
}

function makeAgentRunnerWithDeferred(promise: Promise<ReturnType<typeof makeAgentOutput>>) {
    return {
        on: vi.fn(),
        run: vi.fn(() => promise),
    };
}

function createDeferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function makeReporter(): ProgressReporter {
    return {
        start: vi.fn(async () => undefined),
        addStep: vi.fn(),
        startStep: vi.fn(async () => undefined),
        completeStep: vi.fn(async () => undefined),
        failStep: vi.fn(async () => undefined),
        addSubStep: vi.fn(async () => 0),
        startSubStep: vi.fn(async () => undefined),
        addAndStartSubStep: vi.fn(async () => 0),
        completeSubStep: vi.fn(async () => undefined),
        complete: vi.fn(async () => undefined),
        fail: vi.fn(async () => undefined),
    };
}
