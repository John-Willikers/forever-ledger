import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { ClassBadge } from '../../components/ClassBadge';
import { Empty, QueryState } from '../../components/State';
import { formatNumber } from '../../lib/format';
import { formatChicagoShort } from '../../lib/time';
import { formatCopper, mobLabel, qualityClass, qualityLabel } from '../loot/lootLib';
import { ForeverBadge, ItemName, RateBar } from '../loot/parts';
import type { ItemExtra, ItemV1, VendorCost } from '../loot/types';
import { makerRank, recipeHref } from '../professions/recipeLib';
import { mergeDropSources, statLabel, statMatrix, tooltipText } from './itemLib';

/** One item across builds: stats with changes highlighted, where it comes from, what uses it. */
export function ItemPage() {
  const { id = '' } = useParams();
  const valid = /^\d{1,10}$/.test(id) && Number(id) > 0;
  const item = useAdminQuery<ItemV1>(['item', id], `/v1/items/${id}`, { enabled: valid });
  const extra = useAdminQuery<ItemExtra>(['item-extra', id], `/admin/api/items/${id}`, {
    enabled: valid,
  });
  if (!valid)
    return (
      <div className="page">
        <h1>Item</h1>
        <Empty>That isn't an item id.</Empty>
      </div>
    );
  return (
    <div className="page">
      <p className="small">
        <Link to="/loot">← Loot</Link>
      </p>
      <QueryState query={item}>
        {(i) => (
          <>
            <header className="page-head">
              <h1 className={qualityClass(i.quality)}>{i.name}</h1>
              <p className="muted">
                {qualityLabel(i.quality)} · {i.type ?? 'unknown type'}
                {i.subtype ? ` / ${i.subtype}` : ''}
                {i.equipLoc ? ` · ${i.equipLoc}` : ''} · item {i.itemId}
                <ForeverBadge show={extra.data?.foreverOnly ?? false} />
              </p>
            </header>
            <div className="grid-2">
              <StatsCard item={i} extra={extra.data} />
              <TooltipCard item={i} />
            </div>
            <QueryState query={extra}>
              {(x) => (
                <>
                  <div className="grid-2">
                    <DropsCard item={i} extra={x} />
                    <NodesCard item={i} />
                  </div>
                  <VendorsCard extra={x} />
                  <div className="grid-2">
                    <QuestsCard item={i} />
                    <RecipesCard extra={x} />
                  </div>
                </>
              )}
            </QueryState>
            <SpecsCard item={i} />
          </>
        )}
      </QueryState>
    </div>
  );
}

const statValue = (key: string, v: number | null) =>
  v === null ? '—' : key === 'sellPrice' ? formatCopper(v) : formatNumber(v);

