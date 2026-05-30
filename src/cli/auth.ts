import http from 'node:http';
import { execFile } from 'node:child_process';
import * as Lark from '@larksuiteoapi/node-sdk';
import { isRecord } from '../utils/guards.js';

const AUTH_CALLBACK_PORT = 9876;
const AUTH_TIMEOUT_MS = 120_000;

interface FeishuApiEnvelope {
    code?: number;
    msg?: string;
    data?: {
        access_token?: string;
    };
    tenant_access_token?: string;
    bot?: {
        open_id?: string;
    };
}

export async function getUserAccessToken(appId: string, appSecret: string): Promise<string> {
    return new Promise((resolve, reject) => {
        let resolved = false;

        const server = http.createServer(async (req, res) => {
            const url = new URL(req.url ?? '/', `http://localhost:${AUTH_CALLBACK_PORT}`);

            if (url.pathname !== '/callback') {
                res.writeHead(404, { Connection: 'close' });
                res.end();
                return;
            }

            const code = url.searchParams.get('code');
            if (!code) {
                res.writeHead(400);
                res.end('Missing code parameter');
                return;
            }

            try {
                const tokenRes = await fetch('https://open.feishu.cn/open-apis/authen/v1/oidc/access_token', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        Authorization: `Bearer ${await getTenantAccessToken(appId, appSecret)}`,
                    },
                    body: JSON.stringify({
                        grant_type: 'authorization_code',
                        code,
                    }),
                });

                const tokenData = await readFeishuEnvelope(tokenRes);
                if (tokenData.code !== 0) {
                    throw new Error(tokenData.msg || 'Failed to get token');
                }

                const userToken = tokenData.data?.access_token;
                if (!userToken) {
                    throw new Error('No access_token in response');
                }

                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', Connection: 'close' });
                res.end('<h1>授权成功！</h1><p>请返回终端继续操作。</p>');

                if (!resolved) {
                    resolved = true;
                    resolve(userToken);
                    setTimeout(() => server.close(), 100);
                }
            } catch (error) {
                res.writeHead(500, { Connection: 'close' });
                res.end('Failed to get token');
                if (!resolved) {
                    resolved = true;
                    server.close();
                    reject(error);
                }
            }
        });

        server.keepAliveTimeout = 0;
        server.listen(AUTH_CALLBACK_PORT, () => {
            const authUrl = `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${appId}&redirect_uri=http://localhost:${AUTH_CALLBACK_PORT}/callback&state=collector&scope=wiki:wiki`;

            console.log('\n请在浏览器中完成授权:');
            console.log(`\n${authUrl}\n`);
            openBrowser(authUrl);
        });

        setTimeout(() => {
            if (!resolved) {
                resolved = true;
                server.close();
                reject(new Error('授权超时'));
            }
        }, AUTH_TIMEOUT_MS);
    });
}

export async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
    const res = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    });
    const data = await readFeishuEnvelope(res);
    if (data.code !== 0) {
        throw new Error(data.msg || 'Failed to get tenant access token');
    }
    if (!data.tenant_access_token) {
        throw new Error('No tenant_access_token in response');
    }
    return data.tenant_access_token;
}

export async function addBotAsWikiAdmin(
    appId: string,
    appSecret: string,
    wikiSpaceId: string,
    userAccessToken: string,
): Promise<'added' | 'skipped' | 'failed'> {
    try {
        const tenantToken = await getTenantAccessToken(appId, appSecret);
        const botRes = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
            headers: { Authorization: `Bearer ${tenantToken}` },
        });
        const botData = await readFeishuEnvelope(botRes);
        const botOpenId = botData.bot?.open_id;
        if (!botOpenId) return 'skipped';

        const memberRes = await fetch(`https://open.feishu.cn/open-apis/wiki/v2/spaces/${wikiSpaceId}/members`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${userAccessToken}`,
            },
            body: JSON.stringify({
                member_type: 'openid',
                member_id: botOpenId,
                member_role: 'admin',
            }),
        });
        const memberData = await readFeishuEnvelope(memberRes);
        return memberData.code === 0 ? 'added' : 'failed';
    } catch {
        return 'failed';
    }
}

function openBrowser(authUrl: string): void {
    const platform = process.platform;
    const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = platform === 'win32' ? ['/c', 'start', '', authUrl] : [authUrl];
    execFile(command, args, () => undefined);
}

async function readFeishuEnvelope(response: Response): Promise<FeishuApiEnvelope> {
    const data = await response.json();
    if (!isRecord(data)) return {};
    return {
        code: typeof data.code === 'number' ? data.code : undefined,
        msg: typeof data.msg === 'string' ? data.msg : undefined,
        tenant_access_token: typeof data.tenant_access_token === 'string' ? data.tenant_access_token : undefined,
        data: parseData(data.data),
        bot: parseBot(data.bot),
    };
}

function parseData(value: unknown): FeishuApiEnvelope['data'] {
    if (!isRecord(value)) return undefined;
    return {
        access_token: typeof value.access_token === 'string' ? value.access_token : undefined,
    };
}

function parseBot(value: unknown): FeishuApiEnvelope['bot'] {
    if (!isRecord(value)) return undefined;
    return {
        open_id: typeof value.open_id === 'string' ? value.open_id : undefined,
    };
}

export function createFeishuClient(config: { appId: string; appSecret: string }): Lark.Client {
    return new Lark.Client({
        appId: config.appId,
        appSecret: config.appSecret,
    });
}
