#!/usr/bin/env python3
"""补全 library.json 中缺失的游戏详情（图片、描述、标签）"""

import os
import json
from pathlib import Path
from common import filter_library_games, get_steam_id, get_owned_games, fetch_steam_details, fetch_review, batch_fetch, build_games_output

STEAM_LANG = os.environ.get('STEAM_LANG', 'schinese')


def main():
    base_dir = Path(__file__).parent.parent.parent
    library_file = base_dir / 'library.json'

    print('=' * 60)
    print('补全游戏库详情数据')
    print('=' * 60)

    if not library_file.exists():
        print('library.json 不存在，将创建新文件')
        games = []
    else:
        with open(library_file, encoding='utf-8') as f:
            data = json.load(f)
        games = data.get('games', [])
        print(f'现有 {len(games)} 款游戏')

    need_fill = [g for g in games if not g.get('header_image') or not g.get('genres')]
    print(f'需要补全: {len(need_fill)} 款')

    if not need_fill:
        print('所有游戏数据已完整，无需补全')
        return

    print(f'\n获取游戏详情...')
    need_appids = [g['appid'] for g in need_fill]
    detail_map = batch_fetch(need_appids, lambda aid: fetch_steam_details(aid, STEAM_LANG), progress_interval=10)

    played = [g for g in need_fill if g.get('playtime_hours', 0) > 0]
    played_appids = [g['appid'] for g in played]
    review_map = {}
    if played_appids:
        print(f'\n获取评测数据 ({len(played)} 款)...')
        review_map = batch_fetch(played_appids, lambda aid: fetch_review(aid, STEAM_LANG))
    updated = 0
    for g in games:
        aid = g['appid']
        if aid in detail_map:
            d = detail_map[aid]
            if not g.get('header_image'):
                g['header_image'] = d.get('header_image', '')
            if not g.get('genres'):
                g['genres'] = d.get('genres', [])
            if not g.get('short_description'):
                g['short_description'] = d.get('short_description', '')
            if not g.get('screenshots'):
                g['screenshots'] = d.get('screenshots', [])
            updated += 1
        if aid in review_map:
            g['review'] = review_map[aid]

    games, software_count, filtered_count, total_playtime = filter_library_games(games, detail_map)
    if software_count > 0:
        print(f'过滤掉 {software_count} 款非游戏（软件/视频等）')
    if filtered_count > 0:
        print(f'过滤掉 {filtered_count} 款游玩时长不足总时长千分之一的游戏')

    output = build_games_output(games)
    with open(library_file, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, indent=2)

    print(f'\n✓ 已更新 {updated} 款游戏，过滤 {software_count} 款软件，过滤 {filtered_count} 款低时长，保存到 library.json')


if __name__ == '__main__':
    main()
