/**
 * Absolute links (feed URLs, invite links) — built from PUBLIC_URL, or from the request.
 */
import type { Request } from 'express';
import type { Config } from '../config.js';
import type { FeedLinks } from '../../shared/api.js';

export function baseUrl(req: Request, config: Config): string {
  return config.publicUrl || `${req.protocol}://${req.get('host')}`;
}

export function feedLinks(base: string, feedToken: string): FeedLinks {
  const https = `${base}/feed/${feedToken}.ics`;
  const webcal = https.replace(/^https?:/, 'webcal:');
  return {
    https,
    webcal,
    google: 'https://calendar.google.com/calendar/r?cid=' + encodeURIComponent(webcal),
    pageUrl: `${base}/s/${feedToken}`,
    isLocal: isLocalAddress(base),
  };
}

/** True when the address only works on the home network (or isn't https). */
export function isLocalAddress(base: string): boolean {
  try {
    const { protocol, hostname: h } = new URL(base);
    return protocol === 'http:' || h === 'localhost' || h.endsWith('.local') || h.endsWith('.lan') ||
      /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.)/.test(h);
  } catch {
    return true;
  }
}
