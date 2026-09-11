'use strict';

require('dotenv').config();
const express = require('express');
const path = require('path');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser({ timeout: 12000 });
const PORT = Number(process.env.PORT || 8080);
const API_KEY = String(process.env.APISPORTS_KEY || '').trim();
const API_BASE = 'https://v3.football.api-sports.io';

const DAILY_BUDGET = Math.max(1, Number(process.env.API_FOOTBALL_DAILY_BUDGET || 90));
const LIVE_TTL = Math.max(60, Number(process.env.LIVE_CACHE_SECONDS || 1200)) * 1000;
const DETAIL_TTL = Math.max(60, Number(process.env.DETAIL_CACHE_SECONDS || 600)) * 1000;
const LEAGUES_TTL = Math.max(300, Number(process.env.LEAGUES_CACHE_SECONDS || 86400)) * 1000;
const NEWS_REFRESH_MS = Math.max(15, Number(process.env.NEWS_REFRESH_MINUTES || 60)) * 60 * 1000;

const apiCache = new Map();
let usageDay = peruDay();
let usageCount = 0;
let newsState = { items: [], fetchedAt: null, error: null };

function peruDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function resetUsageIfNeeded() {
  const today = peruDay();
  if (today !== usageDay) {
    usageDay = today;
    usageCount = 0;
  }
}

function cacheGet(key, allowStale = false) {
  const entry = apiCache.get(key);
  if (!entry) return null;
  if (allowStale || entry.expiresAt > Date.now()) return entry;
  return null;
}

async function apiFootball(endpoint, ttlMs) {
  const cacheKey = endpoint;
  const fresh = cacheGet(cacheKey, false);
  if (fresh) return { data: fresh.data, cache: true, stale: false, fetchedAt: fresh.fetchedAt };

  if (!API_KEY) {
    const err = new Error('APISPORTS_KEY no está configurada');
    err.status = 503;
    throw err;
  }

  resetUsageIfNeeded();
  if (usageCount >= DAILY_BUDGET) {
    const stale = cacheGet(cacheKey, true);
    if (stale) return { data: stale.data, cache: true, stale: true, fetchedAt: stale.fetchedAt };
    const err = new Error('Presupuesto diario interno de API-Football alcanzado');
    err.status = 429;
    throw err;
  }

  usageCount += 1;
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: {
      'x-apisports-key': API_KEY,
      'accept': 'application/json'
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || (payload.errors && Object.keys(payload.errors).length)) {
    const stale = cacheGet(cacheKey, true);
    if (stale) return { data: stale.data, cache: true, stale: true, fetchedAt: stale.fetchedAt };
    const err = new Error(`API-Football respondió ${response.status}`);
    err.status = response.status || 502;
    err.details = payload.errors || payload;
    throw err;
  }

  const entry = {
    data: payload,
    fetchedAt: new Date().toISOString(),
    expiresAt: Date.now() + ttlMs
  };
  apiCache.set(cacheKey, entry);
  return { data: payload, cache: false, stale: false, fetchedAt: entry.fetchedAt };
}

function mapFixture(x) {
  return {
    id: x.fixture?.id,
    date: x.fixture?.date,
    timestamp: x.fixture?.timestamp,
    timezone: x.fixture?.timezone,
    venue: x.fixture?.venue || null,
    referee: x.fixture?.referee || null,
    elapsed: x.fixture?.status?.elapsed ?? null,
    status: x.fixture?.status?.short || x.fixture?.status?.long || 'NS',
    statusLong: x.fixture?.status?.long || '',
    league: {
      id: x.league?.id,
      name: x.league?.name || 'Competición',
      country: x.league?.country || '',
      logo: x.league?.logo || '',
      flag: x.league?.flag || '',
      round: x.league?.round || ''
    },
    home: {
      id: x.teams?.home?.id,
      name: x.teams?.home?.name || 'Local',
      logo: x.teams?.home?.logo || '',
      winner: x.teams?.home?.winner,
      goals: x.goals?.home ?? 0
    },
    away: {
      id: x.teams?.away?.id,
      name: x.teams?.away?.name || 'Visitante',
      logo: x.teams?.away?.logo || '',
      winner: x.teams?.away?.winner,
      goals: x.goals?.away ?? 0
    },
    score: x.score || null
  };
}

