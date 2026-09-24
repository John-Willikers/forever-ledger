import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { useAdminQuery } from '../../api';
import { Chart, useChartPalette } from '../../components/Chart';
import { Empty, QueryState } from '../../components/State';
import { classColor } from '../../lib/classes';
import { formatNumber, plural } from '../../lib/format';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { characterPath } from '../characters/timelineLib';
import { ForeverBadge } from './ForeverBadge';
import {
  formatLoc,
  formatMoney,
  npcLocationGroups,
  npcLocationOption,
  pickBarOption,
  pickChartHeight,
  picksFor,
} from './questLib';
import './registerScatter';
import type { QuestDetail, QuestObservationRow, QuestTurnIn } from './types';

/** One quest's detail in a side drawer: Escape, the close button or the backdrop close it. */
export function QuestDrawer({ id, onClose }: { id: number; onClose: () => void }) {
  const detail = useAdminQuery<QuestDetail>(['quest', id], `/admin/api/quests/${id}`);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus moves into the drawer when a quest opens; Escape closes it.
  useEffect(() => {
    closeRef.current?.focus();
  }, [id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const titleId = `quest-drawer-title-${id}`;
  return (
    <div className="drawer-root">
      <div className="drawer-backdrop" onClick={onClose} aria-hidden />
      <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={titleId}>
        <header className="drawer-head">
          <h2 id={titleId}>
            {detail.data?.quest.title ?? `Quest ${id}`}
            {detail.data?.quest.foreverOnly && <ForeverBadge />}
          </h2>
          <button
            ref={closeRef}
            type="button"
            className="secondary small"
            onClick={onClose}
            aria-label="Close quest details"
          >
            Close
          </button>
        </header>
        <QueryState query={detail}>{(d) => <DetailBody key={d.quest.questId} d={d} />}</QueryState>
      </aside>
    </div>
  );
}

function DetailBody({ d }: { d: QuestDetail }) {
  const [picked, setPicked] = useState<number | null>(null);
  const build = picked !== null && d.builds.includes(picked) ? picked : (d.builds[0] ?? null);
  const q = d.quest;
  const observations = d.observations.filter((o) => o.build === build);
  const turnIns = d.turnIns.filter((t) => t.build === build);
  const fixed = d.rewards.filter((r) => r.build === build && r.kind === 'reward');
  return (
    <div className="drawer-body">
      <p className="muted small">
        #{q.questId}
        {q.category && <> · {q.category}</>}
        {q.level !== null && <> · level {q.level}</>}
        {q.suggestedGroup ? <> · group of {q.suggestedGroup}</> : null}
      </p>
      {q.objectives.length > 0 && (
        <ul className="objectives small">
          {q.objectives.map((o, i) => (
            <li key={i}>{o}</li>
          ))}
        </ul>
      )}
      {d.builds.length > 1 ? (
        <label className="small muted">
          Build{' '}
          <select value={build ?? ''} onChange={(e) => setPicked(Number(e.target.value))}>
            {d.builds.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <p className="small muted">Build {build ?? '—'}</p>
      )}

      <section>
        <h3>Reward pick popularity</h3>
        <Picks d={d} build={build} />
        {fixed.length > 0 && (
          <p className="small">
            Always rewarded:{' '}
            {fixed
              .map(
                (r) =>
                  `${r.name ?? `item ${r.itemId}`}${r.count && r.count > 1 ? ` ×${r.count}` : ''}`,
              )
              .join(', ')}
          </p>
        )}
      </section>

      <section>
        <h3>Giver and ender locations</h3>
        <Locations observations={observations} />
      </section>

      <section>
        <h3>Observations ({observations.length})</h3>
        <Observations list={observations} />
      </section>

      <section>
        <h3>
          Turn-ins ({turnIns.length}
          {d.turnInsTotal > d.turnIns.length
            ? `, newest ${d.turnIns.length} of ${d.turnInsTotal} loaded`
            : ''}
          )
        </h3>
        <TurnIns list={turnIns} />
      </section>
    </div>
  );
}

function Picks({ d, build }: { d: QuestDetail; build: number | null }) {
  const palette = useChartPalette();
  const picks = build === null ? [] : picksFor(d.rewards, build);
  if (picks.length === 0) return <Empty>No reward choices seen in this build.</Empty>;
  const total = picks.reduce((n, p) => n + p.picks, 0);
  return (
    <>
      <Chart
        option={pickBarOption(picks, palette)}
        height={pickChartHeight(picks.length)}
        label={`Reward picks: ${picks.map((p) => `${p.name} ${p.picks}`).join(', ')}`}
      />
      <p className="muted small">
        {total === 0
          ? 'Nobody has turned it in with a choice yet.'
          : `${plural(total, 'pick')} from turn-ins that recorded the chosen reward.`}
      </p>
    </>
  );
}

function Locations({ observations }: { observations: QuestObservationRow[] }) {
  const palette = useChartPalette();
  const groups = npcLocationGroups(observations);
  if (groups.length === 0) return <Empty>No NPC locations recorded in this build.</Empty>;
  return (
    <div className="loc-grid">
      {groups.map((g) => (
        <figure key={g.zone} className="loc-plot">
          <figcaption className="small">{g.zone}</figcaption>
          <Chart
            option={npcLocationOption(g, palette)}
            height={260}
            label={`${g.zone}: givers ${g.givers.map((p) => `${p.name} (${p.x}, ${p.y})`).join(', ') || 'none'}; enders ${g.enders.map((p) => `${p.name} (${p.x}, ${p.y})`).join(', ') || 'none'}`}
          />
        </figure>
      ))}
    </div>
  );
}

function CharCell({ char, cls }: { char: string; cls: string | null }) {
  return (
    <Link
      to={characterPath(char)}
      className="char-link"
      style={{ borderLeftColor: classColor(cls) }}
    >
      {char}
    </Link>
  );
}

function When({ at }: { at: string | null }) {
  return at ? (
    <span className="nowrap" title={formatChicago(at, { seconds: true })}>
      {formatChicagoShort(at)}
    </span>
  ) : (
    <>—</>
  );
}

function Observations({ list }: { list: QuestObservationRow[] }) {
  if (list.length === 0) return <Empty>None in this build.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr>
            <th>Stage</th>
            <th>Character</th>
            <th>Level</th>
            <th>XP</th>
            <th>Money</th>
            <th>NPC</th>
            <th>Where</th>
            <th>Seen</th>
          </tr>
        </thead>
        <tbody>
          {list.map((o) => (
            <tr key={`${o.stage}:${o.char}`}>
              <td>{o.stage}</td>
              <td>
                <CharCell char={o.char} cls={o.class} />
              </td>
              <td>{o.level ?? '—'}</td>
              <td>{formatNumber(o.xp)}</td>
              <td className="nowrap">{formatMoney(o.money)}</td>
              <td>
                {o.npc ? (
                  <>
                    {o.npc.name ?? 'unnamed'}
                    {o.npc.id !== null && <span className="muted small"> #{o.npc.id}</span>}
                  </>
                ) : (
                  '—'
                )}
              </td>
              <td className="small">{formatLoc(o.npc?.loc ?? o.loc)}</td>
              <td>
                <When at={o.observedAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TurnIns({ list }: { list: QuestTurnIn[] }) {
  if (list.length === 0) return <Empty>No turn-ins in this build.</Empty>;
  return (
    <div className="table-wrap">
      <table className="data compact">
        <thead>
          <tr>
            <th>Character</th>
            <th>Level</th>
            <th>XP paid</th>
            <th>Money</th>
            <th>Choice</th>
            <th>Turned in</th>
          </tr>
        </thead>
        <tbody>
          {list.map((t) => (
            <tr key={`${t.char}:${t.turnedInAt}`}>
              <td>
                <CharCell char={t.char} cls={t.class} />
              </td>
              <td>{t.level ?? '—'}</td>
              <td>{formatNumber(t.xp)}</td>
              <td className="nowrap">{formatMoney(t.money)}</td>
              <td>{t.choice ? (t.choice.name ?? `item ${t.choice.itemId}`) : '—'}</td>
              <td>
                <When at={t.turnedInAt} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
