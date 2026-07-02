import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ImageInjectingModelProvider, ImageInputRegistry } from '../src/agent/ImageInputRegistry.js';
import { bashTool } from '../src/agent/tools/BashTool.js';
import { listDirectoryTool } from '../src/agent/tools/ListDirectoryTool.js';
import { openCliTool } from '../src/agent/tools/OpenCliTool.js';
import { readImageTool } from '../src/agent/tools/ReadImageTool.js';
import { submitOutputTool, createOutputCapture } from '../src/agent/tools/SubmitOutputTool.js';
import { createTools } from '../src/agent/tools/registry.js';
import { Config } from '../src/config/Config.js';

describe('agent asset tools', () => {
    it('only registers read_image_asset when the configured model supports vision', () => {
        const withoutVision = createTools(makeConfig(false)).map((tool) => tool.name);
        const withVision = createTools(makeConfig(true), undefined, new ImageInputRegistry()).map((tool) => tool.name);

        expect(withoutVision).not.toContain('read_image_asset');
        expect(withVision).toContain('read_image_asset');
    });

    it('registers submit_output only when an output capture is provided', () => {
        expect(createTools(makeConfig(false)).map((t) => t.name)).not.toContain('submit_output');
        const capture = createOutputCapture();
        const names = createTools(
            makeConfig(true),
            undefined,
            new ImageInputRegistry(),
            capture,
        ).map((t) => t.name);
        expect(names).toContain('submit_output');
    });

    it('submit_output captures a schema-valid AgentOutput and acks the caller', async () => {
        const capture = createOutputCapture();
        const tool = submitOutputTool(capture);
        const validOutput = makeValidOutputFixture();

        const ack = await tool.invoke({} as any, JSON.stringify(validOutput));

        expect(ack).toBe('Output received. You may end the conversation.');
        expect(capture.get()).toMatchObject({ title: 'Test title', platform: 'wechat' });
        capture.clear();
        expect(capture.get()).toBeUndefined();
    });

    it('submit_output rejects schema-invalid arguments', async () => {
        const capture = createOutputCapture();
        const tool = submitOutputTool(capture);
        // confidence out of [0,1] violates the schema
        const invalidOutput = { ...makeValidOutputFixture(), confidence: 1.7 };

        const result = await tool
            .invoke({} as any, JSON.stringify(invalidOutput))
            .catch((e: unknown) => String(e));
        expect(result).toMatch(/Invalid JSON input for tool|Invalid tool arguments/i);
        expect(capture.get()).toBeUndefined();
    });

    it('adds recursive job file listings to opencli output', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'collector-tools-'));
        try {
            const tool = openCliTool({ enabled: true, bin: '/bin/sh', timeout: 5 }, dataDir);

            const output = await tool.invoke(
                { context: { knowledgeId: 'knowledge-1' } } as any,
                JSON.stringify({
                    args: ['-c', 'mkdir -p xiaohongshu-downloads/note-1 && printf img > xiaohongshu-downloads/note-1/cover.jpg && echo ok'],
                }),
            ) as string;
            const result = parseToolResult<{
                stdout: string;
                files: Array<{ path: string }>;
            }>(output);

            expect(result.ok).toBe(true);
            expect(result.data.stdout).toContain('ok');
            expect(result.data.files).toContainEqual(expect.objectContaining({
                path: 'xiaohongshu-downloads/note-1/cover.jpg',
            }));
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('registers one concrete image path for multimodal injection', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'collector-tools-'));
        try {
            mkdirSync(join(dataDir, 'knowledge-1', 'xiaohongshu-downloads', 'note-1'), { recursive: true });
            writeFileSync(join(dataDir, 'knowledge-1', 'xiaohongshu-downloads', 'note-1', 'cover.jpg'), 'fake image');
            const registry = new ImageInputRegistry();
            const tool = readImageTool(dataDir, registry);

            const output = await tool.invoke(
                { context: { knowledgeId: 'knowledge-1' } } as any,
                JSON.stringify({ path: 'xiaohongshu-downloads/note-1/cover.jpg' }),
            );

            const parsed = JSON.parse(output as string);
            expect(parsed.ok).toBe(true);
            expect(parsed.data.mode).toBe('image_inputs');
            expect(parsed.data.images).toEqual([
                {
                    id: 'img_001',
                    path: 'xiaohongshu-downloads/note-1/cover.jpg',
                    mimeType: 'image/jpeg',
                    size: 10,
                },
            ]);
            expect(registry.get('img_001')?.dataUrl).toBe('data:image/jpeg;base64,ZmFrZSBpbWFnZQ==');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('injects registered images into the next model request as input_image parts', async () => {
        const registry = new ImageInputRegistry();
        registry.add({
            path: 'xiaohongshu-downloads/note-1/cover.jpg',
            mimeType: 'image/jpeg',
            size: 10,
            dataUrl: 'data:image/jpeg;base64,ZmFrZSBpbWFnZQ==',
        });
        let capturedRequest: any;
        const provider = new ImageInjectingModelProvider({
            getModel: () => ({
                getResponse: async (request: any) => {
                    capturedRequest = request;
                    return { usage: {}, output: [] };
                },
                getStreamedResponse: async function* () {},
            }),
        } as any, () => registry);

        const model = await provider.getModel('test-model');
        await model.getResponse({
            input: [
                {
                    type: 'function_call_result',
                    name: 'read_image_asset',
                    callId: 'call-1',
                    status: 'completed',
                    output: {
                        type: 'text',
                        text: JSON.stringify({ ok: true, data: { mode: 'image_inputs', imageInputIds: ['img_001'] } }),
                    },
                },
            ],
            modelSettings: {},
            tools: [],
            outputType: 'text',
            handoffs: [],
            tracing: false,
        } as any);

        const injected = capturedRequest.input[1];
        expect(injected.role).toBe('user');
        expect(injected.content).toContainEqual({
            type: 'input_image',
            image: 'data:image/jpeg;base64,ZmFrZSBpbWFnZQ==',
        });
    });

    it('runs bash commands from the current job data directory by default', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'collector-tools-'));
        try {
            mkdirSync(join(dataDir, 'knowledge-1'), { recursive: true });
            writeFileSync(join(dataDir, 'knowledge-1', 'asset.txt'), 'asset content');
            const tool = bashTool(dataDir);

            const output = await tool.invoke(
                { context: { knowledgeId: 'knowledge-1' } } as any,
                JSON.stringify({ command: 'cat asset.txt', timeout: null }),
            );
            const result = parseToolResult<{ stdout: string }>(output as string);

            expect(result.ok).toBe(true);
            expect(result.data.stdout).toBe('asset content');
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    });

    it('lists directory entries as paths relative to the job root', async () => {
        const dataDir = mkdtempSync(join(tmpdir(), 'collector-tools-'));
        try {
            mkdirSync(join(dataDir, 'knowledge-1', 'nested'), { recursive: true });
            writeFileSync(join(dataDir, 'knowledge-1', 'nested', 'asset.txt'), 'asset content');
            const tool = listDirectoryTool(dataDir);

            const output = await tool.invoke(
                { context: { knowledgeId: 'knowledge-1' } } as any,
                JSON.stringify({ path: 'nested', recursive: true }),
            );

            const result = parseToolResult<Array<{ path: string; type: string; size?: number; extension?: string }>>(output as string);
            expect(result.ok).toBe(true);
            expect(result.data).toEqual([
                { path: 'nested/asset.txt', type: 'file', size: 13, extension: '.txt' },
            ]);
        } finally {
            rmSync(dataDir, { recursive: true, force: true });
        }
    });
});

function makeConfig(vision: boolean): Config {
    return new Config({
        llm: {
            baseUrl: 'https://api.openai.com/v1',
            apiKey: 'test-key',
            model: 'gpt-4o-mini',
            maxTokens: 16000,
            vision,
            audio: false,
            functionCalling: true,
        },
    });
}

function parseToolResult<T>(output: string): { ok: true; data: T } {
    const parsed = JSON.parse(output);
    expect(parsed.ok).toBe(true);
    return parsed;
}

function makeValidOutputFixture() {
    return {
        title: 'Test title',
        summary: 'A short summary.',
        contentMarkdown: '# Title\n\nbody',
        author: 'author',
        publishedAt: '2025-01-01T00:00:00.000Z',
        platform: 'wechat',
        contentType: 'text',
        sourceUrl: 'https://example.com/a',
        canonicalUrl: null,
        selectedExistingTags: [],
        newTags: [{ name: 'topic-a', kind: 'topic' }],
        artifactRefs: [],
        confidence: 0.8,
        needsReview: false,
        qualityNotes: 'none',
    };
}