function queryString(params) {
  const u = new URLSearchParams();
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v).trim() !== '') u.set(k, String(v));
  });
  const s = u.toString();
  return s ? `?${s}` : '';
}

function parseSourceFromTitle(title) {
  const parts = String(title || '').split(' - ');
  if (parts.length > 1) return parts.pop().trim();
  return '';
}

function cleanHeadline(title) {
  const parts = String(title || '').split(' - ');
  if (parts.length > 1) parts.pop();
  return parts.join(' - ').trim();
}

function defaultNewsFeeds() {
  return [
    'https://news.google.com/rss/search?q=f%C3%BAtbol+Per%C3%BA&hl=es-419&gl=PE&ceid=PE:es-419',
    'https://news.google.com/rss/search?q=Champions+League+f%C3%BAtbol&hl=es-419&gl=PE&ceid=PE:es-419',
    'https://news.google.com/rss/search?q=Premier+League+f%C3%BAtbol&hl=es-419&gl=PE&ceid=PE:es-419',
    'https://news.google.com/rss/search?q=deportes+Per%C3%BA&hl=es-419&gl=PE&ceid=PE:es-419'
  ];
}

async function refreshNews() {
  const configured = String(process.env.NEWS_RSS_URLS || '').split(',').map(x => x.trim()).filter(Boolean);
  const feeds = configured.length ? configured : defaultNewsFeeds();
  try {
    const results = await Promise.allSettled(feeds.map(url => parser.parseURL(url)));
    const seen = new Set();
    const items = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      for (const item of r.value.items || []) {
        const headline = cleanHeadline(item.title);
        const key = headline.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!headline || seen.has(key) || !item.link) continue;
        seen.add(key);
        items.push({
          title: headline,
          source: parseSourceFromTitle(item.title) || item.creator || 'Fuente deportiva',
          link: item.link,
          publishedAt: item.isoDate || item.pubDate || null
        });
      }
    }
    items.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    newsState = { items: items.slice(0, 36), fetchedAt: new Date().toISOString(), error: null };
    console.log(`[news] ${newsState.items.length} titulares actualizados`);
  } catch (error) {
    newsState = { ...newsState, error: error.message || 'No se pudieron actualizar las noticias' };
    console.error('[news]', error.message);
  }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '250kb' }));
app.use(express.static(__dirname, { extensions: ['html'] }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'sportedge-ai', time: new Date().toISOString() });
});

app.get('/api/status', (_req, res) => {
  resetUsageIfNeeded();
  res.json({
    configured: Boolean(API_KEY),
    provider: 'API-Football / API-Sports',
    planMode: 'free-optimized',
    dailyBudget: DAILY_BUDGET,
    usedToday: usageCount,
    remainingBudget: Math.max(0, DAILY_BUDGET - usageCount),
    usageDay,
    liveCacheSeconds: Math.round(LIVE_TTL / 1000),
    newsRefreshMinutes: Math.round(NEWS_REFRESH_MS / 60000),
    newsFetchedAt: newsState.fetchedAt
  });
});

