import { DIFFICULTIES } from './lib';
import type { Band } from './lib';

const rangeText = (b: Band) => (b.to - b.from <= 1 ? `${b.from}` : `${b.from}–${b.to - 1}`);

/** Difficulty bands of one recipe on a shared skill-rank scale; the text next to it says the same. */
export function BandBar({ bands, scale }: { bands: Band[]; scale: number }) {
  if (bands.length === 0) return <span className="muted small">not seen</span>;
  const summary = bands
    .filter((b) => b.observed)
    .map((b) => `${b.label} ${rangeText(b)}`)
    .join(', ');
  return (
    <span className="band" title={summary}>
      <span className="band-bar" aria-hidden>
        {bands.map((b) => (
          <span
            key={`${b.from}-${b.label}`}
            className={`band-seg${b.observed ? '' : ' unseen'}`}
            style={{
              left: `${(Math.min(b.from, scale) / scale) * 100}%`,
              width: `${(Math.max(0, Math.min(b.to, scale) - Math.min(b.from, scale)) / scale) * 100}%`,
              ...(b.color ? { background: b.color } : {}),
            }}
          />
        ))}
      </span>
      <span className="visually-hidden">{summary}</span>
    </span>
  );
}

/** The four colors, for the table header. */
export function BandLegend({ scale }: { scale: number }) {
  return (
    <span className="band-legend muted small">
      {Object.values(DIFFICULTIES).map((d) => (
        <span key={d.label}>
          <span className="band-swatch" style={{ background: d.color }} aria-hidden /> {d.label}
        </span>
      ))}
      <span>
        <span className="band-swatch unseen" aria-hidden /> not seen
      </span>
      <span>· scale 0–{scale}</span>
    </span>
  );
}
