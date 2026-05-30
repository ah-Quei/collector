import type { AttachmentInfo } from '../../models/Knowledge.js';
import type { FeishuDescendantBlock, FeishuTextElement } from './FeishuSdkTypes.js';
import { attachmentLabel } from './MarkdownSegments.js';

export interface TableBlocks {
    tableId: string;
    descendants: FeishuDescendantBlock[];
    columnWidth: number[];
    rows: string[][];
}

const MAX_NATIVE_TABLE_COLUMNS = 100;
const MAX_NATIVE_TABLE_DESCENDANTS = 1000;
export const MAX_NATIVE_TABLE_CELLS = Math.floor((MAX_NATIVE_TABLE_DESCENDANTS - 1) / 2);
const MIN_TABLE_COLUMN_WIDTH = 90;
const MAX_TABLE_TOTAL_WIDTH = 720;
const MAX_TABLE_TEXT_COLUMN_WIDTH = 420;
const MAX_TABLE_DENSE_TEXT_COLUMN_WIDTH = 190;
const MAX_TABLE_NUMERIC_COLUMN_WIDTH = 130;
const TABLE_ARTIFACT_COLUMN_WIDTH = 140;

export function shouldSplitTable(rows: string[][]): boolean {
    const columnSize = Math.max(...rows.map((row) => row.length));
    return columnSize > MAX_NATIVE_TABLE_COLUMNS || rows.length * columnSize > MAX_NATIVE_TABLE_CELLS;
}

export function splitLargeTable(rows: string[][]): string[][][] {
    const columnSize = Math.max(...rows.map((row) => row.length));
    const columnsPerChunk = Math.min(columnSize, MAX_NATIVE_TABLE_COLUMNS);
    const rowsPerChunk = Math.max(1, Math.floor(MAX_NATIVE_TABLE_CELLS / columnsPerChunk));
    const rowChunks = splitTallTable(rows, rowsPerChunk);
    return rowChunks.flatMap((rowChunk) => splitWideTable(rowChunk, MAX_NATIVE_TABLE_COLUMNS));
}

export function createTableBlocks(
    rows: string[][],
    attachmentById: Map<string, AttachmentInfo>,
): TableBlocks {
    const columnSize = Math.max(...rows.map((row) => row.length));
    const normalizedRows = rows.map((row) =>
        Array.from({ length: columnSize }, (_, index) => row[index]?.trim() ?? ''),
    );
    const columnWidth = estimateTableColumnWidths(normalizedRows);
    const table = createTableDescendants(normalizedRows, columnWidth, attachmentById);
    return {
        ...table,
        columnWidth,
        rows: normalizedRows,
    };
}

function createTableDescendants(
    rows: string[][],
    columnWidth: number[],
    attachmentById: Map<string, AttachmentInfo>,
): { tableId: string; descendants: FeishuDescendantBlock[] } {
    const columnSize = Math.max(...rows.map((row) => row.length));
    const tableId = temporaryBlockId('table', 0, 0);
    const cellIds: string[] = [];
    const descendants: FeishuDescendantBlock[] = [];

    descendants.push({
        block_id: tableId,
        block_type: 31,
        table: {
            property: {
                row_size: rows.length,
                column_size: columnSize,
                column_width: columnWidth,
                header_row: rows.length > 1,
            },
        },
        children: cellIds,
    });

    for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        for (let columnIndex = 0; columnIndex < columnSize; columnIndex += 1) {
            const cellId = temporaryBlockId('cell', rowIndex, columnIndex);
            const textId = temporaryBlockId('cell_text', rowIndex, columnIndex);
            cellIds.push(cellId);
            descendants.push({
                block_id: cellId,
                block_type: 32,
                table_cell: {},
                children: [textId],
            });
            descendants.push({
                block_id: textId,
                block_type: 2,
                text: {
                    elements: toFeishuTextElements(rows[rowIndex]?.[columnIndex] ?? '', {
                        bold: rowIndex === 0,
                        attachmentById,
                    }),
                },
                children: [],
            });
        }
    }

    return { tableId, descendants };
}