app.get('/api/live', async (_req, res, next) => {
  try {
    const out = await apiFootball('/fixtures?live=all', LIVE_TTL);
    const matches = (out.data.response || []).map(mapFixture);
    res.set('Cache-Control', 'public, max-age=30');
    res.json({ count: matches.length, matches, fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/fixtures', async (req, res, next) => {
  try {
    const params = {
      date: req.query.date,
      league: req.query.league,
      season: req.query.season,
      team: req.query.team,
      country: req.query.country,
      next: req.query.next,
      last: req.query.last,
      timezone: req.query.timezone || 'America/Lima'
    };
    const endpoint = `/fixtures${queryString(params)}`;
    const out = await apiFootball(endpoint, Math.max(LIVE_TTL, 3600 * 1000));
    const matches = (out.data.response || []).map(mapFixture);
    res.json({ count: matches.length, matches, fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/leagues', async (req, res, next) => {
  try {
    const endpoint = `/leagues${queryString({ country: req.query.country, season: req.query.season, current: req.query.current })}`;
    const out = await apiFootball(endpoint, LEAGUES_TTL);
    const leagues = (out.data.response || []).map(x => ({
      id: x.league?.id,
      name: x.league?.name,
      type: x.league?.type,
      logo: x.league?.logo,
      country: x.country?.name,
      flag: x.country?.flag,
      seasons: x.seasons || []
    }));
    res.json({ count: leagues.length, leagues, fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/fixture', async (req, res, next) => {
  try {
    const id = String(req.query.id || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'fixture id inválido' });
    const out = await apiFootball(`/fixtures?id=${encodeURIComponent(id)}`, DETAIL_TTL);
    res.json({ response: out.data.response || [], fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/statistics', async (req, res, next) => {
  try {
    const id = String(req.query.fixture || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'fixture inválido' });
    const out = await apiFootball(`/fixtures/statistics?fixture=${encodeURIComponent(id)}`, DETAIL_TTL);
    res.json({ response: out.data.response || [], fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/events', async (req, res, next) => {
  try {
    const id = String(req.query.fixture || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'fixture inválido' });
    const out = await apiFootball(`/fixtures/events?fixture=${encodeURIComponent(id)}`, DETAIL_TTL);
    res.json({ response: out.data.response || [], fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});

app.get('/api/live-odds', async (req, res, next) => {
  try {
    const id = String(req.query.fixture || '').trim();
    if (!/^\d+$/.test(id)) return res.status(400).json({ error: 'fixture inválido' });
    const out = await apiFootball(`/odds/live?fixture=${encodeURIComponent(id)}`, DETAIL_TTL);
    res.json({ response: out.data.response || [], fetchedAt: out.fetchedAt, cache: out.cache, stale: out.stale });
  } catch (e) { next(e); }
});



// Proxy seguro para Widgets API-SPORTS.
// El navegador llama a /api/football/... y el servidor agrega APISPORTS_KEY.
// Así la clave nunca queda escrita en index.html ni en GitHub.
function ttlForWidgetPath(rawPath, query) {
  const pathLower = String(rawPath || '').toLowerCase();
  if (pathLower.startsWith('leagues')) return Math.max(LEAGUES_TTL, 4 * 60 * 60 * 1000);
  if (pathLower.startsWith('standings')) return 6 * 60 * 60 * 1000;
  if (pathLower.startsWith('teams') || pathLower.startsWith('players')) return 6 * 60 * 60 * 1000;
  if (pathLower.startsWith('fixtures')) {
    if (String(query.live || '').trim()) return LIVE_TTL;
    return Math.max(DETAIL_TTL, 60 * 60 * 1000);
  }
  if (pathLower.startsWith('odds')) return DETAIL_TTL;
  return DETAIL_TTL;
}

app.get('/api/football/*', async (req, res, next) => {
  try {
    const rawPath = String(req.params[0] || '').replace(/^\/+/, '');
    if (!rawPath || !/^[a-zA-Z0-9_\/-]+$/.test(rawPath)) {
      return res.status(400).json({ error: 'Ruta API-SPORTS inválida' });
    }
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(req.query || {})) {
      if (Array.isArray(value)) value.forEach(v => params.append(key, String(v)));
      else if (value !== undefined && value !== null) params.set(key, String(value));
    }
    const qs = params.toString();
    const endpoint = `/${rawPath}${qs ? `?${qs}` : ''}`;
    const out = await apiFootball(endpoint, ttlForWidgetPath(rawPath, req.query));
    res.set('Cache-Control', 'public, max-age=30');
    res.json(out.data);
  } catch (e) { next(e); }
});

app.get('/api/news', async (_req, res) => {
  if (!newsState.fetchedAt || (Date.now() - new Date(newsState.fetchedAt).getTime()) > NEWS_REFRESH_MS) {
    await refreshNews();
  }
  res.set('Cache-Control', 'public, max-age=300');
  res.json(newsState);
});

app.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

app.use((err, _req, res, _next) => {
  const status = Number(err.status || 500);
  console.error('[api error]', status, err.message);
  res.status(status).json({
    error: err.message || 'Error interno',
    details: process.env.NODE_ENV === 'development' ? err.details : undefined
  });
});

refreshNews();
setInterval(refreshNews, NEWS_REFRESH_MS).unref();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SportEdge AI activo en http://localhost:${PORT}`);
  console.log(`API-Football: ${API_KEY ? 'configurada' : 'sin clave (modo demo en frontend)'}`);
  console.log(`Cache LIVE: ${Math.round(LIVE_TTL / 60000)} min | presupuesto diario interno: ${DAILY_BUDGET}`);
});
