import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useDeferredValue, useState } from 'react';
import type { FormEvent } from 'react';
import { postJson, useAdminQuery, useCsrf } from '../../api';
import { Card } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Kpi } from '../../components/Kpi';
import { QueryState } from '../../components/State';
import { Tabs } from '../../components/Tabs';
import { formatNumber } from '../../lib/format';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { entityLabel, formatValue, LABELS, safeHref, tierName } from './lib';
import type {
  ClaimLabel,
  ClaimRow,
  DisputeRow,
  KnowledgeSummary,
  Listing,
  ObservationRow,
  QueueRow,
  QueueState,
  SourceRow,
} from './types';
import './knowledge.css';

const KEY = ['knowledge'] as const;

function LabelPill({ label }: { label: ClaimLabel }) {
  return <span className={`pill claim-${label.toLowerCase()}`}>{label}</span>;
}

function SourceLink({ url, text }: { url: string | null; text: string }) {
  const href = safeHref(url);
  return href ? (
    <a href={href} target="_blank" rel="noreferrer noopener">
      {text}
    </a>
  ) : (
    <>{text}</>
  );
}

/** Web sources, claims with labels and tiers, disputes, first-party observations and the cruiser fetch queue. */
export function KnowledgePage() {
  const summary = useAdminQuery<KnowledgeSummary>(
    [...KEY, 'summary'],
    '/admin/api/knowledge/summary',
  );
  return (
    <div className="page">
      <header className="page-head">
        <h1>Knowledge</h1>
        <p className="muted">
          Facts from web pages and field notes, each with its source, tier and confidence label.
          Pages are fetched by the browser on cruiser; first-party data (tier 1) outranks every web
          source.
        </p>
      </header>
      <QueryState query={summary}>
        {(s) => (
          <div className="kpis">
            <Kpi
              label="Claims"
              value={formatNumber(s.claims)}
              hint={`${formatNumber(s.labels.VERIFIED)} verified`}
            />
            <Kpi
              label="Sources"
              value={formatNumber(s.sources)}
              hint={`${formatNumber(s.snapshots)} pages fetched`}
            />
            <Kpi
              label="Queue"
              value={formatNumber(s.queue.queued + s.queue.leased)}
              hint={
                s.lastSnapshotAt
                  ? `last page ${formatChicagoShort(s.lastSnapshotAt)}`
                  : 'nothing fetched yet'
              }
            />
            <Kpi
              label="Needs a human"
              value={formatNumber(s.queue.needs_human)}
              tone={s.queue.needs_human > 0 ? 'warn' : undefined}
              hint="challenge pages that never cleared"
            />
            <Kpi label="Field observations" value={formatNumber(s.observations)} />
          </div>
        )}
      </QueryState>
      <Tabs
        id="knowledge"
        label="Knowledge views"
        tabs={[
          { key: 'claims', label: 'Claims' },
          { key: 'disputes', label: 'Disputes' },
          { key: 'observations', label: 'Observations' },
          { key: 'sources', label: 'Sources' },
          { key: 'queue', label: 'Fetch queue' },
        ]}
      >
        {(key) =>
          key === 'disputes' ? (
            <Disputes />
          ) : key === 'observations' ? (
            <Observations />
          ) : key === 'sources' ? (
            <Sources />
          ) : key === 'queue' ? (
            <Queue />
          ) : (
            <Claims />
          )
        }
      </Tabs>
    </div>
  );
}

const claimCol = createColumnHelper<SortableFeatures, ClaimRow>();
const claimColumns = claimCol.columns([
  claimCol.accessor((c) => entityLabel(c), {
    id: 'entity',
    header: 'Entity',
    cell: (i) => (
      <>
        {i.getValue()} <span className="chip">{i.row.original.entityType}</span>
      </>
    ),
  }),
  claimCol.accessor('attribute', { header: 'Attribute' }),
  claimCol.accessor((c) => formatValue(c.value), {
    id: 'value',
    header: 'Value',
    enableSorting: false,
    cell: (i) => (
      <span title={i.row.original.quote ?? undefined} className="claim-value">
        {i.getValue()}
      </span>
    ),
  }),
  claimCol.accessor('label', { header: 'Label', cell: (i) => <LabelPill label={i.getValue()} /> }),
  claimCol.accessor('tier', {
    header: 'Source',
    cell: (i) => (
      <>
        <span className="chip">
          {i.getValue()} · {tierName(i.getValue())}
        </span>
        <SourceLink url={i.row.original.url} text={i.row.original.site} />
      </>
    ),
  }),
  claimCol.accessor((c) => c.observedBuild ?? 0, {
    id: 'build',
    header: 'Build',
    cell: (i) => i.row.original.observedBuild ?? '—',
  }),
]);