function temporaryBlockId(prefix: string, rowIndex: number, columnIndex: number): string {
    return `${prefix}_${rowIndex}_${columnIndex}`;
}

function estimateTableColumnWidths(rows: string[][]): number[] {
    const columnSize = Math.max(...rows.map((row) => row.length));
    const profiles = Array.from({ length: columnSize }, (_, columnIndex) => {
        const samples = rows.map((row) => row[columnIndex] ?? '');
        const maxScore = Math.max(...samples.map(visualLength), 1);
        const hasArtifact = samples.some((cell) => /\[\[artifact:art_[a-zA-Z0-9_-]+]]/.test(cell));
        const mostlyNumeric = samples.slice(1).length > 0
            && samples.slice(1).every((cell) => !cell.trim() || /^[\d.,%/+\-\sA-Za-z]+$/.test(cell.trim()));

        if (hasArtifact) {
            return { desired: TABLE_ARTIFACT_COLUMN_WIDTH, min: 120 };
        }

        if (mostlyNumeric && maxScore <= 18) {
            return {
                desired: clamp(96 + maxScore * 3, MIN_TABLE_COLUMN_WIDTH, MAX_TABLE_NUMERIC_COLUMN_WIDTH),
                min: MIN_TABLE_COLUMN_WIDTH,
            };
        }

        const maxTextWidth = columnSize >= 6 ? MAX_TABLE_DENSE_TEXT_COLUMN_WIDTH : MAX_TABLE_TEXT_COLUMN_WIDTH;
        return {
            desired: clamp(108 + maxScore * 5, 120, maxTextWidth),
            min: MIN_TABLE_COLUMN_WIDTH,
        };
    });
    const desiredWidths = profiles.map((profile) => profile.desired);
    const desiredTotal = desiredWidths.reduce((sum, width) => sum + width, 0);
    const totalWidthBudget = Math.max(columnSize * MIN_TABLE_COLUMN_WIDTH, MAX_TABLE_TOTAL_WIDTH);
    const targetWidth = estimateTableTargetWidth(rows, totalWidthBudget);
    if (desiredTotal < targetWidth) {
        return expandTableColumnWidths(profiles, targetWidth);
    }
    if (desiredTotal <= totalWidthBudget) return desiredWidths;

    const minTotal = profiles.reduce((sum, profile) => sum + profile.min, 0);
    if (minTotal >= totalWidthBudget) return profiles.map((profile) => profile.min);

    const reducibleTotal = profiles.reduce((sum, profile) => sum + Math.max(0, profile.desired - profile.min), 0);
    if (reducibleTotal <= 0) return desiredWidths;

    const excess = desiredTotal - totalWidthBudget;
    return profiles.map((profile) => {
        const reducible = Math.max(0, profile.desired - profile.min);
        return clamp(profile.desired - (excess * reducible) / reducibleTotal, profile.min, profile.desired);
    });
}

function estimateTableTargetWidth(rows: string[][], totalWidthBudget: number): number {
    const columnSize = Math.max(...rows.map((row) => row.length));
    const hasArtifact = rows.some((row) => row.some((cell) => /\[\[artifact:art_[a-zA-Z0-9_-]+]]/.test(cell)));
    const hasLongText = rows.some((row) => row.some((cell) => visualLength(cell) >= 36));
    const hasManyRows = rows.length >= 4;

    if (hasArtifact || hasLongText) return totalWidthBudget;
    if (hasManyRows || columnSize >= 4) return Math.min(totalWidthBudget, Math.max(columnSize * 125, 560));
    return Math.min(totalWidthBudget, Math.max(columnSize * 120, 360));
}

