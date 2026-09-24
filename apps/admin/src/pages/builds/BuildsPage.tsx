import { createColumnHelper } from '@tanstack/react-table';
import { Link, useSearchParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Kpi } from '../../components/Kpi';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { ItemName } from '../loot/parts';
import { mobLabel } from '../loot/lootLib';
import '../professions/professions.css';
import './builds.css';
import {
  CATEGORIES,
  isCategory,
  overlapCount,
  pairFromParams,
  rowsFor,
  summaryTiles,
} from './buildsLib';
import type { ChangeRow, Entity } from './buildsLib';
import type { BuildDiff, BuildRow, CategoryKey, OnlyIn } from './types';

const MIN_CORPSES_CHOICES = [1, 3, 5, 10, 25, 50];

/** Singular and plural of what each category counts. */
const NOUNS: Record<CategoryKey, [string, string]> = {
  items: ['item', 'items'],
  quests: ['quest', 'quests'],
  recipes: ['recipe', 'recipes'],
  vendors: ['vendor', 'vendors'],
  trainers: ['trainer', 'trainers'],
  drops: ['looted mob', 'looted mobs'],
};

const buildLabel = (b: { build: number; version: string | null }) =>
  b.version ? `${b.build} (${b.version})` : String(b.build);

/** Client builds seen and what changed between two of them. */
export function BuildsPage() {
  const builds = useAdminQuery<BuildRow[]>(['builds'], '/admin/api/builds');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Builds</h1>
        <p className="muted">
          Every client build the addon ran on, and what changed between two of them for the items,
          quests, recipes, vendors, trainers and mobs seen in both.
        </p>
      </header>
      <QueryState query={builds}>
        {(list) => (
          <>
            <Compare builds={list} />
            <Timeline builds={list} />
          </>
        )}
      </QueryState>
    </div>
  );
}

