import './echartsExtra';
import '../professions/professions.css';
import type { ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { ClassBadge } from '../../components/ClassBadge';
import { Kpi } from '../../components/Kpi';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatChicago } from '../../lib/time';
import { mobLabel } from '../loot/lootLib';
import { ItemName } from '../loot/parts';
import {
  bossSplits,
  bossTimelineOption,
  charName,
  formatDuration,
  instanceLabel,
  perMinute,
  pickTab,
  rowsChartHeight,
  runTabs,
} from './runLib';
import type { BossLike } from './runLib';
import type { RunGroupDetail, RunPerspective } from './types';

/**
 * One dungeon run group, from any member's run id. A run several party members uploaded gets a Group tab (merged
 * bosses and boss loot, every member's own loot) and one tab per member's own run; a run nobody else uploaded is shown
 * as it is. The tab is kept in `?view=` (the member's run id).
 */
export function RunPage() {
  const { id = '' } = useParams();
  const run = useAdminQuery<RunGroupDetail>(
    ['run', id],
    `/admin/api/runs/${encodeURIComponent(id)}`,
    { enabled: id !== '' },
  );
  return (
    <div className="page">
      <p className="small">
        <Link to="/dungeons">← Dungeons</Link>
      </p>
      <QueryState query={run}>{(g) => <RunGroup g={g} />}</QueryState>
    </div>
  );
}

function RunGroup({ g }: { g: RunGroupDetail }) {
  const [params, setParams] = useSearchParams();
  const tabs = runTabs(g.perspectives);
  if (tabs.length === 0) return <Run r={g.perspectives[0]!} />;
  const tab = pickTab(tabs, params.get('view'));
  const member = g.perspectives.find((p) => p.id === tab);
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Group or member view">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`tab-${t.key}`}
            aria-selected={tab === t.key}
            aria-controls="run-panel"
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() =>
              setParams(
                (p) => {
                  const next = new URLSearchParams(p);
                  if (t.key === 'group') next.delete('view');
                  else next.set('view', t.key);
                  return next;
                },
                { replace: true },
              )
            }
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="tab-panel" role="tabpanel" id="run-panel" aria-labelledby={`tab-${tab}`}>
        {member ? <Run r={member} /> : <Group g={g} />}
      </div>
    </>
  );
}

function RunHead({
  instanceId,
  instance,
  build,
  difficulty,
  maxPlayers,
  lootMethod,
  who,
  startedAt,
  finishedAt,
  endReason,
}: {
  instanceId: number;
  instance: string | null;
  build: number;
  difficulty: number | null;
  maxPlayers: number | null;
  lootMethod: string | null;
  who: ReactNode;
  startedAt: string;
  finishedAt: string | null;
  endReason?: string | null;
}) {
  return (
    <header className="page-head">
      <h1>{instanceLabel(instanceId, instance)}</h1>
      <p className="muted">
        {who} · build {build}
        {difficulty !== null ? ` · difficulty ${difficulty}` : ''}
        {maxPlayers !== null ? ` · ${maxPlayers}-player` : ''}
        {lootMethod ? ` · loot: ${lootMethod}` : ''}
      </p>
      <p className="muted small">
        Started {formatChicago(startedAt, { seconds: true })} · finished{' '}
        {finishedAt ? formatChicago(finishedAt, { seconds: true }) : 'not yet'}
        {endReason ? ` (${endReason})` : ''}
      </p>
    </header>
  );
}

