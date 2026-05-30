import { BaseRepository } from './BaseRepository.js';
import { Tag, type TagKind } from '../models/Tag.js';

type TagRow = Parameters<typeof Tag.fromRow>[0];

export class TagRepository extends BaseRepository<Tag> {
    findById(id: string): Tag | null {
        const row = this.db.prepare<[string], TagRow>('SELECT * FROM tags WHERE id = ?').get(id);
        return row ? Tag.fromRow(row) : null;
    }

    findAll(): Tag[] {
        const rows = this.db.prepare<[], TagRow>('SELECT * FROM tags ORDER BY kind, name').all();
        return rows.map(Tag.fromRow);
    }

    findByKind(kind: TagKind): Tag[] {
        const rows = this.db.prepare<[TagKind], TagRow>('SELECT * FROM tags WHERE kind = ? ORDER BY name').all(kind);
        return rows.map(Tag.fromRow);
    }

    findByNameAndKind(name: string, kind: TagKind): Tag | null {
        const row = this.db.prepare<[string, TagKind], TagRow>('SELECT * FROM tags WHERE name = ? AND kind = ?').get(name, kind);
        return row ? Tag.fromRow(row) : null;
    }

    create(tag: Tag): Tag {
        const now = this.now();
        this.db.prepare(`
            INSERT INTO tags (id, name, kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
        `).run(tag.id, tag.name, tag.kind, now, now);
        return tag;
    }

    update(tag: Tag): Tag {
        const now = this.now();
        tag.updatedAt = new Date(now);
        this.db.prepare(`
            UPDATE tags SET name = ?, kind = ?, updated_at = ? WHERE id = ?
        `).run(tag.name, tag.kind, now, tag.id);
        return tag;
    }

    delete(id: string): void {
        this.db.prepare('DELETE FROM tags WHERE id = ?').run(id);
    }

    /**
     * Find or create a tag by name and kind
     */
    findOrCreate(name: string, kind: TagKind): Tag {
        const existing = this.findByNameAndKind(name, kind);
        if (existing) return existing;

        const tag = new Tag(name, kind);
        return this.create(tag);
    }

    /**
     * Link a tag to a knowledge entry
     */
    linkToKnowledge(knowledgeId: string, tagId: string, confidence?: number): void {
        this.db.prepare(`
            INSERT OR IGNORE INTO knowledge_tags (knowledge_id, tag_id, confidence, created_at)
            VALUES (?, ?, ?, ?)
        `).run(knowledgeId, tagId, confidence ?? null, this.now());
    }

    unlinkAllFromKnowledge(knowledgeId: string): void {
        this.db.prepare('DELETE FROM knowledge_tags WHERE knowledge_id = ?').run(knowledgeId);
    }

    /**
     * Get all tags for a knowledge entry
     */
    findByKnowledgeId(knowledgeId: string): Tag[] {
        const rows = this.db.prepare<[string], TagRow>(`
            SELECT t.* FROM tags t
            JOIN knowledge_tags kt ON t.id = kt.tag_id
            WHERE kt.knowledge_id = ?
            ORDER BY t.kind, t.name
        `).all(knowledgeId);
        return rows.map(Tag.fromRow);
    }
}
