import { createColumnHelper } from '@tanstack/react-table';
import { Link, useParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { ClassBadge } from '../../components/ClassBadge';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Kpi } from '../../components/Kpi';
import { Empty, QueryState } from '../../components/State';
import { Tabs } from '../../components/Tabs';
import { formatCompact, formatNumber, plural } from '../../lib/format';
import { formatChicago, formatChicagoShort, timeAgo } from '../../lib/time';
import { formatMoney } from '../../lib/money';
import './characters.css';
import {
  cumulativeXpOption,
  levelOverTimeOption,
  levelSpan,
  perDayXpOption,
  skillsFor,
} from './timelineLib';
import type { CharacterSkills, CharacterTimeline, TimelineTurnIn } from './types';

/** One character, in tabs: level and quest XP over time and per day; quests turned in; professions. */
export function CharacterDetailPage() {
  const key = useParams().key ?? '';
  const timeline = useAdminQuery<CharacterTimeline>(
    ['character-timeline', key],
    `/admin/api/characters/${encodeURIComponent(key)}/timeline`,
  );
  return (
    <div className="page">
      <Link className="back-link" to="/characters">
        ← Characters
      </Link>
      <QueryState query={timeline}>{(t) => <Timeline charKey={key} t={t} />}</QueryState>
    </div>
  );
}

function Timeline({ charKey, t }: { charKey: string; t: CharacterTimeline }) {
  const c = t.character;
  const span = levelSpan(t.levels);
  return (
    <>
      <header className="page-head">
        <div className="char-head">
          <h1>{c?.name ?? charKey}</h1>
          {c && <span className="muted">{c.realm}</span>}
          {c && <ClassBadge cls={c.class} />}
        </div>
        <p className="muted">
          {c ? (
            <>
              Level {c.level ?? '?'} {c.race ?? ''}
              {c.faction ? ` · ${c.faction}` : ''} · last seen{' '}
              {c.lastSeen ? (
                <time dateTime={c.lastSeen} title={formatChicago(c.lastSeen)}>
                  {timeAgo(c.lastSeen)} ({formatChicagoShort(c.lastSeen)})
                </time>
              ) : (
                'never'
              )}
            </>
          ) : (
            'Only seen in quest data (no character record uploaded yet).'
          )}
        </p>
      </header>
      <div className="kpis">
        <Kpi label="Quests turned in" value={formatNumber(t.totals.turnIns)} />
        <Kpi label="Quest XP" value={formatCompact(t.totals.questXp)} />
        <Kpi
          label="Levels seen"
          value={span ? (span.from === span.to ? span.from : `${span.from}–${span.to}`) : '—'}
        />
        <Kpi label="Days with quests" value={formatNumber(t.perDay.length)} />
      </div>
      <Tabs
        id="char"
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'quests', label: 'Quests turned in', count: t.totals.turnIns },
          { key: 'professions', label: 'Professions' },
        ]}
        label="Character sections"
      >
        {(key) =>
          key === 'quests' ? (
            <Card title="Quests turned in">
              <DataTable
                data={[...t.turnIns].reverse()}
                columns={turnInColumns}
                rowKey={(r) => `${r.questId}:${r.turnedInAt}`}
                initialSorting={[{ id: 'turnedInAt', desc: true }]}
                pageSize={50}
                empty="No quests turned in yet."
              />
            </Card>
          ) : key === 'professions' ? (
            <Professions charKey={charKey} />
          ) : (
            <>
              <div className="grid-2">
                <LevelCard t={t} />
                <XpCard t={t} />
              </div>
              <PerDayCard t={t} />
            </>
          )
        }
      </Tabs>
    </>
  );
}

