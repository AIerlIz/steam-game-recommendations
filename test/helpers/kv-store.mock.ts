import type {
  KVStore,
  GamesData,
  GamesDetailData,
  GameLibrary,
  TelegramConfig,
  Subscription,
  AdminSession,
  LastSearch,
} from '../../worker/types.js'

export class InMemoryKvStore implements KVStore {
  private store = new Map<string, string>()

  get raw(): Map<string, string> {
    return this.store
  }

  private async getJson<T>(key: string): Promise<T | null> {
    const raw = this.store.get(key)
    if (raw === undefined) return null
    try { return JSON.parse(raw) as T } catch { return null }
  }

  private async put(key: string, value: unknown): Promise<void> {
    this.store.set(key, JSON.stringify(value))
  }

  async getGames(): Promise<GamesData> {
    return (await this.getJson<GamesData>('data:games')) || { games: [], total_owned: 0 }
  }

  async saveGames(data: GamesData): Promise<void> {
    await this.put('data:games', data)
  }

  async getGamesDetail(): Promise<GamesDetailData> {
    return (await this.getJson<GamesDetailData>('data:games_detail')) || { games: [], total_owned: 0 }
  }

  async saveGamesDetail(data: GamesDetailData): Promise<void> {
    await this.put('data:games_detail', data)
  }

  async getLibrary(): Promise<GameLibrary | null> {
    return await this.getJson<GameLibrary>('data:library')
  }

  async saveLibrary(library: GameLibrary): Promise<void> {
    await this.put('data:library', library)
  }

  async getConfig(key: string): Promise<string | null> {
    return this.store.get(`config:${key}`) ?? null
  }

  async setConfig(key: string, value: string): Promise<void> {
    this.store.set(`config:${key}`, value)
  }

  async deleteConfig(key: string): Promise<void> {
    this.store.delete(`config:${key}`)
  }

  async getAllConfigs(): Promise<Record<string, string>> {
    const configs: Record<string, string> = {}
    for (const [k, v] of this.store) {
      if (k.startsWith('config:')) {
        configs[k.slice(7)] = v
      }
    }
    return configs
  }

  async getTelegramConfig(): Promise<TelegramConfig> {
    return (await this.getJson<TelegramConfig>('config:TELEGRAM')) || {}
  }

  async setTelegramConfig(config: TelegramConfig): Promise<void> {
    await this.put('config:TELEGRAM', config)
  }

  async getSubscriptions(chatId: number | string): Promise<Subscription[]> {
    return (await this.getJson<Subscription[]>(`sub:${chatId}`)) || []
  }

  async saveSubscriptions(chatId: number | string, subs: Subscription[]): Promise<void> {
    await this.put(`sub:${chatId}`, subs)
  }

  async getAllSubKeys(): Promise<string[]> {
    return [...this.store.keys()]
      .filter(k => k.startsWith('sub:') && !k.endsWith('_notified'))
  }

  async getLastSearch(chatId: number | string): Promise<LastSearch | null> {
    return await this.getJson<LastSearch>(`lastsearch:${chatId}`)
  }

  async saveLastSearch(chatId: number | string, data: LastSearch, _ttl: number): Promise<void> {
    await this.put(`lastsearch:${chatId}`, data)
  }

  async getAdminSession(id: string): Promise<AdminSession | null> {
    return await this.getJson<AdminSession>(`admin:session:${id}`)
  }

  async setAdminSession(id: string, data: AdminSession, _ttl: number): Promise<void> {
    await this.put(`admin:session:${id}`, data)
  }

  async deleteAdminSession(id: string): Promise<void> {
    this.store.delete(`admin:session:${id}`)
  }

  async getNotified(key: string): Promise<Record<string, number>> {
    return (await this.getJson<Record<string, number>>(`${key}_notified`)) || {}
  }

  async saveNotified(key: string, data: Record<string, number>): Promise<void> {
    await this.put(`${key}_notified`, data)
  }
}
