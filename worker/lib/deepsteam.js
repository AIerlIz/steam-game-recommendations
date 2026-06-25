import { createLLM } from './llm.js';
import { getSteamId, getOwnedGames, saveGamesJson, getConfig } from './steam.js';

const GENRE_CLUSTERS = {
  'RPG/ARPG': ['rpg', 'action rpg', 'arpg', 'jrpg', 'crpg', 'mmorpg', 'dungeon crawler',
                '角色扮演', '动作角色扮演', '动作rpg', '日式角色扮演', '类魂'],
  'FPS/射击': ['fps', 'shooter', 'first-person', 'hero shooter', 'tactical shooter',
               '射击', '第一人称', '第一人称射击', '第三人称射击', '射击游戏'],
  '策略/模拟': ['strategy', 'simulation', 'rts', 'turn-based', 'turn based', '4x', 'grand strategy',
                'tower defense', 'moba', 'life sim', 'dating sim', 'farming sim', 'choices matter',
                '策略', '模拟', '回合制', '即时战略', '回合制策略', '塔防', '恋爱模拟'],
  '冒险/叙事': ['adventure', 'narrative', 'visual novel', 'interactive fiction', 'walking simulator',
                'point & click', 'open world', 'open-world', 'sci-fi', 'atmospheric',
                '冒险', '叙事', '剧情', '开放世界', '视觉小说', '探索', '科幻', '互动小说'],
  '恐怖/生存': ['horror', 'survival', 'zombies', 'psychological horror', 'lovecraftian',
                'post-apocalyptic', 'post apocalyptic',
                '恐怖', '生存', '僵尸', '末日', '后末日', '心理恐怖'],
  '动作/格斗': ['action', 'fighting', 'beat \'em up', 'hack and slash', 'stealth', 'metroidvania',
                'bullet hell', 'souls-like', 'soulslike', 'platformer',
                '动作', '格斗', '清版', '类银河战士恶魔城', '平台'],
  '独立/创意': ['indie', 'roguelike', 'roguelite', 'rogue-like', 'rogue-lite',
                '独立', '肉鸽', '类rogue', '像素', '创意'],
  '沙盒/建造': ['sandbox', 'building', 'crafting', 'base building', 'city builder',
                'colony sim', 'voxel', 'automation', 'open world survival craft',
                '沙盒', '建造', '城市建设', '殖民模拟', '自动化'],
  '竞速/体育': ['racing', 'sports', 'vehicular combat',
                '竞速', '体育', '赛车', '驾驶', '足球', '篮球'],
  '休闲/解谜': ['casual', 'puzzle', 'card game', 'board game', 'hidden object', 'idle', 'clicker',
                'match 3', 'word game', 'rhythm',
                '休闲', '解谜', '卡牌', '棋盘', '消除', '三消', '益智', '音乐'],
};

const GENRE_TO_CLUSTER = {};
for (const [cluster, keywords] of Object.entries(GENRE_CLUSTERS)) {
  for (const kw of keywords) {
    GENRE_TO_CLUSTER[kw.toLowerCase()] = cluster;
  }
}