function LevelCard({ t }: { t: CharacterTimeline }) {
  const palette = useChartPalette();
  const span = levelSpan(t.levels);
  return (
    <Card title="Level over time">
      {t.levels.length === 0 ? (
        <Empty>No levels recorded yet.</Empty>
      ) : (
        <>
          <Chart
            option={levelOverTimeOption(t.levels, palette)}
            height={260}
            label={`Level over time: ${span?.from} to ${span?.to} between ${formatChicagoShort(t.levels[0]!.at)} and ${formatChicagoShort(t.levels.at(-1)!.at)}`}
          />
          <p className="muted small">
            From quest windows, turn-ins and the character record; a level holds until the next one.
          </p>
        </>
      )}
    </Card>
  );
}

function XpCard({ t }: { t: CharacterTimeline }) {
  const palette = useChartPalette();
  return (
    <Card title="Quest XP over time">
      {t.turnIns.length === 0 ? (
        <Empty>No quests turned in yet.</Empty>
      ) : (
        <Chart
          option={cumulativeXpOption(t.turnIns, palette)}
          height={260}
          label={`Quest XP over time: ${formatNumber(t.totals.questXp)} XP from ${plural(t.totals.turnIns, 'quest')}`}
        />
      )}
    </Card>
  );
}

function PerDayCard({ t }: { t: CharacterTimeline }) {
  const palette = useChartPalette();
  if (t.perDay.length === 0) return null;
  return (
    <Card title="Quest XP per day">
      <Chart
        option={perDayXpOption(t.perDay, palette)}
        height={200}
        label={`Quest XP per day: ${t.perDay.map((d) => `${d.day} ${d.xp}`).join(', ')}`}
      />
    </Card>
  );
}

const col = createColumnHelper<SortableFeatures, TimelineTurnIn>();
const turnInColumns = col.columns([
  col.accessor((r) => Date.parse(r.turnedInAt), {
    id: 'turnedInAt',
    header: 'Turned in',
    sortFn: 'basic',
    cell: (c) => (
      <span className="nowrap" title={formatChicago(c.row.original.turnedInAt, { seconds: true })}>
        {formatChicagoShort(c.row.original.turnedInAt)}
      </span>
    ),
  }),
  col.accessor((r) => r.title ?? '', {
    id: 'quest',
    header: 'Quest',
    cell: (c) => (
      <Link to={`/quests?quest=${c.row.original.questId}`}>
        {c.row.original.title ?? `Quest ${c.row.original.questId}`}
      </Link>
    ),
  }),
  col.accessor((r) => r.level ?? -1, {
    id: 'level',
    header: 'Level',
    sortFn: 'basic',
    cell: (c) => c.row.original.level ?? '—',
  }),
  col.accessor((r) => r.xp ?? -1, {
    id: 'xp',
    header: 'XP',
    sortFn: 'basic',
    cell: (c) => formatNumber(c.row.original.xp),
  }),
  col.accessor((r) => r.money ?? -1, {
    id: 'money',
    header: 'Money',
    sortFn: 'basic',
    cell: (c) => <span className="nowrap">{formatMoney(c.row.original.money)}</span>,
  }),
  col.accessor('build', { header: 'Build', sortFn: 'basic' }),
]);

function Professions({ charKey }: { charKey: string }) {
  const skills = useAdminQuery<CharacterSkills[]>(
    ['professions-skills', charKey],
    `/v1/professions/skills?char=${encodeURIComponent(charKey)}`,
  );
  return (
    <Card
      title="Professions"
      actions={
        <Link to="/professions" className="small">
          All professions
        </Link>
      }
    >
      <QueryState query={skills}>
        {(all) => {
          const list = skillsFor(all, charKey);
          if (list.length === 0)
            return <Empty>No profession skills uploaded for this character.</Empty>;
          return (
            <ul className="skills">
              {list.map((p) => (
                <li key={p.skillLineId}>
                  <span>{p.name}</span>
                  <span className="skill-bar" aria-hidden>
                    <span
                      style={{
                        width: `${Math.min(100, (p.rank / Math.max(1, p.maxRank)) * 100)}%`,
                      }}
                    />
                  </span>
                  <span className="nowrap">
                    {p.rank} / {p.maxRank}
                  </span>
                </li>
              ))}
            </ul>
          );
        }}
      </QueryState>
    </Card>
  );
}
