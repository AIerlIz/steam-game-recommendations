import { KV_KEYS, getTelegramConfig } from '../steam.js'
import { tgCall, escMd, steamStoreSearch, fetchBatchAppDetails, searchLocal, sendGameDetail, sendSearchResults, isAdmin } from './utils.js'
import { getSession, saveSession } from './session.js'

export async function handleSearch(query: string, chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token) return
  if (query.length < 2) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⚠️ 至少输入 2 个字符' })
    return
  }

  let localResults: { appid?: number; name?: string }[] = []
  if (query.length >= 3) {
    const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: { name?: string; appid?: number }[] } | null
    const allGames = detailData?.games || []
    localResults = searchLocal(allGames, query)

    // also search user's library (has Chinese names from fill-details)
    const libData = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as { games?: { name?: string; appid?: number }[] } | null
    if (libData?.games) {
      for (const g of libData.games) {
        if (g.name && g.appid && !localResults.some(r => r.appid === g.appid)) {
          const lowered = g.name.toLowerCase()
          if (lowered.includes(query.toLowerCase())) {
            localResults.push({ appid: g.appid, name: g.name })
          }
        }
      }
    }
  }

  if (localResults.length > 0 && localResults.length <= 8) {
    const items = localResults.map(g => ({ appid: g.appid ?? 0, name: g.name || '' })).filter(i => i.appid > 0)
    const [cnMap, enMap] = await Promise.all([
      fetchBatchAppDetails(items.map(i => i.appid), 'schinese'),
      fetchBatchAppDetails(items.map(i => i.appid), 'english'),
    ])

    const totalPages = Math.ceil(items.length / 5)
    await sendSearchResults(token, chatId, items, 0, totalPages)
    await saveSession(env, chatId, {
      search: { results: items, query, currentPage: 0, totalPages, isSteamSearch: false },
    })

    if (items.length === 1) {
      const g = items[0]
      const cn = cnMap[g.appid] || g
      const en = enMap[g.appid]
      await sendGameDetail(token, chatId, g.appid, cn, en, true)
    }
    return
  }

  const isChinese = /[\u4e00-\u9fff]/.test(query)
  let searchLang = isChinese ? 'schinese' : 'english'
  let searchResult = await steamStoreSearch(query, searchLang)

  if (!searchResult.items?.length) {
    const altLang = isChinese ? 'english' : 'schinese'
    searchResult = await steamStoreSearch(query, altLang)
    searchLang = altLang
  }

  if (!searchResult.items?.length) {
    const hint = isChinese ? '\n💡 试试用英文名搜索，例如 Terraria → terraria' : ''
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: `❌ 未找到相关游戏${hint}`,
    })
    return
  }

  const rawItems = searchResult.items.slice(0, 20)
  const items = rawItems.map(i => ({ appid: i.id, name: i.name || '' }))
  const appids = items.map(i => i.appid)
  const [cnMap, enMap] = await Promise.all([
    fetchBatchAppDetails(appids, 'schinese'),
    fetchBatchAppDetails(appids, 'english'),
  ])

  const totalPages = Math.ceil(items.length / 5)
  await sendSearchResults(token, chatId, items, 0, totalPages)
  await saveSession(env, chatId, {
    search: { results: items, query, currentPage: 0, totalPages, isSteamSearch: true },
  })

  if (items.length === 1) {
    const item = items[0]
    const cn = cnMap[item.appid]
    const en = enMap[item.appid]
    await sendGameDetail(token, chatId, item.appid, cn, en, true)
  }
}

export async function cmdStart(token: string, chatId: number): Promise<void> {
  const text = `🤖 *GameSeeker Bot*

🎮 搜索 Steam 游戏、获取 AI 推荐、订阅降价通知`
  const keyboard = [
    [{ text: '🎮 搜索游戏', callback_data: 'menu_search' }],
    [{ text: '🎯 今日推荐', callback_data: 'menu_recommend' }],
    [{ text: '📚 我的游戏库', callback_data: 'menu_library' }],
    [{ text: '📊 统计信息', callback_data: 'menu_stats' }],
    [{ text: '🔔 订阅管理', callback_data: 'menu_subs' }],
  ]
  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: keyboard },
  })
}

