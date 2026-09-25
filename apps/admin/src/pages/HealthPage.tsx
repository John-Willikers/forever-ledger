import { useState } from 'react';
import { useAdminQuery } from '../api';
import { Card } from '../components/Card';
import { Empty, QueryState } from '../components/State';
import { Tabs } from '../components/Tabs';
import { formatBytes, formatNumber, plural } from '../lib/format';
import {
  DIAGNOSTIC_LEVELS,
  DIAGNOSTIC_SOURCES,
  diagnosticsPath,
  FLAG_LABELS,
  hasEntries,
  headline,
  prettyJson,
  severity,
} from '../lib/health';
import type { HealthFilters } from '../lib/health';
import { formatChicago, formatChicagoShort } from '../lib/time';
import type { ApiSample, ApiSampleInfo, DiagnosticsList, HealthItem, Items } from '../types';

const WINDOWS = [1, 7, 30, 90] as const;

export function HealthPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Health</h1>
        <p className="muted">
          Problems reported by tray apps, batches the server refused, and what the addon saw of the
          client API.
        </p>
      </header>
      <Tabs
        id="health"
        tabs={[
          { key: 'diagnostics', label: 'Diagnostics' },
          { key: 'samples', label: 'API samples' },
        ]}
        label="Health sections"
      >
        {(key) => (key === 'samples' ? <Samples /> : <Feed />)}
      </Tabs>
    </div>
  );
}

function Feed() {
  const [filters, setFilters] = useState<HealthFilters>({
    type: '',
    level: '',
    source: '',
    days: 7,
  });
  const path = diagnosticsPath(filters);
  // The key holds the filters, not the path: `since` moves with the clock.
  const feed = useAdminQuery<DiagnosticsList>(['diagnostics', filters], path, {
    refetchInterval: 60_000,
  });
  const set = (patch: Partial<HealthFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <Card
      title="Diagnostics and refused batches"
      actions={
        <div className="filters" role="group" aria-label="Filters">
          <label>
            Type
            <select
              value={filters.type}
              onChange={(e) => set({ type: e.target.value as HealthFilters['type'] })}
            >
              <option value="">all</option>
              <option value="diagnostic">tray reports</option>
              <option value="ingest-error">refused batches</option>
            </select>
          </label>
          <label>
            Level
            <select value={filters.level} onChange={(e) => set({ level: e.target.value })}>
              <option value="">any</option>
              {DIAGNOSTIC_LEVELS.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
          </label>
          <label>
            Source
            <select value={filters.source} onChange={(e) => set({ source: e.target.value })}>
              <option value="">any</option>
              {DIAGNOSTIC_SOURCES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
          <label>
            Since
            <select value={filters.days} onChange={(e) => set({ days: Number(e.target.value) })}>
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d === 1 ? '24 hours' : `${d} days`}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      <QueryState query={feed}>
        {(list) =>
          list.items.length === 0 ? (
            <Empty>Nothing reported since {formatChicagoShort(list.since)}. All quiet.</Empty>
          ) : (
            <>
              <p className="muted small">
                {plural(list.items.length, 'entry', 'entries')} since{' '}
                {formatChicagoShort(list.since)}
              </p>
              <ul className="feed">
                {list.items.map((item) => (
                  <FeedRow key={`${item.type}-${item.id}`} item={item} />
                ))}
              </ul>
            </>
          )
        }
      </QueryState>
    </Card>
  );
}

function FeedRow({ item }: { item: HealthItem }) {
  const sev = severity(item);
  const detail =
    item.type === 'diagnostic'
      ? {
          occurred: formatChicago(item.occurredAt, { seconds: true }),
          app: `${item.appVersion ?? '?'} on ${item.platform ?? '?'}`,
          uploader: item.uploaderId,
          token: item.tokenId,
          detail: item.detail,
        }
      : {
          account: item.account,
          uploader: item.uploaderId,
          token: item.tokenId,
          schemaVersion: item.schemaVersion,
          issues: item.issues,
        };
  return (
    <li className={`feed-row sev-${sev}`}>
      <details>
        <summary>
          <span className={`pill sev-${sev}`}>
            {item.type === 'diagnostic' ? item.level : 'refused'}
          </span>
          <span className="pill neutral">
            {item.type === 'diagnostic' ? (item.source ?? '?') : 'ingest'}
          </span>
          <span className="feed-msg">{headline(item)}</span>
          <time className="muted small" dateTime={item.receivedAt}>
            {formatChicagoShort(item.receivedAt)}
          </time>
        </summary>
        <pre className="json">{prettyJson(detail)}</pre>
      </details>
    </li>
  );
}

function Samples() {
  const list = useAdminQuery<Items<ApiSampleInfo>>(['api-samples'], '/admin/api/api-samples');
  const [selected, setSelected] = useState<{ api: string; build: number } | null>(null);
  return (
    <Card title="Client API samples">
      <p className="muted small">
        The first result of each client API per build, as the addon saw it. The addon's own error
        and field-miss reports are listed first.
      </p>
      <QueryState query={list}>
        {({ items }) =>
          items.length === 0 ? (
            <Empty>No samples yet.</Empty>
          ) : (
            <div className="samples">
              <ul className="sample-list">
                {items.map((s) => {
                  const active = selected?.api === s.api && selected.build === s.build;
                  const warn = s.flag !== null && s.entries > 0;
                  return (
                    <li key={`${s.api}@${s.build}`}>
                      <button
                        type="button"
                        className={`sample-item${active ? ' active' : ''}${warn ? ' warn' : ''}`}
                        aria-pressed={active}
                        onClick={() => setSelected({ api: s.api, build: s.build })}
                      >
                        <span className="sample-name">
                          {warn && <span aria-hidden>⚠ </span>}
                          {s.flag ? FLAG_LABELS[s.flag] : s.api}
                        </span>
                        <span className="muted small">
                          build {s.build} · {formatBytes(s.size)}
                          {s.flag ? ` · ${plural(s.entries, 'entry', 'entries')}` : ''}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="sample-view">
                {selected ? (
                  <SampleView api={selected.api} build={selected.build} />
                ) : (
                  <Empty>Pick a sample to see its JSON.</Empty>
                )}
              </div>
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

function SampleView({ api, build }: { api: string; build: number }) {
  const sample = useAdminQuery<ApiSample>(
    ['api-sample', api, build],
    `/admin/api/api-samples/${encodeURIComponent(api)}?build=${build}`,
  );
  return (
    <QueryState query={sample}>
      {(s) => {
        const flag = s.api === 'ForeverLedger.errors' || s.api === 'ForeverLedger.fieldMisses';
        const warn = flag && hasEntries(s.sample);
        return (
          <div>
            <h3 className="sample-title">{s.api}</h3>
            <p className="muted small">
              build {s.build} · observed {formatChicagoShort(s.observedAt)}
              {s.builds.length > 1
                ? ` · also in ${formatNumber(s.builds.length - 1)} other builds`
                : ''}
            </p>
            {warn && (
              <div className="callout warn" role="note">
                The addon reported{' '}
                {s.api === 'ForeverLedger.errors'
                  ? 'Lua errors in this build: something it reads broke.'
                  : 'fields it looked for but did not find: the client API names differ in this build.'}
              </div>
            )}
            <pre className="json">{prettyJson(s.sample)}</pre>
          </div>
        );
      }}
    </QueryState>
  );
}
