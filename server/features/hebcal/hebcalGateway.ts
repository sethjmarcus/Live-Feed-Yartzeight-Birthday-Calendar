/**
 * Gateway to the Hebcal REST API (https://www.hebcal.com/home/195/jewish-calendar-rest-api)
 * for the optional feed extras: Jewish holidays and candle-lighting / Havdalah times.
 *
 * - Responses are cached in SQLite and refreshed in the background, so a phone
 *   fetching its feed never waits on hebcal.com.
 * - If a year has never been downloaded (e.g. the server is offline), holidays are
 *   computed locally with the @hebcal/core library instead. Candle-lighting needs the
 *   API (it depends on the location's sunset).
 *
 * Data © Hebcal.com, licensed CC BY 4.0 — attribution is included in the feed.
 */
import { HebrewCalendar } from '@hebcal/core';
import type { HebcalCacheRepository } from './hebcalCacheRepository.js';
import type { SettingsRepository } from '../settings/settingsRepository.js';
import type { HebcalStatus } from '../../../shared/api.js';
import type { HebcalFeedType } from '../../../shared/eventTypes.js';
import type { Settings } from '../../../shared/schemas.js';

export const ATTRIBUTION = 'Holiday and candle-lighting data: Hebcal.com (CC BY 4.0)';
const YEARS_BACK = 1;
const YEARS_AHEAD = 2;
const API_FLAG: Record<Settings['hebcalHolidays'][number], string> = {
  major: 'maj', minor: 'min', modern: 'mod', roshchodesh: 'nx', fast: 'mf', specialShabbat: 'ss',
};

export interface HebcalItem {
  kind: HebcalFeedType;
  date: string;              // YYYY-MM-DD
  dateTime: string | null;   // ISO with offset for timed items (candle-lighting)
  title: string;
  hebrew: string;
  memo: string;
}
interface ApiItem { title: string; date: string; category: string; subcat?: string; hebrew?: string; memo?: string }
interface CachedYear { items: ApiItem[]; location: string | null }

type Fetch = typeof globalThis.fetch;
type Log = { warn: (o: unknown, msg?: string) => void };

export class HebcalGateway {
  private lastError: string | null = null;
  private timer?: NodeJS.Timeout;

  constructor(
    private cache: HebcalCacheRepository,
    private settings: SettingsRepository,
    private opts: { baseUrl: string; refreshHours: number; fetch?: Fetch; log: Log },
  ) {}

  /** Refresh now and periodically. Never throws. */
  start() {
    void this.refresh().catch(() => {});
    this.timer = setInterval(() => void this.refresh().catch(() => {}), Math.min(this.opts.refreshHours, 6) * 3_600_000);
    this.timer.unref();
  }
  stop() { clearInterval(this.timer); }

  private years(now = new Date()) {
    const y = now.getFullYear();
    return Array.from({ length: YEARS_BACK + YEARS_AHEAD + 1 }, (_, i) => y - YEARS_BACK + i);
  }

  /** One API query string per year, for the current settings. */
  private query(year: number, s: Settings): string {
    const q = new URLSearchParams({ v: '1', cfg: 'json', year: String(year), month: 'x', i: s.hebcalIsrael ? 'on' : 'off', leyning: 'off' });
    for (const group of s.hebcalHolidays) q.set(API_FLAG[group], 'on');
    if (s.hebcalGeonameId) {
      q.set('c', 'on');
      q.set('geonameid', s.hebcalGeonameId);
      q.set('b', String(s.hebcalCandleMinutes));
      q.set('M', 'on');
    }
    return q.toString();
  }

