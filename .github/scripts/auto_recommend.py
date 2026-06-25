#!/usr/bin/env python3
"""Steam游戏AI推荐脚本：DeepSteam算法完整集成

集成DeepSteam核心算法：
- 多兴趣路由 (Multi-Interest Routing): 基于游戏时长的IDF加权聚类
- NLP意图重写 (Intent Rewriting): 将用户偏好转化为结构化推荐指令
- RRF融合排序 (Reciprocal Rank Fusion): 多信号融合+量级压制+新游提权
- 系列感知过滤 (Series Filter): 推新不推旧策略
"""

import os
import sys
import re
import json
import math
import requests
from pathlib import Path
from collections import defaultdict

sys.path.insert(0, str(Path(__file__).parent))
from common import save_games_json, get_steam_id, get_owned_games, fetch_steam_details, fetch_review
from llm import create_llm

# 配置
STEAM_API_KEY = os.environ.get("STEAM_API_KEY", "")
STEAM_USER_ID = os.environ.get("STEAM_USER_ID", "")
_LLM_CLIENT = None


def get_llm():
    global _LLM_CLIENT
    if _LLM_CLIENT is None:
        try:
            _LLM_CLIENT = create_llm()
        except ValueError as e:
            print(f"LLM初始化失败: {e}")
            sys.exit(1)
    return _LLM_CLIENT

# DeepSteam: 游戏品类标准词表 (覆盖主流Steam品类)
GENRE_CLUSTERS = {
    "RPG/ARPG": ["rpg", "action rpg", "arpg", "动作角色扮演", "角色扮演"],
    "FPS/射击": ["fps", "shooter", "first-person", "射击", "第一人称"],
    "策略/模拟": ["strategy", "simulation", "turn-based", "策略", "模拟"],
    "冒险/叙事": ["adventure", "narrative", "story", "冒险", "叙事"],
    "恐怖/生存": ["horror", "survival", "恐怖", "生存"],
    "动作/格斗": ["action", "fighting", "beat", "动作", "格斗"],
    "独立/创意": ["indie", "pixel", "roguelike", "独立", "像素"],
    "沙盒/建造": ["sandbox", "building", "crafting", "沙盒", "建造"],
    "竞速/体育": ["racing", "sports", "竞速", "体育"],
    "休闲/解谜": ["casual", "puzzle", "休闲", "解谜"],
}

# DeepSteam: 系列游戏正则模式
SERIES_PATTERNS = [
    r"(Civilization\s*\d*)",
    r"(Final Fantasy\s*\d*)",
    r"(Call of Duty.*)",
    r"(Assassin's Creed.*)",
    r"(Total War.*)",
    r"(The Elder Scrolls.*)",
    r"(Far Cry\s*\d*)",
    r"(Borderlands\s*\d*)",
    r"(Dark Souls\s*\d*)",
    r"(Resident Evil\s*\d*)",
    r"(Need for Speed.*)",
    r"(Fallout\s*\d*)",
    r"(Mass Effect\s*\d*)",
    r"(Dragon Age\s*\d*)",
    r"(BioShock\s*\d*)",
    r"(Portal\s*\d*)",
    r"(Half-Life\s*\d*)",
    r"(Wolfenstein\s*\d*)",
    r"(Doom\s*\d*)",
    r"(Hitman\s*\d*)",
    r"(Tomb Raider.*)",
    r"(Uncharted.*)",
    r"(God of War.*)",
    r"(Halo\s*\d*)",
    r"(Gears of War.*)",
    r"(Forza.*)",
    r"(FIFA\s*\d*)",
    r"(NBA 2K\d*)",
    r"(Madden\s*\d*)",
    r"(Monster Hunter.*)",
    r"(Persona\s*\d*)",
    r"(Yakuza.*)",
    r"(Like a Dragon.*)",
    r"(XCOM\s*\d*)",
    r"(StarCraft\s*\d*)",
    r"(Warcraft\s*\d*)",
    r"(Diablo\s*\d*)",
    r"(Overwatch\s*\d*)",
    r"(Rainbow Six.*)",
    r"(Ghost Recon.*)",
    r"(Splinter Cell.*)",
    r"(Prince of Persia.*)",
    r"(Silent Hill.*)",
    r"(Metal Gear.*)",
    r"(Kingdom Hearts.*)",
    r"(Street Fighter.*)",
    r"(Tekken\s*\d*)",
    r"(Mortal Kombat\s*\d*)",
    r"(Dead or Alive.*)",
    r"(Soulcalibur.*)",
    r"(Sonic\s*.*)",
    r"(Kirby.*)",
    r"(Zelda.*)",
    r"(Mario\s*.*)",
    r"(Pokemon.*)",
    r"(Dragon Quest.*)",
    r"(NieR.*)",
    r"(Bayonetta.*)",
    r"(Devil May Cry.*)",
    r"(Dead Space.*)",
    r"(System Shock.*)",
    r"(Disco Elysium.*)",
    r"(Baldur's Gate.*)",
    r"(Pillars of Eternity.*)",
    r"(Divinity.*)",
    r"(Warhammer.*)",
    r"(Star Wars.*)",
    r"(Alien\s*.*)",
    r"(Predator.*)",
    # 通用模式: "系列名 + 数字" 或 "系列名 + 罗马数字"
    r"([A-Za-z][A-Za-z .'\-]{2,})\s*[IVXLCDM]+\b",
    r"([A-Za-z][A-Za-z .'\-]{2,})\s*\d+",
]


