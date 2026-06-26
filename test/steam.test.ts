import { describe, it, expect } from 'vitest'
import type { LibraryGame } from '../worker/types.js'
import { filterLibraryGames, buildGamesOutput } from '../worker/lib/steam.js'

describe('filterLibraryGames', () => {
  const sampleGames: LibraryGame[] = [
    { appid: 1, name: 'Game A', playtime_hours: 100 },
    { appid: 2, name: 'Game B', playtime_hours: 0.5 },
    { appid: 3, name: 'Game C', playtime_hours: 2 },
    { appid: 4, name: 'Game D', playtime_hours: 0 },
  ]

  it('returns FilterResult with all fields', () => {
    const result = filterLibraryGames(sampleGames, {})
    expect(result).toHaveProperty('games')
    expect(result).toHaveProperty('softwareCount')
    expect(result).toHaveProperty('filteredCount')
    expect(result).toHaveProperty('totalPlaytime')
  })

  it('filters out software from detailMap', () => {
    const games: LibraryGame[] = [
      { appid: 1, name: 'Real Game', playtime_hours: 100 },
      { appid: 2, name: 'Some Tool', playtime_hours: 100 },
    ]
    const detailMap = { 2: { type: 'tool' } }
    const result = filterLibraryGames(games, detailMap)
    expect(result.games.some(g => g.appid === 1)).toBe(true)
    expect(result.games.some(g => g.appid === 2)).toBe(false)
  })

  it('sets softwareCount when filtering software', () => {
    const games: LibraryGame[] = [
      { appid: 1, name: 'Real Game', playtime_hours: 100 },
      { appid: 2, name: 'Music', playtime_hours: 100 },
    ]
    const result = filterLibraryGames(games, { 2: { type: 'music' } })
    expect(result.softwareCount).toBe(1)
  })

  it('filters low-playtime games via dynamic threshold', () => {
    const games: LibraryGame[] = [
      { appid: 1, name: 'High', playtime_hours: 100 },
      { appid: 2, name: 'Low', playtime_hours: 0.01 },
    ]
    const result = filterLibraryGames(games, {})
    // totalPlaytime = 100.01, thresholdFactor = 0.001 → threshold = 0.10001
    // Game 2 (0.01h) is below threshold
    expect(result.games.every(g => g.appid === 1)).toBe(true)
    expect(result.filteredCount).toBe(1)
  })

  it('uses thresholdFactor option', () => {
    const games: LibraryGame[] = [
      { appid: 1, name: 'High', playtime_hours: 100 },
      { appid: 2, name: 'Low', playtime_hours: 0.01 },
    ]
    // thresholdFactor = 0, no filtering
    const result = filterLibraryGames(games, {}, { thresholdFactor: 0 })
    expect(result.games).toHaveLength(2)
  })

  it('keeps all games when detailMap is null', () => {
    const result = filterLibraryGames(sampleGames, null)
    // dynamic threshold: total = 102.5, factor 0.001 → threshold = 0.1025
    // removes Game D (0h), maybe Game B (0.5h passes since >= 0.1025)
    expect(result.games).toHaveLength(3)
  })
})

describe('buildGamesOutput', () => {
  it('returns correct structure', () => {
    const result = buildGamesOutput([
      { appid: 1, name: 'Test', playtime_hours: 10 },
    ])
    expect(result).toHaveProperty('games')
    expect(result).toHaveProperty('total_games')
    expect(result).toHaveProperty('total_playtime_hours')
    expect(Array.isArray(result.games)).toBe(true)
  })

  it('counts total games', () => {
    const result = buildGamesOutput([
      { appid: 1, name: 'A', playtime_hours: 10 },
      { appid: 2, name: 'B', playtime_hours: 20 },
    ])
    expect(result.total_games).toBe(2)
  })

  it('sums playtime hours', () => {
    const result = buildGamesOutput([
      { appid: 1, name: 'A', playtime_hours: 10.5 },
      { appid: 2, name: 'B', playtime_hours: 20.3 },
    ])
    expect(result.total_playtime_hours).toBe(30.8)
  })

  it('handles empty array', () => {
    const result = buildGamesOutput([])
    expect(result.games).toEqual([])
    expect(result.total_games).toBe(0)
    expect(result.total_playtime_hours).toBe(0)
  })
})
