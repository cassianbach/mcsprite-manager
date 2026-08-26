import { app, shell } from 'electron';
import { join } from 'node:path';
import { existsSync, promises as fs } from 'node:fs';

// Reuse GitHub CLI's public OAuth app client_id — allowed for device flow with scope read:user
const CLIENT_ID = '178c6fc778ccc68e1d6a';
const AUTH_PATH = (): string => join(app.getPath('userData'), 'user-library', 'auth.json');

interface AuthStore { token?: string; handle?: string; loginAt?: number; }

async function readAuth(): Promise<AuthStore | null> {
  try {
    if (!existsSync(AUTH_PATH())) return null;
    const raw = await fs.readFile(AUTH_PATH(), 'utf8');
    return JSON.parse(raw) as AuthStore;
  } catch { return null; }
}
async function writeAuth(data: AuthStore): Promise<void> {
  await fs.mkdir(join(app.getPath('userData'), 'user-library'), { recursive: true });
  await fs.writeFile(AUTH_PATH(), JSON.stringify(data, null, 2), 'utf8');
}

export async function getVerifiedHandle(): Promise<string | null> {
  const a = await readAuth();
  return a?.handle ?? null;
}
export async function getToken(): Promise<string | null> {
  const a = await readAuth();
  return a?.token ?? null;
}

export async function logout(): Promise<void> {
  try { await fs.unlink(AUTH_PATH()); } catch {}
  // also clear legacy handle.json if present
  try { await fs.unlink(join(app.getPath('userData'), 'user-library', 'handle.json')); } catch {}
}

export interface DeviceFlowInfo { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; expires_in: number; interval: number; }

export async function startDeviceFlow(): Promise<DeviceFlowInfo> {
  const deviceRes = await fetch('https://github.com/login/device/code', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: CLIENT_ID, scope: 'read:user' }),
  });
  if (!deviceRes.ok) throw new Error(`Device code failed: ${deviceRes.status}`);
  const device = (await deviceRes.json()) as DeviceFlowInfo;
  await shell.openExternal(device.verification_uri_complete ?? device.verification_uri);
  return device;
}

export async function pollDeviceFlow(device_code: string, interval?: number, expires_in?: number): Promise<{ handle: string; token: string }> {
  const intervalMs = (interval ?? 5) * 1000;
  const deadline = Date.now() + (expires_in ?? 900) * 1000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs));
    const tokenRes = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: CLIENT_ID, device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
    });
    const tokenJson = (await tokenRes.json()) as { access_token?: string; error?: string; error_description?: string };
    if (tokenJson.access_token) {
      const token = tokenJson.access_token;
      const userRes = await fetch('https://api.github.com/user', { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
      if (!userRes.ok) throw new Error('Failed to fetch GitHub user');
      const user = (await userRes.json()) as { login: string };
      const handle = user.login;
      await writeAuth({ token, handle, loginAt: Date.now() });
      try { await fs.writeFile(join(app.getPath('userData'), 'user-library', 'handle.json'), JSON.stringify({ handle }, null, 2), 'utf8'); } catch {}
      return { handle, token };
    }
    if (tokenJson.error && tokenJson.error !== 'authorization_pending' && tokenJson.error !== 'slow_down') {
      throw new Error(tokenJson.error_description ?? tokenJson.error);
    }
    if (tokenJson.error === 'slow_down') await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('Login timed out. Please try again.');
}

export async function loginWithGithub(): Promise<{ handle: string; token: string }> {
  const device = await startDeviceFlow();
  return pollDeviceFlow(device.device_code, device.interval, device.expires_in);
}
