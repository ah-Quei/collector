import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const SCRIPT = resolve('scripts/install.sh');
const ORIGINAL_ENV = { ...process.env };

describe('install.sh', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('installs collector and initializes skills from release assets', () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-install-'));
        try {
            const fixture = makeFixture(root, '1.2.3', 'template v1');
            runInstaller(root, fixture.assetsDir, 'v1.2.3');

            const installed = join(root, 'install', 'collector');
            const version = execFileSync(installed, ['--version'], { encoding: 'utf-8' }).trim();

            expect(version).toBe('collector 1.2.3');
            expect(readFileSync(join(root, 'skills', 'resolve-test', 'SKILL.md'), 'utf-8')).toContain('template v1');
            expect(readFileSync(join(root, 'skills', '.collector-skills.json'), 'utf-8')).toContain('resolve-test/SKILL.md');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('keeps local skill edits and writes incoming templates on program update', () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-install-'));
        try {
            let fixture = makeFixture(root, '1.2.3', 'template v1');
            runInstaller(root, fixture.assetsDir, 'v1.2.3');

            const skillFile = join(root, 'skills', 'resolve-test', 'SKILL.md');
            writeFileSync(skillFile, 'local edit\n', 'utf-8');

            fixture = makeFixture(root, '1.2.4', 'template v2');
            runInstaller(root, fixture.assetsDir, 'v1.2.4');

            const installed = join(root, 'install', 'collector');
            const version = execFileSync(installed, ['--version'], { encoding: 'utf-8' }).trim();

            expect(version).toBe('collector 1.2.4');
            expect(readFileSync(skillFile, 'utf-8')).toBe('local edit\n');
            expect(readFileSync(`${skillFile}.incoming`, 'utf-8')).toContain('template v2');
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });
});

function makeFixture(root: string, version: string, skillContent: string): { assetsDir: string } {
    const assetsDir = join(root, `assets-${version}`);
    const binaryDir = join(root, `binary-${version}`);
    const skillDir = join(root, `skills-${version}`, 'skills', 'resolve-test');
    mkdirSync(assetsDir, { recursive: true });
    mkdirSync(binaryDir, { recursive: true });
    mkdirSync(skillDir, { recursive: true });

    const collector = join(binaryDir, 'collector');
    writeFileSync(collector, `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "collector ${version}"
else
  echo "Collector test binary"
fi
`, 'utf-8');
    chmodSync(collector, 0o755);

    writeFileSync(join(skillDir, 'SKILL.md'), `---
name: resolve-test
kind: resolve
description: Test skill
entry_conditions: {}
---

${skillContent}
`, 'utf-8');

    execFileSync('tar', ['-czf', join(assetsDir, 'collector-linux-x64.tar.gz'), '-C', binaryDir, 'collector']);
    execFileSync('tar', ['-czf', join(assetsDir, 'collector-skills.tar.gz'), '-C', join(root, `skills-${version}`), 'skills']);

    return { assetsDir };
}

function runInstaller(root: string, assetsDir: string, version: string): void {
    const fakeBin = join(root, 'fake-bin');
    mkdirSync(fakeBin, { recursive: true });
    const fakeCurl = join(fakeBin, 'curl');
    writeFileSync(fakeCurl, `#!/usr/bin/env bash
set -euo pipefail
out=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o)
      out="$2"
      shift 2
      ;;
    -*)
      shift
      ;;
    *)
      url="$1"
      shift
      ;;
  esac
done
asset="\${url##*/}"
if [ -z "$out" ]; then
  cat "$ASSET_DIR/$asset"
else
  cp "$ASSET_DIR/$asset" "$out"
fi
`, 'utf-8');
    chmodSync(fakeCurl, 0o755);

    execFileSync('bash', [SCRIPT], {
        cwd: resolve('.'),
        encoding: 'utf-8',
        env: {
            ...process.env,
            ASSET_DIR: assetsDir,
            COLLECTOR_ARCH: 'x64',
            COLLECTOR_INSTALL_DIR: join(root, 'install'),
            COLLECTOR_OS: 'linux',
            COLLECTOR_RELEASE_BASE_URL: 'https://example.test/releases',
            COLLECTOR_REPO: 'example/collector',
            COLLECTOR_SKILLS_DIR: join(root, 'skills'),
            COLLECTOR_SKILLS_STRATEGY: 'incoming',
            COLLECTOR_VERSION: version,
            PATH: `${fakeBin}:${process.env.PATH}`,
        },
    });
}
