export interface SkillEntryConditions {
    urlDomains?: string[];
    contentType?: string;
}

export class Skill {
    constructor(
        public readonly name: string,
        public readonly kind: string,
        public readonly description: string,
        public readonly entryConditions: SkillEntryConditions,
        public readonly content: string,
        public readonly filePath: string,
    ) {}
}
