import * as readline from 'node:readline';

export async function prompt(question: string, defaultValue?: string): Promise<string> {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve) => {
        const suffix = defaultValue ? ` (${defaultValue})` : '';
        rl.question(`${question}${suffix}: `, (answer) => {
            rl.close();
            resolve(answer.trim() || defaultValue || '');
        });
    });
}

export async function confirm(question: string, defaultValue: boolean = true): Promise<boolean> {
    const answer = await prompt(`${question} (${defaultValue ? 'Y/n' : 'y/N'})`);
    if (!answer) return defaultValue;
    return answer.toLowerCase() !== 'n' && answer.toLowerCase() !== 'no';
}