function expandTableColumnWidths(profiles: Array<{ desired: number; min: number }>, targetWidth: number): number[] {
    const desiredTotal = profiles.reduce((sum, profile) => sum + profile.desired, 0);
    if (desiredTotal >= targetWidth || desiredTotal <= 0) {
        return profiles.map((profile) => profile.desired);
    }

    const extra = targetWidth - desiredTotal;
    const expanded = profiles.map((profile) => {
        return profile.desired + (extra * profile.desired) / desiredTotal;
    });
    const rounded = expanded.map((width) => Math.round(width));
    const delta = Math.round(targetWidth - rounded.reduce((sum, width) => sum + width, 0));
    if (delta !== 0 && rounded.length > 0) {
        const widestIndex = rounded.reduce((best, width, index) => width > rounded[best] ? index : best, 0);
        rounded[widestIndex] += delta;
    }
    return rounded;
}

function visualLength(value: string): number {
    const plain = value
        .replace(/\[\[artifact:art_[a-zA-Z0-9_-]+]]/g, 'attachment')
        .replace(/\[([^\]]+)]\([^)]+\)/g, '$1')
        .replace(/[*_`]/g, '');
    let score = 0;
    for (const char of plain) {
        score += /[\u3400-\u9fff\u3040-\u30ff\uff00-\uffef]/.test(char) ? 2 : 1;
    }
    return score;
}

function clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, Math.round(value)));
}

function splitTallTable(rows: string[][], maxRows: number): string[][][] {
    if (rows.length <= maxRows) return [rows];

    const header = rows[0] ?? [];
    const body = rows.slice(1);
    const maxBodyRows = Math.max(1, maxRows - 1);
    const chunks: string[][][] = [];
    for (let start = 0; start < body.length; start += maxBodyRows) {
        chunks.push([header, ...body.slice(start, start + maxBodyRows)]);
    }
    return chunks;
}

function splitWideTable(rows: string[][], maxColumns: number): string[][][] {
    const columnSize = Math.max(...rows.map((row) => row.length));
    if (columnSize <= maxColumns) return [rows];

    const firstColumn = rows.map((row) => row[0] ?? '');
    const chunks: string[][][] = [];
    for (let start = 1; start < columnSize; start += maxColumns - 1) {
        const end = Math.min(start + maxColumns - 1, columnSize);
        chunks.push(rows.map((row, rowIndex) => [
            firstColumn[rowIndex] ?? '',
            ...row.slice(start, end),
        ]));
    }
    return chunks;
}

function toFeishuTextElements(
    markdown: string,
    options: { bold?: boolean; attachmentById?: Map<string, AttachmentInfo> } = {},
): FeishuTextElement[] {
    const elements: FeishuTextElement[] = [];
    const pattern = /\[\[artifact:(art_[a-zA-Z0-9_-]+)]]|\[([^\]]+)]\((https?:\/\/[^)\s]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/g;
    let cursor = 0;
    let match: RegExpExecArray | null;

    const pushText = (content: string, style: Record<string, unknown> = {}): void => {
        if (!content) return;
        elements.push({
            text_run: {
                content,
                text_element_style: {
                    ...(options.bold ? { bold: true } : {}),
                    ...style,
                },
            },
        });
    };

    while ((match = pattern.exec(markdown)) !== null) {
        pushText(markdown.slice(cursor, match.index));
        if (match[1]) {
            const attachment = options.attachmentById?.get(match[1]);
            const label = attachmentLabel(attachment, match[1]);
            const url = attachment?.sourceUrl || (/^https?:\/\//i.test(attachment?.path ?? '') ? attachment?.path : '');
            pushText(label, url ? { link: { url } } : { inline_code: true });
        } else if (match[2] && match[3]) {
            pushText(match[2], { link: { url: match[3] } });
        } else if (match[4]) {
            pushText(match[4], { inline_code: true });
        } else if (match[5]) {
            pushText(match[5], { bold: true });
        }
        cursor = pattern.lastIndex;
    }
    pushText(markdown.slice(cursor));

    if (elements.length === 0) {
        pushText(' ');
    }
    return elements;
}
