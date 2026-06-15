#!/usr/bin/env python3
"""公共工具函数模块"""

import json
import time
import requests
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed


SESSION = requests.Session()


def _request_with_retry(url: str, max_retries: int = 3, delay: float = 1.0, **kwargs) -> requests.Response | None:
    """带指数退避重试的 GET 请求"""
    timeout = kwargs.pop('timeout', 15)
    for attempt in range(max_retries):
        try:
            resp = SESSION.get(url, timeout=timeout, **kwargs)
            resp.raise_for_status()
            return resp
        except Exception:
            if attempt < max_retries - 1:
                time.sleep(delay * (2 ** attempt))
    return None


def load_games_json(base_dir: Path) -> dict:
    """加载games.json"""
    cache_file = base_dir / "games.json"
    if cache_file.exists():
        try:
            return json.loads(cache_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"games": [], "total_owned": 0}


def save_games_json(base_dir: Path, data: dict):
    """原子写入 games.json：先写 .tmp 再 rename 防止写中断导致文件损坏"""
    cache_file = base_dir / "games.json"
    tmp_file = cache_file.with_suffix(".json.tmp")
    tmp_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp_file.rename(cache_file)


def filter_library_games(games: list, detail_map: dict = None) -> tuple:
    """过滤游戏库：移除非游戏 + 低时长游戏

    Args:
        games: 游戏列表，每项需包含 appid, playtime_hours
        detail_map: {appid: {'type': str}} 可选，用于判断是否游戏

    Returns:
        (过滤后的列表, 过滤掉的软件数, 过滤掉的低时长数, 总时长)
    """
    software_count = 0
    if detail_map:
        before_count = len(games)
        games = [g for g in games if detail_map.get(g['appid'], {}).get('type', 'game') == 'game']
        software_count = before_count - len(games)

    total_playtime = sum(g.get('playtime_hours', 0) for g in games)
    threshold = total_playtime * 0.001
    before_count = len(games)
    games = [g for g in games if g.get('playtime_hours', 0) >= threshold]
    filtered_count = before_count - len(games)

    return games, software_count, filtered_count, total_playtime


def get_steam_id(steam_api_key: str, steam_user_id: str) -> str:
    """从 Steam ID 或 URL 名获取数字 Steam ID"""
    if not steam_api_key or not steam_user_id:
        return ''
    if steam_user_id.isdigit():
        return steam_user_id
    url = f'https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key={steam_api_key}&vanityurl={steam_user_id}'
    try:
        resp = requests.get(url, timeout=10)
        data = resp.json()
        if data.get('response', {}).get('success') == 1:
            return data['response']['steamid']
    except Exception:
        pass
    return ''


def get_owned_games(steam_api_key: str, steam_id: str) -> tuple:
    """获取用户拥有的游戏列表，返回 (游戏列表, API报告的总数)"""
    if not steam_api_key or not steam_id:
        return [], 0
    url = f'https://api.steampowered.com/IPlayerService/GetOwnedGames/v1/?key={steam_api_key}&steamid={steam_id}&include_appinfo=true'
    try:
        resp = requests.get(url, timeout=30)
        data = resp.json()
        resp_data = data.get('response', {})
        games = resp_data.get('games', [])
        count = resp_data.get('game_count', len(games))
        result = []
        for g in games:
            aid = g.get('appid')
            if not aid:
                continue
            result.append({
                'appid': aid,
                'name': g.get('name', ''),
                'playtime_hours': round(g.get('playtime_forever', 0) / 60, 1),
            })
        return result, count
    except Exception:
        return [], 0


def fetch_steam_details(appid: int, lang: str = 'schinese') -> dict | None:
    """获取单个Steam游戏详情（从 appdetails 接口），失败自动重试"""
    url = f'https://store.steampowered.com/api/appdetails?cc=cn&l={lang}&appids={appid}'
    resp = _request_with_retry(url)
    if resp is None:
        return None
    try:
        data = resp.json()
        info = data.get(str(appid))
        if not info or not info.get('success'):
            return None
        d = info['data']
        result = {
            'appid': appid,
            'name': d.get('name', ''),
            'type': d.get('type', 'game'),
            'header_image': d.get('header_image', ''),
            'short_description': d.get('short_description', ''),
            'genres': [g['description'] for g in d.get('genres', [])],
            'categories': [c['description'] for c in d.get('categories', [])],
            'release_date': d.get('release_date', {}).get('date', ''),
            'is_free': d.get('is_free', False),
            'price': d.get('price_overview'),
            'on_sale': (d.get('price_overview') or {}).get('discount_percent', 0) > 0,
            'screenshots': [s['path_full'] for s in d.get('screenshots', [])[:3]],
        }
        return result
    except Exception:
        return None


def fetch_review(appid: int, lang: str = 'schinese') -> dict | None:
    """获取Steam游戏评测摘要，失败自动重试"""
    url = f'https://store.steampowered.com/appreviews/{appid}?json=1&language={lang}&purchase_type=all'
    resp = _request_with_retry(url, timeout=10)
    if resp is None:
        return None
    try:
        data = resp.json()
        if data.get('success') == 1:
            q = data.get('query_summary', {})
            return {
                'score': q.get('review_score', 0),
                'desc': q.get('review_score_desc', ''),
                'total': q.get('total_reviews', 0),
                'positive': q.get('total_positive', 0),
            }
    except Exception:
        pass
    return None


def batch_fetch(items, fetch_fn, *, max_workers=2, delay=0.3, progress_interval=0):
    """批量并发带节流的请求

    Args:
        items: 可迭代对象，每个元素传给 fetch_fn
        fetch_fn: callable(item) -> result | None
        max_workers: 最大并发数
        delay: 每次提交间隔秒数
        progress_interval: 每 N 条打印一次进度 (0=不打印)

    Returns:
        dict: {item: result} 仅含 fetch_fn 返回非 None 的结果
    """
    results = {}
    items = list(items)
    total = len(items)
    with ThreadPoolExecutor(max_workers=max_workers) as pool:
        futures = {}
        for item in items:
            if delay:
                time.sleep(delay)
            futures[pool.submit(fetch_fn, item)] = item
        done = 0
        for future in as_completed(futures):
            done += 1
            item = futures[future]
            try:
                result = future.result()
                if result is not None:
                    results[item] = result
            except Exception:
                pass
            if progress_interval > 0 and (done % progress_interval == 0 or done == total):
                print(f'   [{done}/{total}] {len(results)} 成功')
    return results


def build_games_output(games):
    """构建标准游戏库输出字典 {games, total_games, total_playtime_hours}"""
    total_playtime = sum(g.get('playtime_hours', 0) for g in games)
    return {
        'games': games,
        'total_games': len(games),
        'total_playtime_hours': round(total_playtime, 1),
    }
