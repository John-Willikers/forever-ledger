import type { ClaimLabel, EntityType, GameVersion } from '@forever-ledger/contracts';

/** A claim before it has a source row: what a parser read off a page. */
export interface ClaimDraft {
  entityType: EntityType;
  /** Game id when the page gives one. */
  entityId?: number | null;
  /** Name, the key when there is no id (zones from a guide table). */
  entityName?: string | null;
  attribute: string;
  value: unknown;
  /** Overrides the label the source's tier and game version give. */
  label?: ClaimLabel;
  observedBuild?: number | null;
  quote?: string | null;
}

export interface CommentDraft {
  commentId: number;
  entityType: EntityType | null;
  entityId: number | null;
  postedAt: Date | null;
  rating: number | null;
  body: string;
  /** The site's own version tag for the comment (Wowhead `dataTree`), when it gives one. */
  dataTree: number | null;
  gameVersion: GameVersion;
}

/** A page a parser says should be fetched too (a list page's quests), queued when the snapshot is applied. */
export interface FollowDraft {
  url: string;
  entityType: EntityType | null;
  entityId: number | null;
  priority: number;
}

export interface ParseResult {
  /** e.g. `wowhead@1`. Bump the number when a parser's output changes, then run `knowledge-cli reparse`. */
  parser: string;
  title: string | null;
  pageUpdatedAt: Date | null;
  /** Build the page says it describes, when it says so. */
  build: number | null;
  claims: ClaimDraft[];
  comments: CommentDraft[];
  /** Parts of the page the parser expected but couldn't read, for the admin panel. */
  problems: string[];
  /** Pages to queue (never re-queues one already known: its state and priority stay). */
  follow?: FollowDraft[];
}
