export interface ProgressStep {
    id: string;
    text: string;
    status: 'pending' | 'running' | 'done' | 'error';
}

export interface CompleteInfo {
    title: string;
    summary: string;
    docUrl?: string;
    knowledgeId?: string;
    reprocessable?: boolean;
}

export interface FailInfo {
    error: string;
    docUrl?: string;
    knowledgeId?: string;
    reprocessable?: boolean;
}

/**
 * Progress push abstraction.
 * Feishu and Browser Extension each provide their own implementation.
 */
export interface ProgressReporter {
    start(title: string): Promise<void>;
    addStep(text: string): void;
    startStep(index: number): Promise<void>;
    completeStep(index: number): Promise<void>;
    failStep(index: number, error: string): Promise<void>;
    addSubStep(stepIndex: number, text: string): Promise<number>;
    startSubStep(stepIndex: number, subStepIndex: number): Promise<void>;
    addAndStartSubStep(stepIndex: number, text: string): Promise<number>;
    completeSubStep(stepIndex: number, subStepIndex: number): Promise<void>;
    complete(info: CompleteInfo): Promise<void>;
    fail(error: string | FailInfo): Promise<void>;
}
