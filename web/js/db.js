/**
 * Fetch listone da GitHub Raw con cache in-memory.
 * Nessun redeploy Netlify necessario quando la Action aggiorna il JSON.
 */

const DEFAULT_DB_URL =
  "https://raw.githubusercontent.com/02kiki02/Fanta/main/data/fantacalcio_db.json";

const CACHE_TTL_MS = 5 * 60 * 1000;

let memoryCache = {
  url: null,
  fetchedAt: 0,
  payload: null,
};

export function getDefaultDbUrl() {
  return DEFAULT_DB_URL;
}

export function clearDbCache() {
  memoryCache = { url: null, fetchedAt: 0, payload: null };
}

/**
 * @param {string} url
 * @param {{ force?: boolean }} [opts]
 */
export async function fetchPlayersDb(url, opts = {}) {
  const target = (url || DEFAULT_DB_URL).trim();
  const now = Date.now();
  const fresh =
    !opts.force &&
    memoryCache.payload &&
    memoryCache.url === target &&
    now - memoryCache.fetchedAt < CACHE_TTL_MS;

  if (fresh) {
    return {
      payload: memoryCache.payload,
      fromCache: true,
      url: target,
    };
  }

  const response = await fetch(target, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} caricando il listone`);
  }

  const payload = await response.json();
  if (!payload || !Array.isArray(payload.players)) {
    throw new Error("JSON non valido: manca players[]");
  }

  memoryCache = {
    url: target,
    fetchedAt: now,
    payload,
  };

  return { payload, fromCache: false, url: target };
}

export function playersToMap(players) {
  const map = new Map();
  for (const p of players || []) {
    map.set(String(p.id), p);
  }
  return map;
}
