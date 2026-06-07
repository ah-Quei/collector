import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join, relative } from 'node:path';
import { Config } from '../config/Config.js';
import { confirm, prompt } from './prompt.js';
import {
    findInstallScript,
    listSkillManifests,
    type SkillEnvVar,
    type SkillManifest,
} from './skillManifest.js';

interface SkillCommandArgs {
    command?: string;
    rest: string[];
}

interface InstallDepsArgs {
    dir?: string;
    skill?: string;
    dryRun: boolean;
    help: boolean;
}

interface ConfigureArgs {
    skill?: string;
    dir?: string;
    help: boolean;
}

interface UpdateSkillsArgs {
    strategy?: string;
    help: boolean;
}

export async function runSkillDeps(args: string[] = []): Promise<void> {
    const parsed = parseSkillCommandArgs(args);
    switch (parsed.command) {
        case undefined:
        case 'list':
            runSkillList();
            return;
        case 'install-deps':
            await runSkillInstallDeps(parsed.rest);
            return;
        case 'configure':
            await runSkillConfigure(parsed.rest);
            return;
        case 'enable':
            runSkillEnabled(parsed.rest, true);
            return;
        case 'disable':
            runSkillEnabled(parsed.rest, false);
            return;
        case 'update':
            await runSkillsUpdate(parsed.rest);
            return;
        default:
            throw new Error(`Unknown skills command: ${parsed.command}`);
    }
}

export async function runSkillInstallDeps(args: string[] = []): Promise<void> {
    const parsed = parseInstallDepsArgs(args);
    if (parsed.help) {
        printInstallDepsHelp();
        return;
    }

    const skillsDir = parsed.dir ?? Config.load().skills.dir;
    const scripts = findSkillInstallScripts(skillsDir, parsed.skill);

    if (scripts.length === 0) {
        console.log(parsed.skill
            ? `未找到 Skill 依赖安装脚本: ${parsed.skill}`
            : `未找到 Skill 依赖安装脚本: ${skillsDir}`);
        return;
    }

    console.log(`发现 ${scripts.length} 个 Skill 依赖安装脚本:`);
    for (const script of scripts) {
        console.log(`  - ${script.skillName}: ${relative(skillsDir, script.path)}`);
    }

    if (parsed.dryRun) return;

    for (const script of scripts) {
        console.log(`\n==> 安装 ${script.skillName} 依赖`);
        const code = await runScript(script.path, skillsDir, Config.load().getEnabledSkillEnv());
        if (code !== 0) {
            throw new Error(`Skill 依赖安装失败: ${script.skillName} (${code ?? 'unknown'})`);
        }
    }

    console.log('\n所有 Skill 依赖安装完成');
}

function runSkillList(): void {
    const config = Config.load();
    const manifests = listSkillManifests(config.skills.dir);
    if (manifests.length === 0) {
        console.log(`未找到 Skills: ${config.skills.dir}`);
        return;
    }

    console.log(`Skills: ${config.skills.dir}`);
    for (const manifest of manifests) {
        const enabled = config.skills.enabled[manifest.name] ?? manifest.enabledByDefault;
        const installScript = manifest.install?.script || (findInstallScript(manifest.dir) ? relative(manifest.dir, findInstallScript(manifest.dir)!) : '');
        const flags = [
            enabled ? 'enabled' : 'disabled',
            installScript ? 'installable' : '',
            manifest.env.length > 0 ? 'configurable' : '',
        ].filter(Boolean).join(', ');
        console.log(`  - ${manifest.name}: ${manifest.title} [${flags}]`);
    }
}

