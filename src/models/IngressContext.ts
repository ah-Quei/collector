export interface RawContent {
    type: 'text' | 'image' | 'audio' | 'video' | 'file';
    text?: string;
    mimeType?: string;
    storageUri?: string;
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
