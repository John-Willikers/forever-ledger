// Shapes of the admin API responses (apps/server/src/routes/adminData.ts, adminAccess.ts, diagnostics.ts).
// Times are ISO strings with the America/Chicago offset.
import type { Role } from './api';

export interface UserRef {
  id: number;
  battletag: string;
}

export interface VersionInUse {
  version: string;
  uploaders: number;
  lastSeen: string;
}

export interface BuildSeen {
  build: number;
  version: string | null;
  interface: number | null;
  firstSeen: string;
  lastSeen: string;
  uploads: number;
}

export interface FlaggedSample {
  api: string;
  build: number;
  observedAt: string;
  entries: number;
}

export interface Overview {
  generatedAt: string;
  uploads: { today: number; last7d: number; total: number; lastAt: string | null };
  recordsByKind: { kind: string; count: number }[];
  totals: { characters: number; accounts: number; uploaders: number; records: number };
  builds: BuildSeen[];
  versions: { addon: VersionInUse[]; tray: VersionInUse[] };
  health: {
    ingestErrors7d: number;
    diagnostics7d: Record<string, number>;
    flaggedSamples: FlaggedSample[];
  };
}

export interface Upload {
  id: number;
  receivedAt: string;
  tokenId: number | null;
  tokenLabel: string | null;
  owner: UserRef | null;
  uploaderId: string;
  account: string;
  schemaVersion: number;
  clientBuild: number;
  addonVersion: string | null;
  records: Record<string, number>;
  total: number;
}

export interface UploadsPage {
  items: Upload[];
  nextBefore: number | null;
}

export interface HourBucket {
  hour: string;
  count: number;
}

export interface UploadsHourly {
  days: number;
  buckets: HourBucket[];
}

export interface CharacterRow {
  key: string;
  name: string;
  realm: string;
  class: string | null;
  race: string | null;
  faction: string | null;
  level: number | null;
  lastSeen: string | null;
  owners: UserRef[];
  tokens: { id: number; label: string }[];
}

export interface Token {
  id: number;
  label: string;
  createdAt: string;
  revokedAt: string | null;
  lastUsedAt: string | null;
  owner: UserRef | null;
  /** Read scope: may also read every /v1 read route (all data, export, diagnostics). */
  canRead: boolean;
  uploads: number;
  lastUploadAt: string | null;
}

export interface MintedToken {
  id: number;
  label: string;
  owner: UserRef | null;
  canRead: boolean;
  /** Shown once; never returned again. */
  token: string;
}

export interface AdminUser {
  id: number;
  battletag: string;
  role: Role;
  createdAt: string;
  lastLoginAt: string | null;
  tokens: number;
}

export type SampleFlag = 'errors' | 'fieldMisses';

export interface ApiSampleInfo {
  api: string;
  build: number;
  observedAt: string;
  size: number;
  flag: SampleFlag | null;
  entries: number;
}

export interface ApiSample {
  api: string;
  build: number;
  observedAt: string;
  sample: unknown;
  builds: number[];
}

export interface DiagnosticItem {
  type: 'diagnostic';
  id: number;
  receivedAt: string;
  occurredAt: string;
  tokenId: number | null;
  uploaderId: string | null;
  appVersion: string | null;
  platform: string | null;
  level: string | null;
  source: string | null;
  message: string | null;
  detail: unknown;
}

export interface IngestErrorItem {
  type: 'ingest-error';
  id: number;
  receivedAt: string;
  tokenId: number | null;
  uploaderId: string | null;
  account: string | null;
  schemaVersion: number | null;
  status: number | null;
  error: string | null;
  issues: unknown;
}

export type HealthItem = DiagnosticItem | IngestErrorItem;

export interface DiagnosticsList {
  since: string;
  items: HealthItem[];
}

export interface Items<T> {
  items: T[];
}
