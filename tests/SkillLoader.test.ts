import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SkillLoader } from '../src/agent/SkillLoader.js';

describe('SkillLoader', () => {
    it('honors enabled_by_default from collector.skill.yaml', () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-skill-loader-'));
        try {
            mkdirSync(join(root, 'skill-a'), { recursive: true });
            writeFileSync(join(root, 'skill-a', 'SKILL.md'), `---
name: skill-a
kind: test
description: Test skill
entry_conditions: {}
---

body
`, 'utf-8');
            writeFileSync(join(root, 'skill-a', 'collector.skill.yaml'), `name: skill-a
enabled_by_default: false
`, 'utf-8');

            const loader = new SkillLoader();
            loader.loadFromDir(root);
            expect(loader.findByName('skill-a')).toBeUndefined();

            loader.loadFromDir(root, { 'skill-a': true });
            expect(loader.findByName('skill-a')).toBeDefined();
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});