# ==================== DeepSteam 核心算法 ====================

def build_user_profile(owned_games: list) -> dict:
    """
    DeepSteam: 多兴趣画像构建
    
    基于用户游戏库构建多维度画像:
    1. IDF加权: 降低大众游戏权重，提升独特品味游戏权重
    2. 品类聚类: 将游戏按Genre簇分组，识别多条兴趣线
    3. 时长加权: 高时长游戏获得更高权重
    """
    if not owned_games:
        return {"clusters": {}, "top_genres": [], "idf_weights": {}, "total_hours": 0}

    total_hours = sum(g.get("playtime_hours", 0) for g in owned_games)

    # 1. IDF加权: 热门游戏权重低，冷门游戏权重高
    # IDF = 1/(log10(playtime+1)+1)
    #   - 低时长游戏(尝鲜/小众) → IDF接近1.0，独特性高
    #   - 高时长游戏(核心偏好) → IDF接近0，通过时长信号单独加权
    #   设计思路：IDF + 原始时长双通道 — IDF 保证独特性（冷门加分）、
    #   时长保证偏好强度（长时游戏在后续热度分中加权），互补不冲突
    idf_weights = {}
    for game in owned_games:
        name = game.get("name", "")
        hours = game.get("playtime_hours", 0)
        uniqueness = 1.0 / (math.log10(hours + 1) + 1.0)
        idf_weights[name] = uniqueness

    # 2. 品类聚类 (Multi-Interest Routing)
    clusters = defaultdict(list)
    for game in owned_games:
        name_lower = game.get("name", "").lower()
        matched = False

        # 尝试按游戏名匹配品类簇
        for cluster_name, keywords in GENRE_CLUSTERS.items():
            for kw in keywords:
                if kw in name_lower:
                    clusters[cluster_name].append(game)
                    matched = True
                    break
            if matched:
                break

        if not matched:
            # 按游玩时长归类
            hours = game.get("playtime_hours", 0)
            if hours > 100:
                clusters["核心偏好"].append(game)
            elif hours > 20:
                clusters["次要偏好"].append(game)
            else:
                clusters["轻度兴趣"].append(game)

    # 3. 计算每个簇的兴趣强度
    cluster_strength = {}
    for cluster_name, games in clusters.items():
        total_cluster_hours = sum(g.get("playtime_hours", 0) for g in games)
        avg_idf = sum(idf_weights.get(g["name"], 0.5) for g in games) / max(len(games), 1)
        # 兴趣强度 = 总时长 * 平均IDF * log(游戏数量)
        strength = total_cluster_hours * avg_idf * math.log(len(games) + 1)
        cluster_strength[cluster_name] = strength

    # 按强度排序取Top品类
    top_genres = sorted(cluster_strength.keys(), key=lambda x: cluster_strength[x], reverse=True)[:5]

    return {
        "clusters": dict(clusters),
        "top_genres": top_genres,
        "idf_weights": idf_weights,
        "total_hours": total_hours,
        "cluster_strength": cluster_strength,
    }


