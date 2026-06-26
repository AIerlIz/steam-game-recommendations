import type { Game, UserProfile, Recommendation } from '../types.js'
import { SERIES_PATTERNS } from './genre-data.js'

export function detectSeries(gameName: string): string {
  for (const pattern of SERIES_PATTERNS) {
    const match = pattern.exec(gameName)
    if (match) return match[1]
  }
  return ''
}

export function extractYear(releaseDate?: string): number {
  if (!releaseDate) return 0
  const match = releaseDate.match(/(\d{4})/)
  if (match) return parseInt(match[1])
  return 0
}

export function calculateWeightedScore(
  recommendation: Recommendation,
  ownedGames: Game[],
  profile: UserProfile,
): number {
  const recTags = new Set((recommendation.tags || []).map(t => t.toLowerCase()))

  const userGenres = new Set<string>()
  let userIdfSum = 0
  for (const genre of profile.top_genres) {
    const genreLower = genre.toLowerCase()
    for (const tagLower of recTags) {
      if (tagLower.includes(genreLower) || genreLower.includes(tagLower)) {
        userGenres.add(tagLower)
        const clusterGames = profile.clusters[genre]
        const clusterIdf = clusterGames.reduce((s, g) => s + (profile.idf_weights[g.name] || 0.5), 0) / Math.max(clusterGames.length, 1)
        userIdfSum += clusterIdf
      }
    }
  }

  let tagScore = 0
  if (recTags.size > 0 && userGenres.size > 0) {
    const intersection = [...recTags].filter(t => userGenres.has(t))
    tagScore = intersection.length / recTags.size
    const idfBonus = Math.min(userIdfSum / Math.max(userGenres.size, 1), 0.3)
    tagScore = Math.min(tagScore + idfBonus, 1.0)
  }

  const maxHours = Math.max(...ownedGames.map(g => g.playtime_hours || 0), 1)
  let heatScore = 0
  for (const game of ownedGames) {
    const nameLower = (game.name || '').toLowerCase()
    for (const tag of recTags) {
      if (nameLower.includes(tag)) {
        heatScore = Math.max(heatScore, (game.playtime_hours || 0) / maxHours)
        break
      }
    }
  }
  heatScore = Math.min(heatScore, 1.0)

  let qualityScore = 0.5
  if (recommendation.review_score) qualityScore = recommendation.review_score / 10
  else if (recommendation.rating) qualityScore = recommendation.rating / 10

  const baseScore = tagScore * 1.2 + heatScore * 1.0 + qualityScore * 0.8

  const owners = recommendation.owners || 0
  let authorityBoost = 1.0
  if (owners > 20_000_000) authorityBoost = 1.25
  else if (owners > 5_000_000) authorityBoost = 1.15

  const releaseYear = recommendation.release_year || 0
  const recencyBoost = releaseYear >= 2018 ? 1.15 : 1.0

  let diversityBoost = 1.0
  if (profile.top_genres.length) {
    let matchedClusters = 0
    for (const genre of profile.top_genres.slice(0, 3)) {
      const clusterGames = profile.clusters[genre]
      for (const cg of clusterGames) {
        const cgName = (cg.name || '').toLowerCase()
        if ([...recTags].some(t => cgName.includes(t))) {
          matchedClusters++
          break
        }
      }
    }
    if (matchedClusters >= 2) diversityBoost = 1.1
  }

  return baseScore * authorityBoost * recencyBoost * diversityBoost
}

export function filterSeriesDeepsteam(recommendations: Recommendation[], ownedGames: Game[]): Recommendation[] {
  const ownedSeries = new Map<string, { name: string; year: number }>()
  for (const game of ownedGames) {
    const name = game.name || ''
    const series = detectSeries(name)
    if (series) {
      const year = game.release_year || extractYear(game.release_date)
      const existing = ownedSeries.get(series)
      if (!existing || year > existing.year) {
        ownedSeries.set(series, { name, year })
      }
    }
  }

  interface SeriesItem extends Recommendation {
    _series_year: number
    _series: string
  }

  const seriesMap = new Map<string, SeriesItem[]>()
  const standalone: Recommendation[] = []
  for (const rec of recommendations) {
    const searchName = rec.name || rec.chinese_name || ''
    const series = detectSeries(searchName)
    if (series) {
      const item: SeriesItem = { ...rec, _series_year: rec.release_year || 0, _series: series }
      const list = seriesMap.get(series)
      if (list) list.push(item)
      else seriesMap.set(series, [item])
    } else {
      standalone.push(rec)
    }
  }

  const filtered = [...standalone]
  for (const [series, items] of seriesMap) {
    items.sort((a, b) => (b._series_year || 0) - (a._series_year || 0))
    const owned = ownedSeries.get(series)
    if (owned) {
      const ownedYear = owned.year
      const newerItems = items.filter(i => (i._series_year || 0) > ownedYear)
      if (newerItems.length) filtered.push(...newerItems.slice(0, 2))
      else filtered.push(items[0])
    }
  }

  return filtered
}
