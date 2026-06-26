import type { SteamAPIClient, Game, GameDetail, ReviewData, StoreSearchResult } from '../types.js'
import { requestWithRetry } from './steam.js'

interface RawAppDetails {
  name: string
  type: string
  header_image: string
  short_description: string
  genres: { description: string }[]
  categories: { description: string }[]
  release_date: { date: string }
  is_free: boolean
  price_overview: GameDetail['price']
  screenshots: { path_full: string }[]
}

export class HttpSteamClient implements SteamAPIClient {
  constructor(private apiKey: string) {}

  async resolveVanityUrl(vanityUrl: string): Promise<string | null> {
    if (!this.apiKey || !vanityUrl) return null
    if (/^\d+$/.test(vanityUrl)) return vanityUrl

    const url = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${this.apiKey}&vanityurl=${vanityUrl}`
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
      const data: { response?: { success: number; steamid: string } } = await resp.json()
      if (data.response?.success === 1) return data.response.steamid
    } catch { /* ignore */ }
    return null
  }

  async getOwnedGames(steamId: string): Promise<{ games: Game[]; count: number }> {
    if (!this.apiKey || !steamId) return { games: [], count: 0 }
    const url = `https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key=${this.apiKey}&steamid=${steamId}&include_appinfo=true`
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

  async getAppDetails(appid: number, lang = 'schinese'): Promise<GameDetail | null> {
    const url = `https://store.steampowered.com/api/appdetails?cc=cn&l=${lang}&appids=${String(appid)}`
    const resp = await requestWithRetry(url)
    if (!resp) return null
    try {
      const allData: Record<string, { success: boolean; data?: RawAppDetails } | undefined> = await resp.json()
      const entry = allData[String(appid)]
      if (!entry || !entry.success || !entry.data) return null
      const d = entry.data
      const price = d.price_overview
      return {
        appid,
        name: d.name || '',
        type: d.type || 'game',
        header_image: d.header_image || '',
        short_description: d.short_description || '',
        genres: d.genres.map(g => g.description),
        categories: d.categories.map(c => c.description),
        release_date: d.release_date.date,
        is_free: d.is_free,
        price: price || null,
        on_sale: (price?.discount_percent || 0) > 0,
        screenshots: d.screenshots.slice(0, 3).map(s => s.path_full),
      }
    } catch {
      return null
    }
  }

  async getReview(appid: number, lang = 'schinese'): Promise<ReviewData | null> {
    const url = `https://store.steampowered.com/appreviews/${String(appid)}?json=1&language=${lang}&purchase_type=all`
    const resp = await requestWithRetry(url, 3, 1, { timeout: 10 })
    if (!resp) return null
    try {
      const data: { success: number; query_summary?: ReviewData } = await resp.json()
      if (data.success === 1 && data.query_summary) return data.query_summary
    } catch { /* ignore */ }
    return null
  }

  async storeSearch(query: string, lang = 'schinese', country = 'cn'): Promise<StoreSearchResult> {
    const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(query)}&l=${lang}&cc=${country}`
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!resp.ok) return { items: [] }
      const data: { items?: { id: number; name: string; type: string }[] } = await resp.json()
      return { items: data.items || [] }
    } catch {
      return { items: [] }
    }
  }
}