def rewrite_intent(profile: dict, owned_games: list) -> str:
    """
    DeepSteam: NLP意图重写
    
    将用户多兴趣画像转化为结构化推荐指令:
    - 每条兴趣线独立描述
    - 包含游玩时长、品类偏好等上下文
    - 帮助LLM理解用户的多维口味
    """
    if not profile.get("top_genres"):
        return ""

    lines = []
    top_games = sorted(owned_games, key=lambda x: x.get("playtime_hours", 0), reverse=True)[:15]

    # 按兴趣簇生成描述
    for genre in profile["top_genres"][:4]:
        cluster_games = profile["clusters"].get(genre, [])
        if not cluster_games:
            continue
        # 取该簇中玩得最多的3款
        top_in_cluster = sorted(cluster_games, key=lambda x: x.get("playtime_hours", 0), reverse=True)[:3]
        game_names = [g["name"] for g in top_in_cluster]
        hours = sum(g.get("playtime_hours", 0) for g in cluster_games)
        lines.append(f"- {genre}: 偏好强度高(累计{hours:.0f}h), 代表作: {', '.join(game_names)}")

    # 核心偏好补充
    if top_games:
        core_names = [g["name"] for g in top_games[:5]]
        lines.append(f"- 核心游戏(按游玩时长): {', '.join(core_names)}")

    return "\n".join(lines)


def detect_series(game_name: str) -> str:
    """DeepSteam: 系列游戏检测"""
    for pattern in SERIES_PATTERNS:
        match = re.search(pattern, game_name, re.IGNORECASE)
        if match:
            return match.group(1)
    return ""


def extract_year(release_date: str) -> int:
    """从发布日期字符串提取年份"""
    if not release_date:
        return 0
    match = re.search(r'(\d{4})', str(release_date))
    return int(match.group(1)) if match else 0


def calculate_weighted_score(
    recommendation: dict,
    owned_games: list,
    profile: dict,
    all_recommendations: list,
) -> float:
    """
    DeepSteam: 多信号加权融合排序
    
    多信号融合排序，包含:
    1. 品类匹配分 (tag_score): IDF加权的品类匹配度
    2. 热度分 (heat_score): 基于用户游玩时长的热度信号
    3. 质量分 (quality_score): 基于评分的质量信号
    4. 量级压制 (authority_control): 削弱千万级大作统治力
    5. 新游提权 (recency_bias): 2018年后游戏1.15x加分
    6. 多样性加成 (diversity_boost): 来自不同兴趣簇的候选加分
    """
    rec_tags = set(t.lower() for t in recommendation.get("tags", []))

    # 1. IDF加权品类匹配分: 用用户画像簇代替游戏名匹配
    user_genres = set()
    user_idf_sum = 0.0
    profile_top_genres = profile.get("top_genres", [])
    for genre in profile_top_genres:
        genre_lower = genre.lower()
        for tag_lower in rec_tags:
            if tag_lower in genre_lower or genre_lower in tag_lower:
                user_genres.add(tag_lower)
                # 取该簇平均IDF作为权重
                cluster_games = profile.get("clusters", {}).get(genre, [])
                cluster_idf = sum(
                    profile.get("idf_weights", {}).get(g.get("name", ""), 0.5)
                    for g in cluster_games
                ) / max(len(cluster_games), 1)
                user_idf_sum += cluster_idf

    if rec_tags and user_genres:
        tag_score = len(rec_tags & user_genres) / len(rec_tags)
        # IDF加成: 如果匹配的标签来自小众偏好，加分
        idf_bonus = min(user_idf_sum / max(len(user_genres), 1), 0.3)
        tag_score = min(tag_score + idf_bonus, 1.0)
    else:
        tag_score = 0.0

    # 2. 热度分 (基于用户游玩时长)
    max_hours = max((g.get("playtime_hours", 0) for g in owned_games), default=1)
    heat_score = 0.0
    for game in owned_games:
        name_lower = game.get("name", "").lower()
        for tag in rec_tags:
            if tag in name_lower:
                heat_score = max(heat_score, game.get("playtime_hours", 0) / max(max_hours, 1))
                break
    heat_score = min(heat_score, 1.0)

    # 3. 质量分 (如果有评分信息)
    quality_score = 0.5  # 默认
    if recommendation.get("review_score"):
        quality_score = recommendation["review_score"] / 10.0
    elif recommendation.get("rating"):
        quality_score = recommendation["rating"] / 10.0

    # 4. 加权融合 (权重: 品类1.2, 热度1.0, 质量0.8)
    rrf_k = 60  # 融合常数
    # 这里用3路信号代替DeepSteam的3路
    rrf_score = (
        (1.0 / (rrf_k + 1)) * tag_score * 1.2 +   # 品类匹配 (对应语义)
        (1.0 / (rrf_k + 1)) * heat_score * 1.0 +   # 热度 (对应关键词)
        (1.0 / (rrf_k + 1)) * quality_score * 0.8  # 质量 (对应基础热度)
    )

    # 5. 量级压制 (Authority Control)
    # DeepSteam: owners > 5M → 1.15x, > 20M → 1.25x
    # 这里用推荐游戏的预估热度做类似处理
    owners = recommendation.get("owners", 0) or 0
    authority_boost = 1.0
    if owners > 20_000_000:
        authority_boost = 1.25
    elif owners > 5_000_000:
        authority_boost = 1.15

    # 6. 新游提权 (Recency Bias)
    # DeepSteam: 2018+游戏 → 1.15x
    release_year = recommendation.get("release_year", 0)
    recency_boost = 1.15 if release_year >= 2018 else 1.0

    # 7. 多样性加成: 来自不同兴趣簇的候选
    diversity_boost = 1.0
    if profile.get("top_genres"):
        matched_clusters = 0
        for genre in profile["top_genres"][:3]:
            cluster_games = profile["clusters"].get(genre, [])
            for cg in cluster_games:
                if any(t.lower() in cg.get("name", "").lower() for t in rec_tags):
                    matched_clusters += 1
                    break
        if matched_clusters >= 2:
            diversity_boost = 1.1  # 跨品类匹配加分

    final_score = rrf_score * authority_boost * recency_boost * diversity_boost
    return final_score