function Compare({ builds }: { builds: BuildRow[] }) {
  const [params, setParams] = useSearchParams();
  const pair = pairFromParams(params, builds);
  const tabParam = params.get('tab');
  const tab: CategoryKey = isCategory(tabParam) ? tabParam : 'items';
  const minRaw = Number(params.get('minCorpses'));
  const minCorpses = MIN_CORPSES_CHOICES.includes(minRaw) ? minRaw : 5;

  const set = (patch: Record<string, string | null>) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) next.delete(k);
          else next.set(k, v);
        }
        return next;
      },
      { replace: true },
    );

  if (!pair)
    return (
      <Card title="Compare builds">
        <Empty>
          {builds.length === 0
            ? 'No builds yet: nothing has been uploaded.'
            : `Only one build seen so far (${buildLabel(builds[0]!)}). A diff needs two.`}
        </Empty>
      </Card>
    );

  const picker = (key: 'from' | 'to', label: string) => (
    <label>
      {label}
      <select value={pair[key]} onChange={(e) => set({ [key]: e.target.value })}>
        {builds.map((b) => (
          <option
            key={b.build}
            value={b.build}
            disabled={b.build === pair[key === 'from' ? 'to' : 'from']}
          >
            {buildLabel(b)}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <Card
      title="Compare builds"
      actions={
        <div className="filters" role="group" aria-label="Builds to compare">
          {picker('from', 'From')}
          <button
            type="button"
            className="secondary small"
            onClick={() => set({ from: String(pair.to), to: String(pair.from) })}
            title="Swap from and to"
          >
            ⇄ Swap
          </button>
          {picker('to', 'To')}
        </div>
      }
    >
      <DiffView
        from={pair.from}
        to={pair.to}
        fromRow={builds.find((b) => b.build === pair.from)}
        tab={tab}
        onTab={(t) => set({ tab: t })}
        minCorpses={minCorpses}
        onMinCorpses={(n) => set({ minCorpses: String(n) })}
      />
    </Card>
  );
}

function DiffView({
  from,
  to,
  fromRow,
  tab,
  onTab,
  minCorpses,
  onMinCorpses,
}: {
  from: number;
  to: number;
  fromRow: BuildRow | undefined;
  tab: CategoryKey;
  onTab: (t: CategoryKey) => void;
  minCorpses: number;
  onMinCorpses: (n: number) => void;
}) {
  const qs = new URLSearchParams({
    from: String(from),
    to: String(to),
    minCorpses: String(minCorpses),
  });
  const diff = useAdminQuery<BuildDiff>(
    ['build-diff', qs.toString()],
    `/admin/api/build-diff?${qs}`,
  );
  return (
    <QueryState query={diff} loading="Comparing builds…">
      {(d) => {
        const tiles = summaryTiles(d, fromRow);
        const nothingShared = tiles.every((t) => t.overlap === 0);
        return (
          <div className="builds-diff">
            {nothingShared && (
              <p className="callout warn">
                Nothing was observed in both {d.from.build} and {d.to.build}: there is nothing to
                compare yet. Play the same content on both builds to see changes here.
              </p>
            )}
            <div className="kpis" aria-label="Changes per category">
              {tiles.map((t) => (
                <Kpi
                  key={t.key}
                  label={`${t.label} changed`}
                  value={formatNumber(t.changed)}
                  hint={
                    <>
                      {t.overlap !== null && (
                        <>{plural(t.overlap, NOUNS[t.key][0], NOUNS[t.key][1])} in both · </>
                      )}
                      only in {d.from.build}: {formatNumber(t.onlyInFrom)} · only in {d.to.build}:{' '}
                      {formatNumber(t.onlyInTo)}
                    </>
                  }
                />
              ))}
            </div>
            <div className="tabs" role="tablist" aria-label="Change category">
              {CATEGORIES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  role="tab"
                  id={`build-tab-${c.key}`}
                  aria-selected={tab === c.key}
                  aria-controls="build-tab-panel"
                  className={tab === c.key ? 'tab active' : 'tab'}
                  onClick={() => onTab(c.key)}
                >
                  {c.label} ({formatNumber(d[c.key].total)})
                </button>
              ))}
            </div>
            <div
              className="tab-panel"
              role="tabpanel"
              id="build-tab-panel"
              aria-labelledby={`build-tab-${tab}`}
            >
              <CategoryPanel
                diff={d}
                category={tab}
                overlap={overlapCount(fromRow, d, tab)}
                minCorpses={minCorpses}
                onMinCorpses={onMinCorpses}
              />
            </div>
          </div>
        );
      }}
    </QueryState>
  );
}

