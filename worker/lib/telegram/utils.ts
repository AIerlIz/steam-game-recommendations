import { getTelegramConfig } from '../steam.js'

interface TgResponse {
  ok?: boolean
  result?: unknown
}

export async function tgCall(token: string, method: string, body: Record<string, unknown>): Promise<TgResponse> {
  const url = `https://api.telegram.org/bot${token}/${method}`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return resp.json()
}

export function escMd(text: string): string {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&')
}

export async function steamStoreSearch(query: string, lang: string): Promise<{ items?: { id: number; name: string; type: string }[] }> {
  const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(query)}&l=${lang}&cc=cn`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!resp.ok) return { items: [] }
    return resp.json()
  } catch { return { items: [] } }
}

export async function fetchBatchAppDetails(appids: number[], lang: string): Promise<Record<number, Record<string, unknown>>> {
  if (!appids.length) return {}
  const url = `https://store.steampowered.com/api/appdetails?cc=cn&l=${lang}&appids=${appids.join(',')}`
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(15000) })
    const data = await resp.json() as Record<string, { success?: boolean; data?: Record<string, unknown> }>
    const result: Record<number, Record<string, unknown>> = {}
    for (const aid of appids) {
      const info = data[String(aid)]
      if (info?.success && info.data) {
        result[aid] = info.data
      }
    }
    return result
  } catch { return {} }
}

export function searchLocal(games: { name?: string }[], query: string): { appid?: number; name?: string }[] {
  const q = query.toLowerCase()
  const results: { appid?: number; name?: string }[] = []
  for (const g of games) {
    const name = (g.name || '').toLowerCase()
    if (name.includes(q)) {
      results.push(g)
    }
  }
  return results
}

export async function sendGameDetail(
  token: string,
  chatId: number,
  appid: number,
  cn: Record<string, unknown> | null | undefined,
  en: Record<string, unknown> | null | undefined,
): Promise<void> {
  const cnName = String(cn?.name || '未知')
  const enName = String(en?.name || cnName)
  const displayName = cnName !== enName ? `${cnName} (${enName})` : cnName

  const price = cn?.price_overview as { currency?: string; initial?: number; final?: number; discount_percent?: number } | undefined
  const priceText = price
    ? price.discount_percent && price.discount_percent > 0
      ? `~~¥${((price.initial || 0) / 100).toFixed(0)}~~ **¥${((price.final || 0) / 100).toFixed(0)}** -${price.discount_percent}% 🔥`
      : `¥${((price.final || 0) / 100).toFixed(0)}`
    : '价格未知'

  const releaseDate = String((cn?.release_date as { date?: string })?.date || '未知')
  const desc = (String((cn?.short_description as string) || (en?.short_description as string) || '暂无简介')).slice(0, 300)

  let text = `🎮 *${escMd(displayName)}*`
  text += `\n📅 ${escMd(releaseDate)} | 💰 ${escMd(priceText)}`
  if (Array.isArray(cn?.genres)) {
    text += `\n🏷️ ${escMd((cn.genres as string[]).slice(0, 3).join(' · '))}`
  }
  text += `\n📝 ${escMd(desc)}`

  const photoUrl = String(cn?.header_image || '')

  const replyMarkup = {
    inline_keyboard: [[
      { text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` },
      { text: '🔔 订阅降价', callback_data: `sub_${appid}` },
    ]],
  }

  if (photoUrl) {
    await tgCall(token, 'sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption: text,
      parse_mode: 'MarkdownV2',
      reply_markup: replyMarkup,
    })
  } else {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
      reply_markup: replyMarkup,
    })
  }
}

export async function sendGameList(
  token: string,
  chatId: number,
  items: { appid?: number; id?: number; name?: string }[],
  query: string,
  cnMap: Record<number, Record<string, unknown>>,
  enMap: Record<number, Record<string, unknown>>,
  isSteamSearch = false,
): Promise<void> {
  const lines = items.map((item, i) => {
    const aid = isSteamSearch ? (item.id as number) : (item.appid as number)
    const cn = cnMap[aid] || item
    const en = enMap[aid]
    const cnName = String((cn).name || item.name || '未知')
    const enName = String(en?.name || '')
    const nameDisplay = cnName !== enName && enName
      ? `${cnName} (${enName})`
      : cnName
    const price = (cn).price_overview as { final?: number } | undefined
    const priceStr = price ? `¥${((price.final || 0) / 100).toFixed(0)}` : ''
    const rating = (cn).review_score ? `⭐${(((cn).review_score as number) / 10).toFixed(1)}` : ''
    return `${i + 1}\\. ${escMd(nameDisplay)} ${rating} ${escMd(priceStr)}`
  })

  const text = `🔍 找到${String(items.length)}个相关游戏：\n\n${lines.join('\n')}\n\n回复数字查看详情，或输入更精确的名称`
  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
  })
}

export async function isAdmin(chatId: number | string, env: Env): Promise<boolean> {
  const config = await getTelegramConfig(env)
  return String(chatId) === String(config?.adminChatId || '')
}
