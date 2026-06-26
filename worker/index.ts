import { getTelegramConfig, addChineseName } from './lib/kv-keys.js'
import { recommendForAllUsers } from './lib/deepsteam.js'
import { syncAllUsers } from './scripts/fetch-library.js'
import { handleWebhook, checkDiscountsD1 } from './lib/telegram.js'
import { steamLoginUrl, verifySteamLogin } from './auth/steam.js'
import { createSession as createD1Session, getSessionUser, upsertUser, sessionCookie, clearCookie as clearD1Cookie } from './auth/session.js'
import { handleLibrary } from './api/library.js'
import { handleRecommendations } from './api/recommendations.js'
import { handleSearch } from './api/search.js'
import { handleSubscriptions } from './api/subscriptions.js'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  })
}

async function getBotToken(env: Env): Promise<string | undefined> {
  const tgData = await getTelegramConfig(env.DB)
  return tgData.token
}

// ---------- Admin Auth ----------

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return result
}

async function validateAdminSession(db: D1Database, cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false
  const now = Math.floor(Date.now() / 1000)
  const row = await db.prepare('SELECT id FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?')
    .bind(cookie, 'admin', now).first()
  return !!row
}

// ---------- Main Handler ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

    if (path === '/admin' || path === '/admin/') {
      return env.ASSETS.fetch(new Request(`${url.origin}/admin.html`, request))
    }

    // Admin login
    if (path === '/admin/login' && request.method === 'POST') {
      try {
        const { password } = await request.json() as { password?: string }
        if (!password || password !== env.ADMIN_PASSWORD) {
          return jsonResponse({ error: '密码错误' }, 401)
        }
        const sessionId = crypto.randomUUID()
        const now = Math.floor(Date.now() / 1000)
        await env.DB.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
          .bind(sessionId, 'admin', now, now + 86400).run()
        return new Response(JSON.stringify({ ok: true }), {
          headers: { 'Content-Type': 'application/json', 'Set-Cookie': `admin_session=${sessionId}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=86400` },
        })
      } catch {
        return jsonResponse({ error: '请求格式错误' }, 400)
      }
    }

    // Admin logout
    if (path === '/admin/logout' && request.method === 'POST') {
      const cookies = parseCookies(request.headers.get('Cookie'))
      if (cookies.admin_session) {
        await env.DB.prepare('DELETE FROM sessions WHERE id = ? AND user_id = ?').bind(cookies.admin_session, 'admin').run()
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0' },
      })
    }

    // Admin config API
    if (path === '/admin/api/config') {
      const cookies = parseCookies(request.headers.get('Cookie'))
      const valid = await validateAdminSession(env.DB, cookies.admin_session)
      if (!valid) return jsonResponse({ error: '未登录' }, 401)

      const method = request.method
      if (method === 'GET') {
        const rows = await env.DB.prepare('SELECT key, value FROM config').all<{ key: string; value: string }>()
        const configs: Record<string, { value: string; sensitive: boolean }> = {}
        const sensitiveKeys = ['STEAM_API_KEY', 'LLM_API_KEY']
        for (const r of (rows.results || [])) {
          configs[r.key] = { value: sensitiveKeys.includes(r.key) ? '' : r.value, sensitive: sensitiveKeys.includes(r.key) || r.key === 'TELEGRAM' }
        }
        // reveal endpoint
        const revealKey = url.searchParams.get('reveal')
        if (revealKey) {
          const row = await env.DB.prepare('SELECT value FROM config WHERE key = ?').bind(revealKey).first<{ value: string }>()
          return jsonResponse({ value: row?.value || '' })
        }
        return jsonResponse(configs)
      }
      if (method === 'PUT') {
        const body = await request.json() as { key?: string; value?: string }
        if (!body.key) return jsonResponse({ error: '缺少 key' }, 400)
        await env.DB.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind(body.key, String(body.value || '')).run()
        return jsonResponse({ ok: true })
      }
      if (method === 'DELETE') {
        const body = await request.json() as { key?: string }
        if (!body.key) return jsonResponse({ error: '缺少 key' }, 400)
        await env.DB.prepare('DELETE FROM config WHERE key = ?').bind(body.key).run()
        return jsonResponse({ ok: true })
      }
      return jsonResponse({ error: '不支持的请求方法' }, 405)
    }

    if (path === '/api/auth/steam') {
      const returnPath = url.searchParams.get('return') || '/'
      const returnUrl = `${url.protocol}//${url.host}/api/auth/steam/callback?return=${encodeURIComponent(returnPath)}`
      return Response.redirect(steamLoginUrl(returnUrl), 302)
    }

    if (path === '/api/auth/steam/callback') {
      const user = await verifySteamLogin(url, env.DB)
      if (!user) return new Response('Auth failed', { status: 401 })
      await upsertUser(env.DB, user)
      const sessionId = await createD1Session(env.DB, user)
      const redirectPath = url.searchParams.get('return') || '/'
      return new Response(null, { status: 302, headers: { Location: redirectPath, 'Set-Cookie': sessionCookie(sessionId) } })
    }

    if (path === '/api/auth/status') {
      const user = await getSessionUser(env.DB, request)
      return jsonResponse(user ? { loggedIn: true, user } : { loggedIn: false })
    }

    if (path === '/api/auth/logout' && request.method === 'POST') {
      return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearD1Cookie() } })
    }

    if (path === '/api/library') return handleLibrary(env, request)

    if (path === '/api/recommendations') return handleRecommendations(env, request)

    if (path === '/api/search') return handleSearch(env, request)

    if (path.startsWith('/api/subscriptions')) return handleSubscriptions(env, request)

    if (path === '/api/bot/webhook') {
      return handleWebhook(request, env, ctx)
    }

    if (path === '/api/bot/set-commands') {
      const token = await getBotToken(env)
      if (!token) return new Response('Bot not configured', { status: 200 })
      const commands = [
        { command: 'start', description: '显示菜单' },
        { command: 'search', description: '搜索游戏' },
        { command: 'recommend', description: '今日推荐' },
        { command: 'library', description: '我的游戏库' },
        { command: 'stats', description: '统计信息' },
        { command: 'subscribe', description: '订阅降价通知' },
        { command: 'unsubscribe', description: '取消订阅' },
        { command: 'list', description: '订阅列表' },
        { command: 'run', description: '管理后台管线' },
      ]
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/setMyCommands`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ commands }) },
      )
      const result = await resp.json()
      return jsonResponse(result)
    }

    if (path === '/api/bot/set-webhook') {
      const token = await getBotToken(env)
      if (!token) return new Response('Bot not configured', { status: 200 })
      const webhookUrl = `${url.protocol}//${url.host}/api/bot/webhook`
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
      )
      const result = await resp.json()
      return jsonResponse(result)
    }

    if (path === '/api/bot/add-chinese-name' && request.method === 'POST') {
      const body = await request.json() as { name?: string; appid?: number }
      if (!body.name || !body.appid) return jsonResponse({ ok: false, error: '缺少 name 或 appid' }, 400)
      await addChineseName(env.DB, body.name, body.appid)
      return jsonResponse({ ok: true })
    }

    if (path.startsWith('/api/proxy/')) {
      const targetUrl = path.replace('/api/proxy/', '') + url.search
      const allowedHosts = ['store.steampowered.com', 'api.steampowered.com', 'steamcdn-a.akamaihd.net']
      try {
        const targetHost = new URL(targetUrl).hostname
        if (!allowedHosts.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
          return new Response('Forbidden', { status: 403 })
        }
      } catch { return new Response('Invalid URL', { status: 400 }) }
      try {
        const resp = await fetch(targetUrl, {
          method: request.method,
          headers: request.headers,
        })
        const headers = new Headers(resp.headers)
        headers.set('Access-Control-Allow-Origin', '*')
        return new Response(resp.body, { status: resp.status, headers })
      } catch {
        return new Response('Proxy error', { status: 502 })
      }
    }

    return env.ASSETS.fetch(request)
  },

  async scheduled(event: ScheduledController, env: Env): Promise<void> {
    switch (event.cron) {
      case '0 3 * * *': {
        console.log('starting daily recommendations for all users...')
        const results = await recommendForAllUsers(env).catch(e => { console.error('recommendForAllUsers failed:', e); return [] })
        for (const r of results) { if (r.error) console.error(`user ${r.userId} rec failed:`, r.error) }
        console.log(`recs done: ${results.length} users, ${results.reduce((s,r)=>s+r.count,0)} recs`)
        break
      }
      case '30 3 * * 1': {
        console.log('开始每周多用户游戏库同步...')
        const syncResults = await syncAllUsers(env).catch(e => {
          console.error('syncAllUsers 失败:', e)
          return []
        })
        for (const r of syncResults) {
          if (r.error) console.error(`用户 ${r.userId} 同步失败:`, r.error)
        }
        console.log(`同步完成: ${syncResults.length} 位用户, ${syncResults.reduce((s, r) => s + r.gameCount, 0)} 款游戏`)
        break
      }
      case '0 4 * * *': {
        console.log('开始检查降价...')
        await checkDiscountsD1(env).catch(e => console.error('checkDiscountsD1 失败:', e))
        break
      }
      default:
        console.log('未知 cron:', event.cron)
    }
  },
}
