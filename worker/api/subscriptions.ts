import { getSessionUser } from '../auth/session.js'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8' } })
}

export async function handleSubscriptions(env: Env, request: Request): Promise<Response> {
  const user = await getSessionUser(env.DB, request)
  if (!user) return jsonResponse({ error: 'Unauthorized' }, 401)
  const method = request.method

  if (method === 'GET') {
    const rows = await env.DB.prepare('SELECT * FROM subscriptions WHERE user_id = ?')
      .bind(user.steamid).all<{ id: number; appid: number; name: string; added_at: number }>()
    return jsonResponse({ subscriptions: rows.results || [] })
  }

  if (method === 'POST') {
    const body = await request.json() as { appid?: number; name?: string }
    if (!body.appid || !body.name) return jsonResponse({ error: 'appid and name required' }, 400)
    await env.DB.prepare(
      'INSERT INTO subscriptions (user_id, appid, name) VALUES (?, ?, ?) ON CONFLICT(user_id, appid) DO NOTHING'
    ).bind(user.steamid, body.appid, body.name).run()
    return jsonResponse({ ok: true })
  }

  if (method === 'DELETE') {
    const id = parseInt(new URL(request.url).pathname.split('/').pop() || '0', 10)
    await env.DB.prepare('DELETE FROM subscriptions WHERE id = ? AND user_id = ?').bind(id, user.steamid).run()
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: 'Method not allowed' }, 405)
}
