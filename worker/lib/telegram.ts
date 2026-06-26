import { KV_KEYS, getTelegramConfig } from './steam.js'
import { tgCall, escMd, fetchBatchAppDetails, sendGameDetail } from './telegram/utils.js'
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
import { getSession } from './telegram/session.js'

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

  // forward chatAction for commands that may be slow
  const parts = text.split(/\s+/)
  const cmd = parts[0].toLowerCase()
  const args = parts.slice(1).join(' ')

  // /search command
  if (cmd === '/search') {
    if (!args) {
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '使用方式: /search 游戏名' })
      return new Response('OK')
    }
    await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
    await handleSearch(args, chatId, env)
    return new Response('OK')
  }

  // non-command text → implicit search
  if (!cmd.startsWith('/')) {
    await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
    await handleSearch(text, chatId, env)
    return new Response('OK')
  }

  // /start → inline keyboard menu
  if (cmd === '/start') {
    await cmdStart(token, chatId)
    return new Response('OK')
  }

  // numeric reply — fallback for old search results
  if (/^\d+$/.test(text) && !text.startsWith('/')) {
    const session = await getSession(env, chatId)
    if (session.search) {
      const num = parseInt(text)
      const results = session.search.results
      if (num >= 1 && num <= results.length) {
        const selected = results[num - 1]
        const [cnMap, enMap] = await Promise.all([
          fetchBatchAppDetails([selected.appid], 'schinese'),
          fetchBatchAppDetails([selected.appid], 'english'),
        ])
        await sendGameDetail(token, chatId, selected.appid, cnMap[selected.appid], enMap[selected.appid], true)
        return new Response('OK')
      }
    }
  }

  switch (cmd) {
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
    const d = detailMap[Number(g.appid)]
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
            reply_markup: {
              inline_keyboard: [[
                { text: '🔗 Steam', url: `https://store.steampowered.com/app/${sub.appid}/` },
                { text: '🔕 退订', callback_data: `unsub_${subs.indexOf(sub)}` },
              ]],
            },
          })

          notified[String(sub.appid)] = price.final as number
        }
      }
    }

    await env.KV.put(notifiedKey, JSON.stringify(notified))
  }
}