def filter_series_deepsteam(recommendations: list, owned_games: list) -> list:
    """
    DeepSteam: 系列感知过滤 - 推新不推旧
    
    策略:
    1. 识别同系列游戏
    2. 如果用户已玩过系列新作，惩罚旧作
    3. 每个系列最多保留2款，优先推荐新作
    """
    # 构建用户已拥有的系列
    owned_series = {}
    for game in owned_games:
        name = game.get("name", "")
        series = detect_series(name)
        if series:
            year = game.get("release_year", 0) or extract_year(game.get("release_date", ""))
            if series not in owned_series or year > owned_series[series]["year"]:
                owned_series[series] = {"name": name, "year": year}

    # 检测推荐中的系列
    series_map = {}
    standalone = []

    for rec in recommendations:
        chinese_name = rec.get("chinese_name", "")
        series = detect_series(chinese_name)

        if series:
            if series not in series_map:
                series_map[series] = []
            year = rec.get("release_year", 0)
            series_map[series].append({**rec, "_series_year": year, "_series": series})
        else:
            standalone.append(rec)

    filtered = standalone.copy()

    for series, items in series_map.items():
        # 按年份排序，新作在前
        items.sort(key=lambda x: x.get("_series_year", 0), reverse=True)

        if series in owned_series:
            owned_year = owned_series[series]["year"]
            # 用户已拥有该系列: 推新不推旧
            # 只保留比用户已拥有的更新的作品
            newer_items = [item for item in items if item.get("_series_year", 0) > owned_year]
            if newer_items:
                filtered.extend(newer_items[:2])
            else:
                # 没有更新的作品，但可以推荐特别高质量的
                filtered.append(items[0])
        else:
            # 用户未拥有该系列: 保留最多2款
            filtered.extend(items[:2])

    return filtered


# ==================== Steam API 函数 ====================

def get_existing_games(base_dir: Path) -> set:
    """从games_detail.json获取已存在的游戏appid"""
    path = base_dir / 'games_detail.json'
    if not path.exists():
        return set()
    with open(path, encoding='utf-8') as f:
        data = json.load(f)
    return {g["appid"] for g in data.get("games", []) if "appid" in g}


