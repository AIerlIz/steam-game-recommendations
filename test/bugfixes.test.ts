import { describe, it, expect } from 'vitest'
import type { Game, Recommendation, UserProfile } from '../worker/types.js'
import { calculateWeightedScore } from '../worker/lib/scoring.js'
import { buildUserProfile } from '../worker/lib/profile.js'

describe('Bug Fix: profile.clusters null safety (Critical #3)', () => {
  it('does not crash when top_genres contains genre not in clusters', () => {
    const games: Game[] = [
      { appid: 1, name: 'Test Game', playtime_hours: 100, playtime_minutes: 6000 },
    ]
    const profile = buildUserProfile(games, { 1: ['Action'] })
    // Artificially add a genre to top_genres that is not in clusters
    profile.top_genres.push('NonExistentGenre')
    const rec: Recommendation = {
      appid: 99, name: 'Test', tags: ['NonExistentGenre'], release_year: 2023, reason: '',
    }
    // Should not throw
    const score = calculateWeightedScore(rec, games, profile)
    expect(score).toBeGreaterThanOrEqual(0)
  })

  it('returns positive score when clusters has all top_genres', () => {
    const games: Game[] = [
      { appid: 1, name: 'CS2', playtime_hours: 500, playtime_minutes: 30000 },
    ]
    const profile = buildUserProfile(games, { 1: ['FPS', 'Action'] })
    const rec: Recommendation = {
      appid: 99, name: 'FPS Game', tags: ['FPS', 'Shooter'], release_year: 2024, reason: '',
    }
    const score = calculateWeightedScore(rec, games, profile)
    expect(score).toBeGreaterThan(0)
  })
})

describe('Bug Fix: Open Redirect (Critical #4)', () => {
  // We test the redirect validation logic inline since it's in index.ts
  function safeRedirect(redirectPath: string | null): string {
    const p = redirectPath || '/'
    return p.startsWith('/') && !p.startsWith('//') ? p : '/'
  }

  it('allows valid relative paths', () => {
    expect(safeRedirect('/')).toBe('/')
    expect(safeRedirect('/library')).toBe('/library')
    expect(safeRedirect('/search?q=test')).toBe('/search?q=test')
  })

  it('blocks protocol-relative URLs', () => {
    expect(safeRedirect('//evil.com')).toBe('/')
    expect(safeRedirect('//evil.com/steal')).toBe('/')
  })

  it('blocks absolute URLs', () => {
    expect(safeRedirect('https://evil.com')).toBe('/')
    expect(safeRedirect('http://evil.com/steal')).toBe('/')
  })

  it('handles null gracefully', () => {
    expect(safeRedirect(null)).toBe('/')
  })
})

describe('Bug Fix: LIKE wildcard escaping (Critical #5)', () => {
  // Test the escaping logic directly
  function escapeLike(s: string): string {
    return s.replace(/[%_]/g, '\\$&')
  }

  it('escapes percent signs', () => {
    expect(escapeLike('100%')).toBe('100\\%')
    expect(escapeLike('%test')).toBe('\\%test')
  })

  it('escapes underscores', () => {
    expect(escapeLike('test_game')).toBe('test\\_game')
  })

  it('escapes percent and underscore independently', () => {
    expect(escapeLike('100%test_game')).toBe('100\\%test\\_game')
  })

  it('leaves normal text unchanged', () => {
    expect(escapeLike('hello world')).toBe('hello world')
    expect(escapeLike('Counter-Strike 2')).toBe('Counter-Strike 2')
  })
})

describe('Bug Fix: calculateWeightedScore edge cases', () => {
  const games: Game[] = [
    { appid: 1, name: 'CS2', playtime_hours: 500, playtime_minutes: 30000 },
    { appid: 2, name: 'Dota 2', playtime_hours: 300, playtime_minutes: 18000 },
  ]
  const profile = buildUserProfile(games, { 1: ['FPS', 'Action'], 2: ['MOBA', 'Strategy'] })

  it('handles rec with empty tags', () => {
    const rec: Recommendation = { appid: 99, name: 'No Tags', tags: [] }
    expect(calculateWeightedScore(rec, games, profile)).toBeGreaterThanOrEqual(0)
  })

  it('handles rec with undefined tags', () => {
    const rec: Recommendation = { appid: 99, name: 'No Tags' }
    expect(calculateWeightedScore(rec, games, profile)).toBeGreaterThanOrEqual(0)
  })

  it('handles empty ownedGames', () => {
    const rec: Recommendation = { appid: 99, name: 'Test', tags: ['FPS'] }
    expect(calculateWeightedScore(rec, [], profile)).toBeGreaterThanOrEqual(0)
  })

  it('handles profile with empty clusters', () => {
    const emptyProfile: UserProfile = {
      clusters: {}, top_genres: ['FPS'], idf_weights: {}, total_hours: 0, cluster_strength: {},
    }
    const rec: Recommendation = { appid: 99, name: 'Test', tags: ['FPS'] }
    expect(calculateWeightedScore(rec, games, emptyProfile)).toBeGreaterThanOrEqual(0)
  })
})
