import { tool } from '@openai/agents';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import { createRequire } from 'node:module';
import { z } from 'zod';
import { mkdirSync, writeFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import TurndownService from 'turndown';
import type { Config } from '../../config/Config.js';
import { getKnowledgeId, toolSuccess } from './helpers.js';

const require = createRequire(import.meta.url);
const { gfm } = require('turndown-plugin-gfm') as { gfm: TurndownService.Plugin };

const BLOCKED_NETWORKS = [
    /^127\./, /^10\./, /^172\.(1[6-9]|2\d|3[01])\./, /^192\.168\./,
    /^0\./, /^169\.254\./, /^::1$/, /^fc00:/, /^fe80:/, /^localhost$/i,
];

const MAX_REDIRECTS = 5;
const FETCH_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const MAX_MARKDOWN_CHARS = 180_000;
const MAX_TEXT_CHARS = 50_000;
const MAX_ARTIFACT_BYTES = 20 * 1024 * 1024;

export function fetchUrlTool(config: Config) {
    return tool({
        name: 'fetch_url',
        description: 'Fetch a URL and return an archived page representation. Media is represented with [[artifact:id]] markers in Markdown plus artifactRefs. Cannot access private/internal network addresses.',
        parameters: z.object({
            url: z.string().describe('The URL to fetch'),
        }),
        async execute({ url }, runContext) {
            const archive = await fetchWebArchive(url);
            const knowledgeId = getKnowledgeId(runContext, 'default');
            const artifactArchive = await materializeArtifacts(archive.markdown, archive.media, config.storage.dataDir, knowledgeId);

            return toolSuccess({
                title: archive.title,
                url: archive.url,
                contentType: archive.contentType,
                markdown: artifactArchive.markdown,
                content: archive.text,
                artifactRefs: artifactArchive.artifactRefs,
                media: archive.media,
            });
        },
    });
}

interface ToolArtifactRef {
    id: string;
    path: string;
    kind: 'image' | 'audio' | 'video';
    sourceUrl: string;
    mimeType: string | null;
    caption: string | null;
    size: number | null;
    error: string | null;
}

interface ArchivedMedia {
    kind: 'image' | 'audio' | 'video';
    url: string;
    alt?: string;
}

interface WebArchive {
    title: string;
    url: string;
    contentType: string;
    markdown: string;
    text: string;
    media: ArchivedMedia[];
}

async function fetchWebArchive(url: string): Promise<WebArchive> {
    assertSafeUrl(url);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    try {
        const response = await fetchWithRedirects(url, controller.signal);
        const contentType = response.headers.get('content-type') ?? '';
        const body = await readLimitedBody(response);
        const finalUrl = response.url || url;

        if (!contentType.includes('html')) {
            const markdown = fencedText(body);
            return {
                title: '',
                url: finalUrl,
                contentType,
                markdown,
                text: body.slice(0, MAX_TEXT_CHARS),
                media: [],
            };
        }

        return archiveHtml(body, finalUrl, contentType);
    } finally {
        clearTimeout(timer);
    }
}

async function fetchWithRedirects(url: string, signal: AbortSignal): Promise<Response> {
    let currentUrl = url;
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
        assertSafeUrl(currentUrl);
        const response = await fetch(currentUrl, {
            signal,
            redirect: 'manual',
            headers: { 'User-Agent': 'Collector/2.0' },
        });

        if ([301, 302, 303, 307, 308].includes(response.status)) {
            const location = response.headers.get('location');
            if (!location) break;
            currentUrl = new URL(location, currentUrl).href;
            continue;
        }

        return response;
    }
    throw new Error(`Too many redirects (max ${MAX_REDIRECTS})`);
}

async function readLimitedBody(response: Response): Promise<string> {
    const reader = response.body?.getReader();
    if (!reader) return '';

    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BODY_BYTES) {
            await reader.cancel();
            break;
        }
        chunks.push(value);
    }

    return new TextDecoder().decode(Buffer.concat(chunks));
}

function assertSafeUrl(url: string): void {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw new Error(`Invalid URL: ${url}`);
    }

    if (!['http:', 'https:'].includes(parsed.protocol)) {
        throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }

    for (const pattern of BLOCKED_NETWORKS) {
        if (pattern.test(parsed.hostname)) {
            throw new Error(`Blocked private/internal address: ${parsed.hostname}`);
        }
    }
}

