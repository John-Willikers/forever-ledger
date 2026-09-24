import { Link } from 'react-router';
import { useAdminQuery } from '../api';
import { ClassBadge } from '../components/ClassBadge';
import { Empty, QueryState } from '../components/State';
import { classColor } from '../lib/classes';
import { formatChicagoShort, timeAgo } from '../lib/time';
import type { CharacterRow, Items } from '../types';
import './characters/characters.css';
import { characterPath } from './characters/timelineLib';

/** Character cards; each links to the character's page (level over time, quest XP, professions). */
export function CharactersPage() {
  const chars = useAdminQuery<Items<CharacterRow>>(['characters'], '/admin/api/characters');
  return (
    <div className="page">
      <header className="page-head">
        <h1>Characters</h1>
        <p className="muted">
          Everyone seen in uploads. Owners come from the upload tokens (assign them on Access).
        </p>
      </header>
      <QueryState query={chars}>
        {({ items }) =>
          items.length === 0 ? (
            <Empty>No characters yet.</Empty>
          ) : (
            <div className="char-grid">
              {items.map((c) => (
                <CharacterCard key={c.key} c={c} />
              ))}
            </div>
          )
        }
      </QueryState>
    </div>
  );
}

function CharacterCard({ c }: { c: CharacterRow }) {
  return (
    <article className="char-card" style={{ borderLeftColor: classColor(c.class) }}>
      <header>
        <h2>
          <Link to={characterPath(c.key)}>{c.name}</Link>
        </h2>
        <span className="muted small">{c.realm}</span>
      </header>
      <p className="char-line">
        <span className="level">Level {c.level ?? '?'}</span> {c.race ?? ''}{' '}
        <ClassBadge cls={c.class} />
        {c.faction && <span className="muted small"> · {c.faction}</span>}
      </p>
      <p className="muted small">
        Last seen{' '}
        {c.lastSeen ? (
          <time dateTime={c.lastSeen} title={formatChicagoShort(c.lastSeen)}>
            {timeAgo(c.lastSeen)} ({formatChicagoShort(c.lastSeen)})
          </time>
        ) : (
          'never'
        )}
      </p>
      <p className="small">
        {c.owners.length > 0 ? (
          <>Owner: {c.owners.map((o) => o.battletag).join(', ')}</>
        ) : (
          <span className="muted">
            No owner yet (via token {c.tokens.map((t) => t.label).join(', ') || 'unknown'})
          </span>
        )}
      </p>
    </article>
  );
}
