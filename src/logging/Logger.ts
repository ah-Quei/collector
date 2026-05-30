export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
};

const LEVEL_LABELS: Record<LogLevel, string> = {
    debug: 'DBG',
    info: 'INF',
    warn: 'WRN',
    error: 'ERR',
};

const LEVEL_COLORS: Record<LogLevel, string> = {
    debug: '\x1b[90m',   // gray
    info: '\x1b[36m',    // cyan
    warn: '\x1b[33m',    // yellow
    error: '\x1b[31m',   // red
};

const RESET = '\x1b[0m';

export class Logger {
    private static globalLevel: LogLevel = 'info';

    static setLevel(level: LogLevel): void {
        Logger.globalLevel = level;
    }

    constructor(private readonly scope: string) {}

    debug(msg: string, data?: Record<string, unknown>): void {
        this.log('debug', msg, data);
    }

    info(msg: string, data?: Record<string, unknown>): void {
        this.log('info', msg, data);
    }

    warn(msg: string, data?: Record<string, unknown>): void {
        this.log('warn', msg, data);
    }

    error(msg: string, data?: Record<string, unknown>): void {
        this.log('error', msg, data);
    }

    child(subScope: string): Logger {
        return new Logger(`${this.scope}:${subScope}`);
    }

    private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
        if (LEVEL_PRIORITY[level] < LEVEL_PRIORITY[Logger.globalLevel]) return;

        const now = new Date();
        const time = now.toTimeString().slice(0, 8);
        const color = LEVEL_COLORS[level];
        const label = LEVEL_LABELS[level];

        const prefix = `${color}${time} [${label}]${RESET} [${this.scope}]`;
        const suffix = data ? ` ${JSON.stringify(data)}` : '';

        const stream = level === 'error' ? process.stderr : process.stdout;
        stream.write(`${prefix} ${msg}${suffix}\n`);
    }
}
