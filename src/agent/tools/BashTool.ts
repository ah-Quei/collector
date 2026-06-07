import { tool } from '@openai/agents';
import { z } from 'zod';
import { execFile, type ExecFileException } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { getJobRoot, toolFailure, toolSuccess, truncateText } from './helpers.js';

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 1024 * 1024;

interface BashResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
    truncated: boolean;
}

export function bashTool(dataDir?: string, extraEnv: NodeJS.ProcessEnv = {}) {
    return tool({
        name: 'bash',
        description: 'Execute a shell command. Used to run commands defined in Skills for processing multimedia content (image OCR, audio transcription, etc.).',
        parameters: z.object({
            command: z.string().describe('The command to execute'),
            timeout: z.number().nullable().describe('Timeout in seconds (defaults to 120)'),
        }),
        async execute({ command, timeout }, runContext) {
            const timeoutMs = (timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000;
            const defaultCwd = dataDir ? getJobRoot(dataDir, runContext, 'default') : undefined;
            if (defaultCwd) mkdirSync(defaultCwd, { recursive: true });

            return new Promise<string>((resolve) => {
                execFile(
                    '/bin/sh',
                    ['-c', command],
                    { cwd: defaultCwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', env: { ...process.env, ...extraEnv } },
                    (error: ExecFileException | null, stdout: string, stderr: string) => {
                        const stdoutResult = truncateText(stdout, MAX_OUTPUT_BYTES);
                        const stderrResult = truncateText(stderr, MAX_OUTPUT_BYTES);
                        if (error?.killed) {
                            resolve(toolFailure(`Command timed out after ${timeout ?? DEFAULT_TIMEOUT_MS / 1000}s`, {
                                stdout: stdoutResult.text,
                                stderr: stderrResult.text,
                                timedOut: true,
                            }));
                            return;
                        }
                        if (error && error.code !== undefined && error.code !== null && error.code !== 0) {
                            resolve(toolFailure(`Command exited with code ${error.code}`, {
                                stdout: stdoutResult.text,
                                stderr: stderrResult.text,
                                exitCode: error.code,
                                truncated: stdoutResult.truncated || stderrResult.truncated,
                            }));
                            return;
                        }
                        resolve(toolSuccess<BashResult>({
                            stdout: stdoutResult.text,
                            stderr: stderrResult.text,
                            exitCode: 0,
                            timedOut: false,
                            truncated: stdoutResult.truncated || stderrResult.truncated,
                        }));
                    },
                );
            });
        },
    });
}
