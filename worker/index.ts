import { getTelegramConfig } from './lib/kv-keys.js'
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
  const tgData = await getTelegramConfig(env)
  return tgData.token as string | undefined
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
