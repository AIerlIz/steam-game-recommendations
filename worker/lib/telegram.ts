import { KV_KEYS, getTelegramConfig } from './steam.js'
import { tgCall, escMd, fetchBatchAppDetails } from './telegram/utils.js'
import {
  handleSearch,
  cmdStart,
  cmdRecommend,
  cmdLibrary,
  cmdStats,
  cmdSubscribe,
  cmdUnsubscribe,
  cmdList,
  cmdRun,
  handleCallbackQuery,
} from './telegram/commands.js'

export async function handleWebhook(request: Request, env: Env, ctx: { waitUntil?: (p: Promise<void>) => void }): Promise<Response> {
  const token = (await getTelegramConfig(env)).token as string | undefined
  if (!token) return new Response('Bot not configured', { status: 200 })

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const update: { callback_query?: Record<string, unknown>; message?: { chat?: { id?: number }; text?: string } } = await request.json()

  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env)
    return new Response('OK')
  }

  const msg = update.message
  if (!msg?.text) return new Response('OK')

  const chatId = msg.chat?.id
  if (!chatId) return new Response('OK')
  const text = msg.text.trim()

  if (/^\d+$/.test(text) && !text.startsWith('/')) {
    const num = parseInt(text)
    const lastSearchKey = KV_KEYS.lastSearchKey(chatId)
    const lastSearch: { results?: { appid: number; name: string }[] } | null = await env.KV.get(lastSearchKey, 'json')
    if (lastSearch?.results && num >= 1 && num <= lastSearch.results.length) {
      const selected = lastSearch.results[num - 1]
      const appid = selected.appid
      const [cnMap, enMap] = await Promise.all([
        fetchBatchAppDetails([appid], 'schinese'),
        fetchBatchAppDetails([appid], 'english'),
      ])
      const { sendGameDetail } = await import('./telegram/utils.js')
      await sendGameDetail(token, chatId, appid, cnMap[appid], enMap[appid])
      return new Response('OK')
    }
  }

  const parts = text.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')

  if (cmd === '/search') {
    if (!args) {
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '使用方式: /search 游戏名' })
      return new Response('OK')
    }
    await handleSearch(args, chatId, env)
    return new Response('OK')
  }

  if (!cmd.startsWith('/')) {
    await handleSearch(text, chatId, env)
    return new Response('OK')
  }

  switch (cmd) {
    case '/start':
      await cmdStart(token, chatId)
      break
    case '/recommend':
      await cmdRecommend(token, chatId, env)
      break
    case '/library':
      await cmdLibrary(token, chatId, env)
      break
    case '/stats':
      await cmdStats(token, chatId, env)
      break
    case '/subscribe':
      await cmdSubscribe(args, chatId, env)
      break
    case '/unsubscribe':
      await cmdUnsubscribe(args, chatId, env)
      break
    case '/list':
      await cmdList(chatId, env)
      break
    case '/run':
      await cmdRun(args, chatId, env, ctx)
      break
    default:
      await tgCall(token, 'sendMessage', {
        chat_id: chatId, text: '❓ 未知命令，发送 /start 查看可用命令',
      })
  }

  return new Response('OK')
}

export async function notify(env: Env, text: string): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  const adminChatId = config.adminChatId as string | undefined
  if (!token || !adminChatId) return
  await tgCall(token, 'sendMessage', {
    chat_id: parseInt(adminChatId),
    text,
    parse_mode: 'MarkdownV2',
  })
}

export async function notifyRecommendResult(env: Env, count: number): Promise<void> {
  const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: { appid?: number; name?: string }[] } | null
  const details = detailData?.games || []
  const detailMap: Record<number, { name?: string }> = {}
  for (const d of details) detailMap[Number(d.appid)] = d

  const gamesData = await env.KV.get(KV_KEYS.DATA_GAMES, 'json') as { games?: { appid?: number; reason?: string; score?: number }[] } | null
  const newGames = gamesData?.games || []

  let text = `🤖 *每日推荐完成*`
  if (count > 0) text += `  — 新增 *${count}* 款\n\n`

  for (let i = 0; i < Math.min(newGames.length, 3); i++) {
    const g = newGames[i]
    const d = detailMap[g.appid ?? 0]
    const name = d?.name || `appid: ${g.appid}`
    text += `*${i + 1}\\. ${escMd(name)}*\n`
    if (g.reason) text += `💡 ${escMd(g.reason)}\n`
    text += `\n`
  }

  text += `📊 推荐总数: ${newGames.length} 款`
  await notify(env, text)
}

export async function notifyLibraryResult(env: Env, count: number, hours: number): Promise<void> {
  const text = `📚 *库同步完成*
同步: *${count}* 款游戏
时长: *${hours.toFixed(0)}* 小时`
  await notify(env, text)
}

export async function checkDiscounts(env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token) return

  const list = await env.KV.list({ prefix: KV_KEYS.SUB_PREFIX })
  const subKeys = list.keys.filter(k => !k.name.includes(KV_KEYS.NOTIFIED_SUFFIX))

  for (const { name: key } of subKeys) {
    const chatId = parseInt(key.replace(KV_KEYS.SUB_PREFIX, ''))
    const subs: { appid: number; name: string }[] = (await env.KV.get(key, 'json') as { appid: number; name: string }[] | null) || []
    if (!subs.length) continue

    const appids = subs.map(s => s.appid)
    const cnMap = await fetchBatchAppDetails(appids, 'schinese')

    const notifiedKey = KV_KEYS.notifiedKey(key)
    const notified: Record<string, number> = (await env.KV.get(notifiedKey, 'json') as Record<string, number> | null) || {}

    for (const sub of subs) {
      const d = cnMap[sub.appid]
      if (!d?.price_overview) continue

      const price = d.price_overview as { discount_percent?: number; initial?: number; final?: number }
      if ((price.discount_percent || 0) > 0 && (price.final || 0) < (price.initial || 0)) {
        const lastPrice = notified[String(sub.appid)]

        if (lastPrice !== price.final) {
          const discountText = `-${price.discount_percent}% 🔥`
          const newPrice = `¥${((price.final || 0) / 100).toFixed(0)}`
          const oldPrice = lastPrice ? `¥${((lastPrice || 0) / 100).toFixed(0)} → ` : ''

          const msg = `🔥 *降价提醒* \\(${escMd(sub.name)}\\)
          
💰 *${oldPrice}${newPrice}* ${discountText}

[查看 Steam](https://store.steampowered.com/app/${sub.appid}/)`

          await tgCall(token, 'sendMessage', {
            chat_id: chatId,
            text: msg,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: false,
          })

          notified[String(sub.appid)] = price.final as number
        }
      }
    }

    await env.KV.put(notifiedKey, JSON.stringify(notified))
  }
}
