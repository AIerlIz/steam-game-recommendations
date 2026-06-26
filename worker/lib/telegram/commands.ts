import { getTelegramConfig, getChineseNameIndex } from '../kv-keys.js'
import { tgCall, escMd, steamStoreSearch, fetchBatchAppDetails, sendGameDetail, sendSearchResults, isAdmin } from './utils.js'
import { getSession, saveSession } from './session.js'
import { initDB } from '../../db/index.js'

export async function handleSearch(query: string, chatId: number, env: Env): Promise<void> {
  await initDB(env.DB)
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  if (!token) return
  if (query.length < 2) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⚠️ 至少输入 2 个字符' })
    return
  }

  let localResults: { appid?: number; name?: string }[] = []
  if (query.length >= 3) {
    const pattern = `%${query}%`
    const libRows = await env.DB.prepare(
      'SELECT DISTINCT appid, name FROM library WHERE name LIKE ? LIMIT 20'
    ).bind(pattern).all<{ appid: number; name: string }>()
    if (libRows.results) {
      localResults = libRows.results.map(r => ({ appid: r.appid, name: r.name }))
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
    if (isChinese) {
      const idx = await getChineseNameIndex(env)
      const lc = query.toLowerCase()
      const matched = Object.entries(idx).find(([cn]) => cn.toLowerCase() === lc)
      if (matched) {
        const appid = matched[1]
        const [cnMap, enMap] = await Promise.all([
          fetchBatchAppDetails([appid], 'schinese'),
          fetchBatchAppDetails([appid], 'english'),
        ])
        const items = [{ appid, name: (enMap[appid] as { name?: string } | undefined)?.name || query }]
        await sendSearchResults(token, chatId, items, 0, 1)
        await saveSession(env, chatId, { search: { results: items, query, currentPage: 0, totalPages: 1, isSteamSearch: false } })
        await sendGameDetail(token, chatId, appid, cnMap[appid] || { name: query }, enMap[appid] as Record<string, unknown> | undefined, true)
        return
      }
    }
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: `❌ 未找到相关游戏\n💡 试试用英文名搜索`,
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
  await initDB(env.DB)
  const adminUsers = await env.DB.prepare('SELECT id FROM users').all<{ id: string }>()
  let rows: { results?: { appid: number; name: string; reason: string; score: number }[] }
  if ((adminUsers.results || []).length > 0) {
    const uid = adminUsers.results![0].id
    rows = await env.DB.prepare(
      'SELECT appid, name, reason, score FROM recommendations WHERE user_id=? ORDER BY score DESC LIMIT 5'
    ).bind(uid).all<{ appid: number; name: string; reason: string; score: number }>()
  } else {
    rows = { results: [] }
  }
  const games = rows.results || []

  if (!games.length) {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: '📭 暂无推荐，AI 正在分析中，明天再来看看吧',
    })
    return
  }

  let text = `🎯 *今日推荐* \\(${games.length} 款\\)\n\n`
  for (let i = 0; i < games.length; i++) {
    const g = games[i]
    const reason = g.reason || ''
    text += `*${i + 1}\\. ${escMd(g.name)}*\n`
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
  await initDB(env.DB)
  const users = await env.DB.prepare('SELECT id FROM users LIMIT 1').all<{ id: string }>()
  const uid = (users.results || [])[0]?.id
  if (!uid) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 尚未登录 Steam' })
    return
  }
  const rows = await env.DB.prepare(
    'SELECT name, playtime_hours FROM library WHERE user_id=? ORDER BY playtime_hours DESC'
  ).bind(uid).all<{ name: string; playtime_hours: number }>()
  const games = rows.results || []
  if (!games.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 库数据为空' })
    return
  }
  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0)
  const top5 = games.slice(0, 5)
  const lines = top5.map((g, i) => `${i + 1}\\. ${escMd(g.name || '')} — ${(g.playtime_hours || 0).toFixed(1)}h`)
  const text = `📚 *游戏库* \\(${games.length} 款游戏\\)\n⏱ 总时长: ${totalPlaytime.toFixed(0)} 小时\n\n*玩得最多:*\n${lines.join('\n')}`
  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [[{ text: '🏠 主菜单', callback_data: 'menu_main' }]] },
  })
}