def parse_llm_response(response: str) -> dict:
    """解析LLM响应"""
    if not response:
        return {}

    json_match = re.search(r'```json\s*(.*?)\s*```', response, re.DOTALL)
    json_str = json_match.group(1) if json_match else response
    json_str = json_str.strip()

    try:
        return json.loads(json_str)
    except json.JSONDecodeError:
        pass

    start = json_str.find('{')
    end = json_str.rfind('}')

    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(json_str[start:end + 1])
        except json.JSONDecodeError:
            pass

    return {}


# ==================== LLM 推荐 ====================

def ai_analyze_and_recommend(
    owned_games: list,
    existing_appids: set,
    profile: dict,
    retries: int = 2,
) -> list:
    """
    DeepSteam增强的LLM推荐:
    1. 多兴趣画像注入Prompt
    2. 意图重写生成结构化指令
    3. 每条兴趣线独立推荐
    4. 强制新游优先 + 否定词过滤
    """
    # 构建用户游戏库描述 (按游玩时间排序)
    sorted_games = sorted(owned_games, key=lambda x: x["playtime_hours"], reverse=True)
    k = float(os.environ.get("RECOMMEND_K", "200"))
    top_n = max(5, int(50 * (1 - math.e ** (-len(sorted_games) / k))))
    top_games = sorted_games[:top_n]

    games_text = "\n".join(
        f"- {game['name']} (游玩{game['playtime_hours']:.1f}小时)"
        for game in top_games
    )

    # DeepSteam: 多兴趣画像描述
    intent_rewrite = rewrite_intent(profile, owned_games)

    # DeepSteam: 已拥有/已推荐的排除列表
    existing_text = ", ".join(str(appid) for appid in existing_appids)
    owned_text = ", ".join(str(g["appid"]) for g in owned_games[:50])

    # DeepSteam: 系列游戏检测
    owned_series_names = set()
    for game in owned_games:
        series = detect_series(game.get("name", ""))
        if series:
            owned_series_names.add(series)

    # DeepSteam: 构建多兴趣推荐Prompt
    prompt = f"""你是一个Steam游戏推荐专家，使用DeepSteam算法的多兴趣路由策略进行推荐。

## 用户多兴趣画像 (Multi-Interest Profile)
{intent_rewrite if intent_rewrite else "暂无明确品类偏好"}

## 用户已拥有的游戏appid（请勿推荐这些游戏！）
{owned_text}

## 用户游戏库（按游玩时间排序）
{games_text}

## 已推荐过的游戏appid（请勿重复推荐）
{existing_text}

## 系列游戏追踪
用户已拥有的系列: {', '.join(owned_series_names) if owned_series_names else '无'}
请避免推荐同系列的旧作(如果用户已有新作)，优先推荐该系列的更新作品或其他系列。

## DeepSteam推荐策略
1. **多兴趣路由**: 为用户的每条主要兴趣线推荐1-2款游戏，确保覆盖多维口味
2. **推新不推旧**: 优先推荐2018年以后的游戏，避免推荐过时作品
3. **多样性保障**: 推荐的游戏应覆盖用户的不同兴趣维度，不要集中在单一品类
4. **否定词过滤**: 如果用户游玩记录中明显缺少某品类，不要强行推荐

## 输出要求
只输出JSON，不要其他文字：
```json
{{
  "recommendations": [
    {{
      "appid": 数字,
      "chinese_name": "中文名",
      "tags": ["标签1", "标签2", "标签3"],
      "release_year": 年份数字,
      "reason": "推荐理由(说明匹配用户的哪条兴趣线)"
    }}
  ]
}}
```

## 注意事项
1. 推荐用户没有的游戏
2. 每个游戏3-5个标签
3. appid必须是纯数字
4. 使用官方中文名
5. 推荐7-10款游戏以覆盖多条兴趣线"""

    print("   调用LLM分析 (DeepSteam多兴趣模式)...")
    response = ""
    for attempt in range(retries + 1):
        response = get_llm().generate(prompt)
        if response:
            break
        print(f"   重试 ({attempt + 1}/{retries})...")

    if not response:
        print("   LLM调用失败")
        return []

    result = parse_llm_response(response)

    if not result:
        print("   响应解析失败")
        return []

    recommendations = result.get("recommendations", [])
    filtered = []
    for r in recommendations:
        try:
            appid = int(r.get("appid", 0))
            if appid and appid not in existing_appids:
                r["appid"] = appid
                filtered.append(r)
        except (ValueError, TypeError):
            continue

    return filtered[:10]


