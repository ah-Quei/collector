import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import yaml from 'js-yaml';
import { isRecord } from '../utils/guards.js';

export interface SkillEnvVar {
    name: string;
    label: string;
    required: boolean;
    secret: boolean;
    defaultValue?: string;
    choices?: string[];
}

export interface SkillInstallManifest {
    script?: string;
    optional: boolean;
    description?: string;
}

export interface SkillManifest {
    name: string;
    title: string;
    enabledByDefault: boolean;
    dir: string;
    install?: SkillInstallManifest;
    env: SkillEnvVar[];
}

export const SKILL_MANIFEST_FILE = 'collector.skill.yaml';
export const INSTALL_SCRIPT_CANDIDATES = ['install.sh', join('scripts', 'install.sh')];

export function listSkillManifests(skillsDir: string): SkillManifest[] {
    if (!existsSync(skillsDir)) return [];

    return readdirSync(skillsDir, { withFileTypes: true })
        .filter(entry => entry.isDirectory())
        .map(entry => loadSkillManifest(join(skillsDir, entry.name), entry.name))
        .filter((manifest): manifest is SkillManifest => manifest !== null)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export function loadSkillManifest(skillDir: string, fallbackName = basename(skillDir)): SkillManifest | null {
    const manifestPath = join(skillDir, SKILL_MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
        const skillFile = join(skillDir, 'SKILL.md');
        if (!existsSync(skillFile)) return null;
        return {
            name: fallbackName,
            title: fallbackName,
            enabledByDefault: true,
            dir: skillDir,
            install: findInstallScript(skillDir)
                ? { script: relative(skillDir, findInstallScript(skillDir)!), optional: true }
                : undefined,
            env: [],
        };
    }

    const parsed = yaml.load(readFileSync(manifestPath, 'utf-8'));
    if (!isRecord(parsed)) return null;

    const name = stringValue(parsed.name) ?? fallbackName;
    const install = parseInstall(parsed.install);
    if (install && !install.script) {
        const script = findInstallScript(skillDir);
        if (script) install.script = relative(skillDir, script);
    }

    return {
        name,
        title: stringValue(parsed.title) ?? name,
        enabledByDefault: booleanValue(parsed.enabled_by_default, true),
        dir: skillDir,
        install,
        env: parseEnv(parsed.config),
    };
}

export function findInstallScript(skillDir: string): string | null {
    for (const candidate of INSTALL_SCRIPT_CANDIDATES) {
        const scriptPath = join(skillDir, candidate);
        if (existsSync(scriptPath) && statSync(scriptPath).isFile()) {
            return scriptPath;
        }
    }
    return null;
}

function parseInstall(value: unknown): SkillInstallManifest | undefined {
    if (!isRecord(value)) return undefined;
    return {
        script: stringValue(value.script),
        optional: booleanValue(value.optional, true),
        description: stringValue(value.description),
    };
}

function parseEnv(configValue: unknown): SkillEnvVar[] {
    if (!isRecord(configValue) || !isRecord(configValue.env)) return [];
    const raw = configValue.env;
    if (!Array.isArray(raw)) return [];

    return raw
        .map((item): SkillEnvVar | null => {
            if (!isRecord(item)) return null;
            const name = stringValue(item.name);
            if (!name) return null;
            return {
                name,
                label: stringValue(item.label) ?? name,
                required: booleanValue(item.required, false),
                secret: booleanValue(item.secret, false),
                defaultValue: stringValue(item.default),
                choices: stringArrayValue(item.choices),
            };
        })
        .filter((item): item is SkillEnvVar => item !== null);
}

function stringValue(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
}

function booleanValue(value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function stringArrayValue(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) return undefined;
    const items = value.filter((item): item is string => typeof item === 'string');
    return items.length > 0 ? items : undefined;
}
