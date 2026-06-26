export const KV_KEYS = {
  DATA_CHINESE_NAMES: 'data:chinese_names',
  CONFIG_TELEGRAM: 'config:TELEGRAM',
  CONFIG_PREFIX: 'config:',
  SUB_PREFIX: 'sub:',
  LASTSEARCH_PREFIX: 'lastsearch:',
  NOTIFIED_SUFFIX: '_notified',
  configKey: (key: string) => `config:${key}`,
  subKey: (chatId: number | string) => `sub:${String(chatId)}`,
  lastSearchKey: (chatId: number | string) => `lastsearch:${String(chatId)}`,
  sessionKey: (chatId: number | string) => `session:${String(chatId)}`,
  notifiedKey: (subKey: string) => `${subKey}_notified`,
}

const BUILTIN_CHINESE_NAMES: Record<string, number> = {
  '泰拉瑞亚': 105600,
}

export async function getChineseNameIndex(env: Env): Promise<Record<string, number>> {
  const stored = await env.KV.get(KV_KEYS.DATA_CHINESE_NAMES, 'json') as Record<string, number> | null
  return { ...BUILTIN_CHINESE_NAMES, ...(stored || {}) }
}

export async function addChineseName(env: Env, cnName: string, appid: number): Promise<void> {
  const stored = await env.KV.get(KV_KEYS.DATA_CHINESE_NAMES, 'json') as Record<string, number> | null
  const map: Record<string, number> = { ...(stored || {}), [cnName]: appid }
  await env.KV.put(KV_KEYS.DATA_CHINESE_NAMES, JSON.stringify(map))
}

export async function getTelegramConfig(env: Env): Promise<Record<string, unknown>> {
  const data = await env.KV.get(KV_KEYS.CONFIG_TELEGRAM, 'json')
  return (data || {}) as Record<string, unknown>
}

export async function setTelegramConfig(env: Env, config: { token?: string; adminChatId?: string }): Promise<void> {
  await env.KV.put(KV_KEYS.CONFIG_TELEGRAM, JSON.stringify(config))
}
