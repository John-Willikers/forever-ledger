import { keepPreviousData } from '@tanstack/react-query';
import { createColumnHelper } from '@tanstack/react-table';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { ForeverBadge } from './ForeverBadge';
import { QuestDrawer } from './QuestDrawer';
import {
  filtersFromParams,
  pickSummary,
  questsPath,
  withParam,
  xpVsLevelOption,
  zoneSeriesOf,
} from './questLib';
import type { QuestFilters } from './questLib';
import './quests.css';
import './registerScatter';
import type { QuestList, QuestRow } from './types';

const SEARCH_DEBOUNCE_MS = 300;

/** The open quest (`?quest=`), else null. */
function openQuestId(params: URLSearchParams) {
  const raw = params.get('quest');
  const n = Number(raw);
  return raw && /^\d+$/.test(raw) && n > 0 ? n : null;
}

export function QuestsPage() {
  const [params, setParams] = useSearchParams();
  const filters = filtersFromParams(params);
  const path = questsPath(filters);
  const quests = useAdminQuery<QuestList>(['quests', path], path, {
    placeholderData: keepPreviousData,
  });
  const set = (key: string, value: string | null) =>
    setParams(withParam(params, key, value), { replace: key !== 'quest' });
  const openId = openQuestId(params);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Quests</h1>
        <p className="muted">
          XP offered vs paid, reward picks and quest NPCs. Each row is one quest in one build (the
          newest unless you pick a build). Times are America/Chicago.
        </p>
      </header>
      <Filters filters={filters} data={quests.data} set={set} />
      <QueryState query={quests}>
        {(list) => (
          <>
            <ScatterCard rows={list.items} />
            <Card
              title="Quests"
              actions={
                <Pager list={list} fetching={quests.isFetching} onPage={(o) => set('offset', o)} />
              }
            >
              <DataTable
                data={list.items}
                columns={columns}
                rowKey={(r) => `${r.questId}:${r.build}`}
                rowClassName={(r) => (r.xpMismatch ? 'row-mismatch' : undefined)}
                empty="No quests match these filters."
              />
            </Card>
          </>
        )}
      </QueryState>
      {openId !== null && <QuestDrawer id={openId} onClose={() => set('quest', null)} />}
    </div>
  );
}

