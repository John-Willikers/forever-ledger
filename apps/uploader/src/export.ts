import { normalize } from '@forever-ledger/contracts';
import type { Meta, NormalizeProblem, Records } from '@forever-ledger/contracts';
import { writeJsonAtomic } from './fsutil.js';
import { readSavedVariable } from './reader.js';
import type { ReadOptions } from './reader.js';
import { formatChicago } from './time.js';

export interface ExportedAccount {
  account: string;
  file: string;
  meta: Meta;
  records: Records;
  problems: NormalizeProblem[];
}

export interface ExportDocument {
  /** America/Chicago, for humans. */
  exportedAt: string;
  accounts: ExportedAccount[];
}

/** Normalized records for each file; no server involved. Throws on unreadable/unsupported files. */
export async function exportRecords(
  files: { account: string; file: string }[],
  read: ReadOptions = {},
): Promise<ExportDocument> {
  const accounts: ExportedAccount[] = [];
  for (const { account, file } of files) {
    const { value } = await readSavedVariable(file, read);
    const { meta, records, problems } = normalize(value);
    accounts.push({ account, file, meta, records, problems });
  }
  return { exportedAt: formatChicago(), accounts };
}

export async function writeExport(path: string, doc: ExportDocument): Promise<void> {
  await writeJsonAtomic(path, doc);
}