  /** Download any year that is missing or stale. */
  async refresh({ force = false } = {}): Promise<{ fetched: number; failed: number }> {
    const s = await this.settings.get();
    const queries = this.years().map(y => this.query(y, s));
    const fetchFn = this.opts.fetch ?? globalThis.fetch;
    let fetched = 0;
    let failed = 0;
    for (const query of queries) {
      const cached = await this.cache.get<CachedYear>(query);
      if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < this.opts.refreshHours * 3_600_000) continue;
      try {
        const res = await fetchFn(`${this.opts.baseUrl}/hebcal?${query}`, {
          signal: AbortSignal.timeout(15_000),
          headers: { 'User-Agent': 'yahrzeit-feed-calendar (self-hosted)' },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { items?: ApiItem[]; location?: { title?: string } };
        if (!Array.isArray(data.items)) throw new Error('Unexpected response from Hebcal');
        await this.cache.put(query, { items: data.items, location: data.location?.title ?? null } satisfies CachedYear, new Date().toISOString());
        fetched++;
      } catch (err) {
        failed++;
        this.lastError = `${new Date().toISOString()}: ${(err as Error).message}`;
        this.opts.log.warn({ err: (err as Error).message }, 'Hebcal API unavailable; using cached/offline data');
      }
    }
    await this.cache.retainOnly(queries);
    return { fetched, failed };
  }

  /** Holidays / candle-lighting between two ISO dates (inclusive), from cache or offline fallback. */
  async items(fromIso: string, toIso: string, kinds: HebcalFeedType[]): Promise<HebcalItem[]> {
    if (!kinds.length) return [];
    const s = await this.settings.get();
    const want = new Set(kinds);
    const out: HebcalItem[] = [];
    for (const year of this.years()) {
      if (`${year}-12-31` < fromIso || `${year}-01-01` > toIso) continue;
      const cached = await this.cache.get<CachedYear>(this.query(year, s));
      const items = cached ? cached.data.items.map(normalizeApiItem) : want.has('holidays') ? offlineHolidays(year, s) : [];
      for (const item of items) {
        if (item && want.has(item.kind) && item.date >= fromIso && item.date <= toIso) out.push(item);
      }
    }
    return out.sort((a, b) => (a.dateTime || a.date).localeCompare(b.dateTime || b.date));
  }

  async status(): Promise<HebcalStatus> {
    const s = await this.settings.get();
    const cached = (await Promise.all(this.years().map(y => this.cache.get<CachedYear>(this.query(y, s))))).filter(c => c !== null);
    return {
      cachedYears: cached.length,
      totalYears: this.years().length,
      lastFetched: cached.map(c => c.fetchedAt).sort().pop() ?? null,
      location: cached.find(c => c.data.location)?.data.location ?? null,
      lastError: this.lastError,
    };
  }
}

function normalizeApiItem(item: ApiItem): HebcalItem | null {
  const kind: HebcalFeedType | null =
    item.category === 'holiday' || item.category === 'roshchodesh' ? 'holidays'
    : item.category === 'candles' || item.category === 'havdalah' ? 'candles' : null;
  if (!kind) return null;
  return {
    kind,
    date: item.date.slice(0, 10),
    dateTime: item.date.includes('T') ? item.date : null,
    title: item.title,
    hebrew: item.hebrew ?? '',
    memo: item.memo ?? '',
  };
}

/** Holidays computed locally by @hebcal/core — used only when the API has never been reached. */
function offlineHolidays(year: number, s: Settings): HebcalItem[] {
  const groups = new Set(s.hebcalHolidays);
  const events = HebrewCalendar.calendar({ year, isHebrewYear: false, il: s.hebcalIsrael });
  const out: HebcalItem[] = [];
  for (const ev of events) {
    const [category, subcat] = ev.getCategories();
    const group = category === 'roshchodesh' ? 'roshchodesh'
      : subcat === 'shabbat' ? 'specialShabbat'
      : subcat === 'major' || subcat === 'minor' || subcat === 'modern' || subcat === 'fast' ? subcat : null;
    if (!group || !groups.has(group)) continue;
    const d = ev.getDate().greg();
    out.push({
      kind: 'holidays',
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
      dateTime: null,
      title: ev.render('en'),
      hebrew: ev.render('he-x-NoNikud'),
      memo: '',
    });
  }
  return out;
}
