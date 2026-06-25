import { KV_KEYS } from '../steam.js';
import { tgCall, escMd, steamStoreSearch, fetchBatchAppDetails, searchLocal, sendGameDetail, sendGameList, isAdmin } from './utils.js';

export async function handleSearch(query, chatId, env) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  if (!token) return;
  if (query.length < 2) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⚠️ 至少输入 2 个字符' });
    return;
  }

  let localResults = [];
  if (query.length >= 3) {
    const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json');
    const allGames = detailData?.games || [];
    localResults = searchLocal(allGames, query);
  }

  if (localResults.length > 0 && localResults.length <= 8) {
    const appids = localResults.map(g => g.appid);
    const [cnMap, enMap] = await Promise.all([
      fetchBatchAppDetails(appids, 'schinese'),
      fetchBatchAppDetails(appids, 'english'),
    ]);

    await env.KV.put(KV_KEYS.lastSearchKey(chatId), JSON.stringify({
      results: localResults.map(g => ({ appid: g.appid, name: g.name })),
    }), { expirationTtl: 600 });

    if (localResults.length === 1) {
      const g = localResults[0];
      const cn = cnMap[g.appid] || g;
      const en = enMap[g.appid];
      await sendGameDetail(token, chatId, g.appid, cn, en);
    } else {
      await sendGameList(token, chatId, localResults, query, cnMap, enMap);
    }
    return;
  }

  const isChinese = /[\u4e00-\u9fff]/.test(query);
  let searchLang = isChinese ? 'schinese' : 'english';
  let searchResult = await steamStoreSearch(query, searchLang);

  if (!searchResult.items?.length && isChinese) {
    searchResult = await steamStoreSearch(query, 'english');
    searchLang = 'english';
  }
  if (!searchResult.items?.length && !isChinese) {
    searchResult = await steamStoreSearch(query, 'schinese');
    searchLang = 'schinese';
  }

  if (!searchResult.items?.length) {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: '❌ 未找到相关游戏，换个关键词试试',
    });
    return;
  }

  const items = searchResult.items.slice(0, 8);
  const appids = items.map(i => i.id);
  const [cnMap, enMap] = await Promise.all([
    fetchBatchAppDetails(appids, 'schinese'),
    fetchBatchAppDetails(appids, 'english'),
  ]);

  await env.KV.put(KV_KEYS.lastSearchKey(chatId), JSON.stringify({
    results: items.map(i => ({ appid: i.id, name: i.name })),
  }), { expirationTtl: 600 });

  if (items.length === 1) {
    const item = items[0];
    const cn = cnMap[item.id];
    const en = enMap[item.id];
    await sendGameDetail(token, chatId, item.id, cn, en);
  } else {
    await sendGameList(token, chatId, items, query, cnMap, enMap, true);
  }
}

export async function cmdStart(token, chatId) {
  const text = `🤖 *GameSeeker Bot*

查询 Steam 游戏信息、接收推荐和降价通知

*命令*
/search \\(关键词\\) — 搜索游戏
/recommend — 今日推荐
/library — 库概况
/stats — 统计
/subscribe \\(游戏名\\) — 订阅降价
/unsubscribe \\(游戏名\\) — 取消订阅
/list — 我的订阅

*管理员*
/run recommend — 触发推荐管线
/run library — 触发库同步`;
  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
  });
}

export async function cmdRecommend(token, chatId, env) {
  const gamesData = await env.KV.get(KV_KEYS.DATA_GAMES, 'json');
  const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json');
  const games = gamesData?.games || [];
  const details = detailData?.games || [];

  if (!games.length) {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: '📭 暂无推荐，AI 正在分析中，明天再来看看吧',
    });
    return;
  }

  const detailMap = {};
  for (const d of details) detailMap[d.appid] = d;

  let text = `🎯 *今日推荐* \\(${games.length} 款\\)\n\n`;
  const keyboard = [];

  for (let i = 0; i < Math.min(games.length, 5); i++) {
    const g = games[i];
    const d = detailMap[g.appid];
    const name = d?.name || `appid: ${g.appid}`;
    const reason = g.reason || '';
    text += `*${i + 1}\\. ${escMd(name)}*\n`;
    if (reason) text += `💡 ${escMd(reason)}\n`;
    text += `\n`;
    keyboard.push([{ text: `🔗 ${name}`, url: `https://store.steampowered.com/app/${g.appid}/` }]);
  }

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
    reply_markup: { inline_keyboard: keyboard.slice(0, 3) },
  });
}

export async function cmdLibrary(token, chatId, env) {
  const data = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json');
  const games = data?.games || [];
  if (!games.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 库数据为空' });
    return;
  }

  const totalPlaytime = games.reduce((s, g) => s + (g.playtime_hours || 0), 0);
  const top5 = [...games].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 5);

  const lines = top5.map((g, i) =>
    `${i + 1}\\. ${escMd(g.name)} — ${g.playtime_hours.toFixed(1)}h`
  );

  const text = `📚 *游戏库* \\(${games.length} 款游戏\\)
⏱ 总时长: ${totalPlaytime.toFixed(0)} 小时

*玩得最多:*
${lines.join('\n')}`;

  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
  });
}

