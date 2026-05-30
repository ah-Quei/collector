import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';
import { Skill, type SkillEntryConditions } from '../models/Skill.js';
import { isRecord } from '../utils/guards.js';

const FRONTMATTER_RE = /^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/;

export class SkillLoader {
    private skills: Skill[] = [];

    /**
     * Load all skills from a directory.
     * Each skill is a subdirectory containing a SKILL.md file with YAML frontmatter.
     */
    loadFromDir(skillsDir: string): void {
        if (!existsSync(skillsDir)) return;

        const entries = readdirSync(skillsDir, { withFileTypes: true });
        const skills: Skill[] = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            const skillFile = join(skillsDir, entry.name, 'SKILL.md');
            if (!existsSync(skillFile)) continue;

            const skill = parseSkillFile(skillFile);
            if (skill) skills.push(skill);
        }

        this.skills = skills;
    }

    findByCategory(category: string): Skill[] {
        return this.skills.filter((s) => s.kind === category);
    }

    findByName(name: string): Skill | undefined {
        return this.skills.find((s) => s.name === name);
    }

    /**
     * Generate the Skill Catalog text for the system prompt.
     * The Agent reads this and decides which skill to call based on entry_conditions.
     */
    toCatalogString(): string {
        if (this.skills.length === 0) return 'No skills loaded.';

        return this.skills.map((s) => {
            const conditions: string[] = [];
            if (s.entryConditions.urlDomains?.length) {
                conditions.push(`url_domains: ${s.entryConditions.urlDomains.join(', ')}`);
            }
            if (s.entryConditions.contentType) {
                conditions.push(`content_type: ${s.entryConditions.contentType}`);
            }
            return `- **${s.name}** (${s.kind})${conditions.length ? ` [${conditions.join('; ')}]` : ''}: ${s.description}`;
        }).join('\n');
    }

    async getDetail(skillName: string): Promise<{ name: string; kind: string; content: string } | null> {
        const skill = this.findByName(skillName);
        if (!skill) return null;
        return { name: skill.name, kind: skill.kind, content: skill.content };
    }
}

function parseSkillFile(filePath: string): Skill | null {
    const raw = readFileSync(filePath, 'utf-8');
    const match = FRONTMATTER_RE.exec(raw);
    if (!match) return null;

    const parsedMeta = yaml.load(match[1]);
    if (!isRecord(parsedMeta)) return null;
    const name = stringValue(parsedMeta.name);
    const kind = stringValue(parsedMeta.kind);
    if (!name || !kind) return null;

    const entryConditionsMeta = isRecord(parsedMeta.entry_conditions) ? parsedMeta.entry_conditions : {};

    const entryConditions: SkillEntryConditions = {
        urlDomains: stringArrayValue(entryConditionsMeta.url_domains),
        contentType: stringValue(entryConditionsMeta.content_type),
    };

    return new Skill(
        name,
        kind,
        stringValue(parsedMeta.description) ?? '',
        entryConditions,
        match[2].trim(),
        filePath,
    );
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : undefined;
}
