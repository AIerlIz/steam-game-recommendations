<p align="center">
  <img src="public/assets/logo.svg" width="100" height="100" alt="GameSeeker">
</p>

<h1 align="center">识游 · GameSeeker</h1>

<p align="center">AI 驱动的 Steam 游戏探索工具 · Cloudflare Workers 原生部署 · TypeScript 全栈</p>

## 架构

```
Cloudflare Worker (worker/index.ts)
  ├── fetch handler
  │   ├── /               → Assets (public/index.html)
  │   ├── /api/auth/*     → D1 Steam 认证
  │   ├── /api/library    → 用户游戏库
  │   ├── /api/recommendations → AI 推荐
  │   ├── /api/search     → 游戏搜索
  │   ├── /api/subscriptions  → 订阅管理
  │   ├── /api/bot/*      → Telegram Bot
  │   └── /api/proxy/*    → Steam API 转发
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
- 在 Worker 设置 → 变量 → 添加环境变量 `ADMIN_PASSWORD`（管理后台密码）

### 2. 管理后台配置

配置通过 D1 `config` 表管理。运行 `npm run init-db` 初始化数据库后，通过 D1 dashboard 或 `wrangler d1 execute` 配置以下 key：

| Key | 说明 |
|-----|------|
| `STEAM_API_KEY` | Steam API Key |
| `STEAM_USER_ID` | Steam 数字 ID |
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
| `worker/index.ts` | Worker 入口：路由分发 + 管理后台 + Cron 调度 |
| `worker/lib/steam.ts` | Steam API 封装：请求重试/退避/并发/详情/评测 |
| `worker/lib/steam-api.ts` | HttpSteamClient 实现（SteamAPIClient 接口） |
| `worker/lib/kv-keys.ts` | KV 键名常量 + 过渡期 KV 访问函数 |
| `worker/lib/llm.ts` | LLM 客户端：OpenAI / DeepSeek / Qwen |
| `worker/lib/scoring.ts` | 加权评分 + 系列过滤算法 |
| `worker/lib/profile.ts` | 用户多兴趣画像构建 |
| `worker/lib/recommend.ts` | 推荐管线编排（LLM + 评分 + 验证) |
| `worker/lib/genre-data.ts` | 品类聚类 + 系列模式数据 |
| `worker/lib/telegram.ts` | Telegram Bot 路由 + 通知 |
| `worker/types.ts` | 领域类型 + 接口定义 |
| `public/index.html` | 前端单页应用 |
| `test/` | 单元测试（Vitest + MockSteamClient） |

## 本地开发

```bash
npm install
npm run dev         # wrangler dev
npm run typecheck   # 类型检查
npm run lint        # ESLint
npm test            # 单元测试
npm run format      # Prettier 格式化
```

## 项目约定

详见 `AGENTS.md`。
