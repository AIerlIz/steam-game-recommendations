import type {
  KVStore,
  GamesData,
  GamesDetailData,
  GameLibrary,
  TelegramConfig,
  Subscription,
  AdminSession,
  LastSearch,
} from '../types.js'

const KEYS = {
  GAMES: 'data:games',
  GAMES_DETAIL: 'data:games_detail',
  LIBRARY: 'data:library',
  TELEGRAM: 'config:TELEGRAM',
  CONFIG_PREFIX: 'config:',
  SUB_PREFIX: 'sub:',
  NOTIFIED_SUFFIX: '_notified',
  config: (k: string) => `config:${k}`,
  sub: (chatId: number | string) => `sub:${String(chatId)}`,
  lastSearch: (chatId: number | string) => `lastsearch:${String(chatId)}`,
  adminSession: (id: string) => `admin:session:${id}`,
  notified: (subKey: string) => `${subKey}_notified`,
}

export { KEYS as KV_KEYS }

export class CfKvStore implements KVStore {
  constructor(private kv: KVNamespace) {}

  async getGames(): Promise<GamesData> {
    const data = await this.kv.get(KEYS.GAMES, 'json')
    return (data || { games: [], total_owned: 0 }) as GamesData
  }

  async saveGames(data: GamesData): Promise<void> {
    await this.kv.put(KEYS.GAMES, JSON.stringify(data))
  }

  async getGamesDetail(): Promise<GamesDetailData> {
    const data = await this.kv.get(KEYS.GAMES_DETAIL, 'json')
    return (data || { games: [], total_owned: 0 }) as GamesDetailData
  }

  async saveGamesDetail(data: GamesDetailData): Promise<void> {
    await this.kv.put(KEYS.GAMES_DETAIL, JSON.stringify(data))
  }

  async getLibrary(): Promise<GameLibrary | null> {
    const data = await this.kv.get(KEYS.LIBRARY, 'json')
    return data as GameLibrary | null
  }

  async saveLibrary(library: GameLibrary): Promise<void> {
    await this.kv.put(KEYS.LIBRARY, JSON.stringify(library))
  }

  async getConfig(key: string): Promise<string | null> {
    return await this.kv.get(KEYS.config(key))
  }

  async setConfig(key: string, value: string): Promise<void> {
    await this.kv.put(KEYS.config(key), value)
  }

  async deleteConfig(key: string): Promise<void> {
    await this.kv.delete(KEYS.config(key))
  }

  async getAllConfigs(): Promise<Record<string, string>> {
    const list = await this.kv.list({ prefix: KEYS.CONFIG_PREFIX })
    const configs: Record<string, string> = {}
    for (const k of list.keys) {
      const val = await this.kv.get(k.name)
      if (val !== null) {
        configs[k.name.replace(KEYS.CONFIG_PREFIX, '')] = val
      }
    }
    return configs
  }

  async getTelegramConfig(): Promise<TelegramConfig> {
    const data: TelegramConfig | null = await this.kv.get(KEYS.TELEGRAM, 'json')
    return data || {}
  }

  async setTelegramConfig(config: TelegramConfig): Promise<void> {
    await this.kv.put(KEYS.TELEGRAM, JSON.stringify(config))
  }

  async getSubscriptions(chatId: number | string): Promise<Subscription[]> {
    const data = await this.kv.get(KEYS.sub(chatId), 'json')
    return (data || []) as Subscription[]
  }

  async saveSubscriptions(chatId: number | string, subs: Subscription[]): Promise<void> {
    await this.kv.put(KEYS.sub(chatId), JSON.stringify(subs))
  }

  async getAllSubKeys(): Promise<string[]> {
    const list = await this.kv.list({ prefix: KEYS.SUB_PREFIX })
    return list.keys
      .filter(k => !k.name.includes(KEYS.NOTIFIED_SUFFIX))
      .map(k => k.name)
  }

  async getLastSearch(chatId: number | string): Promise<LastSearch | null> {
    const data = await this.kv.get(KEYS.lastSearch(chatId), 'json')
    return data as LastSearch | null
  }

  async saveLastSearch(chatId: number | string, data: LastSearch, ttl: number): Promise<void> {
    await this.kv.put(KEYS.lastSearch(chatId), JSON.stringify(data), { expirationTtl: ttl })
  }

  async getAdminSession(id: string): Promise<AdminSession | null> {
    const data = await this.kv.get(KEYS.adminSession(id), 'json')
    return data as AdminSession | null
  }

  async setAdminSession(id: string, data: AdminSession, ttl: number): Promise<void> {
    await this.kv.put(KEYS.adminSession(id), JSON.stringify(data), { expirationTtl: ttl })
  }

  async deleteAdminSession(id: string): Promise<void> {
    await this.kv.delete(KEYS.adminSession(id))
  }

  async getNotified(key: string): Promise<Record<string, number>> {
    const data = await this.kv.get(KEYS.notified(key), 'json')
    return (data || {}) as Record<string, number>
  }

  async saveNotified(key: string, data: Record<string, number>): Promise<void> {
    await this.kv.put(KEYS.notified(key), JSON.stringify(data))
  }
}
