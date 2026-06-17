#!/usr/bin/env python3
"""读取 games.json 中的新 appid，增量拉取 Steam 详情合并到 games_detail.json"""

import os
import json
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed
from common import fetch_steam_details, fetch_review

STEAM_LANG = os.environ.get('STEAM_LANG', 'schinese')


def fetch_one(appid: int, reason: str = "", rrf_score: float = 0) -> dict | None:
    """获取单个Steam游戏信息"""
    try:
        result = fetch_steam_details(appid, STEAM_LANG)
        if not result:
            return None
        if reason:
            result['reason'] = reason
        if rrf_score:
            result['rrf_score'] = rrf_score
        result['review'] = fetch_review(appid, STEAM_LANG)
        return result
    except Exception as e:
        print(f'  ✗ appid={appid}: {e}')
        return None


def main():
    base_dir = Path(__file__).parent.parent.parent
    games_file = base_dir / 'games.json'
    detail_file = base_dir / 'games_detail.json'

    total_owned = 0
    existing_details = {}
    if detail_file.exists():
        with open(detail_file, encoding='utf-8') as f:
            existing_data = json.load(f)
        for g in existing_data.get('games', []):
            existing_details[g['appid']] = g
        total_owned = existing_data.get('total_owned', 0)

    if not games_file.exists():
        print('games.json 不存在，没有新游戏需要获取详情')
        if existing_details:
            print(f'保留现有 {len(existing_details)} 款游戏详情')
        return

    with open(games_file) as f:
        new_data = json.load(f)
    appids = new_data.get('games', [])
    if new_data.get('total_owned'):
        total_owned = new_data['total_owned']

    appid_info = {}
    for item in appids:
        if isinstance(item, dict):
            aid = item.get("appid")
            if aid and aid not in existing_details:
                appid_info[aid] = {
                    "reason": item.get("reason", ""),
                    "rrf_score": item.get("rrf_score", 0),
                }
        elif isinstance(item, (int, str)):
            aid = int(item)
            if aid not in existing_details:
                appid_info[aid] = {"reason": "", "rrf_score": 0}

    print(f'已有详情: {len(existing_details)} 款, 需要获取: {len(appid_info)} 款')

    new_details = {}
    if appid_info:
        with ThreadPoolExecutor(max_workers=8) as pool:
            futures = {}
            for aid in appid_info:
                info = appid_info[aid]
                futures[pool.submit(fetch_one, aid, info["reason"], info["rrf_score"])] = aid
            for i, future in enumerate(as_completed(futures), 1):
                result = future.result()
                if result:
                    new_details[result['appid']] = result
                    print(f'  [{i}/{len(appid_info)}] ✓ {result["name"]}')

    all_games = list(existing_details.values())
    for g in new_details.values():
        all_games.append(g)

    with open(detail_file, 'w', encoding='utf-8') as f:
        json.dump({'games': all_games, 'total_owned': total_owned}, f, ensure_ascii=False, indent=2)

    print(f'\n✓ games_detail.json 已更新 ({len(all_games)} 款游戏, 新增 {len(new_details)} 款)')


if __name__ == '__main__':
    main()
