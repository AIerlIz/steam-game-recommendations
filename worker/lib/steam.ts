import type { FilterResult, LibraryGame, FilterOpts } from '../types.js'

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

export async function getOwnedGames(steamApiKey: string, steamId: string): Promise<{ games: { appid: number; name: string; playtime_hours: number; playtime_forever: number }[]; count: number }> {
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
        playtime_forever: g.playtime_forever || 0,
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
  return (await env.KV.get(`config:${key}`)) || defaultValue
}
