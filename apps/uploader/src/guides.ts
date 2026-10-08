// In-game guides (project-plans/forever-ledger-guides.md): the tray fetches the guides the server holds for the
// characters it uploads and writes them as a generated addon, Interface/AddOns/ForeverLedger_Guides, next to
// ForeverLedger. The game loads it at the next /reload or login, and the ForeverLedger addon's viewer shows it.
// The data file is Lua the game runs, so it is generated from the validated guide shape only: tables, numbers,
// booleans and escaped strings, never code and never raw text from anywhere.
import { createHash } from 'node:crypto';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { GuidesResponse } from '@forever-ledger/contracts';
import type { GuideDoc } from '@forever-ledger/contracts';
import { addonsDirFor, hasAddonFolder } from './addonInstall.js';
import type { FetchLike } from './client.js';
import { requireServer } from './config.js';
import type { Config } from './config.js';
import { discoverSavedVariables } from './discover.js';
import { errorMessage } from './errors.js';
import { RM_DIR, readJsonIfExists, writeFileAtomic, writeJsonAtomic } from './fsutil.js';
import { silentLogger } from './log.js';
import type { Logger } from './log.js';

export const GUIDES_ADDON = 'ForeverLedger_Guides';
export const GUIDES_FILE = 'Guides.lua';
/** Used when the installed ForeverLedger.toc can't be read (Forever build 69913+). */
const FALLBACK_INTERFACE = 16001;

export class GuidesSyncError extends Error {}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
const LUA_KEYWORDS = new Set(
  'and break do else elseif end false for function if in local nil not or repeat return then true until while'.split(
    ' ',
  ),
);

/** A Lua string literal: printable ASCII as is, quotes and backslashes escaped, everything else as \ddd bytes. */
export function luaString(s: string): string {
  let out = '"';
  for (const byte of Buffer.from(s, 'utf8')) {
    if (byte === 0x22) out += '\\"';
    else if (byte === 0x5c) out += '\\\\';
    else if (byte >= 0x20 && byte < 0x7f) out += String.fromCharCode(byte);
    else out += `\\${String(byte).padStart(3, '0')}`;
  }
  return `${out}"`;
}

