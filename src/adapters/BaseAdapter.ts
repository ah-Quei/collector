export abstract class BaseAdapter {
    abstract readonly name: string;

    abstract start(): Promise<void>;
    abstract stop(): Promise<void>;
    abstract healthCheck(): Promise<boolean>;
}
