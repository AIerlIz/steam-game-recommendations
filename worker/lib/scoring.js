import { SERIES_PATTERNS } from './genre-data.js';

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
