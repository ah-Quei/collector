import { tool } from '@openai/agents';
import { z } from 'zod';

export interface SkillDetailSource {
    getDetail(skillName: string): Promise<{ name: string; kind: string; content: string } | null>;
}

export function getSkillDetailTool(skillSource: SkillDetailSource | null) {
    return tool({
        name: 'get_skill_detail',
        description: 'Get the full instructions for a Skill from the Catalog. Call this before executing a Skill.',
        parameters: z.object({
            name: z.string().describe('The Skill name to retrieve'),
        }),
        async execute({ name }) {
            if (!skillSource) return 'Skill system not initialized';
            const detail = await skillSource.getDetail(name);
            if (!detail) return `Skill not found: ${name}`;
            return JSON.stringify(detail, null, 2);
        },
    });
}
