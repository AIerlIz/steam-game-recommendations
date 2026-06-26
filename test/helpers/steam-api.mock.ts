import type { SteamAPIClient, Game, GameDetail, ReviewData, StoreSearchResult } from '../../worker/types.js'

export class MockSteamClient implements SteamAPIClient {
  ownedGames: Game[] = []
  details = new Map<number, GameDetail>()
  reviews = new Map<number, ReviewData>()
  storeResults: StoreSearchResult = { items: [] }
  vanityResult: string | null = null

  async resolveVanityUrl(_vanityUrl: string): Promise<string | null> {
    return this.vanityResult
  }

  async getOwnedGames(_steamId: string): Promise<{ games: Game[]; count: number }> {
    return { games: this.ownedGames, count: this.ownedGames.length }
  }

  async getAppDetails(appid: number, _lang?: string): Promise<GameDetail | null> {
    return this.details.get(appid) ?? null
  }

  async getReview(appid: number, _lang?: string): Promise<ReviewData | null> {
    return this.reviews.get(appid) ?? null
  }

  async storeSearch(_query: string, _lang?: string, _country?: string): Promise<StoreSearchResult> {
    return this.storeResults
  }
}
