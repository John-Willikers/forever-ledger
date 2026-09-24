import { createColumnHelper } from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatCosts, formatMoney } from '../../lib/money';
import { BandBar, BandLegend } from './BandBar';
import { bandScale, difficultyBands, viaLabel } from './lib';
import type { Recipe, RecipeBuild, RecipeCost, RecipeSources } from './types';

const reagentsText = (b: RecipeBuild | undefined) =>
  b && b.reagents.length > 0
    ? b.reagents.map((r) => `${r.qty}× ${r.name ?? `Item ${r.itemId}`}`).join(', ')
    : '—';

function outputText(b: RecipeBuild | undefined) {
  if (!b || b.outputItemId === null || b.outputItemId === undefined) return '—';
  const name = b.outputItemName ?? `Item ${b.outputItemId}`;
  const min = b.qtyMin ?? 1;
  const max = b.qtyMax ?? min;
  return min === 1 && max === 1 ? name : `${name} ×${min === max ? min : `${min}–${max}`}`;
}

const viaText = (r: Recipe) =>
  r.learnedVia.length > 0
    ? r.learnedVia.map((v) => `${viaLabel(v.via)}${v.count > 1 ? ` ×${v.count}` : ''}`).join(', ')
    : '—';

/** Recipes of one base profession (/v1/professions/recipes folds child lines), newest schematic per recipe. */
export function RecipesCard({ skillLineId, name }: { skillLineId: number; name: string }) {
  const recipes = useAdminQuery<Recipe[]>(
    ['v1-recipes', skillLineId],
    `/v1/professions/recipes?skillLine=${skillLineId}`,
  );
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<number | null>(null);
  return (
    <Card
      title={`${name} recipes`}
      actions={
        <label className="filters">
          <span className="visually-hidden">Search recipes</span>
          <input
            type="search"
            placeholder="Search recipes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      }
    >
      <QueryState query={recipes}>
        {(list) => (
          <RecipeTable
            list={list}
            search={search}
            selected={selected}
            onSelect={(id) => setSelected((s) => (s === id ? null : id))}
          />
        )}
      </QueryState>
    </Card>
  );
}

function RecipeTable({
  list,
  search,
  selected,
  onSelect,
}: {
  list: Recipe[];
  search: string;
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const scale = useMemo(() => bandScale(list.map((r) => r.builds[0]?.difficulty ?? [])), [list]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (r) =>
        r.name.toLowerCase().includes(q) || reagentsText(r.builds[0]).toLowerCase().includes(q),
    );
  }, [list, search]);
  const columns = useMemo(() => {
    const col = createColumnHelper<SortableFeatures, Recipe>();
    return col.columns([
      col.accessor('name', {
        header: 'Recipe',
        cell: (c) => (
          <button
            type="button"
            className="linkish"
            aria-expanded={selected === c.row.original.recipeId}
            onClick={() => onSelect(c.row.original.recipeId)}
          >
            {c.getValue()}
          </button>
        ),
      }),
      col.accessor((r) => r.builds[0]?.difficulty[0]?.minRank ?? -1, {
        id: 'difficulty',
        header: 'Difficulty (skill rank)',
        sortFn: 'basic',
        cell: (c) => (
          <BandBar
            bands={difficultyBands(c.row.original.builds[0]?.difficulty ?? [])}
            scale={scale}
          />
        ),
      }),
      col.accessor((r) => reagentsText(r.builds[0]), { id: 'reagents', header: 'Reagents' }),
      col.accessor((r) => outputText(r.builds[0]), { id: 'output', header: 'Makes' }),
      col.accessor('learnedBy', { header: 'Known by', sortFn: 'basic' }),
      col.accessor((r) => viaText(r), { id: 'via', header: 'How learned' }),
    ]);
  }, [scale, selected, onSelect]);

  const current = list.find((r) => r.recipeId === selected) ?? null;
  if (list.length === 0) return <Empty>No recipes seen for this profession yet.</Empty>;
  return (
    <>
      <p className="muted small">
        {plural(shown.length, 'recipe')}
        {shown.length !== list.length ? ` of ${formatNumber(list.length)}` : ''} · newest build per
        recipe · <BandLegend scale={scale} />
      </p>
      <DataTable
        data={shown}
        columns={columns}
        rowKey={(r) => r.recipeId}
        rowClassName={(r) => (r.recipeId === selected ? 'selected' : undefined)}
        initialSorting={[{ id: 'difficulty', desc: false }]}
        empty="No recipe matches."
      />
      {current && <RecipeDetail recipe={current} scale={scale} />}
    </>
  );
}

