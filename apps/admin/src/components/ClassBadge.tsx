import { classColor, classLabel, textOn } from '../lib/classes';

export function ClassBadge({ cls }: { cls: string | null }) {
  const bg = classColor(cls);
  return (
    <span className="class-badge" style={{ background: bg, color: textOn(bg) }}>
      {classLabel(cls)}
    </span>
  );
}
