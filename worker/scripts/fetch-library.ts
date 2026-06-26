import { KV_KEYS, getSteamId, getOwnedGames, fetchSteamDetails, fetchReview, batchFetch, filterLibraryGames, buildGamesOutput, getConfig } from '../lib/steam.js'

export async function fetchLibrary(env: Env): Promise<void> {
  const steamApiKey = await getConfig(env, 'STEAM_API_KEY')
  const steamUserId = await getConfig(env, 'STEAM_USER_ID')
  const lang = await getConfig(env, 'STEAM_LANG', 'schinese')

  console.log('获取 Steam ID...')
  const steamId = await getSteamId(steamApiKey, steamUserId)
  if (!steamId) throw new Error('获取 Steam ID 失败')

  console.log('获取游戏库...')
  const { games: owned, count: totalCount } = await getOwnedGames(steamApiKey, steamId)
  if (!owned.length) throw new Error('游戏库为空')
  console.log(`共 ${totalCount} 款游戏`)

  console.log(`获取游戏详情 (${owned.length} 款)...`)
  const appids = owned.map(g => g.appid)
  const playtimeMap: Record<number, number> = {}
  for (const g of owned) playtimeMap[g.appid] = g.playtime_hours

  const detailMapRaw = await batchFetch(appids, aid => fetchSteamDetails(aid, lang), { maxWorkers: 20, delay: 0.2 })
  const detailMap = detailMapRaw as Record<number, Record<string, unknown>>

  console.log(`获取评测数据 (${Object.keys(detailMap).length} 款)...`)
  const reviewAppids = Object.keys(detailMap).map(Number)
    .sort((a, b) => (playtimeMap[b] || 0) - (playtimeMap[a] || 0))
    .slice(0, 50)
  const reviewMap = await batchFetch(reviewAppids, aid => fetchReview(aid, lang), { maxWorkers: 10, delay: 0.2 })

  console.log('合并数据...')
  const libraryGames = owned.map(g => ({
    appid: g.appid,
    name: (detailMap[g.appid]?.name as string) || g.name,
    playtime_hours: g.playtime_hours,
    header_image: (detailMap[g.appid]?.header_image as string) || '',
    short_description: (detailMap[g.appid]?.short_description as string) || '',
    genres: (detailMap[g.appid]?.genres as string[]) || [],
    screenshots: (detailMap[g.appid]?.screenshots as string[]) || [],
    review: (reviewMap[g.appid] as Record<string, unknown>) || null,
  }))

  const detailTypeMap: Record<number, { type?: string }> = {}
  for (const aid of Object.keys(detailMap).map(Number)) {
    detailTypeMap[aid] = { type: detailMap[aid]?.type as string | undefined }
  }

  const { games: filteredGames, softwareCount, filteredCount } = filterLibraryGames(libraryGames, detailTypeMap)
  if (softwareCount > 0) console.log(`过滤掉 ${softwareCount} 款非游戏`)
  if (filteredCount > 0) console.log(`过滤掉 ${filteredCount} 款低时长游戏`)

  const output = buildGamesOutput(filteredGames)
  await env.KV.put(KV_KEYS.DATA_LIBRARY, JSON.stringify(output))
  const totalPlaytime = filteredGames.reduce((s, g) => s + (g.playtime_hours || 0), 0)
  console.log(`✓ library.json 已生成 (${filteredGames.length} 款游戏, ${totalPlaytime.toFixed(1)} 小时)`)
}
