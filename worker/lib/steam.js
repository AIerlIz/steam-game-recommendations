export function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function requestWithRetry(url, maxRetries = 3, delay = 1.0, opts = {}) {
  const timeout = opts.timeout || 15;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout * 1000);
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      clearTimeout(timer);
      return resp;
    } catch (e) {
      clearTimeout(timer);
      if (attempt < maxRetries - 1) {
        await sleep(delay * Math.pow(2, attempt) * 1000);
      }
    }
  }
  return null;
}

export function loadGamesJson(env) {
  return env.KV.get('data:games', 'json').then(data => data || { games: [], total_owned: 0 });
}

export function saveGamesJson(env, data) {
  return env.KV.put('data:games', JSON.stringify(data));
}

export function filterLibraryGames(games, detailMap = null) {
  let softwareCount = 0;
  if (detailMap) {
    const before = games.length;
    games = games.filter(g => {
      const d = detailMap[g.appid];
      return !d || d.type === 'game';
    });
    softwareCount = before - games.length;
  }
  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0);
  const threshold = totalPlaytime * 0.001;
  const before = games.length;
  games = games.filter(g => (g.playtime_hours || 0) >= threshold);
  const filteredCount = before - games.length;
  return { games, softwareCount, filteredCount, totalPlaytime };
}

export async function getSteamId(steamApiKey, steamUserId) {
  if (!steamApiKey || !steamUserId) return '';
  if (/^\d+$/.test(steamUserId)) return steamUserId;
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${steamApiKey}&vanityurl=${steamUserId}`;
  try {
    const resp = await fetch(url, { timeout: 10000 });
    const data = await resp.json();
    if (data?.response?.success === 1) return data.response.steamid;
  } catch {}
  return '';
}

export async function getOwnedGames(steamApiKey, steamId) {
  if (!steamApiKey || !steamId) return { games: [], count: 0 };
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=true`;
  try {
    const resp = await fetch(url, { timeout: 30000 });
    const data = await resp.json();
    const respData = data?.response || {};
    const games = (respData.games || []).map(g => ({
      appid: g.appid,
      name: g.name || '',
      playtime_hours: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
    })).filter(g => g.appid);
    return { games, count: respData.game_count || games.length };
  } catch {
    return { games: [], count: 0 };
  }
}

export async function fetchSteamDetails(appid, lang = 'schinese') {
  const url = `https://store.steampowered.com/api/appdetails?cc=cn&l=${lang}&appids=${appid}`;
  const resp = await requestWithRetry(url);
  if (!resp) return null;
  try {
    const data = await resp.json();
    const info = data[String(appid)];
    if (!info?.success) return null;
    const d = info.data;
    return {
      appid,
      name: d.name || '',
      type: d.type || 'game',
      header_image: d.header_image || '',
      short_description: d.short_description || '',
      genres: (d.genres || []).map(g => g.description),
      categories: (d.categories || []).map(c => c.description),
      release_date: d.release_date?.date || '',
      is_free: d.is_free || false,
      price: d.price_overview || null,
      on_sale: (d.price_overview?.discount_percent || 0) > 0,
      screenshots: (d.screenshots || []).slice(0, 3).map(s => s.path_full),
    };
  } catch {
    return null;
  }
}

export async function fetchReview(appid, lang = 'schinese') {
  const url = `https://store.steampowered.com/appreviews/${appid}?json=1&language=${lang}&purchase_type=all`;
  const resp = await requestWithRetry(url, 3, 1, { timeout: 10 });
  if (!resp) return null;
  try {
    const data = await resp.json();
    if (data.success === 1) {
      const q = data.query_summary || {};
      return {
        score: q.review_score || 0,
        desc: q.review_score_desc || '',
        total: q.total_reviews || 0,
        positive: q.total_positive || 0,
      };
    }
  } catch {}
  return null;
}

export async function batchFetch(items, fetchFn, { maxWorkers = 2, delay = 0.3, progressInterval = 0 } = {}) {
  const results = {};
  const total = items.length;
  let done = 0;
  const queue = [...items];
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (delay) await sleep(delay * 1000);
      try {
        const result = await fetchFn(item);
        if (result != null) results[item] = result;
      } catch {}
      done++;
    }
  }
  const workers = Array.from({ length: Math.min(maxWorkers, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function getConfig(env, key, defaultValue = '') {
  return (await env.KV.get(`config:${key}`)) || defaultValue;
}

export async function getTelegramConfig(env) {
  const data = await env.KV.get('config:TELEGRAM', 'json');
  return data || {};
}

export async function setTelegramConfig(env, { token, adminChatId }) {
  await env.KV.put('config:TELEGRAM', JSON.stringify({ token, adminChatId }));
}

export async function getAllConfig(env) {
  const list = await env.KV.list({ prefix: 'config:' });
  const config = {};
  for (const k of list.keys) {
    config[k.name.replace('config:', '')] = await env.KV.get(k.name);
  }
  return config;
}

export function buildGamesOutput(games) {
  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0);
  return {
    games,
    total_games: games.length,
    total_playtime_hours: Math.round(totalPlaytime * 10) / 10,
  };
}
