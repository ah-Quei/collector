import { basename } from 'node:path';
import type { AttachmentInfo } from '../../models/Knowledge.js';

export type MarkdownSegment =
    | { type: 'markdown'; content: string }
    | { type: 'table'; rows: string[][] }
    | { type: 'image'; alt: string; url: string }
    | { type: 'artifact'; id: string };

export function splitMarkdownForNativeBlocks(markdown: string): MarkdownSegment[] {
    const lines = markdown.replace(/\r\n/g, '\n').split('\n');
    const segments: MarkdownSegment[] = [];
    const buffer: string[] = [];
    let inFence = false;

    const flushMarkdown = (): void => {
        const content = buffer.join('\n').trim();
        buffer.length = 0;
        if (content) {
            segments.push({ type: 'markdown', content });
        }
    };

    for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i] ?? '';
        if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            buffer.push(line);
            continue;
        }

        if (!inFence) {
            const image = parseStandaloneImage(line);
            if (image) {
                flushMarkdown();
                segments.push({ type: 'image', ...image });
                continue;
            }

            if (isMarkdownTableStart(lines, i)) {
                flushMarkdown();
                const tableLines = [lines[i], lines[i + 1]];
                i += 2;
                while (i < lines.length && isMarkdownTableRow(lines[i] ?? '')) {
                    tableLines.push(lines[i] ?? '');
                    i += 1;
                }
                i -= 1;

                const rows = parseMarkdownTable(tableLines);
                if (rows.length > 0) {
                    segments.push({ type: 'table', rows });
                }
                continue;
            }

            const artifact = parseArtifactMarker(line.trim());
            if (artifact) {
                flushMarkdown();
                segments.push({ type: 'artifact', id: artifact.id });
                continue;
            }
        }

        buffer.push(line);
    }

    flushMarkdown();
    return segments;
}

export function expandInlineArtifactSegments(
    segments: MarkdownSegment[],
    attachmentById: Map<string, AttachmentInfo>,
): MarkdownSegment[] {
    const insertedArtifactIds = new Set(
        segments
            .filter((segment): segment is { type: 'artifact'; id: string } => segment.type === 'artifact')
            .map((segment) => segment.id),
    );
    const expanded: MarkdownSegment[] = [];

    for (const segment of segments) {
        if (segment.type !== 'markdown') {
            expanded.push(segment);
            continue;
        }

        expanded.push(...expandMarkdownInlineArtifacts(segment.content, attachmentById, insertedArtifactIds));
    }

    return expanded;
}

export function replaceInlineArtifactMarkers(
    markdown: string,
    attachmentById: Map<string, AttachmentInfo>,
): string {
    return markdown.replace(/\[\[artifact:(art_[a-zA-Z0-9_-]+)]]/g, (_marker, id: string) => {
        const attachment = attachmentById.get(id);
        const label = attachmentLabel(attachment, id);
        const url = attachment?.sourceUrl || (/^https?:\/\//i.test(attachment?.path ?? '') ? attachment?.path : '');
        return url ? `[${escapeMarkdownLinkText(label)}](${url})` : escapeMarkdownLinkText(label);
    });
}

export function attachmentLabel(attachment: AttachmentInfo | undefined, fallbackId: string): string {
    if (!attachment) return fallbackId;
    if (attachment.caption) return attachment.caption;
    try {
        return basename(new URL(attachment.sourceUrl || attachment.path).pathname) || fallbackId;
    } catch {
        return basename(attachment.path) || fallbackId;
    }
}

function parseArtifactMarker(line: string): { id: string } | undefined {
    const match = line.trim().match(/^\[\[artifact:(art_[a-zA-Z0-9_-]+)]]$/);
    return match?.[1] ? { id: match[1] } : undefined;
}

function expandMarkdownInlineArtifacts(
    markdown: string,
    attachmentById: Map<string, AttachmentInfo>,
    insertedArtifactIds: Set<string>,
): MarkdownSegment[] {
    const segments: MarkdownSegment[] = [];
    const buffer: string[] = [];

    const flushMarkdown = (): void => {
        const content = buffer.join('\n').trim();
        buffer.length = 0;
        if (content) {
            segments.push({ type: 'markdown', content });
        }
    };

    for (const line of markdown.split('\n')) {
        const artifactIds = [...line.matchAll(/\[\[artifact:(art_[a-zA-Z0-9_-]+)]]/g)]
            .map((match) => match[1])
            .filter((id): id is string => Boolean(id));
        if (artifactIds.length === 0) {
            buffer.push(line);
            continue;
        }

        buffer.push(replaceInlineArtifactMarkers(line, attachmentById));

        const localArtifactIds = artifactIds.filter((id) => {
            const attachment = attachmentById.get(id);
            return attachment && !isRemoteArtifact(attachment) && !insertedArtifactIds.has(id);
        });
        if (localArtifactIds.length === 0) continue;

        flushMarkdown();
        for (const id of localArtifactIds) {
            segments.push({ type: 'artifact', id });
            insertedArtifactIds.add(id);
        }
    }

    flushMarkdown();
    return segments;
}

function isRemoteArtifact(attachment: AttachmentInfo): boolean {
    return Boolean(attachment.sourceUrl) || /^https?:\/\//i.test(attachment.path);
}

function escapeMarkdownLinkText(value: string): string {
    return value.replace(/[[\]\\]/g, '\\$&');
}

function parseStandaloneImage(line: string): { alt: string; url: string } | undefined {
    const match = line.trim().match(/^!\[([^\]]*)]\((\S+?)(?:\s+"[^"]*")?\)$/);
    if (!match) return undefined;
    return {
        alt: match[1]?.trim() ?? '',
        url: (match[2] ?? '').trim(),
    };
}

function isMarkdownTableStart(lines: string[], index: number): boolean {
    const header = lines[index] ?? '';
    const separator = lines[index + 1] ?? '';
    return isMarkdownTableRow(header) && isMarkdownTableSeparator(separator);
}

function isMarkdownTableRow(line: string): boolean {
    return splitMarkdownTableRow(line).length >= 2;
}

function isMarkdownTableSeparator(line: string): boolean {
    const cells = splitMarkdownTableRow(line);
    return cells.length >= 2 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function parseMarkdownTable(lines: string[]): string[][] {
    if (lines.length < 2 || !isMarkdownTableSeparator(lines[1] ?? '')) return [];
    const dataLines = [lines[0], ...lines.slice(2)];
    return dataLines
        .map((line) => splitMarkdownTableRow(line).map(cleanTableCell))
        .filter((row) => row.length > 0);
}

function splitMarkdownTableRow(line: string): string[] {
    let value = line.trim();
    if (!value.includes('|')) return [];
    if (value.startsWith('|')) value = value.slice(1);
    if (value.endsWith('|')) value = value.slice(0, -1);

    const cells: string[] = [];
    let current = '';
    let escaping = false;
    for (const char of value) {
        if (escaping) {
            current += char;
            escaping = false;
        } else if (char === '\\') {
            escaping = true;
        } else if (char === '|') {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells;
}

function cleanTableCell(cell: string): string {
    return cell
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/\\\|/g, '|')
        .trim();
}
