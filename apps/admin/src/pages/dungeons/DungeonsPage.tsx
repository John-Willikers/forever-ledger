import './echartsExtra';
import { keepPreviousData } from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { ClassBadge } from '../../components/ClassBadge';
import { Pager } from '../../components/Pager';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { BuildSelect } from '../loot/parts';
import {
  charName,
  clearTimeOption,
  formatDuration,
  instanceLabel,
  rowsChartHeight,
  xpRateOption,
} from './runLib';
import type { ClearTimes } from './runLib';
import type { RunMember, RunSummary, RunsPage } from './types';

const PAGE = 50;

/** A run group's members: character, class badge and level, one per line. */
function Members({ members }: { members: RunMember[] }) {
  return (
    <ul className="plain">
      {members.map((m) => (
        <li key={m.id} className="nowrap" title={m.char}>
          {charName(m.char)} <ClassBadge cls={m.charClass} />
          {m.charLevel !== null && <span className="muted small"> L{m.charLevel}</span>}
        </li>
      ))}
    </ul>
  );
}

/** Runs per instance: clear times, XP per minute (mob vs quest), deaths; the runs table links to each run. */
export function DungeonsPage() {
  const [build, setBuild] = useState<number | null>(null);
  const q = build === null ? '' : `?build=${build}`;
  const summary = useAdminQuery<RunSummary[]>(['runs-summary', build], `/v1/runs/summary${q}`);
  const clear = useAdminQuery<ClearTimes[]>(
    ['clear-times', build],
    `/admin/api/dungeons/clear-times${q}`,
  );
  return (
    <div className="page">
      <header className="page-head">
        <h1>Dungeons</h1>
        <p className="muted">
          Finished runs per instance and build. A run several party members uploaded counts once (a
          run group); its clear time is the median of the members' active times (away time
          excluded). XP per minute counts every member. Times are America/Chicago.
        </p>
      </header>
      <div className="filters">
        <BuildSelect value={build} onChange={setBuild} />
      </div>
      <QueryState query={summary}>{(s) => <SummaryCard rows={s} />}</QueryState>
      <div className="grid-2">
        <ClearTimesCard query={clear} />
        <QueryState query={summary}>{(s) => <XpRateCard rows={s} />}</QueryState>
      </div>
      <RunsCard key={build ?? 'all'} build={build} />
    </div>
  );
}

