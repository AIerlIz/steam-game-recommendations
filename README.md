<p align="center">
  <img src="assets/logo.svg" width="100" height="100" alt="GameSeeker">
</p>

<h1 align="center">识游 · GameSeeker</h1>

<p align="center">AI 驱动的 Steam 游戏探索工具</p>

## 快速开始

### 1. 配置 Secrets

在仓库 Settings → Secrets and variables → Actions 中添加：

| Secret | 说明 |
|--------|------|
| `STEAM_API_KEY` | Steam API Key |
| `STEAM_USER_ID` | Steam 数字 ID 或 URL 名 |
| `LLM_PROVIDER` | `gemini` / `openai` / `deepseek` / `qwen` |
| `LLM_API_KEY` | LLM API Key |
| `LLM_API_BASE` | 可选，自定义 API 端点 |
| `LLM_MODEL` | 可选，模型名 |
| `RECOMMEND_K` | 可选，参考游戏数量曲线（默认 `200`） |
| `STEAM_LANG` | 可选，Steam 语言（默认 `schinese`） |
| `PROXY_BASE` | CORS 代理地址，见下方说明 |

### 2. 手动运行

```bash
pip install -r requirements.txt

export STEAM_API_KEY="xxx"
export STEAM_USER_ID="xxx"
export LLM_PROVIDER="gemini"
export LLM_API_KEY="xxx"

python3 .github/scripts/auto_recommend.py      # LLM 推荐 → games.json
python3 .github/scripts/fetch_steam.py          # Steam API 获取详情 → games_detail.json
python3 .github/scripts/fetch_library.py        # 获取全部游戏库数据 → library.json
python3 .github/scripts/fill_library_details.py # 补全缺失详情
```

### 3. 自动化

| Workflow | 触发 | 功能 |
|----------|------|------|
| `auto_recommend.yml` | 每天 03:00 + push 到 `auto_recommend.py` | AI 推荐 → 获取详情 → 部署 |
| `fetch_library.yml` | 每周六 03:00 + 手动 | 全量库数据获取 → 补全详情 → 部署 |
| `deploy-pages.yml` | 推送 `index.html`  | 部署 GitHub Pages |

## 架构

```
LLM 推荐管线:
  auto_recommend.py → Steam API + LLM → games.json
  fetch_steam.py    → Steam API 8线程并发 → games_detail.json

游戏库管线:
  fetch_library.py        → Steam API 2线程节流 → library.json（含评测、过滤）
  fill_library_details.py → 补全缺失的图片/描述/标签/评测 → library.json

前端:
  index.html → 双 Tab（推荐 / 库）、标签筛选、排序、懒加载分页、覆盖层、Lightbox
  GitHub Pages 托管静态文件
```

## 模块

| 文件 | 功能 |
|------|------|
| `auto_recommend.py` | DeepSteam 算法：多兴趣路由 + IDF 加权画像 + 意图重写 + RRF 融合排序 + 系列过滤 |
| `fetch_steam.py` | 8 线程并发获取 Steam 详情与评测 |
| `fetch_library.py` | 2 线程节流获取全部游戏库详情 + 评测，生成 library.json |
| `fill_library_details.py` | 2 线程节流补全缺失详情与评测 |
| `llm.py` | 统一 LLM 接口，支持 Gemini / OpenAI / DeepSeek / Qwen |
| `common.py` | 公共函数：`_request_with_retry` 指数退避、`batch_fetch` 并发节流、JSON 读写、ID 解析 |

## 页面功能

- 双 Tab 切换：推荐视图（含 AI 推荐理由）/ 库视图（含游玩时长）
- 封面悬停向上弹出推荐理由或游戏简介
- 覆盖层悬停时滚轮翻页
- 标签多选筛选，颜色自动生成，促销标签紧跟全部
- 排序下拉（推荐：默认/评分/价格/日期；库：游玩时长/评分/名称）
- 截图 Lightbox + 触屏滑动手势
- 懒加载分页，滚动加载更多
- 悬停覆盖层时滚轮切换页面
- 点击复制游戏名

## CORS 代理

前端复制游戏名时需通过 Steam API 查询英文名。Steam API 不支持浏览器跨域请求，需部署一个 CORS 代理。

### 方案：Cloudflare Workers

使用 [CF-Proxy](https://github.com/sinspired/CF-Proxy) 部署：

1. 在 Cloudflare Dashboard 创建 Worker，将 [worker.js](https://github.com/sinspired/CF-Proxy/blob/main/worker.js) 内容粘贴部署
2. 绑定自定义域名（如 `cfproxy.yourdomain.top`）
3. 在 GitHub 仓库 Settings → Secrets → Actions 添加 `PROXY_BASE`，值为 `https://cfproxy.yourdomain.top`

代理接收完整 URL 作为路径：`https://cfproxy.yourdomain.top/https://store.steampowered.com/api/appdetails?...`

三个部署工作流（`auto_recommend.yml` / `fetch_library.yml` / `deploy-pages.yml`）均会在构建时用 `${{ secrets.PROXY_BASE }}` 替换 `index.html` 中的 `__PROXY_BASE__` 占位符。
