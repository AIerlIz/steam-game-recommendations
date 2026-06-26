import { describe, it, expect } from 'vitest'
import { parseLlmResponse } from '../worker/lib/recommend.js'

describe('parseLlmResponse', () => {
  it('parses inline JSON', () => {
    const result = parseLlmResponse('{"recommendations": [{"appid": 1}]}')
    expect(result.recommendations).toBeDefined()
    expect(Array.isArray(result.recommendations)).toBe(true)
  })

  it('parses JSON from markdown code block', () => {
    const response = 'Some text\n```json\n{"recommendations": [{"appid": 2}]}\n```\nmore text'
    const result = parseLlmResponse(response)
    expect(result.recommendations).toBeDefined()
  })

  it('extracts JSON from surrounding text using braces', () => {
    const response = 'Here is the result: {"appid": 3, "name": "Test"} and that is all.'
    const result = parseLlmResponse(response)
    expect(result.appid).toBe(3)
  })

  it('returns empty object for empty string', () => {
    expect(parseLlmResponse('')).toEqual({})
  })

  it('returns empty object for invalid input', () => {
    expect(parseLlmResponse('no json here')).toEqual({})
  })

  it('prioritizes code block over inline braces', () => {
    const response = '```json\n{"from_block": true}\n```\n{"from_inline": true}'
    const result = parseLlmResponse(response)
    expect(result.from_block).toBe(true)
    expect(result.from_inline).toBeUndefined()
  })
})