function SummaryCard({ rows }: { rows: RunSummary[] }) {
  return (
    <Card title="Per instance">
      {rows.length === 0 ? (
        <Empty>No finished runs yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Instance</th>
                <th>Build</th>
                <th>Runs</th>
                <th>Median clear</th>
                <th>Best clear</th>
                <th>XP/min</th>
                <th>Mob / quest XP/min</th>
                <th>Avg deaths</th>
                <th>Avg level</th>
                <th>Bosses (median kill time)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.instanceId}-${r.build}`}>
                  <td>{instanceLabel(r.instanceId, r.instance)}</td>
                  <td>{r.build}</td>
                  <td className="nowrap">
                    {formatNumber(r.finishedRuns)}
                    {r.members > r.finishedRuns && (
                      <span className="muted small"> ({plural(r.members, 'member')})</span>
                    )}
                  </td>
                  <td>{formatDuration(r.medianActiveSecs)}</td>
                  <td>{formatDuration(r.bestActiveSecs)}</td>
                  <td>{r.xpPerMinute ?? '—'}</td>
                  <td className="nowrap">
                    {r.mobXpPerMinute ?? '—'} / {r.questXpPerMinute ?? '—'}
                  </td>
                  <td>{r.avgDeaths ?? '—'}</td>
                  <td>{r.avgCharLevel ?? '—'}</td>
                  <td className="small">
                    {r.bosses.length === 0
                      ? '—'
                      : r.bosses.map((b, i) => (
                          <div key={i} className="nowrap">
                            {b.name ?? 'Unknown'} {formatDuration(b.medianAtSecs)}
                          </div>
                        ))}
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

function ClearTimesCard({ query }: { query: UseQueryResult<ClearTimes[], Error> }) {
  const palette = useChartPalette();
  return (
    <Card title="Clear-time distribution">
      <QueryState query={query}>
        {(rows) => {
          const runs = rows.reduce((n, r) => n + r.runs.length, 0);
          if (runs === 0) return <Empty>No finished runs yet.</Empty>;
          return (
            <>
              <Chart
                option={clearTimeOption(rows, palette)}
                height={rowsChartHeight(rows.length)}
                label={`Clear times of ${runs} finished runs over ${plural(rows.length, 'instance')}`}
              />
              <p className="muted small">
                One dot per finished run group (median member active minutes).
              </p>
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

function XpRateCard({ rows }: { rows: RunSummary[] }) {
  const palette = useChartPalette();
  return (
    <Card title="XP per active minute: mobs vs quests">
      {rows.length === 0 ? (
        <Empty>No finished runs yet.</Empty>
      ) : (
        <Chart
          option={xpRateOption(rows, palette)}
          height={260}
          label={`XP per minute from mobs and quests for ${plural(rows.length, 'instance')}`}
        />
      )}
    </Card>
  );
}

function RunsCard({ build }: { build: number | null }) {
  const [instance, setInstance] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (build !== null) qs.set('build', String(build));
  if (instance !== null) qs.set('instance', String(instance));
  const runs = useAdminQuery<RunsPage>(['runs', qs.toString()], `/admin/api/runs?${qs}`, {
    placeholderData: keepPreviousData,
  });
  return (
    <Card
      title="Runs"
      actions={
        <label className="small">
          Instance{' '}
          <select
            value={instance ?? ''}
            onChange={(e) => {
              setInstance(e.target.value === '' ? null : Number(e.target.value));
              setOffset(0);
            }}
          >
            <option value="">All</option>
            {(runs.data?.instances ?? []).map((i) => (
              <option key={i.instanceId} value={i.instanceId}>
                {instanceLabel(i.instanceId, i.instance)} ({i.runs})
              </option>
            ))}
          </select>
        </label>
      }
    >
      <QueryState query={runs}>
        {(page) =>
          page.items.length === 0 ? (
            <Empty>No runs.</Empty>
          ) : (
            <>
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th>Started</th>
                      <th>Members</th>
                      <th>Instance</th>
                      <th>Build</th>
                      <th>Active</th>
                      <th>Away</th>
                      <th>XP per member (mob / quest)</th>
                      <th>Deaths</th>
                      <th>Bosses</th>
                      <th>Loot</th>
                    </tr>
                  </thead>
                  <tbody>
                    {page.items.map((r) => (
                      <tr key={r.id} className={r.finishedAt ? undefined : 'dim'}>
                        <td className="nowrap">
                          <Link
                            to={`/dungeons/runs/${encodeURIComponent(r.id)}`}
                            title={formatChicago(r.startedAt)}
                          >
                            {formatChicagoShort(r.startedAt)}
                          </Link>
                        </td>
                        <td>
                          <Members members={r.members} />
                        </td>
                        <td>{instanceLabel(r.instanceId, r.instance)}</td>
                        <td>{r.build}</td>
                        <td>{formatDuration(r.activeSecs)}</td>
                        <td>{formatDuration(r.awaySecs)}</td>
                        <td className="nowrap">
                          {formatNumber(r.xpTotal)}{' '}
                          <span className="muted small">
                            ({formatNumber(r.mobXp)} / {formatNumber(r.questXp)})
                          </span>
                        </td>
                        <td>{formatNumber(r.deaths)}</td>
                        <td>
                          {r.bosses.killed}/{r.bosses.total}
                        </td>
                        <td>{formatNumber(r.loot)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <Pager
                total={page.total}
                limit={page.limit}
                offset={page.offset}
                onOffset={setOffset}
                busy={runs.isFetching}
              />
            </>
          )
        }
      </QueryState>
    </Card>
  );
}
