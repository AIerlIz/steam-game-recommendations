<p align="center">
  <img src="public/assets/logo.svg" width="100" height="100" alt="GameSeeker">
</p>

<h1 align="center">识游 · GameSeeker</h1>

<p align="center">AI 驱动的 Steam 游戏探索工具 · Cloudflare Workers 原生部署</p>

## 架构

```
Cloudflare Worker (worker/index.js)
├── fetch handler
│   ├── /               → Assets (public/index.html)
│   ├── /games.json     → KV data:games
│   ├── /games_detail.json → KV data:games_detail
│   ├── /library.json   → KV data:library
│   ├── /api/proxy/*    → Steam API 转发
│   └── /admin          → 管理后台
│
└── scheduled handler
    ├── 0 3 * * *       → auto_recommend + fetch_steam
    └── 30 3 * * 1      → fetch_library + fill_details
```

## 部署

### 1. Cloudflare Dashboard 操作

- 进入 Cloudflare Dashboard → Workers & Pages → 创建 → 连接 Git 仓库
- 选择本仓库，保存
- 创建 KV Namespace（如 `gameseeker-kv`）
- 在 Worker 设置中绑定 KV，变量名 `KV`
- 在 KV 中手动写入 `config:ADMIN_PASSWORD`（管理后台密码）

### 2. 管理后台配置

- 访问 `https://{your-worker}.workers.dev/admin`
- 输入初始密码（KV 中的 `config:ADMIN_PASSWORD`）
- 在管理页面配置以下 key：

| Key | 说明 |
|-----|------|
| `STEAM_API_KEY` | Steam API Key |
| `STEAM_USER_ID` | Steam 数字 ID 或 URL 名 |
| `LLM_PROVIDER` | `openai` / `deepseek` / `qwen` |
| `LLM_API_KEY` | LLM API Key |
| `LLM_API_BASE` | 可选，自定义 API 端点 |
| `LLM_MODEL` | 可选，模型名 |
| `STEAM_LANG` | 可选，默认 `schinese` |
| `RECOMMEND_K` | 可选，默认 `200` |

### 3. 推送即部署

推送 `main` 分支 → Cloudflare 自动部署 Worker。

## 数据管线

| Cron | 任务 | 功能 |
|------|------|------|
| 每天 03:00 UTC | `auto_recommend` | DeepSteam 算法：多兴趣路由 → LLM 推荐 → 拉取详情 |
| 每周一 03:30 UTC | `fetch_library` | 全量游戏库同步 → 补全缺失详情 |

## 模块

| 文件 | 功能 |
|------|------|
| `worker/index.js` | Worker 入口：路由分发 + 管理后台 + Cron 调度 |
| `worker/lib/steam.js` | Steam API 封装：请求重试/退避/并发/详情/评测 |
| `worker/lib/llm.js` | LLM 客户端：OpenAI / DeepSeek / Qwen |
| `worker/lib/deepsteam.js` | DeepSteam 算法：多兴趣路由 + IDF 加权 + RRF 融合 + 系列过滤 |
| `worker/scripts/fetch-steam.js` | 增量拉取 Steam 详情合并 |
| `worker/scripts/fetch-library.js` | 全量游戏库获取 |
| `worker/scripts/fill-details.js` | 补全缺失的游戏详情 |
| `public/index.html` | 前端单页应用 |

## 本地开发

```bash
npm install
npx wrangler dev
```
