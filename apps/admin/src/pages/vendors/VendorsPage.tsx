import { createColumnHelper } from '@tanstack/react-table';
import { useDeferredValue, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatCosts, formatMoney } from '../../lib/money';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import '../professions/professions.css';
import { formatLocation, listPath, skillReq, stockLabel, unitPrice } from './lib';
import type { ListFilters } from './lib';
import type {
  NpcList,
  TrainerDetail,
  TrainerRow,
  VendorDetail,
  VendorItem,
  VendorRow,
} from './types';

type Tab = 'vendors' | 'trainers';

const npcName = (n: { npcId: number; name: string | null }) => n.name ?? `NPC ${n.npcId}`;

/** Vendors and trainers seen by the addon: searchable lists, a Forever-only filter, and each NPC's catalog. */
export function VendorsPage() {
  const [tab, setTab] = useState<Tab>('vendors');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Vendors &amp; trainers</h1>
        <p className="muted">
          Every merchant and profession trainer window the addon read, newest build per NPC. The tag
          under a name is the NPC's subtitle in game.
        </p>
      </header>
      <div className="tabs" role="tablist" aria-label="Vendors or trainers">
        {(['vendors', 'trainers'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`panel-${t}`}
            className={tab === t ? 'tab active' : 'tab'}
            onClick={() => setTab(t)}
          >
            {t === 'vendors' ? 'Vendors' : 'Trainers'}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'vendors' ? (
          <NpcBrowser kind="vendors" key="v" />
        ) : (
          <NpcBrowser kind="trainers" key="t" />
        )}
      </div>
    </div>
  );
}