function archiveHtml(html: string, url: string, contentType: string): WebArchive {
    const dom = new JSDOM(html, { url });
    normalizeLazyMedia(dom.window.document);

    const article = new Readability(dom.window.document.cloneNode(true) as Document, {
        keepClasses: false,
    }).parse();

    const sourceDocument = dom.window.document;
    const contentHtml = article?.content || fallbackContentHtml(sourceDocument);
    const title = normalizeText(article?.title || sourceDocument.title || '');
    const markdown = normalizeMarkdown(createTurndownService(url).turndown(contentHtml));
    const media = collectMedia(contentHtml, url);
    const text = normalizeText(article?.textContent || markdownToPlainText(markdown));

    return {
        title,
        url,
        contentType,
        markdown: truncateMarkdown(markdown),
        text: text.slice(0, MAX_TEXT_CHARS),
        media,
    };
}

function normalizeLazyMedia(document: Document): void {
    for (const img of Array.from(document.querySelectorAll('img'))) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original');
        if (src) img.setAttribute('src', src);
    }

    for (const source of Array.from(document.querySelectorAll('source'))) {
        const src = source.getAttribute('src') || source.getAttribute('data-src');
        if (src) source.setAttribute('src', src);
    }
}

function fallbackContentHtml(document: Document): string {
    return document.querySelector('article, main')?.innerHTML
        || document.body?.innerHTML
        || document.documentElement.innerHTML;
}

function createTurndownService(baseUrl: string): TurndownService {
    const service = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
        emDelimiter: '_',
        strongDelimiter: '**',
        linkStyle: 'inlined',
    });

    service.use(gfm);

    service.addRule('absoluteImageUrls', {
        filter: 'img',
        replacement: (_content, node) => {
            const src = resolveUrl(node.getAttribute('src') || node.getAttribute('data-src') || '', baseUrl);
            if (!src) return '';
            const alt = normalizeText(node.getAttribute('alt') || 'image');
            return `\n\n![${escapeMarkdownLabel(alt)}](${src})\n\n`;
        },
    });

    service.addRule('absoluteLinks', {
        filter: 'a',
        replacement: (content, node) => {
            const href = resolveUrl(node.getAttribute('href') || '', baseUrl);
            const label = normalizeText(content) || href;
            return href ? `[${escapeMarkdownLabel(label)}](${href})` : label;
        },
    });

    service.addRule('mediaLinks', {
        filter: ['audio', 'video'],
        replacement: (_content, node) => {
            const tagName = node.tagName.toLowerCase();
            const src = resolveUrl(
                node.getAttribute('src') || node.querySelector('source')?.getAttribute('src') || '',
                baseUrl,
            );
            return src ? `\n\n[${tagName.toUpperCase()}](${src})\n\n` : '';
        },
    });

    return service;
}

function collectMedia(html: string, baseUrl: string): ArchivedMedia[] {
    const dom = new JSDOM(`<body>${html}</body>`, { url: baseUrl });
    const media: ArchivedMedia[] = [];

    for (const img of Array.from(dom.window.document.querySelectorAll('img'))) {
        const url = resolveUrl(img.getAttribute('src') || img.getAttribute('data-src') || '', baseUrl);
        if (url) {
            addMedia(media, { kind: 'image', url, alt: normalizeText(img.getAttribute('alt') || '') || undefined });
        }
    }

    for (const element of Array.from(dom.window.document.querySelectorAll('audio, video'))) {
        const kind = element.tagName.toLowerCase() as 'audio' | 'video';
        const url = resolveUrl(
            element.getAttribute('src') || element.querySelector('source')?.getAttribute('src') || '',
            baseUrl,
        );
        if (url) addMedia(media, { kind, url });
    }

    return media;
}

function addMedia(media: ArchivedMedia[], item: ArchivedMedia): void {
    if (!media.some(existing => existing.kind === item.kind && existing.url === item.url)) {
        media.push(item);
    }
}

function resolveUrl(value: string, baseUrl: string): string {
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return '';
    try {
        return new URL(value, baseUrl).href;
    } catch {
        return value;
    }
}

