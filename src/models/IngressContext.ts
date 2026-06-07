export interface RawContent {
    type: 'text' | 'image' | 'audio' | 'video' | 'file';
    text?: string;
    mimeType?: string;
    storageUri?: string;
    remoteStorageUri?: string;
    fileName?: string;
    size?: number;
    downloadError?: string;
    data?: Uint8Array;
}

export interface IngressContext {
    source: 'feishu' | 'browser-extension';
    chatId: string;
    contents: RawContent[];
    metadata?: {
        url?: string;
        title?: string;
        selectedText?: string;
        messageId?: string;
    };
}
