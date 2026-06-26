import { KV_KEYS, addChineseName } from './lib/steam.js'
import { recommendForAllUsers } from './lib/deepsteam.js'
import { fetchSteam } from './scripts/fetch-steam.js'
import { fetchLibrary, syncAllUsers } from './scripts/fetch-library.js'
import { fillDetails } from './scripts/fill-details.js'
import { handleWebhook, notifyRecommendResult, notifyLibraryResult, checkDiscounts, checkDiscountsD1 } from './lib/telegram.js'
import { steamLoginUrl, verifySteamLogin } from './auth/steam.js'
import { createSession as createD1Session, getSessionUser, upsertUser, sessionCookie, clearCookie as clearD1Cookie } from './auth/session.js'
import { handleLibrary } from './api/library.js'
import { handleRecommendations } from './api/recommendations.js'
import { handleSearch } from './api/search.js'
import { handleSubscriptions } from './api/subscriptions.js'

async function createSession(env: Env): Promise<string> {
  const id = crypto.randomUUID()
  const session = { id, created: Date.now() }
  await env.KV.put(KV_KEYS.adminSessionKey(id), JSON.stringify(session), { expirationTtl: 86400 })
  return id
}

async function validateSession(env: Env, cookie: string | undefined): Promise<boolean> {
  if (!cookie) return false
  const data = await env.KV.get(KV_KEYS.adminSessionKey(cookie), 'json')
  return !!data
}

async function deleteSession(env: Env, cookie: string | undefined): Promise<void> {
  if (cookie) await env.KV.delete(KV_KEYS.adminSessionKey(cookie))
}

function setCookie(id: string): string {
  return `gs_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`
}

function clearCookie(): string {
  return `gs_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`
}

function parseCookies(header: string | null): Record<string, string> {
  const result: Record<string, string> = {}
  if (!header) return result
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim()
  }
  return result
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  })
}

async function requireAuth(request: Request, env: Env): Promise<string | null> {
  const cookies = parseCookies(request.headers.get('Cookie'))
  const valid = await validateSession(env, cookies.gs_session)
  return valid ? (cookies.gs_session ?? null) : null
}

// ---------- Admin Handlers ----------

async function handleAdminLogin(request: Request, env: Env): Promise<Response> {
  try {
    const { password } = await request.json() as Record<string, unknown>
    const stored = env.ADMIN_PASSWORD
    if (!stored || password !== stored) {
      return jsonResponse({ error: '密码错误' }, 401)
    }
    const sessionId = await createSession(env)
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': setCookie(sessionId) },
    })
  } catch {
    return jsonResponse({ error: '请求格式错误' }, 400)
  }
}

async function handleAdminLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookies(request.headers.get('Cookie'))
  await deleteSession(env, cookies.gs_session)
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  })
}

async function handleAdminApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const method = request.method
  const SENSITIVE_KEYS = ['STEAM_API_KEY', 'LLM_API_KEY']

  if (method === 'GET') {
    if (url.searchParams.has('reveal')) {
      const revealKey = url.searchParams.get('reveal') || ''
      if (!SENSITIVE_KEYS.includes(revealKey)) return jsonResponse({ error: '不可查看' }, 403)
      const val = await env.KV.get(KV_KEYS.configKey(revealKey))
      return jsonResponse({ value: val || '' })
    }
    const list = await env.KV.list({ prefix: KV_KEYS.CONFIG_PREFIX })
    const configs: Record<string, { value: string; sensitive: boolean }> = {}
    for (const key of list.keys) {
      const val = await env.KV.get(key.name)
      const configKey = key.name.replace(KV_KEYS.CONFIG_PREFIX, '')
      const isSensitive = SENSITIVE_KEYS.includes(configKey)
      configs[configKey] = { value: isSensitive ? '****' : (val || ''), sensitive: isSensitive || configKey === 'TELEGRAM' }
    }
    return jsonResponse(configs)
  }

  if (method === 'PUT') {
    const body = await request.json() as { key?: string; value?: string }
    if (!body.key) return jsonResponse({ error: '缺少 key' }, 400)
    await env.KV.put(KV_KEYS.configKey(body.key), String(body.value))
    return jsonResponse({ ok: true })
  }

  if (method === 'DELETE') {
    const body = await request.json() as { key?: string }
    if (!body.key) return jsonResponse({ error: '缺少 key' }, 400)
    await env.KV.delete(KV_KEYS.configKey(body.key))
    return jsonResponse({ ok: true })
  }

  return jsonResponse({ error: '不支持的请求方法' }, 405)
}

