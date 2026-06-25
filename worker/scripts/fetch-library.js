import { getSteamId, getOwnedGames, fetchSteamDetails, fetchReview, batchFetch, filterLibraryGames, buildGamesOutput, getConfig } from '../lib/steam.js';

export async function fetchLibrary(env) {
  const steamApiKey = await getConfig(env, 'STEAM_API_KEY');
  const steamUserId = await getConfig(env, 'STEAM_USER_ID');
  const lang = await getConfig(env, 'STEAM_LANG', 'schinese');

  console.log('获取 Steam ID...');
  const steamId = await getSteamId(steamApiKey, steamUserId);
  if (!steamId) throw new Error('获取 Steam ID 失败');

  console.log('获取游戏库...');
  const { games: owned, count: totalCount } = await getOwnedGames(steamApiKey, steamId);
  if (!owned.length) throw new Error('游戏库为空');
  console.log(`共 ${totalCount} 款游戏`);

  console.log(`获取游戏详情 (${owned.length} 款)...`);
  const appids = owned.map(g => g.appid);
  const playtimeMap = {};
  for (const g of owned) playtimeMap[g.appid] = g.playtime_hours;

  const detailMap = await batchFetch(appids, aid => fetchSteamDetails(aid, lang), { maxWorkers: 20, delay: 0.2 });

  console.log(`获取评测数据 (${Object.keys(detailMap).length} 款)...`);
  const reviewAppids = Object.keys(detailMap).map(Number)
    .sort((a, b) => (playtimeMap[b] || 0) - (playtimeMap[a] || 0))
    .slice(0, 50);
  const reviewMap = await batchFetch(reviewAppids, aid => fetchReview(aid, lang), { maxWorkers: 10, delay: 0.2 });

  console.log('合并数据...');
  const libraryGames = owned.map(g => {
    const detail = detailMap[g.appid] || {};
    return {
      appid: g.appid,
      name: detail.name || g.name,
      playtime_hours: g.playtime_hours,
      header_image: detail.header_image || '',
      short_description: detail.short_description || '',
      genres: detail.genres || [],
      screenshots: detail.screenshots || [],
      review: reviewMap[g.appid] || null,
    };
  });

  const { games: filteredGames, softwareCount, filteredCount } = filterLibraryGames(libraryGames, detailMap);
  if (softwareCount > 0) console.log(`过滤掉 ${softwareCount} 款非游戏`);
  if (filteredCount > 0) console.log(`过滤掉 ${filteredCount} 款低时长游戏`);

  const output = buildGamesOutput(filteredGames);
  await env.KV.put('data:library', JSON.stringify(output));
  const totalPlaytime = filteredGames.reduce((s, g) => s + (g.playtime_hours || 0), 0);
  console.log(`✓ library.json 已生成 (${filteredGames.length} 款游戏, ${totalPlaytime.toFixed(1)} 小时)`);
}
