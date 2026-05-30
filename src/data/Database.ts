import Database from 'better-sqlite3';
import { dirname } from 'node:path';
import { mkdirSync } from 'node:fs';

export class DatabaseManager {
    private db: Database.Database | null = null;

    constructor(private dbPath: string) {}

    connect(): Database.Database {
        if (this.db) return this.db;

        const dir = dirname(this.dbPath);
        mkdirSync(dir, { recursive: true });

        this.db = new Database(this.dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');

        this.migrate();
        return this.db;
    }

    getDb(): Database.Database {
        if (!this.db) {
            throw new Error('Database not connected. Call connect() first.');
        }
        return this.db;
    }

    close(): void {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    private migrate(): void {
        const db = this.db!;

        db.exec(`
            CREATE TABLE IF NOT EXISTS knowledge (
                id TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                summary TEXT NOT NULL DEFAULT '',
                content_markdown TEXT NOT NULL DEFAULT '',
                platform TEXT NOT NULL DEFAULT '',
                status TEXT NOT NULL DEFAULT 'processing',
                error_message TEXT,
                source_url TEXT,
                canonical_url TEXT,
                author TEXT,
                published_at TEXT,
                content_type TEXT NOT NULL DEFAULT 'text',
                feishu_doc_id TEXT,
                feishu_wiki_node TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                confidence REAL NOT NULL DEFAULT 1.0,
                needs_review INTEGER NOT NULL DEFAULT 0,
                quality_notes TEXT NOT NULL DEFAULT '',
                attachments TEXT NOT NULL DEFAULT '[]',
                ingress_context TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS tags (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                kind TEXT NOT NULL CHECK(kind IN ('topic', 'source', 'status', 'project')),
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                UNIQUE(name, kind)
            );

            CREATE TABLE IF NOT EXISTS knowledge_tags (
                knowledge_id TEXT NOT NULL REFERENCES knowledge(id) ON DELETE CASCADE,
                tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                confidence REAL,
                created_at TEXT NOT NULL,
                PRIMARY KEY (knowledge_id, tag_id)
            );

            CREATE TRIGGER IF NOT EXISTS cleanup_unreferenced_tags_after_knowledge_tag_delete
            AFTER DELETE ON knowledge_tags
            BEGIN
                DELETE FROM tags
                WHERE id = OLD.tag_id
                  AND NOT EXISTS (
                      SELECT 1 FROM knowledge_tags
                      WHERE tag_id = OLD.tag_id
                  );
            END;

        `);

        const knowledgeColumns = db.prepare('PRAGMA table_info(knowledge)').all() as Array<{ name: string }>;
        const hasIngressContext = knowledgeColumns.some((column) => column.name === 'ingress_context');
        if (!hasIngressContext) {
            db.exec(`ALTER TABLE knowledge ADD COLUMN ingress_context TEXT NOT NULL DEFAULT '{}'`);
        }

        db.exec(`DROP TABLE IF EXISTS settings`);
    }
}
