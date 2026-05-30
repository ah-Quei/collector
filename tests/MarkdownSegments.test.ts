import { describe, expect, it } from 'vitest';
import { expandInlineArtifactSegments, replaceInlineArtifactMarkers, splitMarkdownForNativeBlocks } from '../src/services/feishu/MarkdownSegments.js';

describe('MarkdownSegments', () => {
    it('replaces local inline artifact markers with readable labels', () => {
        const markdown = '- [[artifact:art_001]]：论文首页截图';
        const attachments = new Map([
            ['art_001', {
                id: 'art_001',
                path: 'weixin-articles/article/images/img_001.jpeg',
                kind: 'image',
                caption: '论文首页截图',
            }],
        ]);

        expect(replaceInlineArtifactMarkers(markdown, attachments as any)).toBe('- 论文首页截图：论文首页截图');
    });

    it('keeps remote inline artifact markers as markdown links', () => {
        const markdown = 'See [[artifact:art_001]]';
        const attachments = new Map([
            ['art_001', {
                id: 'art_001',
                path: 'https://example.com/image.png',
                kind: 'image',
                caption: 'source image',
            }],
        ]);

        expect(replaceInlineArtifactMarkers(markdown, attachments as any)).toBe('See [source image](https://example.com/image.png)');
    });

    it('turns local inline artifact markers into block artifact segments', () => {
        const segments = splitMarkdownForNativeBlocks('正文说明。[[artifact:art_001]]');
        const attachments = new Map([
            ['art_001', {
                id: 'art_001',
                path: 'weixin-articles/article/images/img_001.jpeg',
                kind: 'image',
                caption: '论文首页截图',
            }],
        ]);

        expect(expandInlineArtifactSegments(segments, attachments as any)).toEqual([
            { type: 'markdown', content: '正文说明。论文首页截图' },
            { type: 'artifact', id: 'art_001' },
        ]);
    });

    it('does not duplicate local inline artifact markers that already have block positions', () => {
        const segments = splitMarkdownForNativeBlocks('[[artifact:art_001]]\n\n- [[artifact:art_001]]：论文首页截图');
        const attachments = new Map([
            ['art_001', {
                id: 'art_001',
                path: 'weixin-articles/article/images/img_001.jpeg',
                kind: 'image',
                caption: '论文首页截图',
            }],
        ]);

        expect(expandInlineArtifactSegments(segments, attachments as any)).toEqual([
            { type: 'artifact', id: 'art_001' },
            { type: 'markdown', content: '- 论文首页截图：论文首页截图' },
        ]);
    });
});