function StatsCard({ item, extra }: { item: ItemV1; extra: ItemExtra | undefined }) {
  const m = statMatrix(
    item.snapshots.map((s) => ({
      build: s.build,
      ilvl: s.ilvl,
      reqLevel: s.reqLevel,
      sellPrice: s.sellPrice,
      stats: s.stats,
    })),
  );
  return (
    <Card title="Stats across builds">
      {m.builds.length === 0 ? (
        <Empty>No snapshot yet.</Empty>
      ) : (
        <>
          <div className="table-wrap">
            <table className="data compact">
              <thead>
                <tr>
                  <th>Stat</th>
                  {m.builds.map((b) => (
                    <th key={b}>{b}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {m.rows.map((r) => (
                  <tr key={r.key}>
                    <td title={r.isStat ? r.key : undefined}>{r.label}</td>
                    {r.cells.map((c, i) => (
                      <td
                        key={m.builds[i]}
                        className={c.changed ? 'changed' : undefined}
                        title={
                          c.changed
                            ? `was ${statValue(r.key, r.cells[i - 1]?.value ?? null)} in ${m.builds[i - 1]}`
                            : undefined
                        }
                      >
                        {statValue(r.key, c.value)}
                        {c.changed && <span className="sr-only"> (changed)</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {extra && extra.statDiffs.length > 0 && (
            <ul className="diffs small">
              {extra.statDiffs.map((d) => (
                <li key={`${d.fromBuild}-${d.toBuild}`}>
                  <strong>
                    {d.fromBuild} → {d.toBuild}:
                  </strong>{' '}
                  {[
                    ...d.fields.map((f) => ({ key: f.field, from: f.from, to: f.to })),
                    ...d.stats.map((s) => ({ key: s.stat, from: s.from, to: s.to })),
                  ]
                    .map(
                      (c) =>
                        `${statLabel(c.key)} ${statValue(c.key, c.from)} → ${statValue(c.key, c.to)}`,
                    )
                    .join(' · ')}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Card>
  );
}

function TooltipCard({ item }: { item: ItemV1 }) {
  const [build, setBuild] = useState<number | null>(null);
  const snap = item.snapshots.find((s) => s.build === build) ?? item.snapshots[0];
  return (
    <Card
      title="Tooltip"
      actions={
        item.snapshots.length > 1 && (
          <label className="small">
            Build{' '}
            <select value={snap?.build ?? ''} onChange={(e) => setBuild(Number(e.target.value))}>
              {item.snapshots.map((s) => (
                <option key={s.build} value={s.build}>
                  {s.build}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      {!snap || !snap.tooltip || snap.tooltip.length === 0 ? (
        <Empty>No tooltip recorded.</Empty>
      ) : (
        <ul className="tooltip-lines">
          {snap.tooltip.map((line, i) => (
            <li key={i}>{tooltipText(line)}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function DropsCard({ item, extra }: { item: ItemV1; extra: ItemExtra }) {
  const rows = mergeDropSources(item.dropSources, extra.dropRates);
  return (
    <Card title="Drop sources">
      {rows.length === 0 ? (
        <Empty>Not seen dropping from a mob.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Mob</th>
                <th>Build</th>
                <th>Dropped</th>
                <th>Corpses</th>
                <th>Rate</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.build}-${r.npcId}`}>
                  <td>
                    <Link to={`/loot?npc=${r.npcId}&build=${r.build}`}>
                      {mobLabel(r.npcId, r.npcName)}
                    </Link>
                  </td>
                  <td>{r.build}</td>
                  <td title={`${r.contributors} contributing sessions`}>{formatNumber(r.count)}</td>
                  <td>{formatNumber(r.corpses)}</td>
                  <td>
                    {r.rate === null ? (
                      <span className="muted small">no corpse counts</span>
                    ) : (
                      <RateBar rate={r.rate} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function NodesCard({ item }: { item: ItemV1 }) {
  return (
    <Card title="Gathering / object sources">
      {item.nodeSources.length === 0 ? (
        <Empty>Not seen in a node or chest.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Object</th>
                <th>Build</th>
                <th>Opens</th>
                <th>Held it</th>
                <th>Quantity</th>
              </tr>
            </thead>
            <tbody>
              {item.nodeSources.map((n) => (
                <tr key={`${n.build}-${n.objectId}`}>
                  <td>{n.objectId === 0 ? 'Fishing' : (n.name ?? `Object ${n.objectId}`)}</td>
                  <td>{n.build}</td>
                  <td>{formatNumber(n.opens)}</td>
                  <td>{formatNumber(n.count)}</td>
                  <td>{formatNumber(n.quantity)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

const costText = (costs: VendorCost[] | null) =>
  (costs ?? [])
    .map(
      (c) =>
        `${formatNumber(c.amount)} × ${c.name ?? (c.itemId !== undefined ? `item ${c.itemId}` : `currency ${c.currencyId ?? '?'}`)}`,
    )
    .join(', ');

function VendorsCard({ extra }: { extra: ItemExtra }) {
  return (
    <Card title="Vendors">
      {extra.vendors.length === 0 ? (
        <Empty>No vendor seen selling it.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>NPC</th>
                <th>Build</th>
                <th>Price</th>
                <th>Also costs</th>
                <th>Stack</th>
                <th>Available</th>
                <th>Seen</th>
              </tr>
            </thead>
            <tbody>
              {extra.vendors.map((v) => (
                <tr key={`${v.build}-${v.npcId}`}>
                  <td>
                    {v.npcName ?? `NPC ${v.npcId}`}
                    {v.npcTitle && <span className="muted small"> &lt;{v.npcTitle}&gt;</span>}
                  </td>
                  <td>{v.build}</td>
                  <td className="nowrap">{formatCopper(v.price)}</td>
                  <td>{costText(v.costs) || '—'}</td>
                  <td>{formatNumber(v.stack)}</td>
                  <td>{v.numAvailable === -1 ? 'unlimited' : formatNumber(v.numAvailable)}</td>
                  <td className="nowrap">{formatChicagoShort(v.seenAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function QuestsCard({ item }: { item: ItemV1 }) {
  return (
    <Card title="Quest rewards">
      {item.questRewards.length === 0 ? (
        <Empty>Not a known quest reward.</Empty>
      ) : (
        <ul className="plain">
          {item.questRewards.map((q) => (
            <li key={`${q.build}-${q.questId}-${q.kind}`}>
              {q.title ?? `Quest ${q.questId}`} <span className="muted small">#{q.questId}</span> ·{' '}
              {q.kind === 'choice' ? 'choice' : 'reward'}
              {q.count > 1 ? ` ×${q.count}` : ''}{' '}
              <span className="muted small">build {q.build}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

const RecipeLink = ({ recipeId, name }: { recipeId: number; name: string | null }) => (
  <Link to={recipeHref(recipeId)} title="Recipe details">
    {name ?? `Recipe ${recipeId}`}
  </Link>
);

function RecipesCard({ extra }: { extra: ItemExtra }) {
  const { produces, reagentIn } = extra.recipes;
  const teaches = extra.recipes.teaches ?? [];
  return (
    <Card title="Recipes">
      {produces.length === 0 && reagentIn.length === 0 && teaches.length === 0 ? (
        <Empty>No recipe makes or uses it.</Empty>
      ) : (
        <>
          {teaches.length > 0 && (
            <>
              <h3>Teaches</h3>
              <ul className="plain">
                {teaches.map((t) => (
                  <li key={t.recipeId}>
                    <RecipeLink recipeId={t.recipeId} name={t.name} />
                    {t.profession?.name && (
                      <span className="muted small"> · {t.profession.name}</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {produces.length > 0 && (
            <>
              <h3>Made by</h3>
              <ul className="plain">
                {produces.map((r) => (
                  <li key={`${r.build}-${r.recipeId}`}>
                    <RecipeLink recipeId={r.recipeId} name={r.name} />
                    {makerRank(r) && <span> ({makerRank(r)})</span>}{' '}
                    <span className="muted small">build {r.build}</span>
                    <div className="small muted">
                      {r.reagents.map((g, i) => (
                        <span key={g.itemId}>
                          {i > 0 && ', '}
                          {g.qty} × <ItemName itemId={g.itemId} name={g.name} quality={null} />
                        </span>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
          {reagentIn.length > 0 && (
            <>
              <h3>Reagent in</h3>
              <ul className="plain">
                {reagentIn.map((r) => (
                  <li key={`${r.build}-${r.recipeId}`}>
                    {r.qty ?? '?'} × for <RecipeLink recipeId={r.recipeId} name={r.name} />
                    {r.outputItemId !== null && (
                      <>
                        {' '}
                        →{' '}
                        <ItemName itemId={r.outputItemId} name={r.outputItemName} quality={null} />
                      </>
                    )}{' '}
                    <span className="muted small">build {r.build}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Card>
  );
}

function SpecsCard({ item }: { item: ItemV1 }) {
  const fits = [...item.specs.fits].sort((a, b) => b.score - a.score).slice(0, 12);
  if (fits.length === 0) return null;
  return (
    <Card title={`Who wants it (at level ${item.specs.atLevel})`}>
      <ul className="specs">
        {fits.map((f) => (
          <li key={`${f.cls}-${f.spec}`}>
            <ClassBadge cls={f.cls} /> {f.spec}{' '}
            <span className="muted small">
              {f.role} · {Math.round(f.score * 100)}%{f.bestArmor ? ' · best armor' : ''}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
