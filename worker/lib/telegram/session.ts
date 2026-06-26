import { KV_KEYS } from '../steam.js'

export interface SearchResultItem {
  appid: number
  name: string
}

export interface SessionState {
  search?: {
    results: SearchResultItem[]
    query: string
    currentPage: number
    totalPages: number
    isSteamSearch: boolean
  }
}

const TTL = 600

export async function getSession(env: Env, chatId: number): Promise<SessionState> {
  const raw = await env.KV.get(KV_KEYS.sessionKey(chatId), 'json') as SessionState | null
  return raw ?? {}
}

export async function saveSession(env: Env, chatId: number, state: SessionState): Promise<void> {
  await env.KV.put(KV_KEYS.sessionKey(chatId), JSON.stringify(state), { expirationTtl: TTL })
}

export async function clearSession(env: Env, chatId: number): Promise<void> {
  await env.KV.delete(KV_KEYS.sessionKey(chatId))
}
