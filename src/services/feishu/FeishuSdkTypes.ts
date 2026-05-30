import type * as Lark from '@larksuiteoapi/node-sdk';

export interface FeishuBlock {
    block_id?: string;
    block_type?: number;
    children?: string[];
}

export interface FeishuConvertedBlock extends FeishuBlock {
    block_id: string;
    block_type?: number;
    children?: string[];
}

export interface FeishuTextElement {
    text_run?: {
        content: string;
        text_element_style?: {
            bold?: boolean;
            inline_code?: boolean;
            link?: {
                url: string;
            };
        };
    };
}

export interface FeishuTextBlock {
    block_id: string;
    block_type: 2;
    text: {
        elements: FeishuTextElement[];
    };
    children: [];
}

export interface FeishuTableBlock extends FeishuBlock {
    block_id: string;
    block_type: 31;
    table: {
        property: {
            row_size: number;
            column_size: number;
            column_width: number[];
            header_row: boolean;
        };
    };
    children: string[];
}

export interface FeishuTableCellBlock extends FeishuBlock {
    block_id: string;
    block_type: 32;
    table_cell: Record<string, never>;
    children: string[];
}

export type FeishuDescendantBlock = FeishuConvertedBlock | FeishuTextBlock | FeishuTableBlock | FeishuTableCellBlock;

export interface FeishuDocxClient {
    wiki: Lark.Client['wiki'];
    docx: {
        document: Omit<Lark.Client['docx']['document'], 'convert'> & {
            convert(payload: {
                data: {
                    content_type: 'markdown';
                    content: string;
                };
            }): Promise<{
                data?: {
                    blocks?: FeishuConvertedBlock[];
                    first_level_block_ids?: string[];
                };
            }>;
        };
        documentBlockChildren: {
            get(payload: {
                path: { document_id: string; block_id: string };
                params?: { document_revision_id?: number; page_size?: number };
            }): Promise<{
                data?: {
                    items?: FeishuBlock[];
                    children?: FeishuBlock[];
                };
            }>;
            create(payload: {
                path: { document_id: string; block_id: string };
                params?: { document_revision_id?: number };
                data: {
                    children: Array<{
                        block_type: number;
                        file?: { view_type: number };
                        image?: {
                            align: number;
                            caption?: { content: string };
                        };
                    }>;
                };
            }): Promise<{
                data?: {
                    children?: Array<FeishuBlock & { children?: string[] }>;
                };
            }>;
            batchDelete(payload: {
                path: { document_id: string; block_id: string };
                params?: { document_revision_id?: number };
                data: { start_index: number; end_index: number };
            }): Promise<unknown>;
        };
        documentBlockDescendant: {
            create(payload: {
                path: { document_id: string; block_id: string };
                params?: { document_revision_id?: number };
                data: {
                    children_id: string[];
                    descendants: FeishuDescendantBlock[];
                };
            }): Promise<unknown>;
        };
        documentBlock: {
            patch(payload: {
                path: { document_id: string; block_id: string };
                params?: { document_revision_id?: number };
                data: {
                    replace_file?: { token: string };
                    replace_image?: {
                        token: string;
                        align: number;
                        caption?: { content: string };
                    };
                };
            }): Promise<unknown>;
        };
    };
    drive: {
        media: Omit<Lark.Client['drive']['media'], 'uploadAll'> & {
            uploadAll(payload: {
                data: {
                    file_name: string;
                    parent_type: string;
                    parent_node: string;
                    size: number;
                    file: Buffer;
                };
            }): Promise<{ file_token?: string } | null>;
        };
    };
}

export function asFeishuDocxClient(client: Lark.Client): FeishuDocxClient {
    return client as FeishuDocxClient;
}
