import dotenv from 'dotenv';
dotenv.config({ path: ['.env.local', '../../.env.local'] });
import pg from 'pg';
const p = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const r = await p.query("select count(*)::int n, min(last_success_at)::text mn, max(last_success_at)::text mx from series_sync_state where last_success_at is not null");
console.log('Serien mit Erfolg:', r.rows[0].n, '| aeltester:', r.rows[0].mn, '| neuester:', r.rows[0].mx);
await p.end();
