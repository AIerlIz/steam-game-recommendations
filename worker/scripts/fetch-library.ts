import { getOwnedGames, fetchSteamDetails, fetchReview, batchFetch } from '../lib/steam.js'

export async function syncAllUsers(env: Env): Promise<{ userId: string; gameCount: number; error?: string }[]> {
  const configRow = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind('STEAM_API_KEY').first<{ value: string }>()
  if (!configRow?.value) { console.error('STEAM_API_KEY not configured'); return [] }
  const apiKey = configRow.value
  const users = await env.DB.prepare('SELECT id FROM users').all<{ id: string }>()
  const results: { userId: string; gameCount: number; error?: string }[] = []
  for (const u of (users.results || [])) {
    try {
      const { games } = await getOwnedGames(apiKey, u.id)
      if (!games.length) { results.push({ userId: u.id, gameCount: 0 }); continue }
      const appids = games.map(g => g.appid)
      const detailMap = await batchFetch(appids, aid => fetchSteamDetails(aid, 'schinese'), { maxWorkers: 20, delay: 0.2 })
      const top50 = games.sort((a, b) => (b.playtime_forever || 0) - (a.playtime_forever || 0)).slice(0, 50)
      const reviewMap = await batchFetch(top50.map(g => g.appid), aid => fetchReview(aid, 'schinese'), { maxWorkers: 10, delay: 0.2 })
      const stmts = games.map(g => {
        const d = detailMap[g.appid] as Record<string, unknown> | undefined
        const r = reviewMap[g.appid] as Record<string, unknown> | undefined
        return env.DB.prepare(`INSERT INTO library (user_id,appid,name,playtime_hours,playtime_forever,header_image,genres,release_date,review_score,updated_at)
          VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,appid) DO UPDATE SET name=excluded.name,playtime_hours=excluded.playtime_hours,playtime_forever=excluded.playtime_forever,header_image=excluded.header_image,genres=excluded.genres,release_date=excluded.release_date,review_score=excluded.review_score,updated_at=excluded.updated_at`)
          .bind(u.id, g.appid, (d?.name as string) || g.name, ((g.playtime_forever || 0) / 60), g.playtime_forever || 0, (d?.header_image as string) || '', JSON.stringify(d?.genres || []), (d?.release_date as string) || '', (r?.score as number) || 0, Math.floor(Date.now() / 1000))
      })
      if (stmts.length) await env.DB.batch(stmts)
      results.push({ userId: u.id, gameCount: games.length })
    } catch (e) { results.push({ userId: u.id, gameCount: 0, error: String(e) }) }
  }
  return results
}
