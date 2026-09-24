import { keepPreviousData } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { Pager } from '../../components/Pager';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import {
  formatCopper,
  formatRate,
  mobDropChartHeight,
  mobDropOption,
  mobLabel,
  qualityLabel,
} from './lootLib';
import { BuildSelect, ForeverBadge, intFromParams, ItemName, RateBar } from './parts';
import type { ItemRow, ItemsPage, MobDetail, MobRow, Paged } from './types';

const PAGE = 50;

/** Drop rates per mob (click one for its chart) and the item search, linking to the Item page. */
export function LootPage() {
  return (
    <div className="page">
      <header className="page-head">
        <h1>Loot</h1>
        <p className="muted">
          Drop rates per mob from sessions that counted corpses (rate = corpses that dropped the
          item ÷ corpses looted), and every item seen. Pick a mob for its drop chart, an item for
          its page.
        </p>
      </header>
      <MobsCard />
      <ItemsCard />
    </div>
  );
}

/** Build + search as submitted (the query only changes on submit), and the page offset. */
function useFilters() {
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    setSearch(draft.trim());
    setOffset(0);
  };
  return { draft, setDraft, search, offset, setOffset, submit };
}

function MobsCard() {
  const [params, setParams] = useSearchParams();
  const selected = intFromParams(params, 'npc');
  const selectedBuild = intFromParams(params, 'build');
  const [build, setBuild] = useState<number | null>(null);
  const f = useFilters();
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(f.offset) });
  if (build !== null) qs.set('build', String(build));
  if (f.search) qs.set('search', f.search);
  const mobs = useAdminQuery<Paged<MobRow>>(
    ['loot-mobs', qs.toString()],
    `/admin/api/loot/mobs?${qs}`,
    {
      placeholderData: keepPreviousData,
    },
  );
  const select = (m: MobRow) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('npc', String(m.npcId));
        next.set('build', String(m.build));
        return next;
      },
      { replace: true },
    );

  return (
    <>
      {selected !== null && (
        <MobChartCard
          npcId={selected}
          build={selectedBuild}
          onClose={() =>
            setParams(
              (prev) => {
                const next = new URLSearchParams(prev);
                next.delete('npc');
                next.delete('build');
                return next;
              },
              { replace: true },
            )
          }
        />
      )}
      <Card
        title="Drop rates by mob"
        actions={
          <form className="filters" onSubmit={f.submit} role="search">
            <BuildSelect
              value={build}
              onChange={(b) => {
                setBuild(b);
                f.setOffset(0);
              }}
            />
            <label>
              Mob
              <input
                type="search"
                value={f.draft}
                maxLength={100}
                placeholder="name or id"
                onChange={(e) => f.setDraft(e.target.value)}
              />
            </label>
            <button type="submit" className="secondary small">
              Search
            </button>
          </form>
        }
      >
        <QueryState query={mobs}>
          {(page) =>
            page.items.length === 0 ? (
              <Empty>
                {f.search || build !== null
                  ? 'No mob matches.'
                  : 'No corpse counts yet (they come from schema 3+ sessions).'}
              </Empty>
            ) : (
              <>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Mob</th>
                        <th>Build</th>
                        <th>Corpses</th>
                        <th>Avg copper</th>
                        <th>Items</th>
                        <th>Top drops</th>
                        <th>
                          <span className="sr-only">Chart</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {page.items.map((m) => (
                        <tr
                          key={`${m.build}-${m.npcId}`}
                          className={
                            m.npcId === selected && m.build === selectedBuild
                              ? 'selected'
                              : undefined
                          }
                        >
                          <td>
                            <span className="mob-name">{mobLabel(m.npcId, m.name)}</span>
                            {m.name && <span className="muted small"> #{m.npcId}</span>}
                            <ForeverBadge show={m.foreverOnly} />
                          </td>
                          <td>{m.build}</td>
                          <td>{formatNumber(m.corpses)}</td>
                          <td className="nowrap">{formatCopper(m.avgCopper)}</td>
                          <td>{formatNumber(m.items)}</td>
                          <td>
                            <ul className="top-drops">
                              {m.topItems.map((i) => (
                                <li key={i.itemId}>
                                  <ItemName itemId={i.itemId} name={i.name} quality={i.quality} />
                                  <RateBar rate={i.rate} />
                                </li>
                              ))}
                            </ul>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="secondary small"
                              onClick={() => select(m)}
                            >
                              Chart
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  total={page.total}
                  limit={page.limit}
                  offset={page.offset}
                  onOffset={f.setOffset}
                  busy={mobs.isFetching}
                />
              </>
            )
          }
        </QueryState>
      </Card>
    </>
  );
}

function MobChartCard({
  npcId,
  build,
  onClose,
}: {
  npcId: number;
  build: number | null;
  onClose: () => void;
}) {
  const palette = useChartPalette();
  const mob = useAdminQuery<MobDetail>(['loot-mob', npcId], `/admin/api/loot/mobs/${npcId}`);
  return (
    <Card
      title={mob.data ? `${mobLabel(npcId, mob.data.name)} — drop rates` : `NPC ${npcId}`}
      actions={
        <button type="button" className="secondary small" onClick={onClose}>
          Close
        </button>
      }
    >
      <QueryState query={mob}>
        {(m) => {
          const b = m.builds.find((x) => x.build === build) ?? m.builds[0];
          if (!b) return <Empty>No corpses recorded for this mob.</Empty>;
          return (
            <>
              <p className="muted small">
                Build {b.build} · {plural(b.corpses, 'corpse')} looted · avg{' '}
                {formatCopper(b.avgCopper)} per corpse · {plural(b.items.length, 'item')}
                {m.builds.length > 1 &&
                  ` · also seen in ${m.builds
                    .filter((x) => x.build !== b.build)
                    .map((x) => x.build)
                    .join(', ')}`}
              </p>
              <h3>
                Drop rate by item ({plural(b.corpses, 'corpse')}, build {b.build})
              </h3>
              <Chart
                option={mobDropOption(b.items, b.corpses, palette)}
                height={mobDropChartHeight(Math.min(b.items.length, 20))}
                label={`Drop rates of ${mobLabel(npcId, m.name)} over ${b.corpses} corpses`}
              />
              <details>
                <summary className="small">Table ({plural(b.items.length, 'item')})</summary>
                <div className="table-wrap">
                  <table className="data compact">
                    <thead>
                      <tr>
                        <th>Item</th>
                        <th>Dropped</th>
                        <th>Quantity</th>
                        <th>Rate</th>
                      </tr>
                    </thead>
                    <tbody>
                      {b.items.map((i) => (
                        <tr key={i.itemId}>
                          <td>
                            <ItemName itemId={i.itemId} name={i.name} quality={i.quality} />
                          </td>
                          <td>{formatNumber(i.dropped)}</td>
                          <td>{formatNumber(i.quantity)}</td>
                          <td>{formatRate(i.rate)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

const sourceText = (s: ItemRow['sources']) =>
  [
    s.drops ? plural(s.drops, 'mob') : '',
    s.nodes ? plural(s.nodes, 'node') : '',
    s.vendors ? plural(s.vendors, 'vendor') : '',
    s.quests ? plural(s.quests, 'quest') : '',
    s.recipes ? plural(s.recipes, 'recipe') : '',
  ]
    .filter(Boolean)
    .join(' · ') || '—';

function ItemsCard() {
  const f = useFilters();
  const [quality, setQuality] = useState('');
  const [cls, setCls] = useState('');
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(f.offset) });
  if (f.search) qs.set('search', f.search);
  if (quality) qs.set('quality', quality);
  if (cls) qs.set('class', cls);
  const items = useAdminQuery<ItemsPage>(
    ['loot-items', qs.toString()],
    `/admin/api/loot/items?${qs}`,
    {
      placeholderData: keepPreviousData,
    },
  );
  const classes = items.data?.classes ?? [];

  return (
    <Card
      title="Items"
      actions={
        <form className="filters" onSubmit={f.submit} role="search">
          <label>
            Item
            <input
              type="search"
              value={f.draft}
              maxLength={100}
              placeholder="name or id"
              onChange={(e) => f.setDraft(e.target.value)}
            />
          </label>
          <label>
            Quality
            <select
              value={quality}
              onChange={(e) => {
                setQuality(e.target.value);
                f.setOffset(0);
              }}
            >
              <option value="">Any</option>
              {[0, 1, 2, 3, 4, 5, 6, 7].map((q) => (
                <option key={q} value={q}>
                  {qualityLabel(q)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Class
            <select
              value={cls}
              onChange={(e) => {
                setCls(e.target.value);
                f.setOffset(0);
              }}
            >
              <option value="">Any</option>
              {classes.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name} ({c.count})
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="secondary small">
            Search
          </button>
        </form>
      }
    >
      <QueryState query={items}>
        {(page) =>
          page.items.length === 0 ? (
            <Empty>No item matches.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Item</th>
                      <th>Quality</th>
                      <th>Class</th>
                      <th>Item level</th>
                      <th>Req. level</th>
                      <th>Sells for</th>
                      <th>Sources</th>
                      <th>Latest build</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((i) => (
                      <tr key={i.itemId}>
                        <td>
                          <ItemName itemId={i.itemId} name={i.name} quality={i.quality} />
                          <span className="muted small"> #{i.itemId}</span>
                          <ForeverBadge show={i.foreverOnly} />
                        </td>
                        <td>{qualityLabel(i.quality)}</td>
                        <td>
                          {i.type ?? '—'}
                          {i.subtype && <span className="muted"> / {i.subtype}</span>}
                        </td>
                        <td>{formatNumber(i.ilvl)}</td>
                        <td>{formatNumber(i.reqLevel)}</td>
                        <td className="nowrap">{formatCopper(i.sellPrice)}</td>
                        <td className="small">{sourceText(i.sources)}</td>
                        <td>{i.build ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                onOffset={f.setOffset}
                busy={items.isFetching}
              />
            </>
          )
        }
      </QueryState>
    </Card>
  );
}
