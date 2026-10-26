/**
 * All configuration, from environment variables (optionally a .env file).
 */
import fs from 'node:fs';
import path from 'node:path';

export interface Config {
  port: number;
  host: string;
  /** Address phones use to reach the server; '' = detect per request. */
  publicUrl: string;
  /**
   * Which proxies to believe about the client's IP/protocol (X-Forwarded-*):
   * false = none, a number = that many hops, or a string of addresses (Express 'trust proxy').
   */
  trustProxy: false | number | string;
  dataDir: string;
  /** 'vite' = dev server with hot reload, 'dist' = built client, 'none' = API only (tests). */
  clientMode: 'vite' | 'dist' | 'none';
  rootDir: string;
  hebcalApiBase: string;
  hebcalRefreshHours: number;
  logLevel: string;
}

export function loadConfig(rootDir: string, env: NodeJS.ProcessEnv = process.env): Config {
  loadDotEnv(path.join(rootDir, '.env'), env);
  return {
    port: Number(env.PORT || 8080),
    host: env.HOST || '0.0.0.0',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/+$/, ''),
    trustProxy: parseTrustProxy(env.TRUST_PROXY),
    dataDir: path.resolve(rootDir, env.DATA_DIR || 'data'),
    clientMode: env.NODE_ENV === 'development' ? 'vite' : (env.CLIENT_MODE as Config['clientMode']) || 'dist',
    rootDir,
    hebcalApiBase: (env.HEBCAL_API_BASE || 'https://www.hebcal.com').replace(/\/+$/, ''),
    hebcalRefreshHours: Number(env.HEBCAL_REFRESH_HOURS || 12),
    logLevel: env.LOG_LEVEL || 'info',
  };
}

/**
 * TRUST_PROXY=1 (or true/yes) trusts exactly ONE proxy hop — the tunnel or reverse proxy
 * in front of the app. Trusting every hop would let clients fake their IP address
 * (and dodge the sign-in rate limit) by sending their own X-Forwarded-For header.
 */
export function parseTrustProxy(value: string | undefined): false | number | string {
  const v = (value ?? '').trim();
  if (!v || /^(0|false|no)$/i.test(v)) return false;
  if (/^(true|yes)$/i.test(v)) return 1;
  if (/^\d+$/.test(v)) return Number(v);
  return v; // e.g. "loopback" or "10.0.0.1, 10.0.0.2"
}

function loadDotEnv(file: string, env: NodeJS.ProcessEnv) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}
