/**
 * Keep secrets out of logs. Feed, invite and subscribe-page links carry a secret token
 * in the URL; anyone who can read the logs would otherwise be able to use them.
 */
const TOKEN_IN_PATH = /^(\/feed\/|\/s\/|\/invite\/|\/api\/invites\/|\/api\/public\/subscribe\/)[^/?#]+/;

export function redactUrl(url: string): string {
  return url.replace(TOKEN_IN_PATH, '$1[redacted]');
}

/** Request/response fields pino must never print. */
export const REDACTED_LOG_PATHS = [
  'req.headers.cookie',
  'req.headers.referer',
  'req.headers["x-csrf-token"]',
  'req.headers.authorization',
  'res.headers["set-cookie"]',
];
