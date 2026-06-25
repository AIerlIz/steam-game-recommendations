import { KV_KEYS, getTelegramConfig } from '../steam.js';

export async function tgCall(token, method, body) {
  const url = `https://api.telegram.org/bot${token}/${method}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return resp.json();
}

export function escMd(text) {
  return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
}

export async function steamStoreSearch(query, lang) {
  const url = `https://store.steampowered.com/api/storesearch?term=${encodeURIComponent(query)}&l=${lang}&cc=cn`;
  try {
    const resp = await fetch(url, { timeout: 10000 });
    if (!resp.ok) return { items: [] };
    return await resp.json();
  } catch { return { items: [] }; }
}

export async function fetchBatchAppDetails(appids, lang) {
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

export function searchLocal(games, query) {
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

export async function sendGameDetail(token, chatId, appid, cn, en) {
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

export async function sendGameList(token, chatId, items, query, cnMap, enMap, isSteamSearch = false) {
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

export async function isAdmin(chatId, env) {
  const config = await getTelegramConfig(env);
  return String(chatId) === (config.adminChatId || '');
}
