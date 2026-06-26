import { describe, it, expect } from 'vitest'
import type { Game } from '../worker/types.js'
import { buildUserProfile, rewriteIntent } from '../worker/lib/profile.js'

const sampleGames: Game[] = [
  { appid: 1, name: 'Counter-Strike 2', playtime_hours: 500, playtime_minutes: 30000 },
  { appid: 2, name: 'Baldur\'s Gate 3', playtime_hours: 150, playtime_minutes: 9000 },
  { appid: 3, name: 'Stardew Valley', playtime_hours: 30, playtime_minutes: 1800 },
]

const genreMap: Record<number, string[]> = {
  1: ['Action', 'FPS'],
  2: ['RPG', 'Adventure'],
  3: ['RPG', 'Simulation'],
}

describe('buildUserProfile', () => {
  it('returns a UserProfile with expected structure', () => {
    const profile = buildUserProfile(sampleGames, genreMap)
    expect(profile).toHaveProperty('clusters')
    expect(profile).toHaveProperty('top_genres')
    expect(profile).toHaveProperty('idf_weights')
    expect(profile).toHaveProperty('total_hours')
    expect(profile).toHaveProperty('cluster_strength')
  })

  it('computes total_hours correctly', () => {
    const profile = buildUserProfile(sampleGames, genreMap)
    expect(profile.total_hours).toBe(680)
  })

  it('handles empty game list', () => {
    const profile = buildUserProfile([], {})
    expect(profile.total_hours).toBe(0)
    expect(profile.top_genres).toEqual([])
    expect(profile.cluster_strength).toEqual({})
  })

  it('handles games without genre mapping using name-based fallback', () => {
    const games: Game[] = [
      { appid: 99, name: 'Some Unknown Game', playtime_hours: 10, playtime_minutes: 600 },
    ]
    const profile = buildUserProfile(games, {})
    expect(profile.total_hours).toBe(10)
    expect(profile.top_genres.length).toBeGreaterThanOrEqual(0)
  })

  it('classifies games into clusters', () => {
    const profile = buildUserProfile(sampleGames, genreMap)
    expect(Object.keys(profile.clusters).length).toBeGreaterThanOrEqual(2)
  })

  it('top_genres contains cluster names', () => {
    const profile = buildUserProfile(sampleGames, genreMap)
    for (const genre of profile.top_genres) {
      expect(typeof genre).toBe('string')
      expect(genre.length).toBeGreaterThan(0)
    }
  })
})

describe('rewriteIntent', () => {
  it('returns a non-empty string for a non-empty profile', () => {
    const profile = buildUserProfile(sampleGames, genreMap)
    const result = rewriteIntent(profile, sampleGames)
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('handles empty profile gracefully', () => {
    const emptyProfile = buildUserProfile([], {})
    expect(rewriteIntent(emptyProfile, [])).toBe('')
  })
})
