import type { FilterResult, LibraryGame, FilterOpts, GamesData } from '../types.js'

export const KV_KEYS = {
  DATA_GAMES: 'data:games',
  DATA_GAMES_DETAIL: 'data:games_detail',
  DATA_LIBRARY: 'data:library',
  CONFIG_TELEGRAM: 'config:TELEGRAM',
  CONFIG_PREFIX: 'config:',
  SUB_PREFIX: 'sub:',
  LASTSEARCH_PREFIX: 'lastsearch:',
  ADMIN_SESSION_PREFIX: 'admin:session:',
  NOTIFIED_SUFFIX: '_notified',
  configKey: (key: string) => `config:${key}`,
  subKey: (chatId: number | string) => `sub:${String(chatId)}`,
  lastSearchKey: (chatId: number | string) => `lastsearch:${String(chatId)}`,
  sessionKey: (chatId: number | string) => `session:${String(chatId)}`,
  adminSessionKey: (id: string) => `admin:session:${id}`,
  notifiedKey: (subKey: string) => `${subKey}_notified`,
}

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

export async function requestWithRetry(
  url: string,
  maxRetries = 3,
  delay = 1.0,
  opts: { timeout?: number } = {},
): Promise<Response | null> {
  const timeout = opts.timeout || 15
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeout * 1000)
    try {
      const resp = await fetch(url, { ...opts, signal: controller.signal })
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
      clearTimeout(timer)
      return resp
    } catch {
      clearTimeout(timer)
      if (attempt < maxRetries - 1) {
        await sleep(delay * Math.pow(2, attempt) * 1000)
      }
    }
  }
  return null
}

export function filterLibraryGames(
  games: LibraryGame[],
  detailMap: Record<number, { type?: string }> | null = null,
  opts: FilterOpts = {},
): FilterResult {
  let softwareCount = 0
  if (detailMap) {
    const before = games.length
    games = games.filter(g => {
      const d = detailMap[g.appid]
      return !d || d.type === 'game'
    })
    softwareCount = before - games.length
  }
  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0)
  const thresholdFactor = opts.thresholdFactor ?? 0.001
  const threshold = totalPlaytime * thresholdFactor
  const before = games.length
  games = games.filter(g => (g.playtime_hours || 0) >= threshold)
  const filteredCount = before - games.length
  return { games, softwareCount, filteredCount, totalPlaytime }
}

export function buildGamesOutput(games: LibraryGame[]): { games: LibraryGame[]; total_games: number; total_playtime_hours: number } {
  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0)
  return {
    games,
    total_games: games.length,
    total_playtime_hours: Math.round(totalPlaytime * 10) / 10,
  }
}

export async function batchFetch<T>(
  items: T[],
  fetchFn: (item: T) => Promise<Record<string, unknown> | null>,
  { maxWorkers = 2, delay = 0.3 }: { maxWorkers?: number; delay?: number } = {},
): Promise<Record<string | number, unknown>> {
  const results: Record<string | number, unknown> = {}
  const queue = [...items]

  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!
      if (delay) await sleep(delay * 1000)
      try {
        const result = await fetchFn(item)
        if (result != null) results[String(item)] = result
      } catch { /* ignore */ }
    }
  }

  const workers = Array.from({ length: Math.min(maxWorkers, items.length) }, () => worker())
  await Promise.all(workers)
  return results
}

// === 向后兼容函数（待迁移完成后移除） ===

export function loadGamesJson(env: Env): Promise<GamesData> {
  return env.KV.get(KV_KEYS.DATA_GAMES, 'json').then((data: unknown) => (data || { games: [], total_owned: 0 }) as GamesData)
}

export function saveGamesJson(env: Env, data: unknown): Promise<void> {
  return env.KV.put(KV_KEYS.DATA_GAMES, JSON.stringify(data))
}

export async function getSteamId(steamApiKey: string, steamUserId: string): Promise<string> {
  if (!steamApiKey || !steamUserId) return ''
  if (/^\d+$/.test(steamUserId)) return steamUserId
  const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${steamApiKey}&vanityurl=${steamUserId}`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    const data: { response?: { success: number; steamid: string } } = await resp.json()
    if (data.response?.success === 1) return data.response.steamid
  } catch { /* ignore */ }
  return ''
}

export async function getOwnedGames(steamApiKey: string, steamId: string): Promise<{ games: { appid: number; name: string; playtime_hours: number }[]; count: number }> {
  if (!steamApiKey || !steamId) return { games: [], count: 0 }
  const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${steamApiKey}&steamid=${steamId}&include_appinfo=true`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30000) })
    const data: { response?: { games?: { appid: number; name?: string; playtime_forever?: number }[]; game_count?: number } } = await resp.json()
    const respData = data.response || {}
    const games = (respData.games || [])
      .map(g => ({
        appid: g.appid,
        name: g.name || '',
        playtime_hours: Math.round((g.playtime_forever || 0) / 60 * 10) / 10,
      }))
      .filter(g => g.appid)
    return { games, count: respData.game_count || games.length }
  } catch {
    return { games: [], count: 0 }
  }
}

export async function fetchSteamDetails(appid: number, lang = 'schinese'): Promise<Record<string, unknown> | null> {
  const url = `https://store.steampowered.com/api/appdetails?cc=cn&l=${lang}&appids=${String(appid)}`
  const resp = await requestWithRetry(url)
  if (!resp) return null
  try {
    const data: Record<string, { success: boolean; data?: Record<string, unknown> }> = await resp.json()
    const info = data[String(appid)]
    if (!info?.success || !info.data) return null
    return info.data
  } catch {
    return null
  }
}

export async function fetchReview(appid: number, lang = 'schinese'): Promise<Record<string, unknown> | null> {
  const url = `https://store.steampowered.com/appreviews/${String(appid)}?json=1&language=${lang}&purchase_type=all`
  const resp = await requestWithRetry(url, 3, 1, { timeout: 10 })
  if (!resp) return null
  try {
    const data: { success: number; query_summary?: Record<string, unknown> } = await resp.json()
    if (data.success === 1) return data.query_summary || null
  } catch { /* ignore */ }
  return null
}

export async function getConfig(env: Env, key: string, defaultValue = ''): Promise<string> {
  return (await env.KV.get(KV_KEYS.configKey(key))) || defaultValue
}

export async function getTelegramConfig(env: Env): Promise<Record<string, unknown>> {
  const data = await env.KV.get(KV_KEYS.CONFIG_TELEGRAM, 'json')
  return (data || {}) as Record<string, unknown>
}

export async function setTelegramConfig(env: Env, config: { token?: string; adminChatId?: string }): Promise<void> {
  await env.KV.put(KV_KEYS.CONFIG_TELEGRAM, JSON.stringify(config))
}

export async function getAllConfig(env: Env): Promise<Record<string, string>> {
  const list = await env.KV.list({ prefix: KV_KEYS.CONFIG_PREFIX })
  const config: Record<string, string> = {}
  for (const k of list.keys) {
    const val = await env.KV.get(k.name)
    if (val !== null) config[k.name.replace(KV_KEYS.CONFIG_PREFIX, '')] = val
  }
  return config
}
