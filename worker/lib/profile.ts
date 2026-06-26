import type { Game, UserProfile } from '../types.js'
import { GENRE_CLUSTERS, GENRE_TO_CLUSTER } from './genre-data.js'

export function buildUserProfile(ownedGames: Game[], genreMap: Record<number, string[]> = {}): UserProfile {
  if (!ownedGames.length) {
    return { clusters: {}, top_genres: [], idf_weights: {}, total_hours: 0, cluster_strength: {} }
  }

  const totalHours = ownedGames.reduce((s, g) => s + (g.playtime_hours || 0), 0)

  const idfWeights: Record<string, number> = {}
  for (const game of ownedGames) {
    const name = game.name || ''
    const hours = game.playtime_hours || 0
    idfWeights[name] = 1.0 / (Math.log10(hours + 1) + 1.0)
  }

  const clusters = new Map<string, Game[]>()
  const add = (name: string, game: Game) => {
    const list = clusters.get(name)
    if (list) list.push(game)
    else clusters.set(name, [game])
  }

  for (const game of ownedGames) {
    const genres = genreMap[game.appid] ?? []
    let classified = false

    for (const genre of genres) {
      const cluster = GENRE_TO_CLUSTER[genre.toLowerCase()]
      if (cluster) {
        add(cluster, game)
        classified = true
        break
      }
    }

    if (!classified) {
      const nameLower = (game.name || '').toLowerCase()
      for (const [clusterName, keywords] of Object.entries(GENRE_CLUSTERS)) {
        for (const kw of keywords) {
          if (nameLower.includes(kw)) {
            add(clusterName, game)
            classified = true
            break
          }
        }
        if (classified) break
      }
    }

    if (!classified) {
      const hours = game.playtime_hours || 0
      if (hours > 100) add('核心偏好', game)
      else if (hours > 20) add('次要偏好', game)
      else add('轻度兴趣', game)
    }
  }

  const clustersRecord: Record<string, Game[]> = {}
  for (const [k, v] of clusters) clustersRecord[k] = v

  const clusterStrength: Record<string, number> = {}
  for (const [clusterName, games] of clusters) {
    const totalClusterHours = games.reduce((s, g) => s + (g.playtime_hours || 0), 0)
    const avgIdf = games.reduce((s, g) => s + (idfWeights[g.name] || 0.5), 0) / Math.max(games.length, 1)
    clusterStrength[clusterName] = totalClusterHours * avgIdf * Math.log(games.length + 1)
  }

  const topGenres = Object.entries(clusterStrength)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(e => e[0])

  return { clusters: clustersRecord, top_genres: topGenres, idf_weights: idfWeights, total_hours: totalHours, cluster_strength: clusterStrength }
}

export function rewriteIntent(profile: UserProfile, ownedGames: Game[]): string {
  if (!profile.top_genres.length) return ''

  const lines: string[] = []
  const topGames = [...ownedGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 15)

  for (const genre of profile.top_genres.slice(0, 4)) {
    const clusterGames = profile.clusters[genre]
    if (!clusterGames.length) continue
    const topInCluster = [...clusterGames].sort((a, b) => (b.playtime_hours || 0) - (a.playtime_hours || 0)).slice(0, 3)
    const gameNames = topInCluster.map(g => g.name)
    const hours = clusterGames.reduce((s, g) => s + (g.playtime_hours || 0), 0)
    lines.push(`- ${genre}: 偏好强度高(累计${String(Math.round(hours))}h), 代表作: ${gameNames.join(', ')}`)
  }

  if (topGames.length) {
    const coreNames = topGames.slice(0, 5).map(g => g.name)
    lines.push(`- 核心游戏(按游玩时长): ${coreNames.join(', ')}`)
  }

  return lines.join('\n')
}
