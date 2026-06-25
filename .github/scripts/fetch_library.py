#!/usr/bin/env python3
"""获取 Steam 游戏库数据：GetOwnedGames + 批量 appdetails → library.json"""

import os
import json
from pathlib import Path
from common import filter_library_games, get_steam_id, get_owned_games, fetch_steam_details, fetch_review, batch_fetch, build_games_output

STEAM_API_KEY = os.environ.get('STEAM_API_KEY', '')
STEAM_USER_ID = os.environ.get('STEAM_USER_ID', '')
STEAM_LANG = os.environ.get('STEAM_LANG', 'schinese')


def main():
    base_dir = Path(__file__).parent.parent.parent

    print('=' * 60)
    print('Steam 游戏库数据获取')
    print('=' * 60)

    print('\n1. 获取 Steam ID...')
    steam_id = get_steam_id(STEAM_API_KEY, STEAM_USER_ID)
    if not steam_id:
        print('   获取 Steam ID 失败')
        return
    print(f'   Steam ID: {steam_id}')

    print('\n2. 获取游戏库...')
    owned, total_count = get_owned_games(STEAM_API_KEY, steam_id)
    if not owned:
        print('   游戏库为空')
        return
    print(f'   共 {total_count} 款游戏')

    print(f'\n3. 获取游戏详情 ({len(owned)} 款)...')
    appids = [g['appid'] for g in owned]
    playtime_map = {g['appid']: g['playtime_hours'] for g in owned}

    detail_map = batch_fetch(appids, lambda aid: fetch_steam_details(aid, STEAM_LANG), progress_interval=20)
    print(f'\n4. 获取评测数据 ({len(detail_map)} 款)...')
    review_appids = sorted(detail_map.keys(), key=lambda a: playtime_map.get(a, 0), reverse=True)
    review_map = batch_fetch(review_appids, lambda aid: fetch_review(aid, STEAM_LANG))

    print(f'   已获取 {len(review_map)} 款游戏的评测')

    print('\n5. 合并数据...')
    library_games = []
    for g in owned:
        aid = g['appid']
        detail = detail_map.get(aid, {})
        library_games.append({
            'appid': aid,
            'name': detail.get('name', g['name']),
            'playtime_hours': g['playtime_hours'],
            'header_image': detail.get('header_image', ''),
            'short_description': detail.get('short_description', ''),
            'genres': detail.get('genres', []),
            'screenshots': detail.get('screenshots', []),
            'review': review_map.get(aid),
        })

    total_playtime = sum(g['playtime_hours'] for g in library_games)
    library_games, software_count, filtered_count, total_playtime = filter_library_games(library_games, detail_map)
    if software_count > 0:
        print(f'   过滤掉 {software_count} 款非游戏（软件/视频等）')
    if filtered_count > 0:
        print(f'   过滤掉 {filtered_count} 款游玩时长不足总时长千分之一的游戏')

    output = build_games_output(library_games)

    library_file = base_dir / 'library.json'
    with open(library_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n✓ library.json 已生成 ({len(library_games)} 款游戏, {total_playtime:.1f} 小时)')


if __name__ == '__main__':
    main()