/** A Lua literal for plain data (objects, arrays, strings, finite numbers, booleans); null and undefined are left out. */
export function toLua(value: unknown, indent = ''): string {
  if (typeof value === 'string') return luaString(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new GuidesSyncError(`not a finite number: ${value}`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    const items = value.filter((v) => v !== null && v !== undefined).map((v) => toLua(v, inner));
    return items.length === 0
      ? '{}'
      : `{\n${items.map((i) => `${inner}${i},`).join('\n')}\n${indent}}`;
  }
  if (typeof value === 'object' && value !== null) {
    const fields = Object.entries(value)
      .filter(([, v]) => v !== null && v !== undefined)
      .map(([k, v]) => {
        if (!IDENT.test(k) || LUA_KEYWORDS.has(k))
          throw new GuidesSyncError(`not a Lua field name: ${k}`);
        return `${inner}${k} = ${toLua(v, inner)},`;
      });
    return fields.length === 0 ? '{}' : `{\n${fields.join('\n')}\n${indent}}`;
  }
  throw new GuidesSyncError(`can't write ${typeof value} as Lua data`);
}

/** The generated data file: one global table the viewer reads. */
export function guidesLua(guides: GuideDoc[], writtenAt: number): string {
  return [
    '-- Forever Ledger guides, written by the Forever Ledger tray app. Replaced each time a guide arrives:',
    "-- don't edit it. /reload in game to load new guides; /fl guide shows them.",
    `ForeverLedgerGuidesData = ${toLua({ version: 1, written: writtenAt, guides })}`,
    '',
  ].join('\n');
}

export function guidesToc(interfaceVersion: number, version: string): string {
  return [
    `## Interface: ${interfaceVersion}`,
    '## Title: Forever Ledger Guides',
    '## Notes: Leveling guides from the Forever Ledger (written by the tray app; shown by Forever Ledger)',
    `## Version: ${version}`,
    '',
    GUIDES_FILE,
    '',
  ].join('\n');
}

/** The Interface number of the installed ForeverLedger, so the generated addon loads on the same client. */
async function interfaceOf(addonsDir: string): Promise<number> {
  try {
    const toc = await readFile(join(addonsDir, 'ForeverLedger', 'ForeverLedger.toc'), 'utf8');
    const m = /^##\s*Interface:\s*(\d+)/m.exec(toc);
    return m ? Number(m[1]) : FALLBACK_INTERFACE;
  } catch {
    return FALLBACK_INTERFACE;
  }
}

export interface GuidesSyncOptions {
  config: Config;
  fetchImpl?: FetchLike;
  logger?: Logger;
  now?: () => number;
}

export interface GuidesSyncResult {
  /** `no-addon`: ForeverLedger isn't installed anywhere under wowPath, so nothing was written or acked. */
  status: 'written' | 'unchanged' | 'removed' | 'none' | 'no-addon' | 'error';
  guides: { id: number; char: string; title: string; steps: number }[];
  /** Guides written for the first time (the window says "/reload to load"). */
  arrived: { id: number; char: string; title: string }[];
  /** The guides addon folder was just created somewhere: WoW only sees a new addon after a restart, not a /reload. */
  newFolder: boolean;
  /** AddOns folders that could not be written this time (the error is logged). */
  failed: string[];
  addonsDirs: string[];
}

/** `<stateDir>/guides-sync.json`: what was written last and which guides were acked. */
interface GuidesState {
  hash?: string;
  acked?: number[];
  /** Guides already announced in the window (announced once, even while the ack keeps failing). */
  announced?: number[];
}

const statePath = (config: Config) => join(config.stateDir, 'guides-sync.json');

async function readState(config: Config): Promise<GuidesState> {
  try {
    const raw = await readJsonIfExists(statePath(config));
    return raw && typeof raw === 'object' ? (raw as GuidesState) : {};
  } catch {
    return {};
  }
}

async function call(
  opts: GuidesSyncOptions,
  path: string,
  init: { method?: string; body?: unknown } = {},
): Promise<unknown> {
  const { serverUrl, token } = requireServer(opts.config);
  const fetchImpl = opts.fetchImpl ?? fetch;
  let res: Response;
  try {
    res = await fetchImpl(`${serverUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
        ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err) {
    throw new GuidesSyncError(`guides request failed: ${errorMessage(err)}`);
  }
  if (res.status === 401 || res.status === 403)
    throw new GuidesSyncError('token rejected by the server');
  if (!res.ok) throw new GuidesSyncError(`guides request failed: HTTP ${res.status}`);
  return res.json();
}

/**
 * Fetches this tray's guides and writes them into every AddOns folder where ForeverLedger is installed. Writes only
 * when they changed; with no guides left the generated addon is removed. New guides are acked to the server.
 */
export async function syncGuides(opts: GuidesSyncOptions): Promise<GuidesSyncResult> {
  const logger = opts.logger ?? silentLogger();
  const { config } = opts;
  if (!config.wowPath) throw new GuidesSyncError('wowPath is not set');
  const parsed = GuidesResponse.safeParse(await call(opts, '/v1/guides'));
  if (!parsed.success) throw new GuidesSyncError('the server sent guides this tray cannot read');
  const guides = parsed.data.guides;

  const found = await discoverSavedVariables(config.wowPath, { accounts: config.accounts });
  const dirs: string[] = [];
  for (const wtfDir of found.wtfDirs) {
    const addonsDir = addonsDirFor(wtfDir);
    if (await hasAddonFolder(addonsDir)) dirs.push(addonsDir);
  }
  if (dirs.length === 0) {
    return {
      status: 'no-addon',
      guides: guides.map((g) => ({
        id: g.id,
        char: g.char,
        title: g.title,
        steps: g.steps.length,
      })),
      arrived: [],
      addonsDirs: [],
      newFolder: false,
      failed: [],
    };
  }
  const state = await readState(config);
  const hash = createHash('sha256').update(JSON.stringify(guides)).digest('hex');
  const acked = new Set(state.acked ?? []);
  const summary = guides.map((g) => ({
    id: g.id,
    char: g.char,
    title: g.title,
    steps: g.steps.length,
  }));
  const announced = new Set(state.announced ?? []);

  let status: GuidesSyncResult['status'];
  const exists = (path: string) =>
    readFile(path).then(
      () => true,
      () => false,
    );
  const complete = async (dir: string) =>
    (await exists(join(dir, GUIDES_ADDON, GUIDES_FILE))) &&
    (await exists(join(dir, GUIDES_ADDON, `${GUIDES_ADDON}.toc`)));
  const allPresent = (await Promise.all(dirs.map(complete))).every(Boolean);
  let newFolder = false;
  const failed: string[] = [];
  if (guides.length === 0) {
    for (const dir of dirs) await rm(join(dir, GUIDES_ADDON), RM_DIR);
    status = state.hash === undefined ? 'none' : 'removed';
  } else if (state.hash === hash && allPresent) {
    status = 'unchanged';
  } else {
    const writtenAt = Math.floor((opts.now ?? Date.now)() / 1000);
    const lua = guidesLua(guides, writtenAt);
    // Each WoW folder on its own: one that can't be written doesn't stop the others.
    for (const dir of dirs) {
      const folder = join(dir, GUIDES_ADDON);
      try {
        const existed = await exists(join(folder, `${GUIDES_ADDON}.toc`));
        await mkdir(folder, { recursive: true });
        await writeFileAtomic(
          join(folder, `${GUIDES_ADDON}.toc`),
          guidesToc(await interfaceOf(dir), String(writtenAt)),
        );
        await writeFileAtomic(join(folder, GUIDES_FILE), lua);
        if (!existed) newFolder = true;
      } catch (err) {
        failed.push(dir);
        logger.warn({ dir, err: errorMessage(err) }, 'could not write guides into this WoW folder');
      }
    }
    status = failed.length === dirs.length ? 'error' : 'written';
    if (status === 'written') logger.info({ guides: guides.length, dirs }, 'guides written');
  }

  // The server learns the guides are in the game once at least one folder has them.
  const delivered = status === 'written' || status === 'unchanged';
  const toAck = delivered ? guides.filter((g) => !acked.has(g.id)).map((g) => g.id) : [];
  if (toAck.length > 0) {
    try {
      await call(opts, '/v1/guides/ack', { method: 'POST', body: { ids: toAck } });
      for (const id of toAck) acked.add(id);
    } catch (err) {
      logger.warn({ err: errorMessage(err) }, 'guides ack failed; will retry');
    }
  }
  const arrived = delivered
    ? guides
        .filter((g) => !announced.has(g.id))
        .map((g) => ({ id: g.id, char: g.char, title: g.title }))
    : [];
  for (const a of arrived) announced.add(a.id);
  const keep = new Set(guides.map((g) => g.id));
  await writeJsonAtomic(statePath(config), {
    // A failed write is tried again next time.
    hash: guides.length === 0 || status === 'error' ? undefined : hash,
    acked: [...acked].filter((id) => keep.has(id)),
    announced: [...announced].filter((id) => keep.has(id)),
  } satisfies GuidesState);
  return { status, guides: summary, arrived, addonsDirs: dirs, newFolder, failed };
}
