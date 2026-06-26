Always respond in Chinese. All communication must be in Chinese unless the user explicitly asks otherwise.

## 版本号管理

每次提交推送前，检查 `public/index.html` 中的 `APP_VERSION` 常量，将其递增后推送。版本号格式为 `v<major>.<minor>.<patch>`，遵循 semver 语义。

## 项目架构

Cloudflare Workers 原生部署 + TypeScript 全栈：
- `worker/index.ts` — Worker 入口（fetch + cron）
- `worker/types.ts` — 领域类型 + KVStore/SteamAPIClient/LLMClient 接口
- `worker/env.d.ts` — 全局 `Env` interface 合并（追加 `ADMIN_PASSWORD`）
- `worker/lib/` — 核心库（store.ts / steam-api.ts / steam.ts / llm.ts / deepsteam.ts / scoring.ts / profile.ts / genre-data.ts / recommend.ts / telegram.ts）
- `worker/scripts/` — 数据管线脚本（fetch-steam.ts / fetch-library.ts / fill-details.ts）
- `test/` — 单元测试（Vitest + InMemoryKvStore + MockSteamClient）
- `public/` — 静态前端文件（index.html / admin.html）

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
- KV 键名前缀通过 `KV_KEYS` 常量访问（store.ts / steam.ts）
- 向后兼容函数（steam.ts 中的旧 KV/Steam API）标注「待迁移完成后移除」
- 测试使用 InMemoryKvStore（实现 KVStore 接口）和 MockSteamClient（实现 SteamAPIClient 接口）
