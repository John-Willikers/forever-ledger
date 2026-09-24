import './echartsExtra';
import { Link, useParams } from 'react-router';
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
  formatDuration,
  instanceLabel,
  perMinute,
  rowsChartHeight,
} from './runLib';
import type { RunDetail } from './types';

/** One dungeon run: times, XP, the boss split timeline, loot, boss loot rolls and the party. */
export function RunPage() {
  const { id = '' } = useParams();
  const run = useAdminQuery<RunDetail>(['run', id], `/admin/api/runs/${encodeURIComponent(id)}`, {
    enabled: id !== '',
  });
  return (
    <div className="page">
      <p className="small">
        <Link to="/dungeons">← Dungeons</Link>
      </p>
      <QueryState query={run}>{(r) => <Run r={r} />}</QueryState>
    </div>
  );
}

function Run({ r }: { r: RunDetail }) {
  const xpMin = perMinute(r.xpTotal, r.activeSecs);
  return (
    <>
      <header className="page-head">
        <h1>{instanceLabel(r.instanceId, r.instance)}</h1>
        <p className="muted">
          {r.char} <ClassBadge cls={r.charClass} />
          {r.charLevel !== null ? ` level ${r.charLevel}` : ''} · build {r.build}
          {r.difficulty !== null ? ` · difficulty ${r.difficulty}` : ''}
          {r.maxPlayers !== null ? ` · ${r.maxPlayers}-player` : ''}
          {r.lootMethod ? ` · loot: ${r.lootMethod}` : ''}
        </p>
        <p className="muted small">
          Started {formatChicago(r.startedAt, { seconds: true })} · finished{' '}
          {r.finishedAt ? formatChicago(r.finishedAt, { seconds: true }) : 'not yet'}
          {r.endReason ? ` (${r.endReason})` : ''}
        </p>
      </header>
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
        <BossesCard r={r} />
        <PartyCard r={r} />
      </div>
      <div className="grid-2">
        <LootCard r={r} />
        <GroupLootCard r={r} />
      </div>
      <BossLootCard r={r} />
    </>
  );
}

function BossesCard({ r }: { r: RunDetail }) {
  const palette = useChartPalette();
  const splits = bossSplits(r.bosses);
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
        </>
      )}
    </Card>
  );
}

function PartyCard({ r }: { r: RunDetail }) {
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

function LootCard({ r }: { r: RunDetail }) {
  return (
    <Card title={`Your loot (${r.loot.length})`}>
      {r.loot.length === 0 ? (
        <Empty>Nothing looted.</Empty>
      ) : (
        <ul className="plain">
          {r.loot.map((l, i) => (
            <li key={i}>
              <ItemName itemId={l.itemId} name={l.name} quality={l.quality} />{' '}
              {l.npcId !== null && (
                <span className="muted small">
                  from{' '}
                  <Link to={`/loot?npc=${l.npcId}&build=${r.build}`}>
                    {mobLabel(l.npcId, l.npcName)}
                  </Link>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function GroupLootCard({ r }: { r: RunDetail }) {
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

function BossLootCard({ r }: { r: RunDetail }) {
  return (
    <Card title="Boss loot and rolls">
      {r.bossLoot.length === 0 ? (
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
              {r.bossLoot.map((b, i) => (
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
                        {b.winnerIsSelf && <span className="muted small"> (you)</span>}
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
        </div>
      )}
    </Card>
  );
}
