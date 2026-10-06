// Admin CLI for the knowledge pipeline:
//   node dist/knowledge-cli.js status
//                            | add <url> [--priority N] [--refresh]
//                            | seed <file.json>
//                            | enqueue-seen <url template with {type} and {id}> [--limit N]
//                            | reparse [--site wowhead.com]
//                            | claim <source id|key> <type>:<id|name> <attribute> <json value> <quote> [--label L]
//                            | disputes [<type>:<key>]
import { readFileSync } from 'node:fs';
import { ENTITY_TYPES } from '@forever-ledger/contracts';
import type { ClaimLabel, EntityType } from '@forever-ledger/contracts';
import { sql } from 'drizzle-orm';
import { openDatabase, runMigrations } from './db/client.js';
import { readEnv } from './env.js';
import { findDisputes } from './knowledge/disputes.js';
import { enqueueSeen } from './knowledge/enqueue.js';
import { addManualClaim } from './knowledge/manual.js';
import { importSeed } from './knowledge/seed.js';
import { enqueueUrl, reparseAll } from './knowledge/store.js';
import { chicagoIso } from './time.js';

const USAGE = `usage: knowledge-cli status | add <url> [--priority N] [--refresh] | seed <file.json>
  | enqueue-seen <template> [--limit N] | reparse [--site S]
  | claim <source> <type>:<id|name> <attribute> <json> <quote> [--label L] | disputes [<type>:<key>]`;

const argv = process.argv.slice(2);
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const has = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i !== -1) argv.splice(i, 1);
  return i !== -1;
};

/** `item:4655` or `zone:Tanaris`. */
function entity(spec: string | undefined): { type: EntityType; id?: number; name?: string } {
  const m = /^([a-z]+):(.+)$/.exec(spec ?? '');
  if (!m || !(ENTITY_TYPES as readonly string[]).includes(m[1]!)) {
    throw new Error(`entity must look like item:4655 or zone:Tanaris (${ENTITY_TYPES.join(', ')})`);
  }
  const type = m[1] as EntityType;
  return /^\d+$/.test(m[2]!) ? { type, id: Number(m[2]) } : { type, name: m[2]! };
}

const database = openDatabase(readEnv().databaseUrl);
const { db } = database;

try {
  await runMigrations(db);
  const priority = flag('priority');
  const site = flag('site');
  const limit = flag('limit');
  const label = flag('label') as ClaimLabel | undefined;
  const refresh = has('refresh');
  const [command, ...args] = argv;

  if (command === 'status') {
    const q = await db.execute<{ state: string; n: number }>(
      sql`select state, count(*)::int as n from fetch_targets group by state order by state`,
    );
    const totals = await db.execute<Record<string, number>>(sql`
      select (select count(*)::int from web_snapshots) as snapshots,
             (select count(*)::int from sources) as sources,
             (select count(*)::int from claims) as claims,
             (select count(*)::int from web_comments) as comments,
             (select count(*)::int from field_observations) as observations`);
    console.log(`queue: ${q.rows.map((r) => `${r.state} ${r.n}`).join(', ') || 'empty'}`);
    console.log(
      Object.entries(totals.rows[0]!)
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
    );
    const human = await db.execute<{ url: string; updated_at: Date }>(
      sql`select url, updated_at from fetch_targets where state = 'needs_human' order by updated_at desc limit 20`,
    );
    for (const r of human.rows) {
      console.log(`needs a human: ${r.url} (since ${chicagoIso(new Date(r.updated_at))})`);
    }
  } else if (command === 'add' && args[0]) {
    const added = await enqueueUrl(db, {
      url: args[0],
      addedBy: 'cli',
      priority: priority ? Number(priority) : 0,
      refresh,
    });
    console.log(added ? `queued ${args[0]}` : `already queued: ${args[0]} (use --refresh)`);
  } else if (command === 'seed' && args[0]) {
    const r = await importSeed(db, JSON.parse(readFileSync(args[0], 'utf8')));
    console.log(
      `seed: ${r.sources} sources, ${r.claims} new claims, ${r.observations} observations, ${r.queued} URLs queued`,
    );
  } else if (command === 'enqueue-seen' && args[0]) {
    const r = await enqueueSeen(db, args[0], { limit: limit ? Number(limit) : undefined });
    console.log(`enqueue-seen: ${r.seen} entities looked at, ${r.queued} URLs queued`);
  } else if (command === 'reparse') {
    const r = await reparseAll(db, site);
    console.log(`reparse: ${r.pages} pages, ${r.added} new claims`);
    for (const p of r.problems) console.log(`  ${p}`);
  } else if (command === 'claim' && args.length >= 5) {
    const [source, spec, attribute, json, quote] = args as [string, string, string, string, string];
    const e = entity(spec);
    const n = await addManualClaim(db, {
      source: /^\d+$/.test(source) ? Number(source) : source,
      entityType: e.type,
      entityId: e.id,
      entityName: e.name,
      attribute,
      value: JSON.parse(json),
      quote,
      label,
    });
    console.log(n ? 'claim added' : 'claim already exists');
  } else if (command === 'disputes') {
    const e = args[0] ? entity(args[0]) : undefined;
    const rows = await findDisputes(db, {
      entityType: e?.type,
      entityKey: e ? String(e.id ?? e.name) : undefined,
    });
    for (const d of rows) {
      const by = d.byClaimId
        ? `contradicted by #${d.byClaimId} (tier ${d.byTier} ${d.byLabel}) ${JSON.stringify(d.byValue)}`
        : 'labeled FALSE';
      console.log(
        `${d.entityType}:${d.entityKey} ${d.attribute} = ${JSON.stringify(d.value)} (#${d.claimId}, tier ${d.tier} ${d.label}) ${by}`,
      );
    }
    if (rows.length === 0) console.log('no disputes');
  } else {
    console.error(USAGE);
    process.exitCode = 2;
  }
} finally {
  await database.pool.end();
}
