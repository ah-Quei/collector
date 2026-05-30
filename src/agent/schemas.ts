import { z } from 'zod';

export const AgentOutputSchema = z.object({
    title: z.string().describe('Title. For URL inputs, use the original source title exactly; do not shorten or rename it.'),
    summary: z.string().describe('One-paragraph summary of the collected source'),
    contentMarkdown: z.string().describe('Final publishable Markdown article body. Follow the matched Skill for structure. Preserve artifact markers such as [[artifact:art_001]] at the exact position where the referenced attachment should appear.'),
    author: z.string().nullable().describe('Author name'),
    publishedAt: z.string().nullable().describe('Published date in ISO 8601'),
    platform: z.string().describe('Source platform (e.g. xiaohongshu, bilibili, wechat)'),
    contentType: z.string().describe('Content type: text, image, audio, video, file'),
    sourceUrl: z.string().nullable().describe('Original URL'),
    canonicalUrl: z.string().nullable().describe('Canonical URL'),
    selectedExistingTags: z.array(z.string()).describe('IDs of reused existing tags'),
    newTags: z.array(z.object({
        name: z.string(),
        kind: z.enum(['topic', 'source', 'status', 'project']),
    })).describe('New tags to create'),
    artifactRefs: z.array(z.object({
        id: z.string().regex(/^art_[a-zA-Z0-9_-]+$/).describe('Stable artifact marker id used in contentMarkdown, for example art_001'),
        path: z.string().describe('Local file path relative to the current job directory (dataDir/<knowledgeId>/), or the original remote URL if downloading failed'),
        kind: z.enum(['image', 'audio', 'video', 'file']),
        sourceUrl: z.string().nullable().describe('Original remote URL, when available'),
        caption: z.string().nullable().describe('Display caption or alt text, when available'),
        mimeType: z.string().nullable().describe('Detected MIME type, when available'),
        size: z.number().nullable().describe('Local file size in bytes, when available'),
        error: z.string().nullable().describe('Download or processing error, when the artifact could not be materialized locally'),
    })).describe('Artifacts referenced by contentMarkdown markers. Every [[artifact:id]] marker in contentMarkdown should have one matching artifactRef.'),
    confidence: z.number().min(0).max(1).describe('Confidence score'),
    needsReview: z.boolean().describe('Whether manual review is needed'),
    qualityNotes: z.string().describe('Quality notes'),
});

export type AgentOutput = z.infer<typeof AgentOutputSchema>;