export async function cmdRecommend(token: string, chatId: number, env: Env): Promise<void> {
  await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
  const gamesData = await env.KV.get(KV_KEYS.DATA_GAMES, 'json') as { games?: { appid?: number; reason?: string; score?: number }[] } | null
  const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: { appid?: number; name?: string }[] } | null
  const games = gamesData?.games || []
  const details = detailData?.games || []

  if (!games.length) {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: '📭 暂无推荐，AI 正在分析中，明天再来看看吧',
    })
    return
  }

  const detailMap: Record<number, { name?: string }> = {}
  for (const d of details) detailMap[Number(d.appid)] = d

  let text = `🎯 *今日推荐* \\(${games.length} 款\\)\n\n`
  for (let i = 0; i < Math.min(games.length, 5); i++) {
    const g = games[i]
    const d = detailMap[Number(g.appid)]
    const name = d?.name || `appid: ${g.appid}`
    const reason = g.reason || ''
    text += `*${i + 1}\\. ${escMd(name)}*\n`
    if (reason) text += `💡 ${escMd(reason)}\n`
    text += `\n`
  }

  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [[{ text: '🏠 主菜单', callback_data: 'menu_main' }]] },
  })
}

export async function cmdLibrary(token: string, chatId: number, env: Env): Promise<void> {
  await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
  const data = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as { games?: { appid?: number; name?: string; playtime_hours?: number; genres?: string[] }[] } | null
  const games = data?.games || []
  if (!games.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 库数据为空' })
    return
  }

  const totalPlaytime = (games as { playtime_hours?: number }[]).reduce((s: number, g) => s + (g.playtime_hours || 0), 0)
  const top5 = [...games].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 5)

  const lines = top5.map((g, i) =>
    `${i + 1}\\. ${escMd(g.name || '')} — ${(g.playtime_hours || 0).toFixed(1)}h`
  )

  const text = `📚 *游戏库* \\(${games.length} 款游戏\\)
⏱ 总时长: ${totalPlaytime.toFixed(0)} 小时

*玩得最多:*
${lines.join('\n')}`

  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [[{ text: '🏠 主菜单', callback_data: 'menu_main' }]] },
  })
}

export async function cmdStats(token: string, chatId: number, env: Env): Promise<void> {
  await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
  const gamesData = await env.KV.get(KV_KEYS.DATA_GAMES, 'json') as Record<string, unknown> | null
  const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as Record<string, unknown> | null
  const libData = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as Record<string, unknown> | null

  const totalOwned = (gamesData?.total_owned as number) || 0
  const recCount = ((gamesData?.games) as unknown[])?.length || 0
  const detailCount = ((detailData?.games) as unknown[])?.length || 0
  const libCount = ((libData?.games) as unknown[])?.length || 0
  const libHours = (libData?.total_playtime_hours as number) || 0

  const text = `📊 *GameSeeker 统计*
━━━━━━━━━━━━━━━
🎮 Steam 库: *${totalOwned}* 款
📚 已同步: *${libCount}* 款 \\(${libHours.toFixed(0)}h\\)
🎯 已推荐: *${recCount}* 款
📋 含详情: *${detailCount}* 款`

  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [[{ text: '🏠 主菜单', callback_data: 'menu_main' }]] },
  })
}

