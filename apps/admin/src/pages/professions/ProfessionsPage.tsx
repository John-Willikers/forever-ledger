import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, ErrorState, QueryState } from '../../components/State';
import { Tabs } from '../../components/Tabs';
import { formatNumber, plural } from '../../lib/format';
import { formatChicagoShort } from '../../lib/time';
import './echarts';
import { GatheringCard } from './GatheringCard';
import { percent, skillRankOption, skillRankSeries } from './lib';
import './professions.css';
import { RecipeInfo } from './RecipeInfo';
import { recipeParam } from './recipeLib';
import { RecipesCard } from './RecipesCard';
import type {
  CraftRow,
  ProfessionsOverview,
  ProfessionSummary,
  RecipeDetail,
  SkillHistory,
} from './types';

/** The profession picked until the user picks one: the one with the most recipes, crafts and harvests. */
const mostActive = (list: ProfessionSummary[]) =>
  list.reduce((best, p) => (activity(p) > activity(best) ? p : best));
const activity = (p: ProfessionSummary) => p.recipes.seen + p.crafts.casts + p.gathering.opens;

const professionName = (p: { skillLineId: number; name: string | null }) =>
  p.name ?? `Skill line ${p.skillLineId}`;

/**
 * Professions: a card per base profession, then the picked one's recipes, crafts and skill-ups, and gathering, as
 * tabs. `?recipe=<id>` (links from vendors, trainers and items) opens that recipe's details under its profession.
 */
export function ProfessionsPage() {
  const overview = useAdminQuery<ProfessionsOverview>(
    ['professions-overview'],
    '/admin/api/professions/overview',
  );
  const [selected, setSelected] = useState<number | null>(null);
  const [params, setParams] = useSearchParams();
  const recipeId = recipeParam(params);
  // Same key as RecipeInfo's newest-build query: the linked recipe's profession comes from its details.
  const linked = useAdminQuery<RecipeDetail>(
    ['recipe-detail', recipeId, null],
    `/admin/api/professions/recipes/${recipeId}`,
    { enabled: recipeId !== null },
  );
  const setRecipe = (id: number | null) =>
    setParams(
      (p) => {
        const next = new URLSearchParams(p);
        if (id === null) next.delete('recipe');
        else next.set('recipe', String(id));
        return next;
      },
      { replace: true },
    );
  const linkedProfession = recipeId !== null ? (linked.data?.profession ?? null) : null;
  return (
    <div className="page">
      <header className="page-head">
        <h1>Professions</h1>
        <p className="muted">
          Skills, recipes, crafts and gathering from every upload. Forever lists each profession
          twice (a base line and a "Classic" child); they are counted as one.
        </p>
      </header>
      <QueryState query={overview}>
        {({ professions }) => {
          if (professions.length === 0)
            return (
              <>
                <Empty>No professions seen yet.</Empty>
                <GatheringCard />
              </>
            );
          const current =
            professions.find((p) => p.skillLineId === selected) ??
            professions.find((p) => p.skillLineId === linkedProfession?.skillLineId) ??
            mostActive(professions);
          // A linked recipe outside the shown profession (none, or never seen in skills): its details on their own.
          const orphan =
            recipeId !== null &&
            linked.isSuccess &&
            linkedProfession?.skillLineId !== current.skillLineId;
          return (
            <>
              <div className="prof-grid" role="list">
                {professions.map((p) => (
                  <ProfessionCard
                    key={p.skillLineId}
                    p={p}
                    active={p.skillLineId === current.skillLineId}
                    onPick={() => {
                      setSelected(p.skillLineId);
                      setRecipe(null);
                    }}
                  />
                ))}
              </div>
              {orphan && linked.data && (
                <Card title={`${linked.data.name} (recipe ${linked.data.recipeId})`}>
                  <RecipeInfo recipeId={linked.data.recipeId} />
                </Card>
              )}
              {recipeId !== null && linked.isError && (
                <Card title={`Recipe ${recipeId}`}>
                  <ErrorState error={linked.error} retry={() => void linked.refetch()} />
                </Card>
              )}
              <Tabs
                id="prof"
                tabs={[
                  { key: 'recipes', label: 'Recipes' },
                  { key: 'crafts', label: 'Crafts' },
                  { key: 'skill', label: 'Skill history' },
                  { key: 'gathering', label: 'Gathering' },
                ]}
                label="Profession sections"
              >
                {(key) =>
                  key === 'crafts' ? (
                    <CraftsCard prof={current} />
                  ) : key === 'skill' ? (
                    <SkillRankCard prof={current} />
                  ) : key === 'gathering' ? (
                    <GatheringCard />
                  ) : (
                    <RecipesCard
                      key={current.skillLineId}
                      skillLineId={current.skillLineId}
                      name={professionName(current)}
                      selected={recipeId}
                      onSelect={setRecipe}
                    />
                  )
                }
              </Tabs>
            </>
          );
        }}
      </QueryState>
    </div>
  );
}

