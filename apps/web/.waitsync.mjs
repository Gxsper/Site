import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '../../.env.local'] });
import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const cutoff = process.argv[2];
const bis = Date.now() + 8 * 60_000;
while (Date.now() < bis) {
  const r = await p.query(
    'select count(*)::int n from series_sync_state where last_success_at > $1',
    [cutoff],
  );
  const n = r.rows[0].n;
  if (n >= 38) {
    const t = await p.query("select min(last_success_at)::text mn, max(last_success_at)::text mx from series_sync_state");
    console.log('Alle 38 Serien erneuert.');
    console.log('  aeltester:', t.rows[0].mn);
    console.log('  neuester :', t.rows[0].mx);
    await p.end();
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, 15_000));
}
const r = await p.query('select count(*)::int n from series_sync_state where last_success_at > $1', [cutoff]);
console.log('Zeitüberschreitung — nur', r.rows[0].n, 'von 38 erneuert.');
await p.end();
process.exit(1);
