import { describe, it, expect } from 'vitest'
import type { Game, Recommendation } from '../worker/types.js'
import { calculateWeightedScore, filterSeriesDeepsteam } from '../worker/lib/scoring.js'
import { buildUserProfile } from '../worker/lib/profile.js'

const ownedGames: Game[] = [
  { appid: 10, name: 'Counter-Strike 2', playtime_hours: 500, playtime_minutes: 30000 },
  { appid: 11, name: 'Dota 2', playtime_hours: 300, playtime_minutes: 18000 },
  { appid: 12, name: 'Baldur\'s Gate 3', playtime_hours: 150, playtime_minutes: 9000 },
  { appid: 13, name: 'Elden Ring', playtime_hours: 80, playtime_minutes: 4800 },
]

const genreMap: Record<number, string[]> = {
  10: ['Action', 'FPS'],
  11: ['Strategy', 'MOBA', 'Action'],
  12: ['RPG', 'Adventure'],
  13: ['RPG', 'Action', 'Open World'],
}

const profile = buildUserProfile(ownedGames, genreMap)

describe('calculateWeightedScore', () => {
  it('returns positive score for a matching recommendation', () => {
    const rec: Recommendation = {
      appid: 1, name: 'Recommended Game', tags: ['Action', 'FPS', 'RPG'],
      release_year: 2023, reason: 'matches your playstyle',
    }
    const score = calculateWeightedScore(rec, ownedGames, profile)
    expect(score).toBeGreaterThan(0)
    expect(score).toBeLessThan(100)
  })

  it('boosts games matching user top genres using Chinese cluster names', () => {
    const matchRec: Recommendation = {
      appid: 1, name: 'Match', tags: ['动作', 'FPS'], release_year: 2022, reason: '',
    }
    const noMatchRec: Recommendation = {
      appid: 2, name: 'NoMatch', tags: ['Puzzle', 'Casual'], release_year: 2022, reason: '',
    }
    expect(
      calculateWeightedScore(matchRec, ownedGames, profile),
    ).toBeGreaterThan(
      calculateWeightedScore(noMatchRec, ownedGames, profile),
    )
  })

  it('prefers newer releases', () => {
    const oldRec: Recommendation = {
      appid: 1, name: 'Old', tags: ['Action'], release_year: 2010, reason: '',
    }
    const newRec: Recommendation = {
      appid: 2, name: 'New', tags: ['Action'], release_year: 2024, reason: '',
    }
    expect(
      calculateWeightedScore(newRec, ownedGames, profile),
    ).toBeGreaterThan(
      calculateWeightedScore(oldRec, ownedGames, profile),
    )
  })

  it('handles rec without tags gracefully', () => {
    const sparseRec: Recommendation = { appid: 99, name: 'Sparse', tags: [] }
    const score = calculateWeightedScore(sparseRec, ownedGames, profile)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('handles empty ownedGames', () => {
    const rec: Recommendation = {
      appid: 1, name: 'Test', tags: ['Action'], release_year: 2020, reason: '',
    }
    const score = calculateWeightedScore(rec, [], profile)
    expect(score).toBeGreaterThanOrEqual(0)
  })
})

describe('filterSeriesDeepsteam', () => {
  it('caps series recommendations at 2 newer items', () => {
    const recs: Recommendation[] = [
      { appid: 1, name: 'Civilization V', release_year: 2010 },
      { appid: 2, name: 'Civilization VI', release_year: 2016 },
      { appid: 3, name: 'Civilization VII', release_year: 2025 },
    ]
    const ownedWithSeries: Game[] = [
      { appid: 10, name: 'Civilization IV', release_year: 2005, playtime_hours: 100, playtime_minutes: 6000 },
    ]
    const result = filterSeriesDeepsteam(recs, ownedWithSeries)
    expect(result).toHaveLength(2)
    expect(result[0].appid).toBe(3)
    expect(result[1].appid).toBe(2)
  })

  it('keeps non-series games unchanged', () => {
    const recs: Recommendation[] = [
      { appid: 1, name: 'Cyberpunk 2077', release_year: 2020 },
      { appid: 2, name: 'Stardew Valley', release_year: 2016 },
    ]
    const result = filterSeriesDeepsteam(recs, [])
    expect(result).toHaveLength(2)
  })

  it('filters out series already owned', () => {
    const recs: Recommendation[] = [
      { appid: 1, name: 'Fallout: New Vegas', release_year: 2010 },
    ]
    const ownedWithFallout: Game[] = [
      { appid: 20, name: 'Fallout 4', release_year: 2015, playtime_hours: 200, playtime_minutes: 12000 },
    ]
    const result = filterSeriesDeepsteam(recs, ownedWithFallout)
    expect(result).toHaveLength(0)
  })

  it('returns empty for empty input', () => {
    expect(filterSeriesDeepsteam([], [])).toEqual([])
  })
})
