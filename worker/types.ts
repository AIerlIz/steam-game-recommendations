// ====== 领域类型 ======

export interface Game {
  appid: number
  name: string
  playtime_hours?: number
  playtime_minutes?: number
  playtime_forever?: number
  release_date?: string
  release_year?: number
}

export interface GameDetail {
  appid: number
  name: string
  type: string
  header_image: string
  short_description: string
  genres: string[]
  categories: string[]
  release_date: string
  is_free: boolean
  price: PriceOverview | null
  on_sale: boolean
  screenshots: string[]
  reason?: string
  score?: number
  review?: ReviewData | null
}

export interface PriceOverview {
  currency: string
  initial: number
  final: number
  discount_percent: number
}

export interface ReviewData {
  score: number
  desc: string
  total: number
  positive: number
}

export interface GamesData {
  games: { appid: number; reason: string; score: number }[]
  total_owned: number
}

export interface GamesDetailData {
  games: GameDetail[]
  total_owned: number
}

export interface GameLibrary {
  games: Game[]
  total_games: number
  total_playtime_hours: number
}

export interface UserProfile {
  clusters: Record<string, Game[]>
  top_genres: string[]
  idf_weights: Record<string, number>
  total_hours: number
  cluster_strength: Record<string, number>
}

export interface Recommendation {
  appid: number
  name: string
  chinese_name?: string
  tags?: string[]
  release_year?: number
  reason?: string
  score?: number
  verified_name?: string
  review_score?: number
  rating?: number
  owners?: number
}

export interface Subscription {
  appid: number
  name: string
  added: number
}

export interface TelegramConfig {
  token?: string
  adminChatId?: string
}

export interface AdminSession {
  id: string
  created: number
}

export interface LastSearch {
  results: { appid: number; name: string }[]
}

export interface StoreSearchResult {
  items: { id: number; name: string; type: string }[]
}

// ====== 接口 ======

export interface KVStore {
  getGames(): Promise<GamesData>
  saveGames(data: GamesData): Promise<void>
  getGamesDetail(): Promise<GamesDetailData>
  saveGamesDetail(data: GamesDetailData): Promise<void>
  getLibrary(): Promise<GameLibrary | null>
  saveLibrary(library: GameLibrary): Promise<void>
  getConfig(key: string): Promise<string | null>
  setConfig(key: string, value: string): Promise<void>
  deleteConfig(key: string): Promise<void>
  getAllConfigs(): Promise<Record<string, string>>
  getTelegramConfig(): Promise<TelegramConfig>
  setTelegramConfig(config: TelegramConfig): Promise<void>
  getSubscriptions(chatId: number | string): Promise<Subscription[]>
  saveSubscriptions(chatId: number | string, subs: Subscription[]): Promise<void>
  getAllSubKeys(): Promise<string[]>
  getLastSearch(chatId: number | string): Promise<LastSearch | null>
  saveLastSearch(chatId: number | string, data: LastSearch, ttl: number): Promise<void>
  getAdminSession(id: string): Promise<AdminSession | null>
  setAdminSession(id: string, data: AdminSession, ttl: number): Promise<void>
  deleteAdminSession(id: string): Promise<void>
  getNotified(key: string): Promise<Record<string, number>>
  saveNotified(key: string, data: Record<string, number>): Promise<void>
}

export interface SteamAPIClient {
  resolveVanityUrl(vanityUrl: string): Promise<string | null>
  getOwnedGames(steamId: string): Promise<{ games: Game[]; count: number }>
  getAppDetails(appid: number, lang?: string): Promise<GameDetail | null>
  getReview(appid: number, lang?: string): Promise<ReviewData | null>
  storeSearch(query: string, lang?: string, country?: string): Promise<StoreSearchResult>
}

export interface LLMClient {
  generate(prompt: string, temperature?: number): Promise<string>
}

export interface LLMConfig {
  provider: string
  apiKey: string
  apiBase?: string
  model?: string
}

// ====== 工具函数类型 ======

export interface FilterOpts {
  thresholdFactor?: number
}

export interface LibraryGame {
  appid: number
  name: string
  playtime_hours?: number
  header_image?: string
  short_description?: string
  genres?: string[]
  screenshots?: string[]
  review?: ReviewData | Record<string, unknown> | null
}

export interface FilterResult {
  games: LibraryGame[]
  softwareCount: number
  filteredCount: number
  totalPlaytime: number
}
