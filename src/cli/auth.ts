import { isRecord } from '../utils/guards.js';

interface FeishuApiEnvelope {
    code?: number;
    msg?: string;
    tenant_access_token?: string;
    bot?: {
        open_id?: string;
    };
}

async function getTenantAccessToken(appId: string, appSecret: string): Promise<string> {
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

export async function getBotOpenId(appId: string, appSecret: string): Promise<string | null> {
    const tenantToken = await getTenantAccessToken(appId, appSecret);
    const botRes = await fetch('https://open.feishu.cn/open-apis/bot/v3/info', {
        headers: { Authorization: `Bearer ${tenantToken}` },
    });
    const botData = await readFeishuEnvelope(botRes);
    return botData.bot?.open_id ?? null;
}

async function readFeishuEnvelope(response: Response): Promise<FeishuApiEnvelope> {
    const data = await response.json();
    if (!isRecord(data)) return {};
    return {
        code: typeof data.code === 'number' ? data.code : undefined,
        msg: typeof data.msg === 'string' ? data.msg : undefined,
        tenant_access_token: typeof data.tenant_access_token === 'string' ? data.tenant_access_token : undefined,
        bot: parseBot(data.bot),
    };
}

function parseBot(value: unknown): FeishuApiEnvelope['bot'] {
    if (!isRecord(value)) return undefined;
    return {
        open_id: typeof value.open_id === 'string' ? value.open_id : undefined,
    };
}
