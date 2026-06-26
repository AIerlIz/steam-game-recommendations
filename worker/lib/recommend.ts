import type { Game, GamesData, UserProfile, Recommendation, LLMClient } from '../types.js'
import { createLLM } from './llm.js'
import { KV_KEYS, getSteamId, getOwnedGames, saveGamesJson, getConfig } from './steam.js'
import { buildUserProfile, rewriteIntent } from './profile.js'
import { calculateWeightedScore, filterSeriesDeepsteam, detectSeries } from './scoring.js'

export function parseLlmResponse(response: string): Record<string, unknown> {
  if (!response) return {}
  const jsonMatch = response.match(/```json\s*([\s\S]*?)```/)
  let jsonStr: string
  if (jsonMatch) jsonStr = jsonMatch[1]
  else jsonStr = response
  jsonStr = jsonStr.trim()
  try { return JSON.parse(jsonStr) as Record<string, unknown> } catch { /* fall through */ }

  const start = jsonStr.indexOf('{')
  const end = jsonStr.lastIndexOf('}')
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(jsonStr.slice(start, end + 1)) as Record<string, unknown> } catch { /* ignore */ }
  }
  return {}
}

export async function aiAnalyzeAndRecommend(
  ownedGames: Game[],
  existingAppids: Set<number>,
  profile: UserProfile,
  llmClient: LLMClient,
  k = 200,
): Promise<Recommendation[]> {
  const sortedGames = [...ownedGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0))
  const topN = Math.max(5, Math.round(50 * (1 - Math.E ** (-sortedGames.length / k))))
  const topGames = sortedGames.slice(0, topN)

  const gamesText = topGames.map(g => `- ${g.name} (游玩${g.playtime_hours || 0}小时)`).join('\n')
  const intentRewrite = rewriteIntent(profile, ownedGames)

  const existingText = [...existingAppids].slice(0, 50).join(', ')
  const ownedText = ownedGames.slice(0, 50).map(g => String(g.appid)).join(', ')

  const ownedSeriesNames = new Set<string>()
  for (const game of ownedGames) {
    const series = detectSeries(game.name || '')
    if (series) ownedSeriesNames.add(series)
  }

  const prompt = `你是一个Steam游戏推荐专家，使用DeepSteam算法的多兴趣路由策略进行推荐。

## 用户多兴趣画像 (Multi-Interest Profile)
${intentRewrite || '暂无明确品类偏好'}

## 用户已拥有的游戏appid（请勿推荐这些游戏！）
${ownedText}

## 用户游戏库（按游玩时间排序）
${gamesText}

## 已推荐过的游戏appid（请勿重复推荐）
${existingText}

## 系列游戏追踪
用户已拥有的系列: ${[...ownedSeriesNames].join(', ') || '无'}
请避免推荐同系列的旧作(如果用户已有新作)，优先推荐该系列的更新作品或其他系列。

## DeepSteam推荐策略
1. **多兴趣路由**: 为用户的每条主要兴趣线推荐1-2款游戏，确保覆盖多维口味
2. **推新不推旧**: 优先推荐2018年以后的游戏，避免推荐过时作品
3. **多样性保障**: 推荐的游戏应覆盖用户的不同兴趣维度，不要集中在单一品类
4. **否定词过滤**: 如果用户游玩记录中明显缺少某品类，不要强行推荐

## 输出要求
只输出JSON，不要其他文字：
\`\`\`json
{
  "recommendations": [
    {
      "appid": 数字,
      "name": "English name",
      "chinese_name": "中文名",
      "tags": ["标签1", "标签2", "标签3"],
      "release_year": 年份数字,
      "reason": "推荐理由(说明匹配用户的哪条兴趣线)"
    }
  ]
}
\`\`\`

## 注意事项
1. 推荐用户没有的游戏
2. 每个游戏3-5个标签
3. appid必须是纯数字
4. 使用官方中文名
5. 推荐7-10款游戏以覆盖多条兴趣线`

  let response = ''
  let lastError: Error | null = null
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await llmClient.generate(prompt)
      if (response) break
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e))
      console.error(`LLM 第 ${attempt + 1} 次调用失败:`, e)
    }
  }
  if (!response) {
    if (lastError) throw lastError
    throw new Error('LLM 未返回推荐内容')
  }

  const result = parseLlmResponse(response)
  const recs = result?.recommendations as Recommendation[] | undefined
  if (!Array.isArray(recs)) {
    throw new Error('LLM 返回格式无法解析为 recommendations JSON')
  }
  if (!recs.length) {
    throw new Error('LLM 返回的 recommendations 为空')
  }

  const filtered: Recommendation[] = []
  for (const r of recs) {
    const appid = parseInt(String(r.appid))
    if (appid && !existingAppids.has(appid)) {
      r.appid = appid
      filtered.push(r)
    }
  }
  if (!filtered.length) {
    throw new Error('LLM 推荐的游戏都已拥有或已推荐过')
  }
  return filtered.slice(0, 10)
}

export async function recommendAlgo(
  ownedGames: Game[],
  excludeAppids: Set<number>,
  profile: UserProfile,
  llmClient: LLMClient,
  k = 200,
): Promise<Recommendation[]> {
  const recommendations = await aiAnalyzeAndRecommend(ownedGames, excludeAppids, profile, llmClient, k)
  if (!recommendations?.length) throw new Error('没有通过过滤的新推荐游戏')

  for (const rec of recommendations) {
    rec.score = calculateWeightedScore(rec, ownedGames, profile)
  }
  recommendations.sort((a, b) => (b.score || 0) - (a.score || 0))

  return filterSeriesDeepsteam(recommendations, ownedGames)
}