export async function cmdStats(token: string, chatId: number, env: Env): Promise<void> {
  await tgCall(token, 'sendChatAction', { chat_id: chatId, action: 'typing' })
  await initDB(env.DB)
  const users = await env.DB.prepare('SELECT id FROM users LIMIT 1').all<{ id: string }>()
  const uid = (users.results || [])[0]?.id
  if (!uid) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 尚未登录 Steam' })
    return
  }
  const libRow = await env.DB.prepare(
    'SELECT COUNT(*) as count, COALESCE(SUM(playtime_hours),0) as hours FROM library WHERE user_id=?'
  ).bind(uid).first<{ count: number; hours: number }>()
  const recRow = await env.DB.prepare(
    'SELECT COUNT(*) as count FROM recommendations WHERE user_id=?'
  ).bind(uid).first<{ count: number }>()
  const libCount = libRow?.count || 0
  const libHours = libRow?.hours || 0
  const recCount = recRow?.count || 0
  const text = `📊 *GameSeeker 统计*\n━━━━━━━━━━━━━━━\n📚 已同步: *${libCount}* 款 \\(${libHours.toFixed(0)}h\\)\n🎯 已推荐: *${recCount}* 款`
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

  const userRow = await env.DB.prepare('SELECT id FROM users WHERE chat_id=?').bind(String(chatId)).first<{ id: string }>()
  const userId = userRow?.id || String(chatId)
  if (!userRow) {
    await env.DB.prepare('INSERT INTO users (id, chat_id) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET chat_id=excluded.chat_id')
      .bind(userId, String(chatId)).run()
  }

  await env.DB.prepare(
    'INSERT INTO subscriptions (user_id, appid, name) VALUES (?, ?, ?) ON CONFLICT(user_id, appid) DO NOTHING'
  ).bind(userId, appid, name).run()

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: `✅ 已订阅 *${escMd(name)}* 的降价通知，降价时将第一时间通知你`,
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: [[{ text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` }]] },
  })
}

export async function cmdUnsubscribe(args: string, chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  const userRow = await env.DB.prepare('SELECT id FROM users WHERE chat_id=?').bind(String(chatId)).first<{ id: string }>()
  const userId = userRow?.id || String(chatId)
  const subs = await env.DB.prepare(
    'SELECT id, appid, name FROM subscriptions WHERE user_id=?'
  ).bind(userId).all<{ id: number; appid: number; name: string }>()
  const subsList = subs.results || []

  if (!subsList.length) {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '📭 暂无订阅' })
    return
  }
  if (!args) {
    const lines = subsList.map((s, i) => `${i + 1}\\. ${escMd(s.name)}`)
    await tgCall(token || '', 'sendMessage', {
      chat_id: chatId, text: `📋 *订阅列表*\n回复编号取消:\n\n${lines.join('\n')}`, parse_mode: 'MarkdownV2',
      reply_markup: { inline_keyboard: [[{ text: '🔔 在列表中管理', callback_data: 'menu_subs' }]] },
    })
    return
  }
  const idx = parseInt(args) - 1
  if (idx >= 0 && idx < subsList.length) {
    const removed = subsList[idx]
    await env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND user_id=?').bind(removed.id, userId).run()
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: `✅ 已取消 *${escMd(removed.name)}*`, parse_mode: 'MarkdownV2' })
  } else {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '❌ 无效编号' })
  }
}

export async function cmdList(chatId: number, env: Env): Promise<void> {
  const config = await getTelegramConfig(env)
  const token = config.token as string | undefined
  const userRow = await env.DB.prepare('SELECT id FROM users WHERE chat_id=?').bind(String(chatId)).first<{ id: string }>()
  const userId = userRow?.id || String(chatId)
  const subs = await env.DB.prepare('SELECT appid, name FROM subscriptions WHERE user_id=?')
    .bind(userId).all<{ appid: number; name: string }>()
  const subsList = subs.results || []
  if (!subsList.length) {
    await tgCall(token || '', 'sendMessage', { chat_id: chatId, text: '📭 你还没有订阅任何游戏\n使用 /subscribe 游戏名 来添加' })
    return
  }
  const appids = subsList.map(s => s.appid)
  const cnMap = await fetchBatchAppDetails(appids, 'schinese')
  const keyboard = subsList.map((s, i) => {
    const d = cnMap[s.appid]
    const price = d?.price_overview as { final?: number; discount_percent?: number } | undefined
    const discount = price?.discount_percent && price.discount_percent > 0 ? ` 🔥-${price.discount_percent}%` : ''
    const label = `${s.name}${discount}`.length > 40 ? `${s.name.slice(0, 35)}…${discount}` : `${s.name}${discount}`
    return [{ text: `🔕 ${label}`, callback_data: `unsub_${i}` }]
  })
  keyboard.push([{ text: '🏠 主菜单', callback_data: 'menu_main' }])
  await tgCall(token || '', 'sendMessage', {
    chat_id: chatId, text: `📋 *我的订阅* \\(${subsList.length}\\)\n点击项目退订`, parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: keyboard },
  })
}

async function runPipeline(action: string, chatId: number, env: Env, token: string): Promise<void> {
  try {
    if (action === 'recommend') {
      const { recommendForAllUsers } = await import('../deepsteam.js')
      const results = await recommendForAllUsers(env)
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: `✅ 推荐管线完成 (${results.length} 用户)` })
    } else if (action === 'library') {
      const { syncAllUsers } = await import('../../scripts/fetch-library.js')
      const results = await syncAllUsers(env)
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: `✅ 库同步完成 (${results.length} 用户)` })
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
    const userRow = await env.DB.prepare('SELECT id FROM users WHERE chat_id=?').bind(String(chatId)).first<{ id: string }>()
    const userId = userRow?.id || String(chatId)
    await env.DB.prepare(
      'INSERT INTO subscriptions (user_id, appid, name) VALUES (?, ?, ?) ON CONFLICT(user_id, appid) DO NOTHING'
    ).bind(userId, appid, '通过搜索添加').run()
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '✅ 已订阅降价通知' })
    return
  }

  // unsub_{index} — unsubscribe from list by index
  if (data.startsWith('unsub_')) {
    const idx = parseInt(data.replace('unsub_', ''))
    const userRow = await env.DB.prepare('SELECT id FROM users WHERE chat_id=?').bind(String(chatId)).first<{ id: string }>()
    const userId = userRow?.id || String(chatId)
    const subs = await env.DB.prepare('SELECT id, name FROM subscriptions WHERE user_id=? ORDER BY added_at')
      .bind(userId).all<{ id: number; name: string }>()
    const subsList = subs.results || []
    if (idx >= 0 && idx < subsList.length) {
      const removed = subsList[idx]
      await env.DB.prepare('DELETE FROM subscriptions WHERE id=? AND user_id=?').bind(removed.id, userId).run()
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: `✅ 已取消 ${removed.name}` })
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