function Filters({
  filters,
  data,
  set,
}: {
  filters: QuestFilters;
  data: QuestList | undefined;
  set: (key: string, value: string | null) => void;
}) {
  const [search, setSearch] = useState(filters.search ?? '');
  useEffect(() => {
    const next = search.trim();
    if (next === (filters.search ?? '')) return;
    const t = setTimeout(() => set('search', next || null), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
    // Only a new draft starts the timer; `set` changes with every URL change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const zones = data?.zones ?? [];
  const builds = data?.builds ?? [];
  const any =
    filters.search ||
    filters.zone ||
    filters.minLevel !== null ||
    filters.maxLevel !== null ||
    filters.build !== null ||
    filters.forever ||
    filters.mismatch;

  return (
    <div className="filters quest-filters" role="search">
      <label>
        Search
        <input
          type="search"
          value={search}
          placeholder="Title or id"
          maxLength={100}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        Zone
        <select value={filters.zone ?? ''} onChange={(e) => set('zone', e.target.value || null)}>
          <option value="">All zones</option>
          {filters.zone && !zones.some((z) => z.zone === filters.zone) && (
            <option value={filters.zone}>{filters.zone}</option>
          )}
          {zones.map((z) => (
            <option key={z.zone} value={z.zone}>
              {z.zone} ({z.quests})
            </option>
          ))}
        </select>
      </label>
      <label>
        Level
        <input
          type="number"
          min={1}
          className="level-input"
          aria-label="Minimum quest level"
          value={filters.minLevel ?? ''}
          onChange={(e) => set('minLevel', e.target.value || null)}
        />
        –
        <input
          type="number"
          min={1}
          className="level-input"
          aria-label="Maximum quest level"
          value={filters.maxLevel ?? ''}
          onChange={(e) => set('maxLevel', e.target.value || null)}
        />
      </label>
      <label>
        Build
        <select value={filters.build ?? ''} onChange={(e) => set('build', e.target.value || null)}>
          <option value="">Newest per quest</option>
          {filters.build !== null && !builds.includes(filters.build) && (
            <option value={filters.build}>{filters.build}</option>
          )}
          {builds.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.forever}
          onChange={(e) => set('forever', e.target.checked ? '1' : null)}
        />
        Forever-only
      </label>
      <label>
        <input
          type="checkbox"
          checked={filters.mismatch}
          onChange={(e) => set('mismatch', e.target.checked ? '1' : null)}
        />
        Offered ≠ paid
      </label>
      {any && (
        <Link className="small reset-link" to="?" onClick={() => setSearch('')}>
          Clear filters
        </Link>
      )}
    </div>
  );
}

function Pager({
  list,
  fetching,
  onPage,
}: {
  list: QuestList;
  fetching: boolean;
  onPage: (offset: string | null) => void;
}) {
  const from = list.total === 0 ? 0 : list.offset + 1;
  const to = Math.min(list.offset + list.items.length, list.total);
  const prev = Math.max(0, list.offset - list.limit);
  return (
    <span className="pager small">
      <span className="muted">
        {fetching ? 'loading… ' : ''}
        {list.total === 0
          ? 'no quests'
          : `${formatNumber(from)}–${formatNumber(to)} of ${plural(list.total, 'quest')}`}
      </span>
      <button
        type="button"
        className="secondary small"
        disabled={list.offset === 0}
        onClick={() => onPage(prev > 0 ? String(prev) : null)}
      >
        Previous
      </button>
      <button
        type="button"
        className="secondary small"
        disabled={list.offset + list.items.length >= list.total}
        onClick={() => onPage(String(list.offset + list.limit))}
      >
        Next
      </button>
    </span>
  );
}

/** The quest title as a link that opens the detail drawer (keeps the table's filters in the URL). */
function QuestLink({ row }: { row: QuestRow }) {
  const [params] = useSearchParams();
  return (
    <Link to={`?${withParam(params, 'quest', String(row.questId)).toString()}`}>
      {row.title ?? `Quest ${row.questId}`}
    </Link>
  );
}

const col = createColumnHelper<SortableFeatures, QuestRow>();
const num = (v: number | null) => v ?? -1;
const columns = col.columns([
  col.accessor('questId', {
    header: 'Id',
    sortFn: 'basic',
    cell: (c) => (
      <span className="nowrap">
        {c.getValue()}
        {c.row.original.foreverOnly && <ForeverBadge />}
      </span>
    ),
  }),
  col.accessor((r) => r.title ?? '', {
    id: 'title',
    header: 'Title',
    cell: (c) => (
      <span>
        <QuestLink row={c.row.original} />
        {c.row.original.suggestedGroup ? (
          <span className="pill neutral">Group {c.row.original.suggestedGroup}</span>
        ) : null}
      </span>
    ),
  }),
  col.accessor((r) => r.category ?? '', {
    id: 'zone',
    header: 'Zone',
    cell: (c) => c.getValue() || <span className="muted">—</span>,
  }),
  col.accessor((r) => num(r.level), {
    id: 'level',
    header: 'Level',
    sortFn: 'basic',
    cell: (c) => c.row.original.level ?? '—',
  }),
  col.accessor((r) => num(r.xpOffered), {
    id: 'xpOffered',
    header: 'XP offered',
    sortFn: 'basic',
    cell: (c) => formatNumber(c.row.original.xpOffered),
  }),
  col.accessor((r) => num(r.avgXpPaid), {
    id: 'avgXpPaid',
    header: 'Avg XP paid',
    sortFn: 'basic',
    cell: (c) => {
      const r = c.row.original;
      return (
        <span className="nowrap">
          {formatNumber(r.avgXpPaid)}
          {r.xpMismatch && (
            <span
              className="pill sev-warn"
              title={`Offered ${formatNumber(r.xpOffered)}, paid ${formatNumber(r.avgXpPaid)} on average`}
            >
              ≠ offered
            </span>
          )}
        </span>
      );
    },
  }),
  col.accessor((r) => num(r.moneyOffered), {
    id: 'money',
    header: 'Money',
    sortFn: 'basic',
    cell: (c) => <span className="nowrap">{formatMoney(c.row.original.moneyOffered)}</span>,
  }),
  col.accessor('turnIns', { header: 'Turn-ins', sortFn: 'basic' }),
  col.accessor((r) => pickSummary(r.rewardChoices).picks, {
    id: 'picks',
    header: 'Reward picks',
    sortFn: 'basic',
    cell: (c) => {
      const s = pickSummary(c.row.original.rewardChoices);
      return s.text ? <span className="small">{s.text}</span> : <span className="muted">—</span>;
    },
  }),
  col.accessor((r) => [...r.givers, ...r.enders].join(', '), {
    id: 'npcs',
    header: 'Giver → ender',
    cell: (c) => {
      const r = c.row.original;
      if (r.givers.length === 0 && r.enders.length === 0) return <span className="muted">—</span>;
      return (
        <span className="small">
          {r.givers.join(', ') || '?'} → {r.enders.join(', ') || '?'}
        </span>
      );
    },
  }),
  col.accessor('build', {
    header: 'Build',
    sortFn: 'basic',
    cell: (c) => {
      const r = c.row.original;
      return (
        <span title={r.builds.length > 1 ? `Seen in ${r.builds.join(', ')}` : undefined}>
          {r.build}
          {r.builds.length > 1 && <span className="muted small"> +{r.builds.length - 1}</span>}
        </span>
      );
    },
  }),
  col.accessor((r) => (r.lastSeen ? Date.parse(r.lastSeen) : 0), {
    id: 'lastSeen',
    header: 'Last seen',
    sortFn: 'basic',
    cell: (c) => {
      const at = c.row.original.lastSeen;
      return at ? (
        <span className="nowrap" title={formatChicago(at, { seconds: true })}>
          {formatChicagoShort(at)}
        </span>
      ) : (
        '—'
      );
    },
  }),
]);

function ScatterCard({ rows }: { rows: QuestRow[] }) {
  const palette = useChartPalette();
  const plotted = zoneSeriesOf(rows).reduce((n, g) => n + g.rows.length, 0);
  const forever = rows.filter((r) => r.foreverOnly && r.level !== null && r.xpOffered !== null);
  return (
    <Card title="XP offered vs quest level (this page)">
      {plotted === 0 ? (
        <Empty>No quest on this page has both a level and offered XP.</Empty>
      ) : (
        <>
          <Chart
            option={xpVsLevelOption(rows, palette)}
            height={340}
            label={`Scatter plot of XP offered against quest level for ${plotted} quests, colored by zone`}
          />
          <p className="muted small">
            {plural(plotted, 'quest')} plotted, colored by zone (the three biggest; the rest are
            Other).{' '}
            {forever.length > 0
              ? `◆ Larger outlined diamonds are Forever-only quests (${forever.length}).`
              : 'No Forever-only quests on this page.'}
          </p>
        </>
      )}
    </Card>
  );
}