export async function saveRecs(env: Env, recs: Recommendation[], totalOwned: number): Promise<Recommendation[]> {
  const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: unknown[] } | null
  const existingAppidSet = new Set<number>()
  if (detailData?.games) {
    for (const g of detailData.games as { appid?: number }[]) {
      if (g.appid) existingAppidSet.add(g.appid)
    }
  }

  const newEntries: GamesData['games'] = []
  for (const rec of recs) {
    if (rec.appid && !existingAppidSet.has(rec.appid)) {
      newEntries.push({
        appid: rec.appid,
        reason: rec.reason || '',
        score: Math.round((rec.score || 0) * 10000) / 10000,
      })
    }
  }

  await saveGamesJson(env, {
    games: newEntries,
    total_owned: totalOwned,
  })
  return recs.slice(0, newEntries.length)
}

export async function getExistingGames(env: Env): Promise<Set<number>> {
  const data = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: { appid?: number }[] } | null
  if (!data?.games) return new Set()
  return new Set(data.games.map(g => g.appid).filter((id): id is number => id !== undefined))
}

export async function steamSearchByName(name: string): Promise<{ appid: number; name: string; type: string } | null> {
  const clean = encodeURIComponent(name)
  const urls = [
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=schinese&cc=cn`,
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=english&cc=us`,
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=english&cc=cn`,
  ]
  for (const url of urls) {
    try {
      const resp = await fetch(url, { signal: AbortSignal.timeout(10000) })
      if (!resp.ok) continue
      const data: { items?: { id: number; name: string; type: string }[] } = await resp.json()
      const items = data?.items || []
      if (items.length && items[0].type === 'app') {
        return { appid: items[0].id, name: items[0].name || '', type: items[0].type }
      }
    } catch { /* ignore */ }
  }
  return null
}

export async function recommend(env: Env): Promise<Recommendation[]> {
  const steamApiKey = await getConfig(env, 'STEAM_API_KEY')
  const steamUserId = await getConfig(env, 'STEAM_USER_ID')
  if (!steamApiKey || !steamUserId) throw new Error('未配置 STEAM_API_KEY 或 STEAM_USER_ID')

  const llmConfig = {
    provider: await getConfig(env, 'LLM_PROVIDER'),
    apiKey: await getConfig(env, 'LLM_API_KEY'),
    apiBase: await getConfig(env, 'LLM_API_BASE'),
    model: await getConfig(env, 'LLM_MODEL'),
  }
  const k = parseFloat((await getConfig(env, 'RECOMMEND_K')) || '200')
  const llmClient = createLLM(llmConfig)

  console.log('获取 Steam ID...')
  const steamId = await getSteamId(steamApiKey, steamUserId)
  if (!steamId) throw new Error('获取 Steam ID 失败')

  console.log('获取用户游戏库...')
  const { games: ownedGamesData, count: apiGameCount } = await getOwnedGames(steamApiKey, steamId)
  if (!ownedGamesData.length) throw new Error('游戏库为空')
  console.log(`拥有游戏: ${ownedGamesData.length} 款`)

  console.log('构建多兴趣画像...')
  const libraryData = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as { games?: { appid?: number; genres?: string[] }[] } | null
  const libraryGenres: Record<number, string[]> = {}
  if (libraryData?.games) {
    for (const g of libraryData.games as { appid?: number; genres?: string[] }[]) {
      if (g.appid && g.genres) libraryGenres[g.appid] = g.genres
    }
  }
  const profile = buildUserProfile(ownedGamesData, libraryGenres)
  console.log(`主要品类: ${profile.top_genres?.join(', ')}`)

  console.log('检查已存在游戏...')
  const existingGames = await getExistingGames(env)
  const ownedAppids = new Set(ownedGamesData.map(g => g.appid))
  const excludeAppids = new Set([...existingGames, ...ownedAppids])

  console.log('推荐算法(LLM+评分+系列过滤)...')
  const filteredRecs = await recommendAlgo(ownedGamesData, excludeAppids, profile, llmClient, k)

  console.log('验证appid...')
  const validated: Recommendation[] = []
  const maxValidate = Math.min(filteredRecs.length, 7)
  const verifyBatch = filteredRecs.slice(0, maxValidate)
  const results = await Promise.all(verifyBatch.map(rec => {
    const nameToSearch = rec.chinese_name
    if (!nameToSearch) return Promise.resolve(null)
    return steamSearchByName(nameToSearch)
  }))
  for (let i = 0; i < verifyBatch.length; i++) {
    const rec = { ...verifyBatch[i] }
    const corrected = results[i]
    if (!corrected || corrected.type !== 'app') continue
    rec.appid = corrected.appid
    rec.verified_name = corrected.name
    validated.push(rec)
  }
  if (!validated.length) throw new Error('所有appid验证失败')

  const newRecs = validated.slice(0, 7)
  console.log('保存推荐结果...')
  await saveRecs(env, newRecs, apiGameCount || ownedGamesData.length)
  return newRecs
}