const SERIES_PATTERNS = [
  /(Civilization\s*\d*)/i,
  /(Final Fantasy\s*\d*)/i,
  /(Call of Duty.*)/i,
  /(Assassin's Creed.*)/i,
  /(Total War.*)/i,
  /(The Elder Scrolls.*)/i,
  /(Far Cry\s*\d*)/i,
  /(Borderlands\s*\d*)/i,
  /(Dark Souls\s*\d*)/i,
  /(Resident Evil\s*\d*)/i,
  /(Need for Speed.*)/i,
  /(Fallout\s*\d*)/i,
  /(Mass Effect\s*\d*)/i,
  /(Dragon Age\s*\d*)/i,
  /(BioShock\s*\d*)/i,
  /(Portal\s*\d*)/i,
  /(Half-Life\s*\d*)/i,
  /(Wolfenstein\s*\d*)/i,
  /(Doom\s*\d*)/i,
  /(Hitman\s*\d*)/i,
  /(Tomb Raider.*)/i,
  /(Uncharted.*)/i,
  /(God of War.*)/i,
  /(Halo\s*\d*)/i,
  /(Gears of War.*)/i,
  /(Forza.*)/i,
  /(FIFA\s*\d*)/i,
  /(NBA 2K\d*)/i,
  /(Madden\s*\d*)/i,
  /(Monster Hunter.*)/i,
  /(Persona\s*\d*)/i,
  /(Yakuza.*)/i,
  /(Like a Dragon.*)/i,
  /(XCOM\s*\d*)/i,
  /(StarCraft\s*\d*)/i,
  /(Warcraft\s*\d*)/i,
  /(Diablo\s*\d*)/i,
  /(Overwatch\s*\d*)/i,
  /(Rainbow Six.*)/i,
  /(Ghost Recon.*)/i,
  /(Splinter Cell.*)/i,
  /(Prince of Persia.*)/i,
  /(Silent Hill.*)/i,
  /(Metal Gear.*)/i,
  /(Kingdom Hearts.*)/i,
  /(Street Fighter.*)/i,
  /(Tekken\s*\d*)/i,
  /(Mortal Kombat\s*\d*)/i,
  /(Dead or Alive.*)/i,
  /(Soulcalibur.*)/i,
  /(Sonic\s*.*)/i,
  /(Kirby.*)/i,
  /(Zelda.*)/i,
  /(Mario\s*.*)/i,
  /(Pokemon.*)/i,
  /(Dragon Quest.*)/i,
  /(NieR.*)/i,
  /(Bayonetta.*)/i,
  /(Devil May Cry.*)/i,
  /(Dead Space.*)/i,
  /(System Shock.*)/i,
  /(Disco Elysium.*)/i,
  /(Baldur's Gate.*)/i,
  /(Pillars of Eternity.*)/i,
  /(Divinity.*)/i,
  /(Warhammer.*)/i,
  /(Star Wars.*)/i,
  /(Alien\s*.*)/i,
  /(Predator.*)/i,
];

export function buildUserProfile(ownedGames, genreMap = {}) {
  if (!ownedGames?.length) {
    return { clusters: {}, top_genres: [], idf_weights: {}, total_hours: 0, cluster_strength: {} };
  }

  const totalHours = ownedGames.reduce((s, g) => s + (g.playtime_hours || 0), 0);

  const idfWeights = {};
  for (const game of ownedGames) {
    const name = game.name || '';
    const hours = game.playtime_hours || 0;
    idfWeights[name] = 1.0 / (Math.log10(hours + 1) + 1.0);
  }

  const clusters = {};
  for (const game of ownedGames) {
    const genres = genreMap[game.appid] || [];
    let classified = false;

    for (const genre of genres) {
      const cluster = GENRE_TO_CLUSTER[genre.toLowerCase()];
      if (cluster) {
        (clusters[cluster] = clusters[cluster] || []).push(game);
        classified = true;
        break;
      }
    }

    if (!classified) {
      const nameLower = (game.name || '').toLowerCase();
      for (const [clusterName, keywords] of Object.entries(GENRE_CLUSTERS)) {
        for (const kw of keywords) {
          if (nameLower.includes(kw)) {
            (clusters[clusterName] = clusters[clusterName] || []).push(game);
            classified = true;
            break;
          }
        }
        if (classified) break;
      }
    }

    if (!classified) {
      const hours = game.playtime_hours || 0;
      if (hours > 100) (clusters['核心偏好'] = clusters['核心偏好'] || []).push(game);
      else if (hours > 20) (clusters['次要偏好'] = clusters['次要偏好'] || []).push(game);
      else (clusters['轻度兴趣'] = clusters['轻度兴趣'] || []).push(game);
    }
  }

  const clusterStrength = {};
  for (const [clusterName, games] of Object.entries(clusters)) {
    const totalClusterHours = games.reduce((s, g) => s + (g.playtime_hours || 0), 0);
    const avgIdf = games.reduce((s, g) => s + (idfWeights[g.name] || 0.5), 0) / Math.max(games.length, 1);
    clusterStrength[clusterName] = totalClusterHours * avgIdf * Math.log(games.length + 1);
  }

  const topGenres = Object.entries(clusterStrength)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(e => e[0]);

  return { clusters, top_genres: topGenres, idf_weights: idfWeights, total_hours: totalHours, cluster_strength: clusterStrength };
}

export function rewriteIntent(profile, ownedGames) {
  if (!profile.top_genres?.length) return '';

  const lines = [];
  const topGames = [...ownedGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 15);

  for (const genre of profile.top_genres.slice(0, 4)) {
    const clusterGames = profile.clusters[genre] || [];
    if (!clusterGames.length) continue;
    const topInCluster = [...clusterGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 3);
    const gameNames = topInCluster.map(g => g.name);
    const hours = clusterGames.reduce((s, g) => s + (g.playtime_hours || 0), 0);
    lines.push(`- ${genre}: 偏好强度高(累计${Math.round(hours)}h), 代表作: ${gameNames.join(', ')}`);
  }

  if (topGames.length) {
    const coreNames = topGames.slice(0, 5).map(g => g.name);
    lines.push(`- 核心游戏(按游玩时长): ${coreNames.join(', ')}`);
  }

  return lines.join('\n');
}

export function detectSeries(gameName) {
  for (const pattern of SERIES_PATTERNS) {
    const match = pattern.exec(gameName);
    if (match) return match[1];
  }
  return '';
}

export function extractYear(releaseDate) {
  if (!releaseDate) return 0;
  const match = String(releaseDate).match(/(\d{4})/);
  return match ? parseInt(match[1]) : 0;
}

export function calculateWeightedScore(recommendation, ownedGames, profile, allRecommendations) {
  const recTags = new Set((recommendation.tags || []).map(t => t.toLowerCase()));

  let userGenres = new Set();
  let userIdfSum = 0;
  for (const genre of (profile.top_genres || [])) {
    const genreLower = genre.toLowerCase();
    for (const tagLower of recTags) {
      if (tagLower.includes(genreLower) || genreLower.includes(tagLower)) {
        userGenres.add(tagLower);
        const clusterGames = profile.clusters[genre] || [];
        const clusterIdf = clusterGames.reduce((s, g) => s + (profile.idf_weights[g.name] || 0.5), 0) / Math.max(clusterGames.length, 1);
        userIdfSum += clusterIdf;
      }
    }
  }

  let tagScore = 0;
  if (recTags.size > 0 && userGenres.size > 0) {
    const intersection = new Set([...recTags].filter(t => userGenres.has(t)));
    tagScore = intersection.size / recTags.size;
    const idfBonus = Math.min(userIdfSum / Math.max(userGenres.size, 1), 0.3);
    tagScore = Math.min(tagScore + idfBonus, 1.0);
  }

  const maxHours = Math.max(...ownedGames.map(g => g.playtime_hours || 0), 1);
  let heatScore = 0;
  for (const game of ownedGames) {
    const nameLower = (game.name || '').toLowerCase();
    for (const tag of recTags) {
      if (nameLower.includes(tag)) {
        heatScore = Math.max(heatScore, (game.playtime_hours || 0) / maxHours);
        break;
      }
    }
  }
  heatScore = Math.min(heatScore, 1.0);

  let qualityScore = 0.5;
  if (recommendation.review_score) qualityScore = recommendation.review_score / 10;
  else if (recommendation.rating) qualityScore = recommendation.rating / 10;

  const baseScore = tagScore * 1.2 + heatScore * 1.0 + qualityScore * 0.8;

  const owners = recommendation.owners || 0;
  let authorityBoost = 1.0;
  if (owners > 20_000_000) authorityBoost = 1.25;
  else if (owners > 5_000_000) authorityBoost = 1.15;

  const releaseYear = recommendation.release_year || 0;
  const recencyBoost = releaseYear >= 2018 ? 1.15 : 1.0;

  let diversityBoost = 1.0;
  if (profile.top_genres?.length) {
    let matchedClusters = 0;
    for (const genre of profile.top_genres.slice(0, 3)) {
      const clusterGames = profile.clusters[genre] || [];
      for (const cg of clusterGames) {
        const cgName = (cg.name || '').toLowerCase();
        if ([...recTags].some(t => cgName.includes(t))) {
          matchedClusters++;
          break;
        }
      }
    }
    if (matchedClusters >= 2) diversityBoost = 1.1;
  }

  return baseScore * authorityBoost * recencyBoost * diversityBoost;
}

export function filterSeriesDeepsteam(recommendations, ownedGames) {
  const ownedSeries = {};
  for (const game of ownedGames) {
    const name = game.name || '';
    const series = detectSeries(name);
    if (series) {
      const year = game.release_year || extractYear(game.release_date);
      if (!ownedSeries[series] || year > ownedSeries[series].year) {
        ownedSeries[series] = { name, year };
      }
    }
  }

  const seriesMap = {};
  const standalone = [];
  for (const rec of recommendations) {
    const searchName = rec.name || rec.chinese_name || '';
    const series = detectSeries(searchName);
    if (series) {
      (seriesMap[series] = seriesMap[series] || []).push({ ...rec, _series_year: rec.release_year || 0, _series: series });
    } else {
      standalone.push(rec);
    }
  }

  const filtered = [...standalone];
  for (const [series, items] of Object.entries(seriesMap)) {
    items.sort((a, b) => (b._series_year || 0) - (a._series_year || 0));
    if (ownedSeries[series]) {
      const ownedYear = ownedSeries[series].year;
      const newerItems = items.filter(i => (i._series_year || 0) > ownedYear);
      if (newerItems.length) filtered.push(...newerItems.slice(0, 2));
      else filtered.push(items[0]);
    } else {
      filtered.push(...items.slice(0, 2));
    }
  }

  return filtered;
}

export async function getExistingGames(env) {
  const data = await env.KV.get('data:games_detail', 'json');
  if (!data?.games) return new Set();
  return new Set(data.games.map(g => g.appid).filter(Boolean));
}

export function parseLlmResponse(response) {
  if (!response) return {};
  let jsonMatch = response.match(/```json\s*([\s\S]*?)```/);
  let jsonStr = jsonMatch ? jsonMatch[1] : response;
  jsonStr = jsonStr.trim();
  try { return JSON.parse(jsonStr); } catch {}

  const start = jsonStr.indexOf('{');
  const end = jsonStr.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try { return JSON.parse(jsonStr.slice(start, end + 1)); } catch {}
  }
  return {};
}

export async function aiAnalyzeAndRecommend(ownedGames, existingAppids, profile, llmConfig) {
  const sortedGames = [...ownedGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0));
  const k = parseFloat(llmConfig.RECOMMEND_K || '200');
  const topN = Math.max(5, Math.round(50 * (1 - Math.E ** (-sortedGames.length / k))));
  const topGames = sortedGames.slice(0, topN);

  const gamesText = topGames.map(g => `- ${g.name} (游玩${g.playtime_hours || 0}小时)`).join('\n');
  const intentRewrite = rewriteIntent(profile, ownedGames);

  const existingText = [...existingAppids].slice(0, 50).join(', ');
  const ownedText = ownedGames.slice(0, 50).map(g => g.appid).join(', ');

  const ownedSeriesNames = new Set();
  for (const game of ownedGames) {
    const series = detectSeries(game.name || '');
    if (series) ownedSeriesNames.add(series);
  }

  const prompt = `你是一个Steam游戏推荐专家，使用DeepSteam算法的多兴趣路由策略进行推荐。

## 用户多兴趣画像 (Multi-Interest Profile)
${intentRewrite || '暂无明确品类偏好'}

## 用户已拥有的游戏appid（请勿推荐这些游戏！）
${ownedText}

## 用户游戏库（按游玩时间排序）
${gamesText}

## 已推荐过的游戏appid（请勿重复推荐）
${existingText}

## 系列游戏追踪
用户已拥有的系列: ${[...ownedSeriesNames].join(', ') || '无'}
请避免推荐同系列的旧作(如果用户已有新作)，优先推荐该系列的更新作品或其他系列。

## DeepSteam推荐策略
1. **多兴趣路由**: 为用户的每条主要兴趣线推荐1-2款游戏，确保覆盖多维口味
2. **推新不推旧**: 优先推荐2018年以后的游戏，避免推荐过时作品
3. **多样性保障**: 推荐的游戏应覆盖用户的不同兴趣维度，不要集中在单一品类
4. **否定词过滤**: 如果用户游玩记录中明显缺少某品类，不要强行推荐

## 输出要求
只输出JSON，不要其他文字：
\`\`\`json
{
  "recommendations": [
    {
      "appid": 数字,
      "name": "English name",
      "chinese_name": "中文名",
      "tags": ["标签1", "标签2", "标签3"],
      "release_year": 年份数字,
      "reason": "推荐理由(说明匹配用户的哪条兴趣线)"
    }
  ]
}
\`\`\`

## 注意事项
1. 推荐用户没有的游戏
2. 每个游戏3-5个标签
3. appid必须是纯数字
4. 使用官方中文名
5. 推荐7-10款游戏以覆盖多条兴趣线`;

  const llm = createLLM(llmConfig);
  let response = '';
  let lastError = null;
  for (let attempt = 0; attempt <= 2; attempt++) {
    try {
      response = await llm.generate(prompt);
      if (response) break;
    } catch (e) {
      lastError = e;
      console.error(`LLM 第 ${attempt + 1} 次调用失败:`, e);
    }
  }
  if (!response) {
    if (lastError) throw lastError;
    throw new Error('LLM 未返回推荐内容');
  }

  const result = parseLlmResponse(response);
  if (!Array.isArray(result?.recommendations)) {
    throw new Error('LLM 返回格式无法解析为 recommendations JSON');
  }
  if (!result.recommendations.length) {
    throw new Error('LLM 返回的 recommendations 为空');
  }

  const filtered = [];
  for (const r of result.recommendations) {
    const appid = parseInt(r.appid);
    if (appid && !existingAppids.has(appid)) {
      r.appid = appid;
      filtered.push(r);
    }
  }
  if (!filtered.length) {
    throw new Error('LLM 推荐的游戏都已拥有或已推荐过');
  }
  return filtered.slice(0, 10);
}

