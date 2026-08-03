// One-time maintenance: remove unassigned time from the shared database.
//
// Tally no longer tracks unassigned time (it's dropped at rollup). Existing
// shared rows that used the old -1 "no client" sentinel are stale noise — this
// deletes them so the team view shows only client-attributed time.
//
// Usage (better-sqlite3 in package.json forces Electron's ABI, so run under
// Electron's Node, not plain node):
//   DATABASE_URL=postgres://…  ELECTRON_RUN_AS_NODE=1 npx electron scripts/purge-unassigned.ts
//
// Idempotent: safe to run more than once.

import postgres from 'postgres'

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set')

  const sql = postgres(url, { ssl: 'require' })
  try {
    const [before] = await sql`SELECT COUNT(*)::int AS n FROM daily_activity WHERE client_id = -1`
    console.log(`unassigned rows (client_id = -1): ${before.n}`)
    if (before.n > 0) {
      await sql`DELETE FROM daily_activity WHERE client_id = -1`
      console.log(`deleted ${before.n} unassigned rows`)
    }
    const [remaining] = await sql`SELECT COUNT(*)::int AS n FROM daily_activity WHERE client_id = -1`
    console.log(`remaining unassigned rows: ${remaining.n}`)
  } finally {
    await sql.end()
  }
}

main().catch((err) => {
  console.error('Purge failed:', err.message)
  process.exit(1)
})
