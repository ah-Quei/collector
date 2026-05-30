import { v4 as uuidv4 } from 'uuid';

export abstract class BaseEntity {
    public readonly id: string;
    public readonly createdAt: Date;
    public updatedAt: Date;

    constructor(id?: string, createdAt?: Date, updatedAt?: Date) {
        this.id = id ?? uuidv4();
        this.createdAt = createdAt ?? new Date();
        this.updatedAt = updatedAt ?? new Date();
    }

    abstract validate(): void;
}