function NpcBrowser({ kind }: { kind: Tab }) {
  const [filters, setFilters] = useState<ListFilters>({
    search: '',
    title: '',
    foreverOnly: false,
  });
  const deferred = useDeferredValue(filters);
  const [selected, setSelected] = useState<number | null>(null);
  const list = useAdminQuery<NpcList<VendorRow | TrainerRow>>(
    [kind, deferred],
    listPath(kind, deferred),
    { placeholderData: (prev) => prev },
  );
  const set = (patch: Partial<ListFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const titles = list.data?.titles ?? [];
  return (
    <>
      <Card
        title={kind === 'vendors' ? 'Vendors' : 'Trainers'}
        actions={
          <div className="filters" role="group" aria-label="Filters">
            <label>
              <span className="visually-hidden">Search</span>
              <input
                type="search"
                placeholder="Name, tag or NPC id"
                value={filters.search}
                onChange={(e) => set({ search: e.target.value })}
              />
            </label>
            <label>
              Tag
              <select value={filters.title} onChange={(e) => set({ title: e.target.value })}>
                <option value="">any</option>
                {titles.map((t) => (
                  <option key={t.title} value={t.title}>
                    {t.title} ({t.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                checked={filters.foreverOnly}
                onChange={(e) => set({ foreverOnly: e.target.checked })}
              />
              Forever-only
            </label>
          </div>
        }
      >
        <QueryState query={list}>
          {(l) => (
            <>
              <p className="muted small">
                {plural(l.total, kind === 'vendors' ? 'vendor' : 'trainer')}
                {l.items.length < l.total ? ` (first ${formatNumber(l.items.length)} shown)` : ''} ·
                Forever-only: NPC id ≥ {formatNumber(l.foreverNpcMin)}
              </p>
              {kind === 'vendors' ? (
                <DataTable
                  data={l.items as VendorRow[]}
                  columns={vendorColumns(selected, setSelected)}
                  rowKey={(v) => v.npcId}
                  rowClassName={(v) => (v.npcId === selected ? 'selected' : undefined)}
                  empty="No vendor matches."
                />
              ) : (
                <DataTable
                  data={l.items as TrainerRow[]}
                  columns={trainerColumns(selected, setSelected)}
                  rowKey={(t) => t.npcId}
                  rowClassName={(t) => (t.npcId === selected ? 'selected' : undefined)}
                  empty="No trainer matches."
                />
              )}
            </>
          )}
        </QueryState>
      </Card>
      {selected !== null &&
        (kind === 'vendors' ? (
          <VendorCard npcId={selected} key={`v${selected}`} />
        ) : (
          <TrainerCard npcId={selected} key={`t${selected}`} />
        ))}
    </>
  );
}

function NpcCell({
  n,
  selected,
  onSelect,
}: {
  n: { npcId: number; name: string | null; title: string | null; forever: boolean };
  selected: boolean;
  onSelect: (id: number | null) => void;
}) {
  return (
    <span className="npc-cell">
      <button
        type="button"
        className="linkish"
        aria-expanded={selected}
        onClick={() => onSelect(selected ? null : n.npcId)}
      >
        {npcName(n)}
      </button>
      {n.title && <span className="chip">{n.title}</span>}
      {n.forever && (
        <span className="pill forever" title="NPC id in the Forever-only range">
          Forever
        </span>
      )}
      <span className="muted small"> #{n.npcId}</span>
    </span>
  );
}

const seenCell = (seenAt: string | null) => (
  <span className="nowrap" title={formatChicago(seenAt)}>
    {formatChicagoShort(seenAt)}
  </span>
);

function vendorColumns(selected: number | null, onSelect: (id: number | null) => void) {
  const col = createColumnHelper<SortableFeatures, VendorRow>();
  return col.columns([
    col.accessor((v) => npcName(v), {
      id: 'name',
      header: 'Vendor',
      cell: (c) => (
        <NpcCell
          n={c.row.original}
          selected={selected === c.row.original.npcId}
          onSelect={onSelect}
        />
      ),
    }),
    col.accessor((v) => formatLocation(v.location), { id: 'location', header: 'Location' }),
    col.accessor('itemCount', { header: 'Items', sortFn: 'basic' }),
    col.accessor('recipeItemCount', { header: 'Recipes', sortFn: 'basic' }),
    col.accessor('extendedCostCount', { header: 'Extended costs', sortFn: 'basic' }),
    col.accessor('build', { header: 'Build' }),
    col.accessor((v) => (v.seenAt ? Date.parse(v.seenAt) : 0), {
      id: 'seenAt',
      header: 'Seen',
      sortFn: 'basic',
      cell: (c) => seenCell(c.row.original.seenAt),
    }),
  ]);
}

function trainerColumns(selected: number | null, onSelect: (id: number | null) => void) {
  const col = createColumnHelper<SortableFeatures, TrainerRow>();
  return col.columns([
    col.accessor((t) => npcName(t), {
      id: 'name',
      header: 'Trainer',
      cell: (c) => (
        <NpcCell
          n={c.row.original}
          selected={selected === c.row.original.npcId}
          onSelect={onSelect}
        />
      ),
    }),
    col.accessor((t) => t.skillLineName ?? '', {
      id: 'profession',
      header: 'Teaches',
      cell: (c) => c.getValue() || '—',
    }),
    col.accessor((t) => formatLocation(t.location), { id: 'location', header: 'Location' }),
    col.accessor('serviceCount', { header: 'Services', sortFn: 'basic' }),
    col.accessor((t) => (t.complete ? 1 : 0), {
      id: 'complete',
      header: 'Full list',
      sortFn: 'basic',
      cell: (c) =>
        c.row.original.complete ? 'yes' : <span className="pill sev-warn">partial</span>,
    }),
    col.accessor('build', { header: 'Build' }),
    col.accessor((t) => (t.seenAt ? Date.parse(t.seenAt) : 0), {
      id: 'seenAt',
      header: 'Seen',
      sortFn: 'basic',
      cell: (c) => seenCell(c.row.original.seenAt),
    }),
  ]);
}

/** The build picker of a detail card: newest by default. */
function BuildPicker({
  builds,
  value,
  onChange,
}: {
  builds: number[];
  value: number | null;
  onChange: (b: number | null) => void;
}) {
  if (builds.length < 2) return null;
  return (
    <label className="filters">
      Build
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      >
        <option value="">newest</option>
        {builds.map((b) => (
          <option key={b} value={b}>
            {b}
          </option>
        ))}
      </select>
    </label>
  );
}

function DetailHead({ n, children }: { n: VendorDetail | TrainerDetail; children?: ReactNode }) {
  return (
    <p className="small">
      {n.title && <span className="chip">{n.title}</span>}
      {n.forever && <span className="pill forever">Forever</span>} NPC #{n.npcId} ·{' '}
      {formatLocation(n.location)} · build {n.build} · seen {formatChicagoShort(n.seenAt)}
      {children}
    </p>
  );
}

const itemCol = createColumnHelper<SortableFeatures, VendorItem>();
const itemColumns = itemCol.columns([
  itemCol.accessor((i) => i.name ?? `Item ${i.itemId ?? '?'}`, {
    id: 'item',
    header: 'Item',
    cell: (c) => (
      <span>
        <span className={`quality q${c.row.original.quality ?? 'x'}`} aria-hidden />
        {c.getValue()}
        {c.row.original.classId === 9 && <span className="pill neutral">recipe</span>}
      </span>
    ),
  }),
  itemCol.accessor((i) => [i.type, i.subtype].filter(Boolean).join(' / '), {
    id: 'class',
    header: 'Class',
    cell: (c) => c.getValue() || '—',
  }),
  itemCol.accessor(
    (i) => (i.costs && i.costs.length > 0 ? Number.MAX_SAFE_INTEGER : (i.price ?? -1)),
    {
      id: 'price',
      header: 'Price',
      sortFn: 'basic',
      cell: (c) => {
        const i = c.row.original;
        return (
          <span>
            {formatCosts(i.price, i.costs)}
            {i.extendedCost && !i.costs?.length && (
              <span
                className="muted small"
                title="The client flagged an extended cost it didn't list"
              >
                {' '}
                + extended cost
              </span>
            )}
          </span>
        );
      },
    },
  ),
  itemCol.accessor((i) => i.stack ?? 1, {
    id: 'stack',
    header: 'Stack',
    sortFn: 'basic',
    cell: (c) => {
      const i = c.row.original;
      const each = unitPrice(i.price, i.stack);
      return (
        <span>
          {i.stack ?? '—'}
          {i.stack && i.stack > 1 && each !== null && each > 0 && !i.costs?.length && (
            <span className="muted small"> ({formatMoney(each)} each)</span>
          )}
        </span>
      );
    },
  }),
  itemCol.accessor((i) => i.numAvailable ?? -2, {
    id: 'stock',
    header: 'Stock',
    sortFn: 'basic',
    cell: (c) => stockLabel(c.row.original.numAvailable),
  }),
]);

function VendorCard({ npcId }: { npcId: number }) {
  const [build, setBuild] = useState<number | null>(null);
  const detail = useAdminQuery<VendorDetail>(
    ['vendor', npcId, build],
    `/admin/api/vendors/${npcId}${build === null ? '' : `?build=${build}`}`,
  );
  return (
    <Card
      title={detail.data ? npcName(detail.data) : `Vendor #${npcId}`}
      actions={<BuildPicker builds={detail.data?.builds ?? []} value={build} onChange={setBuild} />}
    >
      <QueryState query={detail}>
        {(v) => (
          <>
            <DetailHead n={v} />
            {v.items.length === 0 ? (
              <Empty>This scan listed no items.</Empty>
            ) : (
              <DataTable
                data={v.items}
                columns={itemColumns}
                rowKey={(i) => `${i.itemId}-${i.name}-${i.price}`}
              />
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
}

function TrainerCard({ npcId }: { npcId: number }) {
  const [build, setBuild] = useState<number | null>(null);
  const detail = useAdminQuery<TrainerDetail>(
    ['trainer', npcId, build],
    `/admin/api/trainers/${npcId}${build === null ? '' : `?build=${build}`}`,
  );
  const services = useMemo(() => detail.data?.services ?? [], [detail.data]);
  return (
    <Card
      title={detail.data ? npcName(detail.data) : `Trainer #${npcId}`}
      actions={<BuildPicker builds={detail.data?.builds ?? []} value={build} onChange={setBuild} />}
    >
      <QueryState query={detail}>
        {(t) => (
          <>
            <DetailHead n={t}>{t.skillLineName ? ` · teaches ${t.skillLineName}` : ''}</DetailHead>
            {!t.complete && (
              <div className="callout warn" role="note">
                Partial list: when this trainer was scanned, a service filter was off (usually
                "Used", or "Unavailable") or a header was collapsed, so services can be missing.
              </div>
            )}
            {services.length === 0 ? (
              <Empty>This scan listed no services.</Empty>
            ) : (
              <div className="table-wrap">
                <table className="data compact">
                  <thead>
                    <tr>
                      <th>Service</th>
                      <th>Status</th>
                      <th>Cost</th>
                      <th>Requires</th>
                      <th>Level</th>
                      <th>Makes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {services.map((s, i) => (
                      <tr key={`${i}-${s.name}`}>
                        <td>{s.name ?? '—'}</td>
                        <td>
                          {s.type ? (
                            <span className={`pill svc-${s.type.replace(/[^a-z]/gi, '')}`}>
                              {s.type}
                            </span>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td>{formatMoney(s.cost)}</td>
                        <td>{skillReq(s.skill, s.skillRank)}</td>
                        <td>{s.level ? s.level : '—'}</td>
                        <td>{s.itemId === null ? '—' : (s.itemName ?? `Item ${s.itemId}`)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </QueryState>
    </Card>
  );
}
