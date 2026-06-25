import { fetchSteamDetails, fetchReview, batchFetch, filterLibraryGames, buildGamesOutput, getConfig } from '../lib/steam.js';

export async function fillDetails(env) {
  const lang = await getConfig(env, 'STEAM_LANG', 'schinese');

  const data = await env.KV.get('data:library', 'json');
  const games = data?.games || [];
  if (!games.length) {
    console.log('library.json 不存在或为空');
    return;
  }
  console.log(`现有 ${games.length} 款游戏`);

  const needFill = games.filter(g => !g.header_image || !g.genres?.length);
  console.log(`需要补全: ${needFill.length} 款`);
  if (!needFill.length) {
    console.log('所有游戏数据已完整');
    return;
  }

  console.log('获取游戏详情...');
  const needAppids = needFill.map(g => g.appid);
  const detailMap = await batchFetch(needAppids, aid => fetchSteamDetails(aid, lang), { maxWorkers: 20, delay: 0.2 });

  const played = needFill.filter(g => (g.playtime_hours || 0) > 0)
    .sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0))
    .slice(0, 30);
  const playedAppids = played.map(g => g.appid);
  let reviewMap = {};
  if (playedAppids.length) {
    console.log(`获取评测数据 (${played.length} 款)...`);
    reviewMap = await batchFetch(playedAppids, aid => fetchReview(aid, lang), { maxWorkers: 10, delay: 0.2 });
  }

  let updated = 0;
  for (const g of games) {
    const d = detailMap[g.appid];
    if (d) {
      if (!g.header_image) g.header_image = d.header_image || '';
      if (!g.genres?.length) g.genres = d.genres || [];
      if (!g.short_description) g.short_description = d.short_description || '';
      if (!g.screenshots?.length) g.screenshots = d.screenshots || [];
      updated++;
    }
    if (reviewMap[g.appid]) g.review = reviewMap[g.appid];
  }

  const { games: filteredGames, softwareCount, filteredCount } = filterLibraryGames(games, detailMap);
  if (softwareCount > 0) console.log(`过滤掉 ${softwareCount} 款非游戏`);
  if (filteredCount > 0) console.log(`过滤掉 ${filteredCount} 款低时长游戏`);

  const output = buildGamesOutput(filteredGames);
  await env.KV.put('data:library', JSON.stringify(output));
  console.log(`✓ 已更新 ${updated} 款, 保存到 library (${filteredGames.length} 款)`);
}