export async function cmdSubscribe(args: string, chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token || !args) {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '请指定游戏名，如 /subscribe 黑神话:悟空' })
    return
  }

  const searchResult = await steamStoreSearch(args, 'schinese')
  if (!searchResult.items?.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '❌ 未找到该游戏' })
    return
  }

  const appid = searchResult.items[0].id
  const name = searchResult.items[0].name

  const key = KV_KEYS.subKey(chatId)
  const subs: { appid: number; name: string; added: number }[] = (await env.KV.get(key, 'json') as { appid: number; name: string; added: number }[] | null) || []

  if (subs.some(s => s.appid === appid)) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `✅ 已订阅过 *${escMd(name)}*`, parse_mode: 'MarkdownV2' })
    return
  }

  subs.push({ appid, name, added: Date.now() })
  await env.KV.put(key, JSON.stringify(subs))

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: `✅ 已订阅 *${escMd(name)}* 的降价通知，降价时将第一时间通知你`,
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[{ text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` }]],
    },
  })
}

export async function cmdUnsubscribe(args: string, chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  const key = KV_KEYS.subKey(chatId)
  const subs: { appid: number; name: string; added: number }[] = (await env.KV.get(key, 'json') as { appid: number; name: string; added: number }[] | null) || []

  if (!subs.length) {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '📭 暂无订阅' })
    return
  }

  if (!args) {
    const lines = subs.map((s, i) => `${i + 1}\\. ${escMd(s.name)}`)
    await tgCall(token || '', 'sendMessage', {
      chat_id: chatId,
      text: `📋 *订阅列表*\n回复编号取消:\n\n${lines.join('\n')}`,
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [[{ text: '🔔 在列表中管理', callback_data: 'menu_subs' }]],
      },
    })
    return
  }

  const idx = parseInt(args) - 1
  if (idx >= 0 && idx < subs.length) {
    const removed = subs.splice(idx, 1)
    await env.KV.put(key, JSON.stringify(subs))
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: `✅ 已取消 *${escMd(removed[0].name)}*`, parse_mode: 'MarkdownV2' })
  } else {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '❌ 无效编号' })
  }
}

export async function cmdList(chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  const subs: { appid: number; name: string }[] = (await env.KV.get(KV_KEYS.subKey(chatId), 'json') as { appid: number; name: string }[] | null) || []

  if (!subs.length) {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '📭 你还没有订阅任何游戏\n使用 /subscribe 游戏名 来添加' })
    return
  }

  const appids = subs.map(s => s.appid)
  const cnMap = await fetchBatchAppDetails(appids, 'schinese')

  const keyboard = subs.map((s, i) => {
    const d = cnMap[s.appid]
    const price = d?.price_overview as { final?: number; discount_percent?: number } | undefined
    const discount = price?.discount_percent && price.discount_percent > 0 ? ` 🔥-${price.discount_percent}%` : ''
    const label = `${s.name}${discount}`.length > 40
      ? `${s.name.slice(0, 35)}…${discount}`
      : `${s.name}${discount}`
    return [{ text: `🔕 ${label}`, callback_data: `unsub_${i}` }]
  })
  keyboard.push([{ text: '🏠 主菜单', callback_data: 'menu_main' }])

  await tgCall(token || '', 'sendMessage', {
    chat_id: chatId,
    text: `📋 *我的订阅* \\(${subs.length}\\)\n点击项目退订`,
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function runPipeline(action: string, chatId: number, env: Env, token: string): Promise<void> {
  try {
    if (action === 'recommend') {
      const { recommend } = await import('../deepsteam.js')
      const { fetchSteam } = await import('../../scripts/fetch-steam.js')
      await recommend(env)
      await fetchSteam(env)
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 推荐管线完成' })
    } else if (action === 'library') {
      const { fetchLibrary } = await import('../../scripts/fetch-library.js')
      const { fillDetails } = await import('../../scripts/fill-details.js')
      await fetchLibrary(env)
      await fillDetails(env)
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 库同步完成' })
    }
  } catch (e) {
    console.error(`${action} 管线失败:`, e)
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `❌ 失败: ${(e as Error).message}` })
  }
}

export async function cmdRun(action: string, chatId: number, env: Env, ctx: { waitUntil?: (p: Promise<void>) => void }): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token) return
  if (!(await isAdmin(chatId, env))) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⛔ 仅管理员可用' })
    return
  }

  if (action === 'recommend') {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⏳ 开始推荐管线，后台执行中...' })
    const task = runPipeline('recommend', chatId, env, token)
    if (ctx?.waitUntil) ctx.waitUntil(task)
    else await task
  } else if (action === 'library') {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⏳ 开始库同步，后台执行中...' })
    const task = runPipeline('library', chatId, env, token)
    if (ctx?.waitUntil) ctx.waitUntil(task)
    else await task
  } else {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: '⚙️ *管理面板*',
      parse_mode: 'MarkdownV2',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🤖 推荐管线', callback_data: 'run_recommend' }],
          [{ text: '📦 库同步', callback_data: 'run_library' }],
        ],
      },
    })
  }
}

export async function handleCallbackQuery(cb: { data?: string; id?: string; message?: { chat?: { id?: number }; message_id?: number } }, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token) return
  // always answer callback query FIRST so Telegram stops the spinner
  if (cb.id) {
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {})
  }

  const data = cb.data || ''
  const chatId = cb.message?.chat?.id
  const msgId = cb.message?.message_id
  if (!chatId) return

  // detail_{appid} — show game detail
  if (data.startsWith('detail_')) {
    const appid = parseInt(data.replace('detail_', ''))
    try {
      const [cnMap, enMap] = await Promise.all([
        fetchBatchAppDetails([appid], 'schinese'),
        fetchBatchAppDetails([appid], 'english'),
      ])
      await sendGameDetail(token, chatId, appid, cnMap[appid], enMap[appid], true)
    } catch (e) {
      console.error('detail error:', appid, e)
      await sendGameDetail(token, chatId, appid, null, null, true)
    }
    return
  }

  // sub_{appid} — subscribe
  if (data.startsWith('sub_')) {
    const appid = parseInt(data.replace('sub_', ''))
    if (!appid) return
    const key = KV_KEYS.subKey(chatId)
    const subs: { appid: number; name: string; added: number }[] = (await env.KV.get(key, 'json') as { appid: number; name: string; added: number }[] | null) || []
    if (subs.some(s => s.appid === appid)) {
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '已订阅过' })
      return
    }
    subs.push({ appid, name: '通过搜索添加', added: Date.now() })
    await env.KV.put(key, JSON.stringify(subs))
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '✅ 已订阅降价通知' })
    return
  }

  // unsub_{index} — unsubscribe from list by index
  if (data.startsWith('unsub_')) {
    const idx = parseInt(data.replace('unsub_', ''))
    const key = KV_KEYS.subKey(chatId)
    const subs: { appid: number; name: string }[] = (await env.KV.get(key, 'json') as { appid: number; name: string }[] | null) || []
    if (idx >= 0 && idx < subs.length) {
      const removed = subs[idx]
      subs.splice(idx, 1)
      await env.KV.put(key, JSON.stringify(subs))
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: `✅ 已取消 ${removed.name}` })
      // refresh the list message
      await cmdList(chatId, env)
    } else {
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '无效索引' })
    }
    return
  }

  // srch_{page} — pagination
  if (data.startsWith('srch_')) {
    const page = parseInt(data.replace('srch_', ''))
    const session = await getSession(env, chatId)
    if (!session.search) return
    session.search.currentPage = page
    await saveSession(env, chatId, session)
    // edit existing message
    const startIdx = page * 5
    const pageItems = session.search.results.slice(startIdx, startIdx + 5)
    const totalPages = session.search.totalPages
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
    await tgCall(token, 'editMessageText', {
      chat_id: chatId,
      message_id: msgId,
      text: `🔍 找到 ${String(session.search.results.length)} 个游戏（第 ${String(page + 1)}/${String(totalPages)} 页）：`,
      reply_markup: { inline_keyboard: keyboard },
    })
    return
  }

  // back_search — return to search results
  if (data === 'back_search') {
    const session = await getSession(env, chatId)
    if (!session.search) {
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '搜索已过期，请重新搜索' })
      return
    }
    const { currentPage, totalPages } = session.search
    await sendSearchResults(token, chatId, session.search.results, currentPage, totalPages)
    return
  }

  // run_recommend / run_library — pipeline from inline keyboard
  if (data.startsWith('run_')) {
    const action = data.replace('run_', '')
    await cmdRun(action, chatId, env, {})
    return
  }

  // menu_* — main menu navigation
  if (data.startsWith('menu_')) {
    const action = data.replace('menu_', '')
    switch (action) {
      case 'main':
      case 'start':
        await cmdStart(token, chatId)
        break
      case 'search':
        await tgCall(token, 'sendMessage', { chat_id: chatId, text: '输入游戏名开始搜索，或使用 /search 游戏名' })
        break
      case 'recommend':
        await cmdRecommend(token, chatId, env)
        break
      case 'library':
        await cmdLibrary(token, chatId, env)
        break
      case 'stats':
        await cmdStats(token, chatId, env)
        break
      case 'subs':
        await cmdList(chatId, env)
        break
      case 'admin':
        if (await isAdmin(chatId, env)) {
          await cmdRun('', chatId, env, { waitUntil: undefined })
        }
        break
    }
    return
  }

  // page_info — just acknowledge
  if (data === 'page_info') {
    return
  }

  await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '未知操作' })
}
