import { steamStoreSearch } from '../lib/telegram/utils.js'

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json;charset=UTF-8' } })
}

export async function handleSearch(env: Env, request: Request): Promise<Response> {
  const url = new URL(request.url)
  const q = url.searchParams.get('q') || ''
  if (!q) return jsonResponse({ error: 'Missing query' }, 400)
  const result = await steamStoreSearch(q, 'schinese')
  return jsonResponse({ results: result.items || [] })
}
