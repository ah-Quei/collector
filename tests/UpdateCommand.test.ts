import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runUpdate } from '../src/cli/update.js';

const ORIGINAL_ENV = { ...process.env };

describe('collector update command', () => {
    afterEach(() => {
        process.env = { ...ORIGINAL_ENV };
    });

    it('runs the installer with update arguments mapped to environment variables', async () => {
        const root = mkdtempSync(join(tmpdir(), 'collector-update-'));
        try {
            const outputPath = join(root, 'env.txt');
            const installerPath = join(root, 'installer.sh');
            writeFileSync(installerPath, `#!/usr/bin/env bash
set -euo pipefail
{
  echo "repo=$COLLECTOR_REPO"
  echo "version=$COLLECTOR_VERSION"
  echo "install_dir=$COLLECTOR_INSTALL_DIR"
} > "$UPDATE_OUTPUT"
`, 'utf-8');
            chmodSync(installerPath, 0o755);

            process.env.COLLECTOR_INSTALLER_PATH = installerPath;
            process.env.UPDATE_OUTPUT = outputPath;

            await runUpdate([
                '--repo', 'example/collector',
                '--version', 'v1.2.3',
                '--install-dir', join(root, 'bin'),
            ]);

            const output = readFileSync(outputPath, 'utf-8');
            expect(output).toContain('repo=example/collector');
            expect(output).toContain('version=v1.2.3');
            expect(output).toContain(`install_dir=${join(root, 'bin')}`);
        } finally {
            rmSync(root, { recursive: true, force: true });
        }
    });

    it('rejects unknown update options', async () => {
        await expect(runUpdate(['--wat'])).rejects.toThrow('Unknown update option: --wat');
    });
});
