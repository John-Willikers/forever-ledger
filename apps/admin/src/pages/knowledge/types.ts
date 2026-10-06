export type ClaimLabel = 'VERIFIED' | 'CLASSIC' | 'ANECDOTE' | 'UNVERIFIED' | 'FALSE';
export type QueueState = 'queued' | 'leased' | 'done' | 'needs_human' | 'failed';

export interface KnowledgeSummary {
  snapshots: number;
  sources: number;
  claims: number;
  comments: number;
  observations: number;
  queue: Record<QueueState, number>;
  labels: Record<ClaimLabel, number>;
  lastSnapshotAt: string | null;
}

export interface QueueRow {
  url: string;
  site: string;
  entityType: string | null;
  entityId: number | null;
  priority: number;
  state: QueueState;
  attempts: number;
  lastStatus: number | null;
  lastOutcome: string | null;
  lastError: string | null;
  nextDueAt: string | null;
  lastFetchedAt: string | null;
  leaseWorker: string | null;
  addedBy: string;
}

export interface SourceRow {
  id: number;
  key: string;
  kind: 'web' | 'seed' | 'first_party';
  url: string | null;
  site: string;
  tier: number;
  gameVersion: string;
  build: number | null;
  title: string | null;
  pageUpdatedAt: string | null;
  fetchedAt: string | null;
  note: string | null;
  snapshotId: number | null;
  claims: number;
}

export interface ClaimRow {
  id: number;
  entityType: string;
  entityKey: string;
  entityId: number | null;
  entityName: string | null;
  attribute: string;
  value: unknown;
  label: ClaimLabel;
  observedBuild: number | null;
  quote: string | null;
  parser: string;
  createdAt: string;
  tier: number;
  site: string;
  url: string | null;
  title: string | null;
}

export interface DisputeRow {
  entityType: string;
  entityKey: string;
  attribute: string;
  claimId: number;
  value: unknown;
  label: ClaimLabel;
  tier: number;
  url: string | null;
  byClaimId: number | null;
  byValue: unknown;
  byLabel: ClaimLabel | null;
  byTier: number | null;
  byUrl: string | null;
}

export interface ObservationRow {
  id: number;
  key: string;
  character: string | null;
  faction: string | null;
  race: string | null;
  class: string | null;
  level: number | null;
  build: number | null;
  gameVersion: string;
  observedAt: string;
  durationMins: number | null;
  location: unknown;
  method: string;
  setup: unknown;
  result: unknown;
  notes: string | null;
}

export interface Listing<T> {
  total?: number;
  items: T[];
}