function normalizeMarkdown(markdown: string): string {
    return markdown
        .replace(/\r\n/g, '\n')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .split('\n')
        .map(line => line.trimEnd())
        .join('\n')
        .trim();
}

function normalizeText(text: string): string {
    return text.replace(/\s+/g, ' ').trim();
}

function markdownToPlainText(markdown: string): string {
    return normalizeText(markdown
        .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        .replace(/[#>*_`|-]/g, ' '));
}

function fencedText(text: string): string {
    return `\`\`\`\n${text.trim()}\n\`\`\``;
}

function truncateMarkdown(markdown: string): string {
    if (markdown.length <= MAX_MARKDOWN_CHARS) return markdown;
    return `${markdown.slice(0, MAX_MARKDOWN_CHARS)}\n\n...(truncated by Collector)`;
}

function escapeMarkdownLabel(value: string): string {
    return value.replace(/[\[\]]/g, '').replace(/\s+/g, ' ').trim();
}

async function materializeArtifacts(
    markdown: string,
    media: Array<{ kind: 'image' | 'audio' | 'video'; url: string; alt?: string }>,
    dataDir: string,
    knowledgeId: string,
): Promise<{ markdown: string; artifactRefs: ToolArtifactRef[] }> {
    const artifactRefs: ToolArtifactRef[] = [];
    let rewritten = markdown;

    for (const item of media) {
        const id = `art_${String(artifactRefs.length + 1).padStart(3, '0')}`;
        const artifact = await downloadArtifact(item, id, dataDir, knowledgeId);
        artifactRefs.push(artifact);
        rewritten = replaceMediaReferences(rewritten, item, id);
    }

    return { markdown: rewritten, artifactRefs };
}

async function downloadArtifact(
    item: { kind: 'image' | 'audio' | 'video'; url: string; alt?: string },
    id: string,
    dataDir: string,
    knowledgeId: string,
): Promise<ToolArtifactRef> {
    try {
        const response = await fetch(item.url, { headers: { 'User-Agent': 'Collector/2.0' } });
        if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
        }

        const mimeType = response.headers.get('content-type')?.split(';')[0]?.trim() || null;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > MAX_ARTIFACT_BYTES) {
            throw new Error(`artifact too large: ${buffer.length} bytes`);
        }

        const relativePath = join('artifacts', `${id}${extensionFor(item.url, mimeType)}`);
        const absolutePath = join(dataDir, knowledgeId, relativePath);
        mkdirSync(join(dataDir, knowledgeId, 'artifacts'), { recursive: true });
        writeFileSync(absolutePath, buffer);

        return {
            id,
            path: relativePath,
            kind: item.kind,
            sourceUrl: item.url,
            mimeType,
            caption: item.alt ?? null,
            size: buffer.length,
            error: null,
        };
    } catch (error) {
        return {
            id,
            path: item.url,
            kind: item.kind,
            sourceUrl: item.url,
            mimeType: null,
            caption: item.alt ?? null,
            size: null,
            error: `Download failed: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

function replaceMediaReferences(
    markdown: string,
    item: { kind: 'image' | 'audio' | 'video'; url: string; alt?: string },
    id: string,
): string {
    const marker = `\n\n[[artifact:${id}]]\n\n`;
    const escapedUrl = escapeRegExp(item.url);

    if (item.kind === 'image') {
        const imagePattern = new RegExp(`!?\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g');
        return markdown.replace(imagePattern, marker);
    }

    const mediaPattern = new RegExp(`\\[[^\\]]*\\]\\(${escapedUrl}\\)`, 'g');
    return markdown.replace(mediaPattern, marker);
}

function extensionFor(url: string, mimeType: string | null): string {
    const byMime: Record<string, string> = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'image/svg+xml': '.svg',
        'audio/mpeg': '.mp3',
        'audio/wav': '.wav',
        'audio/ogg': '.ogg',
        'video/mp4': '.mp4',
        'video/webm': '.webm',
    };
    if (mimeType && byMime[mimeType]) return byMime[mimeType];

    try {
        const extension = extname(new URL(url).pathname);
        return extension || '.bin';
    } catch {
        return '.bin';
    }
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
