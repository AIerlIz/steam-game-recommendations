import { fetchSteamDetails, fetchReview, getConfig, batchFetch } from '../lib/steam.js';

export async function fetchSteam(env) {
  const lang = await getConfig(env, 'STEAM_LANG', 'schinese');

  const gamesData = await env.KV.get('data:games', 'json');
  const existingData = await env.KV.get('data:games_detail', 'json');

  const existingDetails = {};
  let totalOwned = 0;
  if (existingData?.games) {
    for (const g of existingData.games) {
      existingDetails[g.appid] = g;
    }
    totalOwned = existingData.total_owned || 0;
  }

  if (!gamesData?.games?.length) {
    console.log('games.json 为空，没有新游戏需要获取详情');
    return;
  }

  const appidInfo = {};
  for (const item of gamesData.games) {
    if (typeof item === 'object' && item.appid) {
      if (!existingDetails[item.appid]) {
        appidInfo[item.appid] = { reason: item.reason || '', score: item.score || 0 };
      }
    }
  }

  console.log(`已有详情: ${Object.keys(existingDetails).length} 款, 需要获取: ${Object.keys(appidInfo).length} 款`);
  if (!Object.keys(appidInfo).length) return;

  const newDetails = {};
  const entries = Object.entries(appidInfo);
  const detailsMap = await batchFetch(entries.map(e => parseInt(e[0])), (aid) => fetchSteamDetails(aid, lang), { maxWorkers: 8 });
  const reviewMap = await batchFetch(entries.map(e => parseInt(e[0])), (aid) => fetchReview(aid, lang), { maxWorkers: 8 });

  for (const [aid, info] of entries) {
    const result = detailsMap[parseInt(aid)];
    if (result) {
      if (info.reason) result.reason = info.reason;
      if (info.score) result.score = info.score;
      result.review = reviewMap[parseInt(aid)] || null;
      newDetails[result.appid] = result;
    }
  }

  const allGames = [...Object.values(existingDetails), ...Object.values(newDetails)];
  await env.KV.put('data:games_detail', JSON.stringify({ games: allGames, total_owned: totalOwned }));
  console.log(`✓ games_detail 已更新 (${allGames.length} 款, 新增 ${Object.keys(newDetails).length} 款)`);
}