async function runSkillConfigure(args: string[] = []): Promise<void> {
    const parsed = parseConfigureArgs(args);
    if (parsed.help) {
        printConfigureHelp();
        return;
    }

    const configPath = process.env.COLLECTOR_CONFIG_PATH;
    const config = Config.load(configPath);
    const manifests = listSkillManifests(parsed.dir ?? config.skills.dir)
        .filter(manifest => !parsed.skill || manifest.name === parsed.skill);

    if (parsed.skill && manifests.length === 0) {
        throw new Error(`Skill not found: ${parsed.skill}`);
    }

    const nextEnabled = { ...config.skills.enabled };
    const nextEnv = cloneSkillEnv(config.skills.env);

    for (const manifest of manifests) {
        const defaultEnabled = config.skills.enabled[manifest.name] ?? manifest.enabledByDefault;
        const enable = await confirm(`启用 ${manifest.title} (${manifest.name})?`, defaultEnabled);
        nextEnabled[manifest.name] = enable;
        if (!enable) continue;

        if (manifest.env.length > 0) {
            nextEnv[manifest.name] = await promptSkillEnv(manifest, nextEnv[manifest.name] ?? {});
        }

        const script = resolveInstallScript(manifest);
        if (script && await confirm(`现在安装 ${manifest.title} 的本地依赖?`, false)) {
            const code = await runScript(script, config.skills.dir, nextEnv[manifest.name] ?? {});
            if (code !== 0) throw new Error(`Skill 依赖安装失败: ${manifest.name} (${code ?? 'unknown'})`);
        }
    }

    new Config({
        ...config,
        skills: {
            dir: config.skills.dir,
            enabled: nextEnabled,
            env: nextEnv,
        },
    }).save(configPath);
    console.log('Skill 配置已保存');
}

function runSkillEnabled(args: string[], enabled: boolean): void {
    const skillName = args[0];
    if (!skillName) {
        throw new Error(`Missing skill name for ${enabled ? 'enable' : 'disable'}`);
    }

    const configPath = process.env.COLLECTOR_CONFIG_PATH;
    const config = Config.load(configPath);
    const manifests = listSkillManifests(config.skills.dir);
    if (!manifests.some(manifest => manifest.name === skillName)) {
        throw new Error(`Skill not found: ${skillName}`);
    }

    new Config({
        ...config,
        skills: {
            dir: config.skills.dir,
            enabled: { ...config.skills.enabled, [skillName]: enabled },
            env: config.skills.env,
        },
    }).save(configPath);
    console.log(`${enabled ? '已启用' : '已禁用'} Skill: ${skillName}`);
}

async function runSkillsUpdate(args: string[] = []): Promise<void> {
    const parsed = parseUpdateSkillsArgs(args);
    if (parsed.help) {
        printSkillsUpdateHelp();
        return;
    }

    const strategy = parsed.strategy ?? process.env.COLLECTOR_SKILLS_STRATEGY ?? 'incoming';
    const child = spawn('bash', ['-c', 'curl -fsSL "$COLLECTOR_INSTALL_SCRIPT_URL" | bash'], {
        env: {
            ...process.env,
            COLLECTOR_INSTALL_APP: '0',
            COLLECTOR_INSTALL_EXTERNAL_TOOLS: '0',
            COLLECTOR_INSTALL_SKILLS: '1',
            COLLECTOR_SKILLS_STRATEGY: strategy,
            COLLECTOR_INSTALL_SCRIPT_URL: process.env.COLLECTOR_INSTALL_SCRIPT_URL
                ?? `https://raw.githubusercontent.com/${process.env.COLLECTOR_REPO ?? 'ah-Quei/collector'}/main/scripts/install.sh`,
        },
        stdio: 'inherit',
    });

    const code = await new Promise<number | null>((resolve, reject) => {
        child.on('error', reject);
        child.on('close', resolve);
    });
    if (code !== 0) throw new Error(`Skill 更新失败 (${code ?? 'unknown'})`);
}

function findSkillInstallScripts(skillsDir: string, skillName?: string): { skillName: string; path: string }[] {
    return listSkillManifests(skillsDir)
        .filter(manifest => !skillName || manifest.name === skillName)
        .map(manifest => {
            const script = resolveInstallScript(manifest);
            return script ? { skillName: manifest.name, path: script } : null;
        })
        .filter((script): script is { skillName: string; path: string } => script !== null);
}

function resolveInstallScript(manifest: SkillManifest): string | null {
    if (manifest.install?.script) {
        const path = join(manifest.dir, manifest.install.script);
        return existsSync(path) ? path : null;
    }
    return findInstallScript(manifest.dir);
}