export async function steamSearchByName(name) {
  const clean = encodeURIComponent(name);
  const urls = [
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=schinese&cc=cn`,
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=english&cc=us`,
    `https://store.steampowered.com/api/storesearch?term=${clean}&l=english&cc=cn`,
  ];
  for (const url of urls) {
    try {
      const resp = await fetch(url, { timeout: 10000 });
      if (!resp.ok) continue;
      const data = await resp.json();
      const items = data?.items || [];
      if (items.length && items[0].type === 'app') {
        return { appid: items[0].id, name: items[0].name || '', type: items[0].type };
      }
    } catch {}
  }
  return null;
}

export async function autoRecommend(env) {
  const steamApiKey = await getConfig(env, 'STEAM_API_KEY');
  const steamUserId = await getConfig(env, 'STEAM_USER_ID');
  if (!steamApiKey || !steamUserId) throw new Error('未配置 STEAM_API_KEY 或 STEAM_USER_ID');

  const llmConfig = {
    LLM_PROVIDER: await getConfig(env, 'LLM_PROVIDER'),
    LLM_API_KEY: await getConfig(env, 'LLM_API_KEY'),
    LLM_API_BASE: await getConfig(env, 'LLM_API_BASE'),
    LLM_MODEL: await getConfig(env, 'LLM_MODEL'),
    RECOMMEND_K: await getConfig(env, 'RECOMMEND_K'),
  };

  console.log('获取 Steam ID...');
  const steamId = await getSteamId(steamApiKey, steamUserId);
  if (!steamId) throw new Error('获取 Steam ID 失败');

  console.log('获取用户游戏库...');
  const { games: ownedGamesData, count: apiGameCount } = await getOwnedGames(steamApiKey, steamId);
  if (!ownedGamesData.length) throw new Error('游戏库为空');
  console.log(`拥有游戏: ${ownedGamesData.length} 款`);

  console.log('构建多兴趣画像...');
  const libraryData = await env.KV.get('data:library', 'json');
  const libraryGenres = {};
  if (libraryData?.games) {
    for (const g of libraryData.games) {
      if (g.appid && g.genres) libraryGenres[g.appid] = g.genres;
    }
  }
  const profile = buildUserProfile(ownedGamesData, libraryGenres);
  console.log(`主要品类: ${profile.top_genres?.join(', ')}`);

  console.log('检查已存在游戏...');
  const existingGames = await getExistingGames(env);
  const ownedAppids = new Set(ownedGamesData.map(g => g.appid));
  const excludeAppids = new Set([...existingGames, ...ownedAppids]);

  console.log('LLM分析并推荐...');
  const recommendations = await aiAnalyzeAndRecommend(ownedGamesData, excludeAppids, profile, llmConfig);
  if (!recommendations?.length) throw new Error('没有通过过滤的新推荐游戏');

  console.log('加权融合排序...');
  for (const rec of recommendations) {
    rec.score = calculateWeightedScore(rec, ownedGamesData, profile, recommendations);
  }
  recommendations.sort((a, b) => (b.score || 0) - (a.score || 0));

  console.log('系列感知过滤...');
  const filteredRecs = filterSeriesDeepsteam(recommendations, ownedGamesData);

  console.log('验证appid...');
  const validated = [];
  const maxValidate = Math.min(filteredRecs.length, 7);
  const verifyBatch = filteredRecs.slice(0, maxValidate);
  const results = await Promise.all(verifyBatch.map(rec => {
    const nameToSearch = rec.chinese_name;
    if (!nameToSearch) return Promise.resolve(null);
    return steamSearchByName(nameToSearch);
  }));
  for (let i = 0; i < verifyBatch.length; i++) {
    const rec = verifyBatch[i];
    const corrected = results[i];
    if (!corrected || corrected.type !== 'app') continue;
    rec.appid = corrected.appid;
    rec.verified_name = corrected.name;
    validated.push(rec);
  }
  if (!validated.length) throw new Error('所有appid验证失败');

  console.log('更新 games.json...');
  const detailData = await env.KV.get('data:games_detail', 'json');
  const existingAppidSet = new Set();
  if (detailData?.games) {
    for (const g of detailData.games) {
      if (g.appid) existingAppidSet.add(g.appid);
    }
  }

  const newRecs = validated.slice(0, 7);
  const newEntries = [];
  for (const rec of newRecs) {
    if (rec.appid && !existingAppidSet.has(rec.appid)) {
      newEntries.push({
        appid: rec.appid,
        reason: rec.reason || '',
        score: Math.round((rec.score || 0) * 10000) / 10000,
      });
    }
  }

  await saveGamesJson(env, {
    games: newEntries,
    total_owned: apiGameCount || ownedGamesData.length,
  });
  console.log(`已写入 ${newEntries.length} 个新appid`);
  return newRecs;
}
