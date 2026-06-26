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
    return resp.json() as Promise<{ items?: { id: number; name: string; type: string }[] }>
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
  showBack = false,
): Promise<void> {
  const cnName = String(cn?.name || '未知')
  const enName = String(en?.name || cnName)
  const displayName = cnName !== enName ? `${cnName} (${enName})` : cnName

  const price = cn?.price_overview as { currency?: string; initial?: number; final?: number; discount_percent?: number } | undefined
  const priceText = price
    ? price.discount_percent && price.discount_percent > 0
      ? `~~¥${((price.initial || 0) / 100).toFixed(0)}~~ **¥${((price.final || 0) / 100).toFixed(0)}** \\-${price.discount_percent}% 🔥`
      : `¥${((price.final || 0) / 100).toFixed(0)}`
    : '价格未知'

  const releaseDate = String((cn?.release_date as { date?: string })?.date || '未知')
  const desc = String((cn?.short_description as string) || (en?.short_description as string) || '暂无简介')
  const trimmedDesc = desc.length > 300 ? `${desc.slice(0, 300)}…` : desc

  const genres = (cn?.genres as string[]) || (en?.genres as string[]) || []
  const tagsText = genres.slice(0, 5).join(' · ')

  const reviewScore = (cn?.review_score as number) || (cn?.metacritic as { score?: number })?.score || 0
  const ratingText = reviewScore ? `⭐ ${(reviewScore / 10).toFixed(1)}` : ''

  const lines = [
    `🎮 *${escMd(displayName)}*`,
    `📅 ${escMd(releaseDate)} · 💰 ${priceText} ${ratingText ? `· ${ratingText}` : ''}`,
  ]
  if (tagsText) lines.push(`🏷️ ${escMd(tagsText)}`)
  lines.push(`📝 ${escMd(trimmedDesc)}`)
  const text = lines.join('\n')

  const photoUrl = String(cn?.header_image || '')

  const keyboard = [
    [
      { text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` },
      { text: '🔔 订阅降价', callback_data: `sub_${appid}` },
    ],
  ]
  if (showBack) {
    keyboard.push([{ text: '◀️ 返回搜索结果', callback_data: 'back_search' }])
  }

  const replyMarkup = { inline_keyboard: keyboard }

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

export async function sendSearchResults(
  token: string,
  chatId: number,
  items: { appid: number; name: string }[],
  page: number,
  totalPages: number,
): Promise<void> {
  const startIdx = page * 5
  const pageItems = items.slice(startIdx, startIdx + 5)

  const keyboard = pageItems.map(item => [
    { text: item.name.length > 40 ? `${item.name.slice(0, 38)}…` : item.name, callback_data: `detail_${item.appid}` },
  ])

  if (totalPages > 1) {
    const nav: { text: string; callback_data: string }[] = []
    if (page > 0) nav.push({ text: '◀️ 上一页', callback_data: `srch_${page - 1}` })
    nav.push({ text: `📄 ${page + 1}/${totalPages}`, callback_data: 'page_info' })
    if (page < totalPages - 1) nav.push({ text: '▶️ 下一页', callback_data: `srch_${page + 1}` })
    keyboard.push(nav)
  }

  keyboard.push([{ text: '🏠 主菜单', callback_data: 'menu_main' }])

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: `🔍 找到 ${String(items.length)} 个游戏（第 ${String(page + 1)}/${String(totalPages)} 页）：`,
    reply_markup: { inline_keyboard: keyboard },
  })
}

export async function isAdmin(chatId: number | string, env: Env): Promise<boolean> {
  const config = await getTelegramConfig(env)
  return String(chatId) === String(config?.adminChatId || '')
}
