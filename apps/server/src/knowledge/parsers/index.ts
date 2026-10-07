import { classifySource } from '@forever-ledger/contracts';
import { pageTitle, pageUpdatedAt, parseHtml } from '../html.js';
import { MOBALYTICS_PARSER, parseMobalyticsMap } from './mobalytics.js';
import { parseTables, TABLE_PARSER } from './tables.js';
import type { ParseResult } from './types.js';
import { parseWowhead } from './wowhead.js';

export type { ClaimDraft, CommentDraft, ParseResult } from './types.js';

/** A build number the page states (`build 70009`, `Build: 69913`), when exactly one is stated. */
export function statedBuild(text: string): number | null {
  const found = new Set(
    [...text.matchAll(/\bbuild[:\s#]*(6\d{4}|7\d{4})\b/gi)].map((m) => Number(m[1])),
  );
  return found.size === 1 ? [...found][0]! : null;
}

/** Everything a stored page yields. Pure: same HTML and URL, same result. */
export function parseSnapshot(html: string, url: string): ParseResult {
  const root = parseHtml(html);
  const title = pageTitle(root);
  const updated = pageUpdatedAt(root);
  const { site } = classifySource(url);
  if (site === 'wowhead.com') {
    return { ...parseWowhead(root, url, title), pageUpdatedAt: updated };
  }
  const mobalytics = site === 'mobalytics.gg';
  return {
    parser: mobalytics ? `${MOBALYTICS_PARSER}+${TABLE_PARSER}` : TABLE_PARSER,
    title,
    pageUpdatedAt: updated,
    build: statedBuild(root.textContent),
    claims: mobalytics ? [...parseMobalyticsMap(root), ...parseTables(root)] : parseTables(root),
    comments: [],
    problems: [],
  };
}
