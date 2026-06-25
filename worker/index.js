import { autoRecommend } from './lib/deepsteam.js';
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
  await env.KV.put(`admin:session:${id}`, JSON.stringify(session), { expirationTtl: 86400 });
  return id;
}

async function validateSession(env, cookie) {
  if (!cookie) return false;
  const data = await env.KV.get(`admin:session:${cookie}`, 'json');
  return !!data;
}

async function deleteSession(env, cookie) {
  if (cookie) await env.KV.delete(`admin:session:${cookie}`);
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

function htmlResponse(body, status = 200, extraHeaders = {}) {
  return new Response(body, {
    status,
    headers: { 'Content-Type': 'text/html;charset=UTF-8', ...extraHeaders },
  });
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

  if (method === 'GET') {
    const list = await env.KV.list({ prefix: 'config:' });
    const configs = {};
    for (const key of list.keys) {
      const val = await env.KV.get(key.name);
      configs[key.name.replace('config:', '')] = { value: val };
    }
    return jsonResponse(configs);
  }

  if (method === 'PUT') {
    const { key, value } = await request.json();
    if (!key) return jsonResponse({ error: '缺少 key' }, 400);
    await env.KV.put(`config:${key}`, String(value));
    return jsonResponse({ ok: true });
  }

  if (method === 'DELETE') {
    const { key } = await request.json();
    if (!key) return jsonResponse({ error: '缺少 key' }, 400);
    await env.KV.delete(`config:${key}`);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: '不支持的请求方法' }, 405);
}

// ---------- Admin HTML ----------

function adminHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>GameSeeker Admin</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#030712;color:#e2e8f0;min-height:100vh}
.container{max-width:800px;margin:0 auto;padding:40px 20px}
h1{font-size:1.8em;font-weight:800;background:linear-gradient(135deg,#a855f7,#3b82f6);-webkit-background-clip:text;-webkit-text-fill-color:transparent;margin-bottom:24px}
.card{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:24px;margin-bottom:20px}
.form-row{display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap}
.form-row input,.form-row select{flex:1;min-width:150px;padding:10px 14px;background:#1e293b;border:1px solid #334155;border-radius:8px;color:#e2e8f0;font-size:14px}
.form-row input:focus{outline:none;border-color:#a855f7}
.btn{padding:10px 20px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;transition:all .2s}
.btn-primary{background:linear-gradient(135deg,#a855f7,#3b82f6);color:#fff}
.btn-primary:hover{opacity:.9}
.btn-danger{background:#dc2626;color:#fff}
.btn-danger:hover{opacity:.9}
.btn-sm{padding:6px 12px;font-size:12px}
table{width:100%;border-collapse:collapse}
th,td{padding:12px;text-align:left;border-bottom:1px solid #1e293b}
th{color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px}
td{font-size:14px}
.key-cell{color:#a855f7;font-family:monospace;max-width:200px;overflow:hidden;text-overflow:ellipsis}
.val-cell{font-family:monospace;max-width:250px;overflow:hidden;text-overflow:ellipsis}
.actions{display:flex;gap:8px}
.status-bar{background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px 24px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
.status-bar .stat{font-size:14px;color:#94a3b8}
.status-bar .stat strong{color:#e2e8f0}
.toast{position:fixed;bottom:20px;right:20px;padding:12px 24px;border-radius:8px;color:#fff;font-size:14px;z-index:1000;opacity:0;transition:opacity .3s}
.toast.show{opacity:1}
.toast-success{background:#059669}
.toast-error{background:#dc2626}
.password-input{width:100%;padding:14px 20px;background:#1e293b;border:1px solid #334155;border-radius:12px;color:#e2e8f0;font-size:16px;text-align:center;margin-bottom:16px}
.password-input:focus{outline:none;border-color:#a855f7}
.login-box{max-width:360px;margin:100px auto;text-align:center}
.login-box h2{margin-bottom:24px;font-size:1.4em}
.eye-btn{background:none;border:none;color:#94a3b8;cursor:pointer;padding:4px;font-size:14px}
.eye-btn:hover{color:#e2e8f0}
.toolbar{display:flex;justify-content:space-between;align-items:center;margin-bottom:16px}
.empty{text-align:center;color:#64748b;padding:40px;font-size:14px}
.loading{text-align:center;color:#64748b;padding:20px}
.hidden{display:none}
.data-link{color:#3b82f6;text-decoration:none;font-size:13px}
.data-link:hover{text-decoration:underline}
.logout-link{color:#94a3b8;text-decoration:none;font-size:14px;cursor:pointer}
.logout-link:hover{color:#e2e8f0}
</style>
</head>
<body>
<div class="container" id="app">
  <div id="login-view" class="login-box">
    <h1>GameSeeker</h1>
    <h2>管理后台</h2>
    <input type="password" id="password-input" class="password-input" placeholder="输入管理员密码" autofocus onkeydown="if(event.key==='Enter')login()">
    <button class="btn btn-primary" onclick="login()" style="width:100%">登录</button>
    <p id="login-error" style="color:#dc2626;margin-top:12px;font-size:13px;display:none"></p>
  </div>
  <div id="admin-view" class="hidden">
    <div class="toolbar">
      <h1>GameSeeker Admin</h1>
      <span class="logout-link" onclick="logout()">退出登录</span>
    </div>
    <div class="card">
      <h3 style="margin-bottom:16px;font-size:16px">添加配置</h3>
      <div class="form-row">
        <input type="text" id="new-key" placeholder="配置名称（如 LLM_PROVIDER）">
        <input type="text" id="new-value" placeholder="值">
        <button class="btn btn-primary" onclick="addConfig()">添加</button>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:16px;font-size:16px">Telegram Bot</h3>
      <div class="form-row">
        <input type="password" id="tg-token" placeholder="Bot Token（从 @BotFather 获取）">
        <input type="text" id="tg-admin" placeholder="Admin Chat ID">
      </div>
      <div style="display:flex;gap:12px;flex-wrap:wrap">
        <button class="btn btn-primary" onclick="saveTelegram()">保存配置</button>
        <button class="btn btn-primary" onclick="setWebhook()">设置 Webhook</button>
      </div>
      <p id="tg-status" style="margin-top:8px;font-size:13px;color:#94a3b8"></p>
    </div>
    <div class="card">
      <h3 style="margin-bottom:16px;font-size:16px">配置列表</h3>
      <div id="config-loading" class="loading">加载中...</div>
      <div id="config-empty" class="empty hidden">暂无配置</div>
      <div id="config-table-wrap" class="hidden">
        <table><thead><tr><th>配置项</th><th>值</th><th>操作</th></tr></thead><tbody id="config-tbody"></tbody></table>
      </div>
    </div>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>
const HIDDEN_KEYS = ['TELEGRAM'];
const SENSITIVE_KEYS = ['STEAM_API_KEY','LLM_API_KEY'];

async function api(path, opts = {}) {
  const resp = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...opts.headers },
    ...opts,
  });
  return resp;
}

function toast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast toast-' + type + ' show';
  setTimeout(() => el.classList.remove('show'), 3000);
}

async function checkAuth() {
  const resp = await api('/admin/api/config');
  if (resp.ok) {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('admin-view').classList.remove('hidden');
    loadConfigs();
  }
}
checkAuth();

async function login() {
  try {
    const password = document.getElementById('password-input').value;
    if (!password) { toast('请输入密码', 'error'); return; }
    const resp = await api('/admin/login', { method: 'POST', body: JSON.stringify({ password }) });
    if (resp.ok) {
      document.getElementById('login-view').classList.add('hidden');
      document.getElementById('admin-view').classList.remove('hidden');
      loadConfigs();
    } else {
      const err = await resp.json().catch(() => ({}));
      document.getElementById('login-error').textContent = err.error || '登录失败';
      document.getElementById('login-error').style.display = 'block';
    }
  } catch (e) {
    console.error('登录错误:', e);
    toast('网络错误: ' + e.message, 'error');
  }
}

async function logout() {
  await api('/admin/logout', { method: 'POST' });
  document.getElementById('login-view').classList.remove('hidden');
  document.getElementById('admin-view').classList.add('hidden');
}

async function loadConfigs() {
  const loading = document.getElementById('config-loading');
  const empty = document.getElementById('config-empty');
  const tableWrap = document.getElementById('config-table-wrap');
  const tbody = document.getElementById('config-tbody');
  loading.classList.remove('hidden');
  empty.classList.add('hidden');
  tableWrap.classList.add('hidden');
  tbody.innerHTML = '';
  const resp = await api('/admin/api/config');
  if (!resp.ok) { toast('加载失败', 'error'); return; }
  const configs = await resp.json();
  loading.classList.add('hidden');
  const keys = Object.keys(configs);
  if (!keys.length) { empty.classList.remove('hidden'); return; }
  tableWrap.classList.remove('hidden');
  // Populate Telegram fields
  const tgRaw = configs['TELEGRAM'];
  if (tgRaw) {
    try {
      const tg = JSON.parse(tgRaw.value);
      document.getElementById('tg-token').value = tg.token || '';
      document.getElementById('tg-admin').value = tg.adminChatId || '';
    } catch(e) {}
  }

  for (const key of keys) {
    if (HIDDEN_KEYS.includes(key)) continue;
    const tr = document.createElement('tr');
    const isSensitive = SENSITIVE_KEYS.includes(key);
    const masked = isSensitive ? '••••••••' : configs[key].value;
    tr.innerHTML = '<td class="key-cell">' + esc(key) + '</td>' +
      '<td class="val-cell"><span id="val-' + esc(key) + '">' + esc(masked) + '</span>' +
      (isSensitive ? \` <button class="eye-btn" onclick="toggleShow('\${esc(key)}')">👁</button>\` : '') +
      '</td>' +
      \`<td class="actions"><button class="btn btn-sm btn-danger" onclick="deleteConfig('\${esc(key)}')">删除</button></td>\`;
    tbody.appendChild(tr);
  }
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

function toggleShow(key) {
  const el = document.getElementById('val-' + key);
  if (el.dataset.revealed === 'true') {
    el.textContent = '••••••••';
    el.dataset.revealed = 'false';
  } else {
    loadConfigs();
    el.dataset.revealed = 'true';
  }
}

async function addConfig() {
  const key = document.getElementById('new-key').value.trim();
  const value = document.getElementById('new-value').value.trim();
  if (!key || !value) { toast('请输入配置名称和值', 'error'); return; }
  const resp = await api('/admin/api/config', { method: 'PUT', body: JSON.stringify({ key, value }) });
  if (resp.ok) {
    toast('配置已保存');
    document.getElementById('new-key').value = '';
    document.getElementById('new-value').value = '';
    loadConfigs();
  } else {
    toast('保存失败', 'error');
  }
}

async function deleteConfig(key) {
  if (!confirm('确定删除 ' + key + ' 吗？')) return;
  const resp = await api('/admin/api/config', { method: 'DELETE', body: JSON.stringify({ key }) });
  if (resp.ok) {
    toast('已删除');
    loadConfigs();
  } else {
    toast('删除失败', 'error');
  }
}

async function saveTelegram() {
  const token = document.getElementById('tg-token').value.trim();
  const adminChatId = document.getElementById('tg-admin').value.trim();
  if (!token || !adminChatId) { toast('请填写完整', 'error'); return; }
  const resp = await api('/admin/api/config', {
    method: 'PUT',
    body: JSON.stringify({ key: 'TELEGRAM', value: JSON.stringify({ token, adminChatId }) }),
  });
  if (resp.ok) {
    toast('Telegram 配置已保存');
    document.getElementById('tg-status').textContent = '✅ 已保存';
    loadConfigs();
  } else {
    toast('保存失败', 'error');
  }
}

async function setWebhook() {
  const resp = await api('/api/bot/set-webhook');
  const data = await resp.json();
  if (data.ok) {
    toast('Webhook 设置成功');
    document.getElementById('tg-status').textContent = '✅ Webhook 已设置';
  } else {
    toast('Webhook 设置失败: ' + (data.description || '未知错误'), 'error');
  }
}
</script>
</body>
</html>`;
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

    if (path.startsWith('/admin')) {
      if (path === '/admin/api/config') {
        const session = await requireAuth(request, env);
        if (!session) return jsonResponse({ error: '未登录' }, 401);
        return handleAdminApi(request, env);
      }
      const session = await requireAuth(request, env);
      if (!session) return htmlResponse(adminHtml());
      return htmlResponse(adminHtml());
    }

    if (path === '/games.json') {
      const data = await env.KV.get('data:games', 'json');
      return jsonResponse(data || { games: [], total_owned: 0 });
    }

    if (path === '/games_detail.json') {
      const data = await env.KV.get('data:games_detail', 'json');
      return jsonResponse(data || { games: [], total_owned: 0 });
    }

    if (path === '/library.json') {
      const data = await env.KV.get('data:library', 'json');
      return jsonResponse(data || { games: [], total_games: 0, total_playtime_hours: 0 });
    }

    if (path === '/api/bot/webhook') {
      return handleWebhook(request, env);
    }

    if (path === '/api/bot/set-webhook') {
      const tgConfig = await env.KV.get('config:TELEGRAM', 'json');
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
        const recs = await autoRecommend(env).catch(e => {
          console.error('autoRecommend 失败:', e);
          return [];
        });
        await fetchSteam(env).catch(e => console.error('fetchSteam 失败:', e));
        await notifyRecommendResult(env, recs?.length || 0).catch(() => {});
        break;
      }
      case '30 3 * * 1': {
        console.log('开始每周游戏库同步...');
        const libBefore = (await env.KV.get('data:library', 'json'))?.games?.length || 0;
        await fetchLibrary(env).catch(e => console.error('fetchLibrary 失败:', e));
        await fillDetails(env).catch(e => console.error('fillDetails 失败:', e));
        const libAfter = (await env.KV.get('data:library', 'json'))?.games?.length || 0;
        const libHours = (await env.KV.get('data:library', 'json'))?.total_playtime_hours || 0;
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
