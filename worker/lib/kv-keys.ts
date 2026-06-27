export async function getTelegramConfig(db: D1Database): Promise<{ token?: string; adminChatId?: string }> {
  const rows = await db.prepare('SELECT key, value FROM config WHERE key IN (?, ?)')
    .bind('TELEGRAM_TOKEN', 'TELEGRAM_ADMIN_CHAT_ID').all<{ key: string; value: string }>()
  const cfg: Record<string, string> = {}
  for (const r of (rows.results || [])) { cfg[r.key] = r.value }
  return { token: cfg.TELEGRAM_TOKEN, adminChatId: cfg.TELEGRAM_ADMIN_CHAT_ID }
}

export async function setTelegramConfig(db: D1Database, config: { token?: string; adminChatId?: string }): Promise<void> {
  const stmts = []
  if (config.token !== undefined) stmts.push(db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind('TELEGRAM_TOKEN', config.token))
  if (config.adminChatId !== undefined) stmts.push(db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').bind('TELEGRAM_ADMIN_CHAT_ID', config.adminChatId))
  if (stmts.length) await db.batch(stmts)
}