function CategoryPanel({
  diff,
  category,
  overlap,
  minCorpses,
  onMinCorpses,
}: {
  diff: BuildDiff;
  category: CategoryKey;
  overlap: number | null;
  minCorpses: number;
  onMinCorpses: (n: number) => void;
}) {
  const cat = diff[category];
  const rows = rowsFor(diff, category);
  const [one, many] = NOUNS[category];
  const emptyText =
    overlap === 0
      ? `No ${many} were observed in both builds.`
      : `${overlap === null ? 'The' : plural(overlap, one, many)} seen in both builds: nothing changed.`;
  return (
    <>
      {category === 'drops' && (
        <div className="filters">
          <label>
            Min corpses in each build
            <select value={minCorpses} onChange={(e) => onMinCorpses(Number(e.target.value))}>
              {MIN_CORPSES_CHOICES.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <span className="muted small">
            {diff.drops.belowThreshold > 0 &&
              `${plural(diff.drops.belowThreshold, 'mob')} looted in both builds but fewer than ${minCorpses} times in one are left out.`}
          </span>
        </div>
      )}
      {cat.total > cat.changes.length && (
        <p className="muted small">
          First {formatNumber(cat.changes.length)} of{' '}
          {plural(cat.total, `changed ${one}`, `changed ${many}`)} shown.
        </p>
      )}
      {rows.length === 0 ? (
        <Empty>{emptyText}</Empty>
      ) : (
        <DataTable
          data={rows}
          columns={columnsFor(diff.to.build)}
          rowKey={(r) => r.key}
          empty={emptyText}
        />
      )}
      <div className="grid-2 tight">
        <OnlyInList
          label={`Only in ${diff.from.build}`}
          only={cat.onlyInFrom}
          category={category}
          build={diff.from.build}
        />
        <OnlyInList
          label={`Only in ${diff.to.build}`}
          only={cat.onlyInTo}
          category={category}
          build={diff.to.build}
        />
      </div>
    </>
  );
}

/** The entity a change belongs to: linked when the panel has a page for it. Names are rendered as text. */
function EntityCell({ e, toBuild }: { e: Entity; toBuild: number }) {
  switch (e.kind) {
    case 'item':
      return <ItemName itemId={e.id} name={e.name} quality={e.quality} />;
    case 'quest':
      return <Link to={`/quests?quest=${e.id}`}>{e.name || `Quest ${e.id}`}</Link>;
    case 'mob':
      return <Link to={`/loot?npc=${e.id}&build=${toBuild}`}>{mobLabel(e.id, e.name)}</Link>;
    case 'recipe':
      return (
        <span>
          {e.name || `Recipe ${e.id}`} <span className="muted small">#{e.id}</span>
        </span>
      );
    case 'vendor':
    case 'trainer':
      return (
        <span className="npc-cell">
          {e.name || `NPC ${e.id}`}
          {e.title && <span className="chip">{e.title}</span>}
          <span className="muted small"> #{e.id}</span>
        </span>
      );
  }
}

const col = createColumnHelper<SortableFeatures, ChangeRow>();
const entityName = (e: Entity) => e.name ?? `${e.kind} ${e.id}`;
/** Mob links open the Loot page at `toBuild`. */
const columnsFor = (toBuild: number) =>
  col.columns([
    col.accessor((r) => entityName(r.entity), {
      id: 'entity',
      header: 'What',
      cell: (c) => <EntityCell e={c.row.original.entity} toBuild={toBuild} />,
    }),
    col.accessor((r) => `${r.what} ${r.item?.name ?? r.detail ?? ''}`, {
      id: 'change',
      header: 'Change',
      cell: (c) => {
        const r = c.row.original;
        return (
          <span className="change-cell">
            {r.what}
            {r.item && (
              <>
                {' · '}
                <ItemName itemId={r.item.itemId} name={r.item.name} quality={r.item.quality} />
              </>
            )}
            {r.detail && <> · {r.detail}</>}
            {r.note && <span className="pill sev-warn">{r.note}</span>}
          </span>
        );
      },
    }),
    col.accessor('from', {
      header: 'Old',
      enableSorting: false,
      cell: (c) => <span className="old">{c.getValue()}</span>,
    }),
    col.accessor('to', { header: 'New', enableSorting: false }),
    col.accessor((r) => r.tone, {
      id: 'delta',
      header: 'Δ',
      cell: (c) => {
        const r = c.row.original;
        return r.delta ? (
          <span
            className={`delta ${r.tone}`}
            title={r.tone === 'neutral' ? undefined : `${r.tone} for the player`}
          >
            {r.delta}
          </span>
        ) : (
          ''
        );
      },
    }),
  ]);

function OnlyInList({
  label,
  only,
  category,
  build,
}: {
  label: string;
  only: OnlyIn;
  category: CategoryKey;
  build: number;
}) {
  const name = (x: { id: number; name: string | null }) => {
    switch (category) {
      case 'items':
        return <ItemName itemId={x.id} name={x.name} quality={null} />;
      case 'quests':
        return <Link to={`/quests?quest=${x.id}`}>{x.name || `Quest ${x.id}`}</Link>;
      case 'drops':
        return <Link to={`/loot?npc=${x.id}&build=${build}`}>{mobLabel(x.id, x.name)}</Link>;
      default:
        return (
          <>
            {x.name || `#${x.id}`} <span className="muted small">#{x.id}</span>
          </>
        );
    }
  };
  return (
    <section className="only-in">
      <h3>
        {label}: {formatNumber(only.total)}
      </h3>
      {only.total === 0 ? (
        <p className="muted small">None.</p>
      ) : (
        <>
          <ul className="only-in-list">
            {only.sample.map((x) => (
              <li key={x.id}>{name(x)}</li>
            ))}
          </ul>
          {only.total > only.sample.length && (
            <p className="muted small">
              …and {formatNumber(only.total - only.sample.length)} more.
            </p>
          )}
        </>
      )}
    </section>
  );
}

function Timeline({ builds }: { builds: BuildRow[] }) {
  const [, setParams] = useSearchParams();
  const compareWithPrevious = (i: number) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('from', String(builds[i + 1]!.build));
        next.set('to', String(builds[i]!.build));
        return next;
      },
      { replace: true },
    );
  const c = createColumnHelper<SortableFeatures, BuildRow & { index: number }>();
  const columns = c.columns([
    c.accessor('build', {
      header: 'Build',
      sortFn: 'basic',
      cell: (x) => <strong>{x.getValue()}</strong>,
    }),
    c.accessor((b) => b.version ?? '', {
      id: 'version',
      header: 'Version',
      cell: (x) => x.getValue() || '—',
    }),
    c.accessor((b) => b.interface ?? 0, {
      id: 'interface',
      header: 'Interface',
      sortFn: 'basic',
      cell: (x) => x.row.original.interface ?? '—',
    }),
    c.accessor((b) => (b.firstSeen ? Date.parse(b.firstSeen) : 0), {
      id: 'firstSeen',
      header: 'First seen',
      sortFn: 'basic',
      cell: (x) => (
        <span className="nowrap" title={formatChicago(x.row.original.firstSeen)}>
          {formatChicagoShort(x.row.original.firstSeen)}
        </span>
      ),
    }),
    c.accessor((b) => (b.lastSeen ? Date.parse(b.lastSeen) : 0), {
      id: 'lastSeen',
      header: 'Last seen',
      sortFn: 'basic',
      cell: (x) => (
        <span className="nowrap" title={formatChicago(x.row.original.lastSeen)}>
          {formatChicagoShort(x.row.original.lastSeen)}
        </span>
      ),
    }),
    c.accessor('uploads', { header: 'Uploads', sortFn: 'basic' }),
    c.accessor('characters', { header: 'Characters', sortFn: 'basic' }),
    c.accessor((b) => b.counts.items, { id: 'items', header: 'Items', sortFn: 'basic' }),
    c.accessor((b) => b.counts.quests, { id: 'quests', header: 'Quests', sortFn: 'basic' }),
    c.accessor((b) => b.counts.recipes, { id: 'recipes', header: 'Recipes', sortFn: 'basic' }),
    c.accessor((b) => b.counts.vendors, { id: 'vendors', header: 'Vendors', sortFn: 'basic' }),
    c.accessor((b) => b.counts.trainers, { id: 'trainers', header: 'Trainers', sortFn: 'basic' }),
    c.accessor((b) => b.counts.npcsLooted, { id: 'npcs', header: 'Mobs looted', sortFn: 'basic' }),
    c.display({
      id: 'compare',
      header: '',
      cell: (x) =>
        x.row.original.index < builds.length - 1 ? (
          <button
            type="button"
            className="secondary small"
            onClick={() => compareWithPrevious(x.row.original.index)}
          >
            vs previous
          </button>
        ) : null,
    }),
  ]);
  return (
    <Card title="Builds timeline">
      <p className="muted small">
        Newest first. First/last seen are when uploads carrying the build arrived (America/Chicago).
        Counts are what the addon observed in that build.
      </p>
      <DataTable
        data={builds.map((b, index) => ({ ...b, index }))}
        columns={columns}
        rowKey={(b) => b.build}
        empty="No builds yet."
      />
    </Card>
  );
}
