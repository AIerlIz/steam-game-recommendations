Always respond in Chinese. All communication must be in Chinese unless the user explicitly asks otherwise.

## 版本号管理

每次提交推送前，检查 `public/index.html` 中的 `APP_VERSION` 常量，将其递增后推送。版本号格式为 `v<major>.<minor>.<patch>`，遵循 semver 语义。

## 项目架构

Cloudflare Workers + D1 全栈部署：
- `worker/index.ts` — Worker 入口（fetch + cron）
- `worker/types.ts` — 领域类型 + KVStore/SteamAPIClient/LLMClient 接口
- `worker/env.d.ts` — 全局 `Env` interface 合并（追加 `ADMIN_PASSWORD` 和 `DB: D1Database`）
- `worker/lib/` — 核心库（kv-keys.ts / steam-api.ts / steam.ts / llm.ts / deepsteam.ts / scoring.ts / profile.ts / genre-data.ts / recommend.ts / telegram.ts）
- `worker/scripts/` — 数据管线脚本（fetch-steam.ts / fetch-library.ts / fill-details.ts）
- `worker/auth/` — D1 认证服务（steam.ts / session.ts）
- `worker/api/` — API 路由（library.ts / recommendations.ts / search.ts / subscriptions.ts）
- `worker/db/` — D1 数据库初始化
- `test/` — 单元测试（Vitest + MockSteamClient）
- `public/` — 静态前端文件（index.html / admin.html）

存储层：D1 为主存储（用户、游戏库、推荐、订阅、配置），KV 为 Telegram Bot 会话缓存和旧管线兼容层（过渡期）。

## 开发命令

- `npm run dev` — 本地开发（wrangler dev）
- `npm run deploy` — 部署
- `npm run typecheck` — 类型检查（自动 `wrangler types` + `tsc --noEmit`）
- `npm run lint` — ESLint（typescript-eslint strict）
- `npm test` — Vitest 单元测试
- `npm run format` — Prettier 格式化

## 命名/代码约定

- `.ts` 文件 import 路径使用 `.js` 后缀（wrangler esbuild 约定）
- 类型优先使用 `types.ts` 中定义的 interface，避免 `any`
- KV 键名前缀通过 `kv-keys.ts` 中的 `KV_KEYS` 常量访问
- 测试使用 MockSteamClient（实现 SteamAPIClient 接口）

## Agent skills

### Issue tracker

GitHub Issues，外部 PR 作为请求来源。详见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认标签：needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix。详见 `docs/agents/triage-labels.md`。

### Domain docs

单上下文布局。详见 `docs/agents/domain.md`。
