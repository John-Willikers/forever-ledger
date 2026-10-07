import { createColumnHelper } from '@tanstack/react-table';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, QueryState } from '../../components/State';
import { formatNumber } from '../../lib/format';
import { formatMoney } from '../../lib/money';
import { formatChicagoShort } from '../../lib/time';
import { fishingQuery, OUTCOME_LABELS, percent, placeName } from './lib';
import type { FishingFilter } from './lib';
import type { CastRow, FishingGroup, WhereRow, ZoneRow } from './types';
import './fishing.css';

const API = '/admin/api/fishing';

/** Fishing casts (addon 0.4.0, schema 7): yield per zone, where an item comes up, and every cast. */
export function FishingPage() {
  const [filter, setFilter] = useState<FishingFilter>({ zone: '', lure: '' });
  const f = useDeferredValue(filter);
  const zones = useAdminQuery<{ items: ZoneRow[] }>(['fishing', 'zones'], `${API}/zones`);
  const zoneNames = [
    ...new Set((zones.data?.items ?? []).map((z) => z.zone).filter(Boolean)),
  ] as string[];
  return (
    <div className="page">
      <header className="page-head">
        <h1>Fishing</h1>
        <p className="muted">
          One row per cast from addon 0.4.0: where, the effective skill (rank plus lure), whether a
          lure was on, how the cast ended and what came up. Casts that caught nothing count too, so
          rates are per cast.
        </p>
      </header>
      <div className="filters" role="group" aria-label="Filters">
        <label>
          Zone
          <select
            value={filter.zone}
            onChange={(e) => setFilter((x) => ({ ...x, zone: e.target.value }))}
          >
            <option value="">all</option>
            {zoneNames.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lure
          <select
            value={filter.lure}
            onChange={(e) =>
              setFilter((x) => ({ ...x, lure: e.target.value as FishingFilter['lure'] }))
            }
          >
            <option value="">any</option>
            <option value="yes">with a lure</option>
            <option value="no">no lure</option>
          </select>
        </label>
      </div>
      <WhereCard filter={f} />
      <YieldCard filter={f} />
      <CastsCard filter={f} />
    </div>
  );
}

function WhereCard({ filter }: { filter: FishingFilter }) {
  const [item, setItem] = useState('');
  const term = useDeferredValue(item.trim());
  const where = useAdminQuery<{ itemIds: number[]; zones: WhereRow[] }>(
    ['fishing', 'where', filter, term],
    `${API}/where${fishingQuery(filter, { item: term })}`,
    { enabled: term.length > 0, placeholderData: (prev) => prev },
  );
  return (
    <Card
      title="Where does it come from?"
      actions={
        <label>
          <span className="visually-hidden">Item</span>
          <input
            type="search"
            placeholder="Item name or id, e.g. Big-mouth Clam"
            value={item}
            onChange={(e) => setItem(e.target.value)}
          />
        </label>
      }
    >
      {term.length === 0 ? (
        <p className="muted small">
          Search an item to see every place it was fished, and how often per cast.
        </p>
      ) : (
        <QueryState query={where}>
          {(w) =>
            w.itemIds.length === 0 ? (
              <Empty>No item by that name in the ledger yet.</Empty>
            ) : (
              <table className="data fishing-where">
                <thead>
                  <tr>
                    <th>Where</th>
                    <th className="num">Casts there</th>
                    <th className="num">Came up</th>
                    <th className="num">Per cast</th>
                  </tr>
                </thead>
                <tbody>
                  {w.zones.map((z) => (
                    <tr key={`${z.zone}|${z.subzone}`}>
                      <td>{placeName(z.zone, z.subzone)}</td>
                      <td className="num">{formatNumber(z.casts)}</td>
                      <td className="num">{formatNumber(z.times)}</td>
                      <td className="num">{percent(z.perCast)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          }
        </QueryState>
      )}
    </Card>
  );
}

function YieldCard({ filter }: { filter: FishingFilter }) {
  const yieldQ = useAdminQuery<{ groups: FishingGroup[] }>(
    ['fishing', 'yield', filter],
    `${API}/yield${fishingQuery(filter)}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <Card title="Yield by place">
      <QueryState query={yieldQ}>
        {(y) =>
          y.groups.length === 0 ? (
            <Empty>No fishing casts yet: they arrive with addon 0.4.0.</Empty>
          ) : (
            <div className="fishing-groups">
              {y.groups.map((g) => (
                <section key={`${g.zone}|${g.subzone}`} className="fishing-group">
                  <h3>{placeName(g.zone, g.subzone)}</h3>
                  <p className="muted small">
                    {formatNumber(g.casts)} casts · {OUTCOME_LABELS.loot}{' '}
                    {formatNumber(g.outcomes.loot)} · {OUTCOME_LABELS.escaped}{' '}
                    {formatNumber(g.outcomes.escaped)} · {OUTCOME_LABELS.notHooked}{' '}
                    {formatNumber(g.outcomes.notHooked)} · {OUTCOME_LABELS.none}{' '}
                    {formatNumber(g.outcomes.none)} · {formatNumber(g.luredCasts)} with a lure ·
                    skill {g.effectiveSkill.min ?? '?'}
                    {g.effectiveSkill.max !== g.effectiveSkill.min
                      ? `–${g.effectiveSkill.max}`
                      : ''}{' '}
                    · {formatChicagoShort(g.firstAt)} → {formatChicagoShort(g.lastAt)}
                  </p>
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Catch</th>
                        <th className="num">Times</th>
                        <th className="num">Qty</th>
                        <th className="num">Per cast</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.catches.map((c) => (
                        <tr key={c.itemId}>
                          <td>
                            <Link to={`/items/${c.itemId}`}>{c.name ?? `item ${c.itemId}`}</Link>
                          </td>
                          <td className="num">{formatNumber(c.times)}</td>
                          <td className="num">{formatNumber(c.qty)}</td>
                          <td className="num">{percent(c.perCast)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              ))}
            </div>
          )
        }
      </QueryState>
    </Card>
  );
}

const castCol = createColumnHelper<SortableFeatures, CastRow>();
const castColumns = castCol.columns([
  castCol.accessor('castAt', { header: 'When', cell: (i) => formatChicagoShort(i.getValue()) }),
  castCol.accessor((c) => placeName(c.zone, c.subzone), {
    id: 'where',
    header: 'Where',
    cell: (i) => (
      <>
        {i.getValue()}
        {i.row.original.x !== null && (
          <span className="muted small">
            {' '}
            ({i.row.original.x}, {i.row.original.y})
          </span>
        )}
      </>
    ),
  }),
  castCol.accessor('char', { header: 'Character' }),
  castCol.accessor((c) => (c.skill ?? 0) + (c.modifier ?? 0), {
    id: 'skill',
    header: 'Skill',
    cell: (i) =>
      `${i.row.original.skill ?? '?'}${i.row.original.modifier ? ` +${i.row.original.modifier}` : ''}`,
  }),
  castCol.accessor((c) => (c.lure ? 'yes' : ''), { id: 'lure', header: 'Lure' }),
  castCol.accessor('outcome', { header: 'Outcome', cell: (i) => OUTCOME_LABELS[i.getValue()] }),
  castCol.accessor(
    (c) => c.loot.map((l) => `${l.qty > 1 ? `${l.qty}× ` : ''}${l.name ?? l.itemId}`).join(', '),
    {
      id: 'catch',
      header: 'Catch',
      enableSorting: false,
      cell: (i) => (
        <>
          {i.getValue() || '—'}
          {i.row.original.money > 0 && (
            <span className="muted"> {formatMoney(i.row.original.money)}</span>
          )}
        </>
      ),
    },
  ),
]);

function CastsCard({ filter }: { filter: FishingFilter }) {
  const casts = useAdminQuery<{ items: CastRow[] }>(
    ['fishing', 'casts', filter],
    `${API}/casts${fishingQuery(filter, { limit: '500' })}`,
    { placeholderData: (prev) => prev },
  );
  return (
    <Card title="Casts (newest first)">
      <QueryState query={casts}>
        {(c) => (
          <DataTable
            data={c.items}
            columns={castColumns}
            rowKey={(r) => r.id}
            pageSize={50}
            resetKey={`${filter.zone}|${filter.lure}`}
            empty="No casts match."
          />
        )}
      </QueryState>
    </Card>
  );
}