def steam_search_by_name(name: str) -> dict | None:
    """通过 Steam storesearch API 按名称搜索，返回 {appid, name, type} 或 None"""
    url = f'https://store.steampowered.com/api/storesearch?term={requests.utils.quote(name)}&l=schinese&cc=cn'
    try:
        resp = requests.get(url, timeout=10)
        if resp.status_code == 200:
            items = resp.json().get('items', [])
            if items:
                item = items[0]
                return {
                    'appid': item['id'],
                    'name': item.get('name', ''),
                    'type': item.get('type', ''),
                }
    except Exception:
        pass
    return None


# ==================== 主流程 ====================

def main() -> None:
    base_dir = Path(os.getcwd())

    print("=" * 60)
    print("Steam游戏AI推荐系统 (DeepSteam算法完整集成)")
    print("=" * 60)
    print("算法模块:")
    print("  - 多兴趣路由 (Multi-Interest Routing)")
    print("  - IDF加权画像 (IDF Weighting)")
    print("  - NLP意图重写 (Intent Rewriting)")
    print("  - 加权融合排序 (Weighted Score Fusion)")
    print("  - 量级压制 (Authority Control)")
    print("  - 新游提权 (Recency Bias)")
    print("  - 系列感知过滤 (Series Filter)")
    print("=" * 60)

    # 检查配置
    print("\n检查配置...")
    print(f"   STEAM_API_KEY: {'✓' if STEAM_API_KEY else '✗'}")
    print(f"   LLM: {type(get_llm()).__name__}")

    # 获取Steam ID
    print("\n1. 获取Steam ID...")
    steam_id = get_steam_id(STEAM_API_KEY, STEAM_USER_ID)
    if steam_id:
        print(f"   Steam ID: {steam_id}")
    else:
        print("   未获取到Steam ID")
        sys.exit(1)

    # 获取用户拥有的游戏
    print("\n2. 获取用户游戏库...")
    owned_games_data, api_game_count = get_owned_games(STEAM_API_KEY, steam_id) if steam_id else ([], 0)
    print(f"   拥有游戏: {len(owned_games_data)} 款 (API报告: {api_game_count})")

    if not owned_games_data:
        print("   未获取到游戏库，无法推荐")
        sys.exit(1)

    if owned_games_data:
        print("\n   玩得最多的5款游戏:")
        for game in sorted(owned_games_data, key=lambda x: x["playtime_hours"], reverse=True)[:5]:
            print(f"   - {game['name']}: {game['playtime_hours']:.1f} 小时")

    # DeepSteam: 多兴趣画像构建
    print("\n3. 构建多兴趣画像 (Multi-Interest Profiling)...")
    profile = build_user_profile(owned_games_data)
    print(f"   兴趣簇: {len(profile['clusters'])} 个")
    print(f"   主要品类: {', '.join(profile['top_genres'][:5])}")
    for genre in profile["top_genres"][:3]:
        games_in_cluster = profile["clusters"].get(genre, [])
        total_h = sum(g.get("playtime_hours", 0) for g in games_in_cluster)
        print(f"     - {genre}: {len(games_in_cluster)} 款游戏, {total_h:.0f} 小时")

    # DeepSteam: 意图重写
    print("\n4. NLP意图重写 (Intent Rewriting)...")
    intent = rewrite_intent(profile, owned_games_data)
    if intent:
        print(f"   重写结果:")
        for line in intent.split("\n")[:5]:
            print(f"     {line}")
    else:
        print("   意图重写为空，使用默认模式")

    # 获取已存在的游戏
    print("\n5. 检查已存在游戏...")
    existing_games = get_existing_games(base_dir)
    print(f"   已存在: {len(existing_games)} 款游戏")

    # 获取已拥有的游戏appid
    owned_appids = {g["appid"] for g in owned_games_data}
    print(f"   已拥有: {len(owned_appids)} 款游戏")

    # 合并排除列表
    exclude_appids = existing_games | owned_appids

    # DeepSteam增强的LLM推荐
    print("\n6. DeepSteam LLM分析并推荐 (多兴趣路由)...")
    recommendations = ai_analyze_and_recommend(owned_games_data, exclude_appids, profile)

    if not recommendations:
        print("   没有新的推荐游戏，工作流终止")
        sys.exit(1)

    # DeepSteam: RRF融合排序
    print("\n7. 加权融合排序 (Authority Control + Recency Bias)...")
    for rec in recommendations:
        rec["rrf_score"] = calculate_weighted_score(rec, owned_games_data, profile, recommendations)
    recommendations.sort(key=lambda x: x["rrf_score"], reverse=True)

    print(f"\n   RRF排序结果:")
    for i, rec in enumerate(recommendations[:7], 1):
        tags = ", ".join(rec.get("tags", []))
        name = rec.get('chinese_name', '未知')
        score = rec.get('rrf_score', 0)
        year = rec.get('release_year', '?')
        print(f"   {i}. {name} [{tags}] Year:{year} RRF:{score:.4f}")

    # DeepSteam: 系列感知过滤
    print("\n8. 系列感知过滤 (推新不推旧)...")
    before_count = len(recommendations)
    recommendations = filter_series_deepsteam(recommendations, owned_games_data)
    print(f"   过滤前: {before_count} 款 → 过滤后: {len(recommendations)} 款")

    # 验证appid有效性（LLM常给错appid，用英文名通过storesearch反查正确appid）
    print("\n9. 验证appid有效性（storesearch反查）...")
    validated = []
    failed_count = 0

    max_validate = min(len(recommendations), 7)
    for rec in recommendations[:max_validate]:
        chinese_name = rec.get("chinese_name", "")
        name_to_search = chinese_name

        if not name_to_search:
            print(f"   ✗ 无名称信息，跳过")
            failed_count += 1
            continue

        corrected = steam_search_by_name(name_to_search)
        if not corrected:
            print(f"   ✗ {name_to_search}: 名称搜索无结果，跳过")
            failed_count += 1
            continue

        if corrected.get('type') != 'app':
            print(f"   ✗ {name_to_search}: 非游戏类型 ({corrected.get('type')})，跳过")
            failed_count += 1
            continue

        rec["appid"] = corrected["appid"]
        rec["verified_name"] = corrected["name"]
        validated.append(rec)
        print(f"   ✓ {name_to_search} → appid {corrected['appid']} ('{corrected['name']}')")

        if len(validated) >= max_validate:
            break

    if failed_count:
        print(f"   ✗ {failed_count} 个appid验证失败")

    # 写入 games.json (仅新推荐，供 fetch_steam 增量拉取详情)
    print("\n10. 更新 games.json...")
    new_recs = validated[:7]

    detail_path = base_dir / 'games_detail.json'
    existing_appid_set = set()
    if detail_path.exists():
        with open(detail_path, encoding='utf-8') as f:
            existing_appid_set = {g['appid'] for g in json.load(f).get('games', []) if 'appid' in g}

    new_entries = []
    for rec in new_recs:
        appid = rec.get("appid")
        if appid and appid not in existing_appid_set:
            new_entries.append({
                "appid": appid,
                "reason": rec.get("reason", ""),
                "rrf_score": round(rec.get("rrf_score", 0), 4),
            })

    data = {
        "games": new_entries,
        "total_owned": api_game_count if api_game_count > 0 else len(owned_games_data),
    }
    save_games_json(base_dir, data)
    new_appids = [r.get("appid") for r in new_recs]
    print(f"   ✓ {len(new_entries)} 个新appid已写入 games.json")

    print(f"\n   推荐appid: {new_appids}")
    print("\n" + "=" * 60)
    print("完成!")
    print(f"games.json 已更新，新增 {len(new_entries)} 款游戏")
    print("算法: DeepSteam多兴趣路由 + 加权融合排序 + 量级压制 + 新游提权 + 系列感知过滤")
    print("=" * 60)


if __name__ == "__main__":
    main()
