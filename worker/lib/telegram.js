import { getTelegramConfig } from './steam.js';

// ========== Telegram API ==========

async function tgCall(token, method, body) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

function escMd(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

// ========== Search ==========

async function steamStoreSearch(query, lang) {
  const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(query)}&l=${lang}&cc=cn`;
  try {
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) return { items: [] };
    return await resp.json();
  } catch { return { items: [] }; }
}

async function fetchBatchAppDetails(appids, lang) {
  if (!appids.length) return {};
  const url = `https://store.steampowered.com/api/appdetails?cc=cn&l=${lang}&appids=${appids.join(',')}`;
  try {
    const resp = await fetch(url, { timeout: 15000 });
    const data = await resp.json();
    const result = {};
    for (const aid of appids) {
      const info = data[String(aid)];
      if (info?.success && info.data) {
        result[aid] = info.data;
      }
    }
    return result;
  } catch { return {}; }
}

function searchLocal(games, query) {
  const q = query.toLowerCase();
  const results = [];
  for (const g of games) {
    const name = (g.name || '').toLowerCase();
    if (name.includes(q)) {
      results.push(g);
    }
  }
  return results;
}

async function handleSearch(query, chatId, env) {
  const token = (await getTelegramConfig(env)).token;
  if (!token) return;
  if (query.length < 2) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⚠️ 至少输入 2 个字符' });
    return;
  }

  // 1. Try local KV search first (skip for short queries to avoid flooding)
  let localResults = [];
  if (query.length >= 3) {
    const detailData = await env.KV.get('data:games_detail', 'json');
    const allGames = detailData?.games || [];
    localResults = searchLocal(allGames, query);
  }

  // 2. If local results are good, use them
  if (localResults.length > 0 && localResults.length <= 8) {
    const appids = localResults.map(g => g.appid);
    const [cnMap, enMap] = await Promise.all([
      fetchBatchAppDetails(appids, 'schinese'),
      fetchBatchAppDetails(appids, 'english'),
    ]);

    // Save for number-reply
    await env.KV.put(`lastsearch:${chatId}`, JSON.stringify({
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

  // 3. Search Steam storesearch (try user's input language, then english)
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

  // Save for number-reply
  await env.KV.put(`lastsearch:${chatId}`, JSON.stringify({
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

async function sendGameDetail(token, chatId, appid, cn, en) {
  const cnName = cn?.name || '未知';
  const enName = en?.name || cnName;
  const displayName = cnName !== enName ? `${cnName} (${enName})` : cnName;

  const price = cn?.price_overview;
  const priceText = price
    ? price.discount_percent > 0
      ? `~~¥${(price.initial / 100).toFixed(0)}~~ **¥${(price.final / 100).toFixed(0)}** -${price.discount_percent}% 🔥`
      : `¥${(price.final / 100).toFixed(0)}`
    : '价格未知';

  const releaseDate = cn?.release_date?.date || '未知';
  const desc = (cn?.short_description || en?.short_description || '暂无简介').slice(0, 300);

  let text = `🎮 *${escMd(displayName)}*`;
  text += `\n📅 ${escMd(releaseDate)} | 💰 ${escMd(priceText)}`;
  if (cn?.genres?.length) {
    text += `\n🏷️ ${escMd(cn.genres.slice(0, 3).join(' · '))}`;
  }
  text += `\n📝 ${escMd(desc)}`;

  const photoUrl = cn?.header_image || '';

  const replyMarkup = {
    inline_keyboard: [[
      { text: '🔗 Steam', url: `https://store.steampowered.com/app/${appid}/` },
      { text: '🔔 订阅降价', callback_data: `sub_${appid}` },
    ]],
  };

  if (photoUrl) {
    await tgCall(token, 'sendPhoto', {
      chat_id: chatId,
      photo: photoUrl,
      caption: text,
      parse_mode: 'MarkdownV2',
      reply_markup: replyMarkup,
    });
  } else {
    await tgCall(token, 'sendMessage', {
      chat_id: chatId,
      text,
      parse_mode: 'MarkdownV2',
      reply_markup: replyMarkup,
    });
  }
}

async function sendGameList(token, chatId, items, query, cnMap, enMap, isSteamSearch = false) {
  const lines = items.map((item, i) => {
    const aid = isSteamSearch ? item.id : item.appid;
    const cn = cnMap[aid] || item;
    const en = enMap[aid];
    const cnName = cn?.name || item.name || '未知';
    const enName = en?.name || '';
    const nameDisplay = cnName !== enName && enName
      ? `${cnName} (${enName})`
      : cnName;
    const price = cn?.price_overview;
    const priceStr = price ? `¥${(price.final / 100).toFixed(0)}` : '';
    const rating = cn?.review_score ? `⭐${(cn.review_score / 10).toFixed(1)}` : '';
    return `${i + 1}\\. ${escMd(nameDisplay)} ${rating} ${escMd(priceStr)}`;
  });

  let text = `🔍 找到${items.length}个相关游戏：\n\n${lines.join('\n')}\n\n回复数字查看详情，或输入更精确的名称`;
  await tgCall(token, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'MarkdownV2',
  });
}

// ========== Commands ==========

async function isAdmin(chatId, env) {
  const adminId = (await getTelegramConfig(env)).adminChatId || '';
  return String(chatId) === adminId;
}

async function cmdStart(token, chatId) {
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

async function cmdRecommend(token, chatId, env) {
  const gamesData = await env.KV.get('data:games', 'json');
  const detailData = await env.KV.get('data:games_detail', 'json');
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

async function cmdLibrary(token, chatId, env) {
  const data = await env.KV.get('data:library', 'json');
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

async function cmdStats(token, chatId, env) {
  const [gamesData, detailData, libData] = await Promise.all([
    env.KV.get('data:games', 'json'),
    env.KV.get('data:games_detail', 'json'),
    env.KV.get('data:library', 'json'),
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

async function cmdSubscribe(args, chatId, env) {
  const token = (await getTelegramConfig(env)).token;
  if (!token || !args) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '请指定游戏名，如 /subscribe 黑神话:悟空' });
    return;
  }

  // Search for the game to get appid
  const searchResult = await steamStoreSearch(args, 'schinese');
  if (!searchResult.items?.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '❌ 未找到该游戏' });
    return;
  }

  const appid = searchResult.items[0].id;
  const name = searchResult.items[0].name;

  // Read existing subscriptions
  const key = `sub:${chatId}`;
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

async function cmdUnsubscribe(args, chatId, env) {
  const token = (await getTelegramConfig(env)).token;
  const key = `sub:${chatId}`;
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

async function cmdList(chatId, env) {
  const token = (await getTelegramConfig(env)).token;
  const subs = (await env.KV.get(`sub:${chatId}`, 'json')) || [];

  if (!subs.length) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '📭 你还没有订阅任何游戏\n使用 /subscribe 游戏名 来添加' });
    return;
  }

  // Check current prices
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

async function cmdRun(action, chatId, env) {
  const token = (await getTelegramConfig(env)).token;
  if (!(await isAdmin(chatId, env))) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: '⛔ 仅管理员可用' });
    return;
  }

  await tgCall(token, 'sendMessage', { chat_id: chatId, text: `⏳ 开始 ${action}...` });

  try {
    if (action === 'recommend') {
      const { autoRecommend } = await import('./deepsteam.js');
      const { fetchSteam } = await import('../scripts/fetch-steam.js');
      await autoRecommend(env);
      await fetchSteam(env);
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 推荐管线完成' });
    } else if (action === 'library') {
      const { fetchLibrary } = await import('../scripts/fetch-library.js');
      const { fillDetails } = await import('../scripts/fill-details.js');
      await fetchLibrary(env);
      await fillDetails(env);
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '✅ 库同步完成' });
    }
  } catch (e) {
    await tgCall(token, 'sendMessage', { chat_id: chatId, text: `❌ 失败: ${e.message}` });
  }
}

async function handleCallbackQuery(cb, env) {
  const token = (await getTelegramConfig(env)).token;
  if (!token) return;
  const data = cb.data || '';
  const chatId = cb.message?.chat?.id;
  const msgId = cb.message?.message_id;

  if (data.startsWith('sub_')) {
    const appid = parseInt(data.replace('sub_', ''));
    if (!appid || !chatId) return;
    const key = `sub:${chatId}`;
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

// ========== Webhook ==========

export async function handleWebhook(request, env) {
  const token = (await getTelegramConfig(env)).token;
  if (!token) return new Response('Bot not configured', { status: 200 });

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  const update = await request.json();

  // Handle callback query (button presses)
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, env);
    return new Response('OK');
  }

  // Handle messages
  const msg = update.message;
  if (!msg?.text) return new Response('OK');

  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const chatType = msg.chat.type;

  // Check if it's a number reply (selecting from list)
  if (/^\d+$/.test(text) && !text.startsWith('/')) {
    const num = parseInt(text);
    // We need the last search context. We could store it in KV,
    // but for simplicity, re-search with the last query
    // Or we can store last search result in KV per chat
    const lastSearchKey = `lastsearch:${chatId}`;
    const lastSearch = await env.KV.get(lastSearchKey, 'json');
    if (lastSearch && lastSearch.results && num >= 1 && num <= lastSearch.results.length) {
      const selected = lastSearch.results[num - 1];
      const appid = selected.appid || selected.id;
      const [cnMap, enMap] = await Promise.all([
        fetchBatchAppDetails([appid], 'schinese'),
        fetchBatchAppDetails([appid], 'english'),
      ]);
      await sendGameDetail(token, chatId, appid, cnMap[appid], enMap[appid]);
      return new Response('OK');
    }
  }

  // Parse command
  const parts = text.split(/\s+/);
  const cmd = parts[0].toLowerCase();
  const args = parts.slice(1).join(' ');

  // Handle /search as a search shortcut
  if (cmd === '/search') {
    if (!args) {
      await tgCall(token, 'sendMessage', { chat_id: chatId, text: '使用方式: /search 游戏名' });
      return new Response('OK');
    }
    await handleSearch(args, chatId, env);
    return new Response('OK');
  }

  // Non-command text → treat as search
  if (!cmd.startsWith('/')) {
    await handleSearch(text, chatId, env);
    return new Response('OK');
  }

  // Route commands
  switch (cmd) {
    case '/start':
      await cmdStart(token, chatId);
      break;
    case '/recommend':
      await cmdRecommend(token, chatId, env);
      break;
    case '/library':
      await cmdLibrary(token, chatId, env);
      break;
    case '/stats':
      await cmdStats(token, chatId, env);
      break;
    case '/subscribe':
      await cmdSubscribe(args, chatId, env);
      break;
    case '/unsubscribe':
      await cmdUnsubscribe(args, chatId, env);
      break;
    case '/list':
      await cmdList(chatId, env);
      break;
    case '/run':
      await cmdRun(args, chatId, env);
      break;
    default:
      await tgCall(token, 'sendMessage', {
        chat_id: chatId, text: '❓ 未知命令，发送 /start 查看可用命令',
      });
  }

  return new Response('OK');
}

// ========== Notifications ==========

export async function notify(env, text) {
  const token = (await getTelegramConfig(env)).token;
  const adminId = (await getTelegramConfig(env)).adminChatId || '';
  if (!token || !adminId) return;
  await tgCall(token, 'sendMessage', {
    chat_id: parseInt(adminId),
    text,
    parse_mode: 'MarkdownV2',
  });
}

export async function notifyRecommendResult(env, count) {
  const detailData = await env.KV.get('data:games_detail', 'json');
  const details = detailData?.games || [];
  const detailMap = {};
  for (const d of details) detailMap[d.appid] = d;

  const gamesData = await env.KV.get('data:games', 'json');
  const newGames = gamesData?.games || [];

  let text = `🤖 *每日推荐完成*`;
  if (count > 0) text += `  — 新增 *${count}* 款\n\n`;

  for (let i = 0; i < Math.min(newGames.length, 3); i++) {
    const g = newGames[i];
    const d = detailMap[g.appid];
    const name = d?.name || `appid: ${g.appid}`;
    text += `*${i + 1}\\. ${escMd(name)}*\n`;
    if (g.reason) text += `💡 ${escMd(g.reason)}\n`;
    text += `\n`;
  }

  text += `📊 推荐总数: ${newGames.length} 款`;
  await notify(env, text);
}

export async function notifyLibraryResult(env, count, hours) {
  const text = `📚 *库同步完成*
同步: *${count}* 款游戏
时长: *${hours.toFixed(0)}* 小时`;
  await notify(env, text);
}

// ========== Discount Check ==========

export async function checkDiscounts(env) {
  const token = (await getTelegramConfig(env)).token;
  if (!token) return;

  // List all subscription keys
  const list = await env.KV.list({ prefix: 'sub:' });
  const subKeys = list.keys.filter(k => !k.name.includes('_notified'));

  for (const { name: key } of subKeys) {
    const chatId = parseInt(key.replace('sub:', ''));
    const subs = (await env.KV.get(key, 'json')) || [];
    if (!subs.length) continue;

    const appids = subs.map(s => s.appid);
    const cnMap = await fetchBatchAppDetails(appids, 'schinese');

    // Get previously notified prices
    const notifiedKey = `${key}_notified`;
    const notified = (await env.KV.get(notifiedKey, 'json')) || {};

    for (const sub of subs) {
      const d = cnMap[sub.appid];
      if (!d?.price_overview) continue;

      const price = d.price_overview;
      // On sale and discount > 0
      if (price.discount_percent > 0 && price.final < price.initial) {
        const lastPrice = notified[String(sub.appid)];

        // Only notify if price changed since last notification
        if (lastPrice !== price.final) {
          const discountText = `-${price.discount_percent}% 🔥`;
          const newPrice = `¥${(price.final / 100).toFixed(0)}`;
          const oldPrice = lastPrice ? `¥${(lastPrice / 100).toFixed(0)} → ` : '';

          const text = `🔥 *降价提醒* \\(${escMd(sub.name)}\\)

💰 *${oldPrice}${newPrice}* ${discountText}

[查看 Steam](https://store.steampowered.com/app/${sub.appid}/)`;

          await tgCall(token, 'sendMessage', {
            chat_id: chatId,
            text,
            parse_mode: 'MarkdownV2',
            disable_web_page_preview: false,
          });

          // Save notified price
          notified[String(sub.appid)] = price.final;
        }
      }
    }

    // Update notified prices
    await env.KV.put(notifiedKey, JSON.stringify(notified));
  }
}
