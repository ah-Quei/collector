import { BaseRepository } from './BaseRepository.js';
import { Knowledge } from '../models/Knowledge.js';

type KnowledgeRow = Parameters<typeof Knowledge.fromRow>[0];

export class KnowledgeRepository extends BaseRepository<Knowledge> {
    findById(id: string): Knowledge | null {
        const row = this.db.prepare<[string], KnowledgeRow>('SELECT * FROM knowledge WHERE id = ?').get(id);
        return row ? Knowledge.fromRow(row) : null;
    }

    findAll(): Knowledge[] {
        const rows = this.db.prepare<[], KnowledgeRow>('SELECT * FROM knowledge ORDER BY created_at DESC').all();
        return rows.map(Knowledge.fromRow);
    }

    findLatestUpdatedAt(): Date | null {
        const row = this.db.prepare('SELECT MAX(updated_at) AS updated_at FROM knowledge').get() as { updated_at: string | null };
        return row.updated_at ? new Date(row.updated_at) : null;
    }

    findDocumentSyncCandidates(): Knowledge[] {
        const rows = this.db.prepare<[], KnowledgeRow>(`
            SELECT * FROM knowledge
            WHERE (feishu_doc_id IS NOT NULL AND feishu_doc_id != '')
               OR status != 'done'
            ORDER BY created_at DESC
        `).all();
        return rows.map(Knowledge.fromRow);
    }

    create(knowledge: Knowledge): Knowledge {
        const now = this.now();
        this.db.prepare(`
            INSERT INTO knowledge (
                id, title, summary, content_markdown, platform,
                status, error_message,
                source_url, canonical_url, author, published_at, content_type,
                feishu_doc_id, feishu_wiki_node, tags, confidence,
                needs_review, quality_notes, attachments, ingress_context, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            knowledge.id, knowledge.title, knowledge.summary,
            knowledge.contentMarkdown, knowledge.platform,
            knowledge.status, knowledge.errorMessage,
            knowledge.sourceUrl, knowledge.canonicalUrl, knowledge.author,
            knowledge.publishedAt, knowledge.contentType,
            knowledge.feishuDocId, knowledge.feishuWikiNode,
            JSON.stringify(knowledge.tags), knowledge.confidence,
            knowledge.needsReview ? 1 : 0, knowledge.qualityNotes,
            JSON.stringify(knowledge.attachments), JSON.stringify(knowledge.ingressContext ?? {}),
            now, now,
        );
        return knowledge;
    }

    update(knowledge: Knowledge): Knowledge {
        const now = this.now();
        knowledge.updatedAt = new Date(now);
        this.db.prepare(`
            UPDATE knowledge SET
                title = ?, summary = ?, content_markdown = ?, platform = ?,
                status = ?, error_message = ?,
                source_url = ?, canonical_url = ?, author = ?, published_at = ?,
                content_type = ?, feishu_doc_id = ?, feishu_wiki_node = ?,
                tags = ?, confidence = ?, needs_review = ?, quality_notes = ?,
                attachments = ?, ingress_context = ?, updated_at = ?
            WHERE id = ?
        `).run(
            knowledge.title, knowledge.summary, knowledge.contentMarkdown,
            knowledge.platform, knowledge.status,
            knowledge.errorMessage, knowledge.sourceUrl, knowledge.canonicalUrl,
            knowledge.author, knowledge.publishedAt, knowledge.contentType,
            knowledge.feishuDocId, knowledge.feishuWikiNode,
            JSON.stringify(knowledge.tags), knowledge.confidence,
            knowledge.needsReview ? 1 : 0, knowledge.qualityNotes,
            JSON.stringify(knowledge.attachments), JSON.stringify(knowledge.ingressContext ?? {}),
            now, knowledge.id,
        );
        return knowledge;
    }

    delete(id: string): void {
        this.db.prepare('DELETE FROM knowledge WHERE id = ?').run(id);
    }

    search(query: string, tags?: string[], limit: number = 10): Knowledge[] {
        let sql = `SELECT * FROM knowledge WHERE (title LIKE ? OR summary LIKE ? OR content_markdown LIKE ?)`;
        const pattern = `%${query}%`;
        const params: unknown[] = [pattern, pattern, pattern];

        if (tags && tags.length > 0) {
            const tagConditions = tags.map(() => `tags LIKE ?`).join(' OR ');
            sql += ` AND (${tagConditions})`;
            tags.forEach(t => params.push(`%"${t}"%`));
        }

        sql += ` ORDER BY created_at DESC LIMIT ?`;
        params.push(limit);

        const rows = this.db.prepare<unknown[], KnowledgeRow>(sql).all(...params);
        return rows.map(Knowledge.fromRow);
    }
}