// ---------- Main Handler ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url)
    const path = url.pathname

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

    if (request.method === 'POST' && path === '/admin/login') {
      return handleAdminLogin(request, env)
    }
    if (request.method === 'POST' && path === '/admin/logout') {
      return handleAdminLogout(request, env)
    }

    if (path === '/admin' || path === '/admin/') {
      return env.ASSETS.fetch(new Request(`${url.origin}/admin.html`, request))
    }
    if (path === '/admin/api/config') {
      const session = await requireAuth(request, env)
      if (!session) return jsonResponse({ error: '未登录' }, 401)
      return handleAdminApi(request, env)
    }

    if (path === '/games.json') {
      const data = await env.KV.get(KV_KEYS.DATA_GAMES, 'json') as Record<string, unknown> | null
      return jsonResponse(data || { games: [], total_owned: 0 })
    }

    if (path === '/games_detail.json') {
      const data = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as Record<string, unknown> | null
      return jsonResponse(data || { games: [], total_owned: 0 })
    }

    if (path === '/library.json') {
      const data = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as Record<string, unknown> | null
      return jsonResponse(data || { games: [], total_games: 0, total_playtime_hours: 0 })
    }

    if (path === '/api/bot/webhook') {
      return handleWebhook(request, env, ctx)
    }

    if (path === '/api/bot/set-commands') {
      const session = await requireAuth(request, env)
      if (!session) return jsonResponse({ error: '未登录' }, 401)
      const tgData = await env.KV.get(KV_KEYS.CONFIG_TELEGRAM, 'json') as Record<string, unknown> | null
      const token = tgData?.token as string | undefined
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
      const session = await requireAuth(request, env)
      if (!session) return jsonResponse({ error: '未登录' }, 401)
      const tgData = await env.KV.get(KV_KEYS.CONFIG_TELEGRAM, 'json') as Record<string, unknown> | null
      const token = tgData?.token as string | undefined
      if (!token) return new Response('Bot not configured', { status: 200 })
      const webhookUrl = `${url.protocol}//${url.host}/api/bot/webhook`
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
      )
      const result = await resp.json()
      return jsonResponse(result)
    }

    if (path === '/api/bot/seed-chinese-names') {
      const session = await requireAuth(request, env)
      if (!session) return jsonResponse({ error: '未登录' }, 401)
      const libData = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as { games?: { appid: number; name?: string }[] } | null
      const detailData = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json') as { games?: { appid: number; name?: string }[] } | null
      const appids = new Set<number>()
      for (const g of libData?.games || []) if (g.appid) appids.add(g.appid)
      for (const g of detailData?.games || []) if (g.appid) appids.add(g.appid)
      return jsonResponse({ total: appids.size, message: 'Chinese name index available' })
    }

    if (path === '/api/bot/add-chinese-name') {
      const session = await requireAuth(request, env)
      if (!session) return jsonResponse({ error: '未登录' }, 401)
      if (request.method !== 'POST') return jsonResponse({ error: 'POST required' }, 405)
      const body = await request.json() as { name?: string; appid?: number }
      if (!body.name || !body.appid) return jsonResponse({ error: '缺少 name 或 appid' }, 400)
      await addChineseName(env, body.name, body.appid)
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
        await fetchSteam(env).catch(e => console.error('fetchSteam 失败:', e))
        await notifyRecommendResult(env, results.reduce((s, r) => s + r.count, 0)).catch(() => {})
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
        await fetchLibrary(env).catch(e => console.error('fetchLibrary 失败:', e))
        await fillDetails(env).catch(e => console.error('fillDetails 失败:', e))
        const libData = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json') as { games?: unknown[]; total_playtime_hours?: number } | null
        const libAfter = libData?.games?.length || 0
        const libHours = libData?.total_playtime_hours || 0
        await notifyLibraryResult(env, libAfter, libHours).catch(() => {})
        break
      }
      case '0 4 * * *': {
        console.log('开始检查降价...')
        await Promise.all([
          checkDiscounts(env).catch(e => console.error('checkDiscounts 失败:', e)),
          checkDiscountsD1(env).catch(e => console.error('checkDiscountsD1 失败:', e)),
        ])
        break
      }
      default:
        console.log('未知 cron:', event.cron)
    }
  },
}
