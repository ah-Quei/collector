import { BaseEntity } from './BaseEntity.js';

export type TagKind = 'topic' | 'source' | 'status' | 'project';

export class Tag extends BaseEntity {
    constructor(
        public name: string,
        public kind: TagKind,
        id?: string,
        createdAt?: Date,
        updatedAt?: Date,
    ) {
        super(id, createdAt, updatedAt);
    }

    validate(): void {
        if (!this.name) {
            throw new Error('Tag name is required');
        }
        if (!['topic', 'source', 'status', 'project'].includes(this.kind)) {
            throw new Error(`Invalid tag kind: ${this.kind}`);
        }
    }

    static fromRow(row: {
        id: string;
        name: string;
        kind: string;
        created_at: string;
        updated_at: string;
    }): Tag {
        return new Tag(
            row.name,
            row.kind as TagKind,
            row.id,
            new Date(row.created_at),
            new Date(row.updated_at),
        );
    }
}
