import { GENRE_CLUSTERS, GENRE_TO_CLUSTER } from './genre-data.js';

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