function RecipeDetail({ recipe, scale }: { recipe: Recipe; scale: number }) {
  return (
    <section className="recipe-detail" aria-label={`${recipe.name} details`}>
      <h3>
        {recipe.name} <span className="muted small">recipe {recipe.recipeId}</span>
      </h3>
      <div className="grid-2">
        <div>
          <h4>Per build</h4>
          {recipe.builds.length === 0 ? (
            <p className="muted small">No schematic seen yet.</p>
          ) : (
            <div className="table-wrap">
              <table className="data compact">
                <thead>
                  <tr>
                    <th>Build</th>
                    <th>Reagents</th>
                    <th>Makes</th>
                    <th>Difficulty</th>
                  </tr>
                </thead>
                <tbody>
                  {recipe.builds.map((b) => (
                    <tr key={b.build}>
                      <td>{b.build}</td>
                      <td>{reagentsText(b)}</td>
                      <td>{outputText(b)}</td>
                      <td>
                        <BandBar bands={difficultyBands(b.difficulty)} scale={scale} />
                        <div className="muted small">
                          {b.difficulty
                            .map(
                              (d) =>
                                `${d.difficulty} ${d.minRank}–${d.maxRank}${d.chars ? ` (${plural(d.chars, 'char')})` : ''}`,
                            )
                            .join(' · ') || '—'}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="small">
            Known by {plural(recipe.learnedBy, 'character')} · learned via {viaText(recipe)}
          </p>
        </div>
        <CostCalculator recipeId={recipe.recipeId} builds={recipe.builds.map((b) => b.build)} />
      </div>
      <Sources recipeId={recipe.recipeId} />
    </section>
  );
}

function CostCalculator({ recipeId, builds }: { recipeId: number; builds: number[] }) {
  const [build, setBuild] = useState<number | null>(null);
  const cost = useAdminQuery<RecipeCost>(
    ['recipe-cost', recipeId, build],
    `/admin/api/professions/cost?recipeId=${recipeId}${build === null ? '' : `&build=${build}`}`,
  );
  return (
    <div>
      <h4 className="with-actions">
        Cost calculator
        {builds.length > 1 && (
          <label className="filters">
            Build
            <select
              value={build ?? ''}
              onChange={(e) => setBuild(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">newest</option>
              {builds.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )}
      </h4>
      <QueryState query={cost}>
        {(c) =>
          c.build === null ? (
            <p className="muted small">No schematic in this build: nothing to price.</p>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data compact cost">
                  <thead>
                    <tr>
                      <th>Reagent</th>
                      <th>Qty</th>
                      <th>Each</th>
                      <th>Cost</th>
                      <th>Cheapest vendor</th>
                    </tr>
                  </thead>
                  <tbody>
                    {c.reagents.map((r) => (
                      <tr key={r.itemId} className={r.cost === null ? 'unknown' : undefined}>
                        <td>{r.name ?? `Item ${r.itemId}`}</td>
                        <td>{r.qty}</td>
                        <td>{formatMoney(r.unitPrice)}</td>
                        <td>
                          {r.cost === null ? (
                            <span className="pill sev-warn">unknown</span>
                          ) : (
                            formatMoney(r.cost)
                          )}
                        </td>
                        <td className="small">
                          {r.vendor ? (
                            <>
                              {r.vendor.name ?? `NPC ${r.vendor.npcId}`}
                              <span className="muted">
                                {' '}
                                · {formatMoney(r.vendor.price)}
                                {r.vendor.stack && r.vendor.stack > 1
                                  ? ` per ${r.vendor.stack}`
                                  : ''}{' '}
                                · build {r.vendor.build}
                              </span>
                            </>
                          ) : r.extendedOnly ? (
                            <span className="muted">only sold for extended costs</span>
                          ) : (
                            <span className="muted">no vendor price seen</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th colSpan={3}>{c.total.complete ? 'Total' : 'Known total'}</th>
                      <th colSpan={2}>
                        {formatMoney(c.total.known)}
                        {!c.total.complete && (
                          <span className="muted small">
                            {' '}
                            + {plural(c.total.unknownItemIds.length, 'unknown price')}
                          </span>
                        )}
                      </th>
                    </tr>
                  </tfoot>
                </table>
              </div>
              <p className="small">
                Makes{' '}
                {c.output ? (
                  <>
                    {c.output.name ?? `Item ${c.output.itemId}`}: sells to vendors for{' '}
                    {c.output.unitSellPrice === null ? (
                      <span className="pill sev-warn">unknown</span>
                    ) : (
                      <>
                        {formatMoney(c.output.unitSellPrice)} each, {formatMoney(c.output.value)}{' '}
                        per craft
                      </>
                    )}
                  </>
                ) : (
                  <span className="muted">no output item</span>
                )}
                {c.profit !== null && (
                  <>
                    {' '}
                    · vendor profit <strong>{formatMoney(c.profit)}</strong>
                  </>
                )}
              </p>
              <p className="muted small">
                Schematic of build {c.build}; vendor prices from any build, per item (listings price
                a stack). Listings with an extended cost are never used.
              </p>
            </>
          )
        }
      </QueryState>
    </div>
  );
}

function Sources({ recipeId }: { recipeId: number }) {
  const sources = useAdminQuery<RecipeSources>(
    ['v1-sources', recipeId],
    `/v1/professions/sources?recipeId=${recipeId}`,
  );
  return (
    <div>
      <h4>Where it comes from</h4>
      <QueryState query={sources}>
        {(s) =>
          s.trainers.length + s.vendors.length + s.drops.length === 0 ? (
            <p className="muted small">No trainer, vendor or drop seen for it yet.</p>
          ) : (
            <ul className="sources small">
              {s.trainers.map((t) => (
                <li key={`t-${t.npcId}-${t.build}-${t.service}`}>
                  <span className="pill neutral">trainer</span>
                  {t.npcName ?? `NPC ${t.npcId}`}
                  {t.npcTitle && <span className="chip">{t.npcTitle}</span>}
                  <span className="muted">
                    {' '}
                    · {formatMoney(t.cost)}
                    {t.skillRank ? ` · needs rank ${t.skillRank}` : ''} · build {t.build}
                  </span>
                </li>
              ))}
              {s.vendors.map((v) => (
                <li key={`v-${v.npcId}-${v.build}-${v.itemId}`}>
                  <span className="pill neutral">vendor</span>
                  {v.npcName ?? `NPC ${v.npcId}`}
                  {v.npcTitle && <span className="chip">{v.npcTitle}</span>}
                  <span className="muted">
                    {' '}
                    · {v.itemName ?? `Item ${v.itemId}`} for {formatCosts(v.price, v.costs)} · build{' '}
                    {v.build}
                  </span>
                </li>
              ))}
              {s.drops.map((d) => (
                <li key={`d-${d.itemId}-${d.build}-${d.npcId}-${d.objectId}`}>
                  <span className="pill neutral">drop</span>
                  {d.itemName ?? `Item ${d.itemId}`}
                  <span className="muted">
                    {' '}
                    · from {d.npcId !== null ? `NPC ${d.npcId}` : `object ${d.objectId}`} ·{' '}
                    {plural(d.count, 'time')} · build {d.build}
                  </span>
                </li>
              ))}
            </ul>
          )
        }
      </QueryState>
    </div>
  );
}
