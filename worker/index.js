import { KV_KEYS } from './lib/steam.js';
import { recommend } from './lib/deepsteam.js';
import { fetchSteam } from './scripts/fetch-steam.js';
import { fetchLibrary } from './scripts/fetch-library.js';
import { fillDetails } from './scripts/fill-details.js';
import { handleWebhook, notifyRecommendResult, notifyLibraryResult, checkDiscounts } from './lib/telegram.js';

function uuid() {
  return crypto.randomUUID();
}

async function createSession(env) {
  const id = uuid();
  const session = { id, created: Date.now() };
  await env.KV.put(KV_KEYS.adminSessionKey(id), JSON.stringify(session), { expirationTtl: 86400 });
  return id;
}

async function validateSession(env, cookie) {
  if (!cookie) return false;
  const data = await env.KV.get(KV_KEYS.adminSessionKey(cookie), 'json');
  return !!data;
}

async function deleteSession(env, cookie) {
  if (cookie) await env.KV.delete(KV_KEYS.adminSessionKey(cookie));
}

function setCookie(id) {
  return `gs_session=${id}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

function clearCookie() {
  return `gs_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
}

function parseCookies(header) {
  const result = {};
  if (!header) return result;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0) result[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return result;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json;charset=UTF-8' },
  });
}

async function requireAuth(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  const valid = await validateSession(env, cookies.gs_session);
  return valid ? cookies.gs_session : null;
}

// ---------- Admin Handlers ----------

async function handleAdminLogin(request, env) {
  try {
    const { password } = await request.json();
    const stored = env.ADMIN_PASSWORD;
    if (!stored || password !== stored) {
      return jsonResponse({ error: '密码错误' }, 401);
    }
    const sessionId = await createSession(env);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Set-Cookie': setCookie(sessionId) },
    });
  } catch {
    return jsonResponse({ error: '请求格式错误' }, 400);
  }
}

async function handleAdminLogout(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie'));
  await deleteSession(env, cookies.gs_session);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': clearCookie() },
  });
}

async function handleAdminApi(request, env) {
  const url = new URL(request.url);
  const method = request.method;
  const SENSITIVE_KEYS = ['STEAM_API_KEY', 'LLM_API_KEY'];

  if (method === 'GET') {
    if (url.searchParams.has('reveal')) {
      const revealKey = url.searchParams.get('reveal');
      if (!SENSITIVE_KEYS.includes(revealKey)) return jsonResponse({ error: '不可查看' }, 403);
      const val = await env.KV.get(KV_KEYS.configKey(revealKey));
      return jsonResponse({ value: val || '' });
    }
      const list = await env.KV.list({ prefix: KV_KEYS.CONFIG_PREFIX });
    const configs = {};
    for (const key of list.keys) {
      const val = await env.KV.get(key.name);
      const configKey = key.name.replace(KV_KEYS.CONFIG_PREFIX, '');
      const isSensitive = SENSITIVE_KEYS.includes(configKey);
      configs[configKey] = { value: isSensitive ? '****' : val, sensitive: isSensitive || configKey === 'TELEGRAM' };
    }
    return jsonResponse(configs);
  }

  if (method === 'PUT') {
    const { key, value } = await request.json();
    if (!key) return jsonResponse({ error: '缺少 key' }, 400);
    await env.KV.put(KV_KEYS.configKey(key), String(value));
    return jsonResponse({ ok: true });
  }

  if (method === 'DELETE') {
    const { key } = await request.json();
    if (!key) return jsonResponse({ error: '缺少 key' }, 400);
    await env.KV.delete(KV_KEYS.configKey(key));
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: '不支持的请求方法' }, 405);
}



// ---------- Main Handler ----------

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'POST' && path === '/admin/login') {
      return handleAdminLogin(request, env);
    }
    if (request.method === 'POST' && path === '/admin/logout') {
      return handleAdminLogout(request, env);
    }

    if (path === '/admin' || path === '/admin/') {
      return env.ASSETS.fetch(new Request(`${url.origin}/admin.html`, request));
    }
    if (path === '/admin/api/config') {
      const session = await requireAuth(request, env);
      if (!session) return jsonResponse({ error: '未登录' }, 401);
      return handleAdminApi(request, env);
    }

    if (path === '/games.json') {
      const data = await env.KV.get(KV_KEYS.DATA_GAMES, 'json');
      return jsonResponse(data || { games: [], total_owned: 0 });
    }

    if (path === '/games_detail.json') {
      const data = await env.KV.get(KV_KEYS.DATA_GAMES_DETAIL, 'json');
      return jsonResponse(data || { games: [], total_owned: 0 });
    }

    if (path === '/library.json') {
      const data = await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json');
      return jsonResponse(data || { games: [], total_games: 0, total_playtime_hours: 0 });
    }

    if (path === '/api/bot/webhook') {
      return handleWebhook(request, env, ctx);
    }

    if (path === '/api/bot/set-webhook') {
      const session = await requireAuth(request, env);
      if (!session) return jsonResponse({ error: '未登录' }, 401);
      const tgConfig = await env.KV.get(KV_KEYS.CONFIG_TELEGRAM, 'json');
      const token = tgConfig?.token;
      if (!token) return new Response('Bot not configured', { status: 200 });
      const webhookUrl = `${url.protocol}//${url.host}/api/bot/webhook`;
      const resp = await fetch(
        `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`,
      );
      const result = await resp.json();
      return jsonResponse(result);
    }

    if (path.startsWith('/api/proxy/')) {
      const targetUrl = path.replace('/api/proxy/', '') + url.search;
      const allowedHosts = ['store.steampowered.com', 'api.steampowered.com', 'steamcdn-a.akamaihd.net'];
      try {
        const targetHost = new URL(targetUrl).hostname;
        if (!allowedHosts.some(h => targetHost === h || targetHost.endsWith('.' + h))) {
          return new Response('Forbidden', { status: 403 });
        }
      } catch { return new Response('Invalid URL', { status: 400 }); }
      try {
        const resp = await fetch(targetUrl, {
          method: request.method,
          headers: request.headers,
        });
        const headers = new Headers(resp.headers);
        headers.set('Access-Control-Allow-Origin', '*');
        return new Response(resp.body, { status: resp.status, headers });
      } catch {
        return new Response('Proxy error', { status: 502 });
      }
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    switch (event.cron) {
      case '0 3 * * *': {
        console.log('开始每日自动推荐...');
        const recs = await recommend(env).catch(e => {
          console.error('recommend 失败:', e);
          return [];
        });
        await fetchSteam(env).catch(e => console.error('fetchSteam 失败:', e));
        await notifyRecommendResult(env, recs?.length || 0).catch(() => {});
        break;
      }
      case '30 3 * * 1': {
        console.log('开始每周游戏库同步...');
        await fetchLibrary(env).catch(e => console.error('fetchLibrary 失败:', e));
        await fillDetails(env).catch(e => console.error('fillDetails 失败:', e));
        const libAfter = (await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json'))?.games?.length || 0;
        const libHours = (await env.KV.get(KV_KEYS.DATA_LIBRARY, 'json'))?.total_playtime_hours || 0;
        await notifyLibraryResult(env, libAfter, libHours).catch(() => {});
        break;
      }
      case '0 4 * * *': {
        console.log('开始检查降价...');
        await checkDiscounts(env).catch(e => console.error('checkDiscounts 失败:', e));
        break;
      }
      default:
        console.log('未知 cron:', event.cron);
    }
  },
};