function ProfessionCard({
  p,
  active,
  onPick,
}: {
  p: ProfessionSummary;
  active: boolean;
  onPick: () => void;
}) {
  return (
    <article className={`prof-card${active ? ' active' : ''}`} role="listitem">
      <button type="button" className="prof-pick" aria-pressed={active} onClick={onPick}>
        <h2>{professionName(p)}</h2>
        <span className="muted small">
          {p.skillLineIds.length > 1
            ? `lines ${p.skillLineIds.join(', ')}`
            : `line ${p.skillLineId}`}
        </span>
      </button>
      {p.characters.length === 0 ? (
        <p className="muted small">No character has it.</p>
      ) : (
        <ul className="prof-chars">
          {p.characters.map((c) => (
            <li key={c.char}>
              <span className="prof-char">{c.char}</span>
              <meter min={0} max={c.maxRank || 1} value={c.rank} aria-label={`${c.char} rank`} />
              <span className="nowrap small">
                {c.rank}/{c.maxRank}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small prof-stats">
        {formatNumber(p.recipes.known)}/{formatNumber(p.recipes.seen)} recipes known ·{' '}
        {plural(p.crafts.casts, 'craft')} · {plural(p.gathering.opens, 'harvest')} ·{' '}
        {plural(p.trainers, 'trainer')} · {plural(p.vendors, 'recipe vendor')}
      </p>
    </article>
  );
}

function SkillRankCard({ prof }: { prof: ProfessionSummary }) {
  const palette = useChartPalette();
  const history = useAdminQuery<SkillHistory>(
    ['skill-history'],
    '/admin/api/professions/skill-history',
  );
  const name = professionName(prof);
  return (
    <Card title={`${name}: skill rank over time`}>
      <QueryState query={history}>
        {(h) => {
          const series = skillRankSeries(h, prof.skillLineId);
          if (series.length === 0) return <Empty>No skill-ups recorded for {name} yet.</Empty>;
          return (
            <>
              <Chart
                option={skillRankOption(series, palette)}
                height={260}
                label={`${name} rank over time for ${plural(series.length, 'character')}`}
              />
              <ul className="muted small inline-list">
                {series.map((s) => {
                  const last = s.data[s.data.length - 1]!;
                  return (
                    <li key={s.char}>
                      {s.char}: {plural(s.data.length, 'rise')}, rank {last[1]} on{' '}
                      {formatChicagoShort(last[0])}
                    </li>
                  );
                })}
              </ul>
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

const craftCol = createColumnHelper<SortableFeatures, CraftRow>();
const craftColumns = craftCol.columns([
  craftCol.accessor((c) => c.name ?? `Recipe ${c.recipeId}`, { id: 'recipe', header: 'Recipe' }),
  craftCol.accessor('build', { header: 'Build' }),
  craftCol.accessor('casts', { header: 'Crafts', sortFn: 'basic' }),
  craftCol.accessor('qty', {
    header: 'Made',
    sortFn: 'basic',
    cell: (c) => (
      <span>
        {formatNumber(c.getValue())}
        {c.row.original.outputItemName && (
          <span className="muted small"> {c.row.original.outputItemName}</span>
        )}
      </span>
    ),
  }),
  craftCol.accessor('procs', { header: 'Procs', sortFn: 'basic' }),
  craftCol.accessor((c) => (c.casts > 0 ? c.procs / c.casts : -1), {
    id: 'procRate',
    header: 'Proc rate',
    sortFn: 'basic',
    cell: (c) => percent(c.row.original.procs, c.row.original.casts),
  }),
  craftCol.accessor('skillUps', { header: 'Skill-ups', sortFn: 'basic' }),
  craftCol.accessor('sessions', { header: 'Sessions', sortFn: 'basic' }),
]);

function CraftsCard({ prof }: { prof: ProfessionSummary }) {
  const crafts = useAdminQuery<{ items: CraftRow[] }>(
    ['crafts', prof.skillLineId],
    `/admin/api/professions/crafts?skillLine=${prof.skillLineId}`,
  );
  return (
    <Card title={`${professionName(prof)} crafts`}>
      <QueryState query={crafts}>
        {({ items }) => (
          <DataTable
            data={items}
            columns={craftColumns}
            rowKey={(c) => `${c.recipeId}-${c.build}`}
            empty="No crafts recorded yet."
          />
        )}
      </QueryState>
      <p className="muted small">
        Summed over sessions per build. Procs: crafts the client reported as a bonus result
        (multicraft or crit).
      </p>
    </Card>
  );
}
