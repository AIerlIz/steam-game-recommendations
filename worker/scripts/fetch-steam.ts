import { KV_KEYS, fetchSteamDetails, fetchReview, getConfig, batchFetch } from '../lib/steam.js'

export async function fetchSteam(env: Env): Promise<void> {
  const lang = await getConfig(env, 'STEAM_LANG', 'schinese')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const gamesData = await env.KV.get(KV_KEYS.DATA_GAMES, 'json') as any
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existingData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as any

  const existingDetails: Record<number, Record<string, unknown>> = {}
  let totalOwned = 0
  if (existingData?.games) {
    for (const g of existingData.games) {
      existingDetails[g.appid] = g
    }
    totalOwned = existingData.total_owned || 0
  }

  if (!gamesData?.games?.length) {
    console.log('games.json 为空，没有新游戏需要获取详情')
    return
  }

  const appidInfo: Record<number, { reason: string; score: number }> = {}
  for (const item of gamesData.games) {
    if (item.appid && !existingDetails[item.appid]) {
      appidInfo[item.appid] = { reason: item.reason || '', score: item.score || 0 }
    }
  }

  console.log(`已有详情: ${Object.keys(existingDetails).length} 款, 需要获取: ${Object.keys(appidInfo).length} 款`)
  if (!Object.keys(appidInfo).length) return

  const entries = Object.entries(appidInfo).map(e => parseInt(e[0]))
  const detailsMap = await batchFetch(entries, (aid) => fetchSteamDetails(aid, lang), { maxWorkers: 8 })
  const reviewMap = await batchFetch(entries, (aid) => fetchReview(aid, lang), { maxWorkers: 8 })

  const newDetails: Record<number, Record<string, unknown>> = {}
  for (const [aidStr, info] of Object.entries(appidInfo)) {
    const aid = parseInt(aidStr)
    const result = detailsMap[aid] as Record<string, unknown> | undefined
    if (result) {
      if (info.reason) result.reason = info.reason
      if (info.score) result.score = info.score
      result.review = reviewMap[aid] || null
      newDetails[result.appid as number] = result
    }
  }

  const allGames = [...Object.values(existingDetails), ...Object.values(newDetails)]
  await env.KV.put(KV_KEYS.DATA_GAMES_DETAIL, JSON.stringify({ games: allGames, total_owned: totalOwned }))
  console.log(`✓ games_detail 已更新 (${allGames.length} 款, 新增 ${Object.keys(newDetails).length} 款)`)
}