/** The merged view of a run group. */
function Group({ g }: { g: RunGroupDetail }) {
  const killed = g.bosses.filter((b) => b.killed).length;
  return (
    <>
      <RunHead
        {...g}
        who={
          <>
            {plural(g.members, 'member')}:{' '}
            {g.perspectives.map((p, i) => (
              <span key={p.id} className="nowrap" title={p.char}>
                {i > 0 ? ', ' : ''}
                {charName(p.char)} <ClassBadge cls={p.charClass} />
                {p.charLevel !== null ? ` ${p.charLevel}` : ''}
              </span>
            ))}
          </>
        }
      />
      <div className="kpis">
        <Kpi
          label="Clear time"
          value={formatDuration(g.activeSecs)}
          hint={`median of the members' active times · span ${formatDuration(g.spanSecs)}`}
        />
        <Kpi label="Members" value={formatNumber(g.members)} hint="uploaded this run" />
        <Kpi
          label="Deaths"
          value={formatNumber(g.deaths)}
          hint="all members"
          tone={g.deaths > 0 ? 'warn' : undefined}
        />
        <Kpi label="Bosses killed" value={`${killed}/${g.bosses.length}`} />
      </div>
      <div className="grid-2">
        <BossesCard bosses={g.bosses} note="Earliest member's time per boss." />
        <Card title={`Members' own loot (${g.loot.length})`}>
          <LootList
            loot={g.loot}
            build={g.build}
            who={(l) => <span className="muted small">{charName(l.char)}: </span>}
          />
        </Card>
      </div>
      <BossLootCard
        rows={g.bossLoot}
        winner={(b) =>
          b.winnerChar ? <span className="muted small"> ({charName(b.winnerChar)})</span> : null
        }
        note="The same drop seen by several members is listed once."
      />
      <p className="muted small">
        Group loot (loot messages) is in each member&apos;s tab: the messages carry no time to match
        them across members.
      </p>
    </>
  );
}

/** One member's own run. */
function Run({ r }: { r: RunPerspective }) {
  const xpMin = perMinute(r.xpTotal, r.activeSecs);
  return (
    <>
      <RunHead
        {...r}
        who={
          <>
            {r.char} <ClassBadge cls={r.charClass} />
            {r.charLevel !== null ? ` level ${r.charLevel}` : ''}
          </>
        }
      />
      <div className="kpis">
        <Kpi
          label="Active time"
          value={formatDuration(r.activeSecs)}
          hint={`away ${formatDuration(r.awaySecs)}`}
        />
        <Kpi
          label="XP"
          value={formatNumber(r.xpTotal)}
          hint={`${formatNumber(r.mobXp)} mobs · ${formatNumber(r.questXp)} quests`}
        />
        <Kpi
          label="XP per minute"
          value={xpMin ?? '—'}
          hint={`mobs ${perMinute(r.mobXp, r.activeSecs) ?? '—'} · quests ${perMinute(r.questXp, r.activeSecs) ?? '—'}`}
        />
        <Kpi
          label="Deaths"
          value={formatNumber(r.deaths)}
          tone={r.deaths > 0 ? 'warn' : undefined}
        />
        <Kpi
          label="Bosses killed"
          value={`${r.bosses.filter((b) => b.killed).length}/${r.bosses.length}`}
        />
      </div>
      <div className="grid-2">
        <BossesCard bosses={r.bosses} />
        <PartyCard r={r} />
      </div>
      <div className="grid-2">
        <Card title={`Your loot (${r.loot.length})`}>
          <LootList loot={r.loot} build={r.build} />
        </Card>
        <GroupLootCard r={r} />
      </div>
      <BossLootCard
        rows={r.bossLoot}
        winner={(b) => (b.winnerIsSelf ? <span className="muted small"> (you)</span> : null)}
      />
    </>
  );
}