function Claims() {
  const [search, setSearch] = useState('');
  const [label, setLabel] = useState<ClaimLabel | ''>('');
  const deferred = useDeferredValue({ search, label });
  const params = new URLSearchParams();
  if (deferred.search.trim()) params.set('search', deferred.search.trim());
  if (deferred.label) params.set('label', deferred.label);
  const list = useAdminQuery<Listing<ClaimRow>>(
    [...KEY, 'claims', deferred],
    `/admin/api/knowledge/claims?${params}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <Card
      title="Claims"
      actions={
        <div className="filters" role="group" aria-label="Filters">
          <label>
            <span className="visually-hidden">Search</span>
            <input
              type="search"
              placeholder="Entity, id or attribute"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            Label
            <select value={label} onChange={(e) => setLabel(e.target.value as ClaimLabel | '')}>
              <option value="">any</option>
              {LABELS.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      <QueryState query={list}>
        {(l) => (
          <>
            <p className="muted small">
              {formatNumber(l.total ?? l.items.length)} claims
              {l.items.length < (l.total ?? 0)
                ? ` (first ${formatNumber(l.items.length)} shown)`
                : ''}
              . Hover a value for the passage it rests on.
            </p>
            <DataTable
              data={l.items}
              columns={claimColumns}
              rowKey={(c) => c.id}
              pageSize={50}
              resetKey={`${deferred.search}|${deferred.label}`}
              empty="No claims match."
            />
          </>
        )}
      </QueryState>
    </Card>
  );
}

function Disputes() {
  const list = useAdminQuery<Listing<DisputeRow>>(
    [...KEY, 'disputes'],
    '/admin/api/knowledge/disputes',
  );
  return (
    <Card title="Disputes">
      <p className="muted small">
        Claims labeled FALSE, and claims a more trusted source contradicts on the same build. Guides
        and the MCP server drop FALSE claims and show the rest as disputed.
      </p>
      <QueryState query={list}>
        {(l) =>
          l.items.length === 0 ? (
            <p className="muted">No disputes.</p>
          ) : (
            <ul className="disputes">
              {l.items.map((d) => (
                <li key={`${d.claimId}-${d.byClaimId ?? 'f'}`}>
                  <strong>{d.entityKey}</strong> <span className="chip">{d.entityType}</span>{' '}
                  {d.attribute}: <span className="claim-value">{formatValue(d.value)}</span>{' '}
                  <LabelPill label={d.label} />
                  <span className="chip">tier {d.tier}</span>
                  {d.byClaimId === null ? (
                    <span className="muted"> contradicted by a source (labeled FALSE)</span>
                  ) : (
                    <span className="muted">
                      {' '}
                      vs <span className="claim-value">{formatValue(d.byValue)}</span>{' '}
                      {d.byLabel && <LabelPill label={d.byLabel} />}
                      <span className="chip">tier {d.byTier}</span>
                      <SourceLink url={d.byUrl} text="source" />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </Card>
  );
}

function Observations() {
  const list = useAdminQuery<Listing<ObservationRow>>(
    [...KEY, 'observations'],
    '/admin/api/knowledge/observations',
  );
  return (
    <Card title="Field observations">
      <QueryState query={list}>
        {(l) =>
          l.items.length === 0 ? (
            <p className="muted">No field observations yet.</p>
          ) : (
            <div className="observations">
              {l.items.map((o) => (
                <article key={o.id} className="observation">
                  <h3>
                    {o.method} · {formatValue(o.location)}
                  </h3>
                  <p className="muted small">
                    {formatChicago(o.observedAt)}
                    {o.durationMins !== null ? ` · ${o.durationMins} min` : ''} ·{' '}
                    {[o.faction, o.race, o.class, o.level !== null ? `level ${o.level}` : null]
                      .filter(Boolean)
                      .join(' ')}
                    {o.build !== null ? ` · build ${o.build}` : ' · build not recorded'}
                  </p>
                  <dl>
                    <dt>Setup</dt>
                    <dd>{formatValue(o.setup)}</dd>
                    <dt>Result</dt>
                    <dd>{formatValue(o.result)}</dd>
                  </dl>
                  {o.notes && <p className="small">{o.notes}</p>}
                </article>
              ))}
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

const sourceCol = createColumnHelper<SortableFeatures, SourceRow>();
const sourceColumns = sourceCol.columns([
  sourceCol.accessor('tier', {
    header: 'Tier',
    cell: (i) => `${i.getValue()} · ${tierName(i.getValue())}`,
  }),
  sourceCol.accessor((s) => s.title ?? s.key, {
    id: 'source',
    header: 'Source',
    cell: (i) => (
      <>
        <SourceLink url={i.row.original.url} text={i.getValue()} />
        {i.row.original.note && <div className="muted small">{i.row.original.note}</div>}
      </>
    ),
  }),
  sourceCol.accessor('kind', { header: 'Kind' }),
  sourceCol.accessor('gameVersion', { header: 'Version' }),
  sourceCol.accessor('claims', { header: 'Claims' }),
  sourceCol.accessor((s) => s.fetchedAt ?? '', {
    id: 'fetched',
    header: 'Fetched',
    cell: (i) => (i.getValue() ? formatChicagoShort(i.getValue()) : '—'),
  }),
]);

function Sources() {
  const list = useAdminQuery<Listing<SourceRow>>(
    [...KEY, 'sources'],
    '/admin/api/knowledge/sources',
  );
  return (
    <Card title="Sources">
      <QueryState query={list}>
        {(l) => (
          <DataTable data={l.items} columns={sourceColumns} rowKey={(s) => s.id} pageSize={50} />
        )}
      </QueryState>
    </Card>
  );
}

const STATES: readonly QueueState[] = ['queued', 'leased', 'done', 'needs_human', 'failed'];

const queueCol = createColumnHelper<SortableFeatures, QueueRow>();
const queueColumns = queueCol.columns([
  queueCol.accessor('url', {
    header: 'URL',
    cell: (i) => <SourceLink url={i.getValue()} text={i.getValue()} />,
  }),
  queueCol.accessor('state', {
    header: 'State',
    cell: (i) => (
      <span
        className={`pill ${i.getValue() === 'needs_human' || i.getValue() === 'failed' ? 'sev-warn' : 'neutral'}`}
      >
        {i.getValue().replace('_', ' ')}
      </span>
    ),
  }),
  queueCol.accessor('priority', { header: 'Priority' }),
  queueCol.accessor((q) => q.lastStatus ?? 0, {
    id: 'last',
    header: 'Last',
    cell: (i) => {
      const q = i.row.original;
      return q.lastOutcome ? `${q.lastOutcome}${q.lastStatus ? ` ${q.lastStatus}` : ''}` : '—';
    },
  }),
  queueCol.accessor((q) => q.nextDueAt ?? '', {
    id: 'due',
    header: 'Due',
    cell: (i) => (i.getValue() ? formatChicagoShort(i.getValue()) : '—'),
  }),
]);

function Queue() {
  const csrf = useCsrf();
  const queryClient = useQueryClient();
  const [state, setState] = useState<QueueState | ''>('');
  const [url, setUrl] = useState('');
  const list = useAdminQuery<Listing<QueueRow>>(
    [...KEY, 'queue', state],
    `/admin/api/knowledge/queue${state ? `?state=${state}` : ''}`,
    { placeholderData: (prev) => prev },
  );
  const add = useMutation({
    mutationFn: (body: { url: string }) =>
      postJson<{ queued: boolean }>('/admin/api/knowledge/queue', csrf, body),
    onSuccess: () => {
      setUrl('');
      void queryClient.invalidateQueries({ queryKey: KEY });
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (url.trim()) add.mutate({ url: url.trim() });
  };
  return (
    <Card
      title="Fetch queue"
      actions={
        <div className="filters" role="group" aria-label="Filters">
          <label>
            State
            <select value={state} onChange={(e) => setState(e.target.value as QueueState | '')}>
              <option value="">any</option>
              {STATES.map((s) => (
                <option key={s} value={s}>
                  {s.replace('_', ' ')}
                </option>
              ))}
            </select>
          </label>
        </div>
      }
    >
      <form className="queue-add" onSubmit={submit}>
        <label>
          <span className="visually-hidden">URL to fetch</span>
          <input
            type="url"
            placeholder="https://www.wowhead.com/forever/item=…"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
          />
        </label>
        <button type="submit" disabled={add.isPending || !url.trim()}>
          {add.isPending ? 'Queueing…' : 'Queue page'}
        </button>
      </form>
      {add.isError && (
        <div className="state error" role="alert">
          Couldn't queue it: {add.error.message}
        </div>
      )}
      <p className="muted small">
        Cruiser leases a few URLs at a time and fetches them slowly. A page that keeps showing a
        challenge waits here as “needs human” until someone signs in again on cruiser.
      </p>
      <QueryState query={list}>
        {(l) => (
          <DataTable
            data={l.items}
            columns={queueColumns}
            rowKey={(q) => q.url}
            pageSize={50}
            resetKey={state}
          />
        )}
      </QueryState>
    </Card>
  );
}