function runScript(scriptPath: string, skillsDir: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<number | null> {
    return new Promise((resolve, reject) => {
        const child = spawn('bash', [scriptPath], {
            cwd: skillsDir,
            env: { ...process.env, ...extraEnv },
            stdio: 'inherit',
        });
        child.on('error', reject);
        child.on('close', resolve);
    });
}

async function promptSkillEnv(manifest: SkillManifest, existing: Record<string, string>): Promise<Record<string, string>> {
    const values = { ...existing };
    for (const envVar of manifest.env) {
        const current = values[envVar.name] ?? envVar.defaultValue ?? '';
        if (envVar.secret && current) {
            console.log(`${envVar.label} 当前值: ${maskSecret(current)}`);
        }
        const answer = await prompt(envQuestion(envVar), envVar.secret ? undefined : displayDefault(current));
        values[envVar.name] = answer || current;
    }
    return values;
}

function envQuestion(envVar: SkillEnvVar): string {
    const required = envVar.required ? '必填' : '可选';
    const choices = envVar.choices?.length ? ` [${envVar.choices.join('/')}]` : '';
    return `${envVar.label}${choices} (${envVar.name}, ${required})`;
}

function displayDefault(value: string): string | undefined {
    if (!value) return undefined;
    return value;
}

function maskSecret(value: string): string {
    if (value.length <= 8) return '****';
    return `${value.slice(0, 3)}****${value.slice(-3)}`;
}

function cloneSkillEnv(value: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
    const result: Record<string, Record<string, string>> = {};
    for (const [skill, env] of Object.entries(value)) {
        result[skill] = { ...env };
    }
    return result;
}

function parseSkillCommandArgs(args: string[]): SkillCommandArgs {
    return { command: args[0], rest: args.slice(1) };
}

function parseInstallDepsArgs(args: string[]): InstallDepsArgs {
    const parsed: InstallDepsArgs = { dryRun: false, help: false };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                parsed.help = true;
                break;
            case '--dir':
                parsed.dir = readRequiredValue(args, ++i, arg);
                break;
            case '--dry-run':
                parsed.dryRun = true;
                break;
            default:
                if (arg.startsWith('-')) throw new Error(`Unknown skills install-deps option: ${arg}`);
                if (parsed.skill) throw new Error(`Unexpected extra skill name: ${arg}`);
                parsed.skill = arg;
        }
    }
    return parsed;
}

function parseConfigureArgs(args: string[]): ConfigureArgs {
    const parsed: ConfigureArgs = { help: false };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                parsed.help = true;
                break;
            case '--dir':
                parsed.dir = readRequiredValue(args, ++i, arg);
                break;
            default:
                if (arg.startsWith('-')) throw new Error(`Unknown skills configure option: ${arg}`);
                if (parsed.skill) throw new Error(`Unexpected extra skill name: ${arg}`);
                parsed.skill = arg;
        }
    }
    return parsed;
}

function parseUpdateSkillsArgs(args: string[]): UpdateSkillsArgs {
    const parsed: UpdateSkillsArgs = { help: false };
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        switch (arg) {
            case '-h':
            case '--help':
                parsed.help = true;
                break;
            case '--strategy':
                parsed.strategy = readRequiredValue(args, ++i, arg);
                break;
            default:
                throw new Error(`Unknown skills update option: ${arg}`);
        }
    }
    return parsed;
}

function readRequiredValue(args: string[], index: number, option: string): string {
    const value = args[index];
    if (!value || value.startsWith('-')) {
        throw new Error(`Missing value for ${option}`);
    }
    return value;
}

function printInstallDepsHelp(): void {
    console.log(`
用法:
  collector skills install-deps
  collector skills install-deps modality-pdf-parse
  collector skills install-deps --dir ~/.collector/skills
  collector skills install-deps --dry-run
`);
}

function printConfigureHelp(): void {
    console.log(`
用法:
  collector skills configure
  collector skills configure modality-pdf-parse
`);
}

function printSkillsUpdateHelp(): void {
    console.log(`
用法:
  collector skills update
  collector skills update --strategy incoming

策略:
  incoming, keep, overwrite, backup
`);
}
