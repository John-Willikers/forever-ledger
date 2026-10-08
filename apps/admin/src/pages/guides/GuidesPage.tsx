import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { postJson, useAdminQuery, useCsrf } from '../../api';
import { Card } from '../../components/Card';
import { Empty, ErrorState, QueryState } from '../../components/State';
import { formatChicagoShort } from '../../lib/time';
import { charName, guideRequest, stepDo, stepPlace } from './lib';
import type { BuiltGuide, GuideForm, GuideRow } from './types';
import './guides.css';

const API = '/admin/api/guides';
const LIST_KEY = ['guides'] as const;

/**
 * In-game guides (project-plans/forever-ledger-guides.md): planned for the character by the route planner (when it has
 * stored state) or built from a guildie's real run; preview it, send it to the tray that uploads the character; the
 * player /reloads and follows it with /fl guide.
 */
export function GuidesPage() {
  const list = useAdminQuery<{ items: GuideRow[] }>(LIST_KEY, API);
  return (
    <div className="page">
      <header className="page-head">
        <h1>Guides</h1>
        <p className="muted">
          A character whose addon stores its state (0.8.0) gets a guide planned for it by the route
          planner, travel included; otherwise (or when you name a run to follow) a guildie&apos;s
          real run is turned into Zygor-style steps. It goes to the tray that uploads the character;
          the player types /reload in game, then /fl guide. Quests the character already turned in
          are left out.
        </p>
      </header>
      <BuildCard />
      <Card title="Sent guides">
        <QueryState query={list}>
          {({ items }) =>
            items.length === 0 ? <Empty>No guides sent yet.</Empty> : <GuidesTable rows={items} />
          }
        </QueryState>
      </Card>
    </div>
  );
}

function BuildCard() {
  const csrf = useCsrf();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<GuideForm>({
    character: '',
    start: '',
    basedOn: '',
    toLevel: '',
    fromLevel: '',
  });
  const [problem, setProblem] = useState<string | null>(null);
  const build = useMutation({
    mutationFn: (body: Record<string, unknown>) => postJson<BuiltGuide>(API, csrf, body),
    onSuccess: (made) => {
      if (made?.id) void queryClient.invalidateQueries({ queryKey: LIST_KEY });
    },
  });
  const run = (preview: boolean) => (e?: FormEvent) => {
    e?.preventDefault();
    const req = guideRequest(form);
    if (!req.ok) {
      setProblem(req.problem);
      return;
    }
    setProblem(null);
    build.mutate({ ...req.body, preview });
  };
  const field = (key: keyof GuideForm, label: string, placeholder: string, size = '12rem') => (
    <label style={{ flexBasis: size }}>
      {label}
      <input
        value={form[key]}
        placeholder={placeholder}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
      />
    </label>
  );
  const made = build.data;
  return (
    <Card title="Build a guide">
      <form className="mint" onSubmit={run(true)} noValidate>
        {field('character', 'For character', 'Sam Willikers')}
        {field('start', 'Start (race or zone)', 'undead')}
        {field('basedOn', "Or follow this character's run", 'Timbo')}
        {field('fromLevel', 'From level', 'their level', '6rem')}
        {field('toLevel', 'To level', '13', '6rem')}
        <button type="submit" className="secondary" disabled={build.isPending}>
          Preview
        </button>
        <button type="button" disabled={build.isPending} onClick={run(false)}>
          {build.isPending ? 'Working…' : 'Send to their tray'}
        </button>
      </form>
      {problem && <p className="field-error">{problem}</p>}
      {build.isError && <ErrorState error={build.error} />}
      {made && (
        <div className="guide-result">
          <p>
            <strong>{made.title}</strong> for {made.character}: {made.steps} steps{' '}
            {made.planned
              ? `planned by the route planner${made.minutes !== undefined ? ` (about ${made.minutes} min)` : ''}${made.reachedTarget ? '' : ' (it runs out of quests before that level)'}`
              : `from ${made.basedOn}'s run${made.reachedTarget ? '' : ' (they never reached that level: the guide stops where they did)'}`}
            .{' '}
            {made.id
              ? 'Sent: their tray picks it up within about 5 minutes.'
              : made.tray
                ? 'Preview only: nothing was sent.'
                : 'Preview only: no tray uploads this character, so it could not be sent.'}
          </p>
          {made.planned && made.gaps.length > 0 && (
            <ul className="muted guide-gaps">
              {made.gaps.map((g, i) => (
                <li key={i}>{g}</li>
              ))}
            </ul>
          )}
          <StepsTable steps={made.doc.steps} />
        </div>
      )}
    </Card>
  );
}

function StepsTable({ steps }: { steps: BuiltGuide['doc']['steps'] }) {
  return (
    <table className="data compact guide-steps">
      <thead>
        <tr>
          <th>#</th>
          <th>Do</th>
          <th>Where</th>
          <th>Quests</th>
        </tr>
      </thead>
      <tbody>
        {steps.map((s, i) => (
          <tr key={i}>
            <td className="step-no">{i + 1}</td>
            <td className="nowrap">{stepDo(s)}</td>
            <td>{stepPlace(s)}</td>
            <td>
              {s.quests.map((q) => (
                <div key={q.questId}>
                  {q.title ?? `Quest ${q.questId}`}
                  {q.objectives?.length ? (
                    <ul className="objectives">
                      {q.objectives.map((o) => (
                        <li key={o}>{o}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GuidesTable({ rows }: { rows: GuideRow[] }) {
  const csrf = useCsrf();
  const queryClient = useQueryClient();
  const remove = useMutation({
    mutationFn: (id: number) => postJson(`${API}/${id}/delete`, csrf),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: LIST_KEY }),
  });
  return (
    <>
      {remove.isError && <ErrorState error={remove.error} />}
      <table className="data compact">
        <thead>
          <tr>
            <th>Character</th>
            <th>Guide</th>
            <th>Steps</th>
            <th>Sent by</th>
            <th>Sent</th>
            <th>In game</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((g) => (
            <tr key={g.id}>
              <td className="nowrap">{charName(g.char)}</td>
              <td>
                {g.title}
                <span
                  className={g.planned ? 'pill' : 'pill neutral'}
                  title={
                    g.planned
                      ? 'Planned for the character by the route planner'
                      : "Follows one of our players' runs"
                  }
                >
                  {g.planned ? 'planned' : 'run'}
                </span>
              </td>
              <td>{g.steps}</td>
              <td className="muted">{g.requestedBy}</td>
              <td className="nowrap">{formatChicagoShort(g.createdAt)}</td>
              <td className="nowrap">
                {g.deliveredAt
                  ? `written ${formatChicagoShort(g.deliveredAt)}`
                  : 'waiting for their tray'}
              </td>
              <td>
                <button
                  type="button"
                  className="small danger"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(g.id)}
                  title="Their tray removes it from the game at its next check"
                >
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
