import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSkillDeps } from '../src/cli/skillDeps.js';

const ORIGINAL_ENV = { ...process.env };

describe('collector skills install-deps command', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
        vi.restoreAllMocks();
    });

    it('runs install scripts found under skill directories', async () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-skill-deps-'));
        try {
            const outputPath = join(root, 'installed.txt');
            process.env.SKILL_DEPS_OUTPUT = outputPath;
            mkdirSync(join(root, 'skill-a'), { recursive: true });
            mkdirSync(join(root, 'skill-b', 'scripts'), { recursive: true });
            writeFileSync(join(root, 'skill-a', 'SKILL.md'), '---\nname: skill-a\nkind: test\n---\n', 'utf-8');
            writeFileSync(join(root, 'skill-b', 'SKILL.md'), '---\nname: skill-b\nkind: test\n---\n', 'utf-8');
            writeFileSync(join(root, 'skill-a', 'install.sh'), 'echo skill-a >> "$SKILL_DEPS_OUTPUT"\n', 'utf-8');
            writeFileSync(join(root, 'skill-b', 'scripts', 'install.sh'), 'echo skill-b >> "$SKILL_DEPS_OUTPUT"\n', 'utf-8');

            await runSkillDeps(['install-deps', '--dir', root]);

            expect(readFileSync(outputPath, 'utf-8')).toBe('skill-a\nskill-b\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('does not run scripts in dry-run mode', async () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-skill-deps-'));
        try {
            const outputPath = join(root, 'installed.txt');
            process.env.SKILL_DEPS_OUTPUT = outputPath;
            mkdirSync(join(root, 'skill-a'), { recursive: true });
            writeFileSync(join(root, 'skill-a', 'SKILL.md'), '---\nname: skill-a\nkind: test\n---\n', 'utf-8');
            writeFileSync(join(root, 'skill-a', 'install.sh'), 'echo skill-a >> "$SKILL_DEPS_OUTPUT"\n', 'utf-8');

            await runSkillDeps(['install-deps', '--dir', root, '--dry-run']);

            expect(() => readFileSync(outputPath, 'utf-8')).toThrow();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('runs only the requested skill install script', async () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-skill-deps-'));
        try {
            const outputPath = join(root, 'installed.txt');
            process.env.SKILL_DEPS_OUTPUT = outputPath;
            mkdirSync(join(root, 'skill-a'), { recursive: true });
            mkdirSync(join(root, 'skill-b'), { recursive: true });
            writeFileSync(join(root, 'skill-a', 'SKILL.md'), '---\nname: skill-a\nkind: test\n---\n', 'utf-8');
            writeFileSync(join(root, 'skill-b', 'SKILL.md'), '---\nname: skill-b\nkind: test\n---\n', 'utf-8');
            writeFileSync(join(root, 'skill-a', 'install.sh'), 'echo skill-a >> "$SKILL_DEPS_OUTPUT"\n', 'utf-8');
            writeFileSync(join(root, 'skill-b', 'install.sh'), 'echo skill-b >> "$SKILL_DEPS_OUTPUT"\n', 'utf-8');

            await runSkillDeps(['install-deps', 'skill-b', '--dir', root]);

            expect(readFileSync(outputPath, 'utf-8')).toBe('skill-b\n');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects unknown options', async () => {
        await expect(runSkillDeps(['install-deps', '--wat'])).rejects.toThrow('Unknown skills install-deps option: --wat');
    });
});