export async function cmdStats(token, chatId, env) {
  const [gamesData, detailData, libData] = await Promise.all([
    env.KV.get(KV_KEYS.DATA_GAMES, 'json'),
    env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json'),
    env.KV.get(KV_KEYS.DATA_LIBRARY, 'json'),
  ]);

  const totalOwned = gamesData?.total_owned || 0;
  const recCount = gamesData?.games?.length || 0;
  const detailCount = detailData?.games?.length || 0;
  const libCount = libData?.games?.length || 0;
  const libHours = libData?.total_playtime_hours || 0;

  const text = `📊 *GameSeeker 统计*
━━━━━━━━━━━━━━━
🎮 Steam 库: *${totalOwned}* 款
📚 已同步: *${libCount}* 款 \\(${libHours.toFixed(0)}h\\)
🎯 已推荐: *${recCount}* 款
📋 含详情: *${detailCount}* 款`;

  await tgCall(token, 'sendMessage', {
    chat_id: chatId, text, parse_mode: 'MarkdownV2',
  });
}

export async function cmdSubscribe(args, chatId, env) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  if (!token || !args) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '请指定游戏名，如 /subscribe 黑神话:悟空' });
    return;
  }

  const searchResult = await steamStoreSearch(args, 'schinese');
  if (!searchResult.items?.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '❌ 未找到该游戏' });
    return;
  }

  const appid = searchResult.items[0].id;
  const name = searchResult.items[0].name;

  const key = KV_KEYS.subKey(chatId);
  const subs = (await env.KV.get(key, 'json')) || [];

  if (subs.some(s => s.appid === appid)) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `✅ 已订阅过 *${escMd(name)}*`, parse_mode: 'MarkdownV2' });
    return;
  }

  subs.push({ appid, name, added: Date.now() });
  await env.KV.put(key, JSON.stringify(subs));

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: `✅ 已订阅 *${escMd(name)}* 的降价通知，降价时将第一时间通知你`,
    parse_mode: 'MarkdownV2',
    reply_markup: {
      inline_keyboard: [[{ text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` }]],
    },
  });
}

export async function cmdUnsubscribe(args, chatId, env) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  const key = KV_KEYS.subKey(chatId);
  const subs = (await env.KV.get(key, 'json')) || [];

  if (!subs.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 暂无订阅' });
    return;
  }

  if (!args) {
    const lines = subs.map((s, i) => `${i + 1}\\. ${escMd(s.name)}`);
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text: `📋 *订阅列表*\n回复编号取消:\n\n${lines.join('\n')}`,
      parse_mode: 'MarkdownV2',
    });
    return;
  }

  const idx = parseInt(args) - 1;
  if (idx >= 0 && idx < subs.length) {
    const removed = subs.splice(idx, 1);
    await env.KV.put(key, JSON.stringify(subs));
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `✅ 已取消 *${escMd(removed[0].name)}*`, parse_mode: 'MarkdownV2' });
  } else {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '❌ 无效编号' });
  }
}

export async function cmdList(chatId, env) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  const subs = (await env.KV.get(KV_KEYS.subKey(chatId), 'json')) || [];

  if (!subs.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 你还没有订阅任何游戏\n使用 /subscribe 游戏名 来添加' });
    return;
  }

  const appids = subs.map(s => s.appid);
  const cnMap = await fetchBatchAppDetails(appids, 'schinese');

  const lines = subs.map((s, i) => {
    const d = cnMap[s.appid];
    const price = d?.price_overview;
    const priceStr = price
      ? price.discount_percent > 0
        ? `~~¥${(price.initial / 100).toFixed(0)}~~ **¥${(price.final / 100).toFixed(0)}** 🔥`
        : `¥${(price.final / 100).toFixed(0)}`
      : '价格未知';
    return `${i + 1}\\. ${escMd(s.name)} — ${priceStr}`;
  });

  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text: `📋 *我的订阅* \\(${subs.length}\\)\n\n${lines.join('\n')}`,
    parse_mode: 'MarkdownV2',
  });
}

async function runPipeline(action, chatId, env, token) {
  try {
    if (action === 'recommend') {
      const { recommend } = await import('../deepsteam.js');
      const { fetchSteam } = await import('../../scripts/fetch-steam.js');
      await recommend(env);
      await fetchSteam(env);
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 推荐管线完成' });
    } else if (action === 'library') {
      const { fetchLibrary } = await import('../../scripts/fetch-library.js');
      const { fillDetails } = await import('../../scripts/fill-details.js');
      await fetchLibrary(env);
      await fillDetails(env);
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 库同步完成' });
    }
  } catch (e) {
    console.error(`${action} 管线失败:`, e);
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `❌ 失败: ${e.message}` });
  }
}

export async function cmdRun(action, chatId, env, ctx) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  if (!(await isAdmin(chatId, env))) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⛔ 仅管理员可用' });
    return;
  }
  if (!['recommend', 'library'].includes(action)) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '使用方式: /run recommend 或 /run library' });
    return;
  }

  await tgCall(token, 'sendMessage', { chat_id: chatId, text: `⏳ 开始 ${action}，后台执行中...` });
  const task = runPipeline(action, chatId, env, token);
  if (ctx?.waitUntil) ctx.waitUntil(task);
  else await task;
}

export async function handleCallbackQuery(cb, env) {
  const { getTelegramConfig } = await import('../steam.js');
  const token = (await getTelegramConfig(env)).token;
  if (!token) return;
  const data = cb.data || '';
  const chatId = cb.message?.chat?.id;

  if (data.startsWith('sub_')) {
    const appid = parseInt(data.replace('sub_', ''));
    if (!appid || !chatId) return;
    const key = KV_KEYS.subKey(chatId);
    const subs = (await env.KV.get(key, 'json')) || [];
    if (subs.some(s => s.appid === appid)) {
      await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '已订阅过' });
      return;
    }
    subs.push({ appid, name: '通过搜索添加', added: Date.now() });
    await env.KV.put(key, JSON.stringify(subs));
    await tgCall(token, 'answerCallbackQuery', { callback_query_id: cb.id, text: '✅ 已订阅降价通知' });
  }
}
