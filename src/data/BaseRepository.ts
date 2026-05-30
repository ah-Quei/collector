import type Database from 'better-sqlite3';
import type { BaseEntity } from '../models/BaseEntity.js';

export abstract class BaseRepository<T extends BaseEntity> {
    constructor(protected db: Database.Database) {}

    abstract findById(id: string): T | null;
    abstract findAll(): T[];
    abstract create(entity: T): T;
    abstract update(entity: T): T;
    abstract delete(id: string): void;

    protected now(): string {
        return new Date().toISOString();
    }
}
