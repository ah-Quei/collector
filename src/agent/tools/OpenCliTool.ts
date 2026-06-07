import { tool } from '@openai/agents';
import { z } from 'zod';
import { execFile, type ExecFileException } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import type { OpenCLIConfig } from '../../config/Config.js';
import { getJobRoot, listRecursive, toolFailure, toolSuccess, truncateText, type FileEntry } from './helpers.js';

const MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

interface OpenCliResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
    truncated: boolean;
    files: FileEntry[];
}

export function openCliTool(config: OpenCLIConfig, dataDir: string, extraEnv: NodeJS.ProcessEnv = {}) {
    return tool({
        name: 'opencli_run',
        description: 'Run an OpenCLI command to fetch content from platforms (Xiaohongshu, Bilibili, WeChat, etc.). Pass the subcommand and arguments as an array.',
        parameters: z.object({
            args: z.array(z.string()).describe('OpenCLI subcommand and arguments, e.g. ["xiaohongshu", "note", "<URL>"]'),
        }),
        async execute({ args: cliArgs }, runContext) {
            if (!cliArgs || cliArgs.length === 0) return toolFailure('args array must not be empty');

            const timeoutMs = config.timeout * 1000;
            const defaultCwd = getJobRoot(dataDir, runContext, 'default');
            mkdirSync(defaultCwd, { recursive: true });

            return new Promise<string>((resolve) => {
                execFile(
                    config.bin,
                    cliArgs,
                    { cwd: defaultCwd, timeout: timeoutMs, maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8', env: { ...process.env, ...extraEnv } },
                    (error: ExecFileException | null, stdout: string, stderr: string) => {
                        const stdoutResult = truncateText(stdout, MAX_OUTPUT_BYTES);
                        const stderrResult = truncateText(stderr, MAX_OUTPUT_BYTES);
                        const files = listRecursive(defaultCwd);
                        if (error?.killed) {
                            resolve(toolFailure(`OpenCLI timed out after ${config.timeout}s`, {
                                stdout: stdoutResult.text,
                                stderr: stderrResult.text,
                                files,
                                timedOut: true,
                            }));
                            return;
                        }
                        if (error) {
                            resolve(toolFailure(`OpenCLI error (exit ${error.code ?? 'unknown'})`, {
                                stdout: stdoutResult.text,
                                stderr: stderrResult.text || error.message,
                                exitCode: error.code,
                                files,
                                truncated: stdoutResult.truncated || stderrResult.truncated,
                            }));
                            return;
                        }
                        resolve(toolSuccess<OpenCliResult>({
                            stdout: stdoutResult.text,
                            stderr: stderrResult.text,
                            exitCode: 0,
                            timedOut: false,
                            truncated: stdoutResult.truncated || stderrResult.truncated,
                            files,
                        }));
                    },
                );
            });
        },
    });
}