function BossesCard({ bosses, note }: { bosses: BossLike[]; note?: string }) {
  const palette = useChartPalette();
  const splits = bossSplits(bosses);
  return (
    <Card title="Boss splits">
      {splits.length === 0 ? (
        <Empty>No boss encounters recorded.</Empty>
      ) : (
        <>
          <Chart
            option={bossTimelineOption(splits, palette)}
            height={rowsChartHeight(splits.length)}
            label={`Boss timeline: ${splits.map((s) => `${s.name} at ${formatDuration(s.atSecs)}`).join(', ')}`}
          />
          <table className="data compact">
            <thead>
              <tr>
                <th>#</th>
                <th>Boss</th>
                <th>At</th>
                <th>Split</th>
              </tr>
            </thead>
            <tbody>
              {splits.map((s) => (
                <tr key={s.ord} className={s.killed ? undefined : 'dim'}>
                  <td>{s.ord}</td>
                  <td>
                    {s.name}
                    {!s.killed && <span className="muted small"> (not killed)</span>}
                  </td>
                  <td>{formatDuration(s.atSecs)}</td>
                  <td>{formatDuration(s.splitSecs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="muted small">{note}</p>}
        </>
      )}
    </Card>
  );
}

function PartyCard({ r }: { r: RunPerspective }) {
  return (
    <Card title={`Party (${plural(r.party.length, 'member')} besides you)`}>
      {r.party.length === 0 ? (
        <Empty>Solo, or no party recorded.</Empty>
      ) : (
        <ul className="plain party">
          {r.party.map((p) => (
            <li key={p.slot}>
              <ClassBadge cls={p.class} /> <span className="muted">level {p.level ?? '?'}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function LootList<L extends RunPerspective['loot'][number]>({
  loot,
  build,
  who,
}: {
  loot: L[];
  build: number;
  who?: (l: L) => ReactNode;
}) {
  if (loot.length === 0) return <Empty>Nothing looted.</Empty>;
  return (
    <ul className="plain">
      {loot.map((l, i) => (
        <li key={i}>
          {who?.(l)}
          <ItemName itemId={l.itemId} name={l.name} quality={l.quality} />{' '}
          {l.npcId !== null && (
            <span className="muted small">
              from{' '}
              <Link to={`/loot?npc=${l.npcId}&build=${build}`}>{mobLabel(l.npcId, l.npcName)}</Link>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function GroupLootCard({ r }: { r: RunPerspective }) {
  return (
    <Card title="Group loot (loot messages)">
      {r.groupLoot.length === 0 ? (
        <Empty>None recorded (only while grouped).</Empty>
      ) : (
        <ul className="plain">
          {r.groupLoot.map((g, i) => (
            <li key={i}>
              {g.by === 'self' ? (
                <span className="pill neutral">you</span>
              ) : (
                <ClassBadge cls={g.class} />
              )}{' '}
              <ItemName itemId={g.itemId} name={g.name} quality={g.quality} />
              {g.qty !== null && g.qty > 1 ? ` ×${g.qty}` : ''}
              {g.won && <span className="muted small"> (won roll)</span>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

type BossDropRow = RunGroupDetail['bossLoot'][number] | RunPerspective['bossLoot'][number];

function BossLootCard<B extends BossDropRow>({
  rows,
  winner,
  note,
}: {
  rows: B[];
  /** What follows the winner's class badge (who it was). */
  winner: (b: B) => ReactNode;
  note?: string;
}) {
  return (
    <Card title="Boss loot and rolls">
      {rows.length === 0 ? (
        <Empty>No boss loot history recorded.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Boss</th>
                <th>Item</th>
                <th>Winner</th>
                <th>Rolls</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((b, i) => (
                <tr key={i}>
                  <td>
                    {b.bossName ?? (b.encounterId !== null ? `Encounter ${b.encounterId}` : '—')}
                  </td>
                  <td>
                    <ItemName itemId={b.itemId} name={b.name} quality={b.quality} />
                    {b.qty !== null && b.qty > 1 ? ` ×${b.qty}` : ''}
                  </td>
                  <td>
                    {b.allPassed ? (
                      <span className="muted">everyone passed</span>
                    ) : b.winnerClass ? (
                      <>
                        <ClassBadge cls={b.winnerClass} />
                        {winner(b)}
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="small">
                    {b.rolls.length === 0
                      ? '—'
                      : b.rolls.map((roll, j) => (
                          <span key={j} className="roll">
                            <ClassBadge cls={roll.class} /> {roll.state ?? '?'}
                            {roll.roll !== null ? ` ${roll.roll}` : ''}
                          </span>
                        ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {note && <p className="muted small">{note}</p>}
        </div>
      )}
    </Card>
  );
}
