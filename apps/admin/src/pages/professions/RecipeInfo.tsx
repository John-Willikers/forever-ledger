import { useState } from 'react';
import { Link } from 'react-router';
import { useAdminQuery } from '../../api';
import { QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import { formatCosts, formatMoney } from '../../lib/money';
import { ItemName } from '../loot/parts';
import { BandBar } from './BandBar';
import { bandScale, difficultyBands, viaLabel } from './lib';
import {
  charLevelText,
  descriptionLines,
  qtyText,
  skillRankText,
  sourceHint,
  tooltipColumns,
  useLevelText,
} from './recipeLib';
import type { RecipeDetail } from './types';

/**
 * A recipe's details (/admin/api/professions/recipes/:id): what it makes with the item's tooltip as its description,
 * what it takes to learn and use it, its reagents and where it comes from. Every item links to its Item page.
 */
export function RecipeInfo({ recipeId }: { recipeId: number }) {
  const [build, setBuild] = useState<number | null>(null);
  const detail = useAdminQuery<RecipeDetail>(
    ['recipe-detail', recipeId, build],
    `/admin/api/professions/recipes/${recipeId}${build === null ? '' : `?build=${build}`}`,
  );
  return (
    <QueryState query={detail}>
      {(d) => (
        <div className="recipe-info">
          {d.builds.length > 1 && (
            <label className="filters small">
              Build
              <select
                value={build ?? ''}
                onChange={(e) => setBuild(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">newest ({d.builds[0]})</option>
                {d.builds.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="grid-2">
            <Makes d={d} />
            <div>
              <Requirements d={d} />
              <Reagents d={d} />
            </div>
          </div>
          <WhereToGet d={d} />
        </div>
      )}
    </QueryState>
  );
}

function Makes({ d }: { d: RecipeDetail }) {
  const out = d.output;
  const desc = descriptionLines(out, d.recipeItems);
  const use = useLevelText(d.requirements.useLevel);
  return (
    <div className="recipe-makes">
      <h4>Makes</h4>
      {out ? (
        <p>
          <ItemName itemId={out.itemId} name={out.name} quality={out.quality} />{' '}
          {qtyText(out.qtyMin, out.qtyMax)}
        </p>
      ) : (
        <p className="muted small">
          {d.build === null
            ? 'No schematic seen in this build.'
            : 'No item (an enchant or a spell).'}
        </p>
      )}
      {desc.lines.length > 0 && (
        <ul className="tooltip-lines wow-tooltip" aria-label="Tooltip">
          {desc.lines.map((line, i) => {
            const [left, right] = tooltipColumns(line);
            return (
              <li key={i}>
                <span>{left}</span>
                {right !== null && <span className="tt-right">{right}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {desc.from === 'recipeItem' && <p className="muted small">From its recipe item's tooltip.</p>}
      {out && desc.from === null && <p className="muted small">No tooltip recorded for it yet.</p>}
      {use && (
        <p>
          <strong>{use}</strong>
        </p>
      )}
      {out && out.build !== null && (
        <p className="muted small">
          {out.ilvl !== null ? `Item level ${out.ilvl} · ` : ''}
          sells for {formatMoney(out.sellPrice)} · item snapshot of build {out.build}
        </p>
      )}
    </div>
  );
}

function Requirements({ d }: { d: RecipeDetail }) {
  const r = d.requirements;
  const bands = difficultyBands(r.difficulty);
  const scale = Math.max(
    bandScale([r.difficulty]),
    r.maxTrivial !== null ? Math.ceil((r.maxTrivial + 1) / 25) * 25 : 0,
  );
  return (
    <>
      <h4>Requirements</h4>
      <dl className="recipe-reqs">
        <dt>Learn</dt>
        <dd>
          {skillRankText(r.skillRank, d.profession?.name ?? null)}
          {r.skillRank && <span className="muted small"> · from {sourceHint(r.skillRank)}</span>}
        </dd>
        <dt>Level</dt>
        <dd>
          {charLevelText(r.charLevel)}
          {r.charLevel && <span className="muted small"> · from {sourceHint(r.charLevel)}</span>}
        </dd>
        <dt>Difficulty</dt>
        <dd>
          <BandBar bands={bands} scale={scale} />
          <div className="muted small">
            {r.difficulty
              .map(
                (t) =>
                  `${t.difficulty} ${t.minRank}–${t.maxRank}${t.chars ? ` (${plural(t.chars, 'char')})` : ''}`,
              )
              .join(' · ') || 'No difficulty seen yet'}
            {r.maxTrivial !== null && ` · turns gray at ${r.maxTrivial}`}
          </div>
        </dd>
      </dl>
    </>
  );
}

function Reagents({ d }: { d: RecipeDetail }) {
  return (
    <>
      <h4>Reagents</h4>
      {d.reagents.length === 0 ? (
        <p className="muted small">{d.build === null ? 'No schematic seen.' : 'None listed.'}</p>
      ) : (
        <ul className="plain">
          {d.reagents.map((g, i) => (
            <li key={`${g.itemId}-${i}`}>
              {formatNumber(g.qty)} ×{' '}
              <ItemName itemId={g.itemId} name={g.name} quality={g.quality} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function WhereToGet({ d }: { d: RecipeDetail }) {
  const { trainers, vendors, drops } = d.sources;
  const listed = new Set([...vendors.map((v) => v.itemId), ...drops.map((x) => x.itemId)]);
  const otherItems = d.recipeItems.filter((i) => !listed.has(i.itemId));
  const none = trainers.length + vendors.length + drops.length + otherItems.length === 0;
  return (
    <div>
      <h4>Where to get it</h4>
      {none ? (
        <p className="muted small">No trainer, vendor, drop or recipe item seen for it yet.</p>
      ) : (
        <ul className="sources small">
          {trainers.map((t, i) => (
            <li key={`t-${t.npcId}-${t.build}-${i}`}>
              <span className="pill neutral">trainer</span>
              {t.npcName ?? `NPC ${t.npcId}`}
              {t.npcTitle && <span className="chip">{t.npcTitle}</span>}
              <span className="muted">
                {' '}
                · {formatMoney(t.cost)}
                {t.skillRank !== null ? ` · needs rank ${t.skillRank}` : ''}
                {t.level ? ` · level ${t.level}` : ''} · build {t.build}
              </span>
            </li>
          ))}
          {vendors.map((v, i) => (
            <li key={`v-${v.npcId}-${v.build}-${v.itemId}-${i}`}>
              <span className="pill neutral">vendor</span>
              {v.npcName ?? `NPC ${v.npcId}`}
              {v.npcTitle && <span className="chip">{v.npcTitle}</span>}{' '}
              <span className="muted">· </span>
              <ItemName itemId={v.itemId} name={v.itemName} quality={v.quality} />
              <span className="muted">
                {' '}
                for {formatCosts(v.price, v.costs)}
                {v.numAvailable !== null && v.numAvailable >= 0
                  ? ` · ${formatNumber(v.numAvailable)} in stock`
                  : ''}{' '}
                · build {v.build}
              </span>
            </li>
          ))}
          {drops.map((x) => (
            <li key={`d-${x.itemId}-${x.build}-${x.npcId}-${x.objectId}`}>
              <span className="pill neutral">drop</span>
              <ItemName itemId={x.itemId} name={x.itemName} quality={null} />
              <span className="muted"> · from </span>
              {x.npcId !== null ? (
                <Link to={`/loot?npc=${x.npcId}&build=${x.build}`}>
                  {x.npcName ?? `NPC ${x.npcId}`}
                </Link>
              ) : (
                (x.objectName ?? `object ${x.objectId}`)
              )}
              <span className="muted">
                {' '}
                · {plural(x.count, 'time')} · build {x.build}
              </span>
            </li>
          ))}
          {otherItems.map((i) => (
            <li key={`i-${i.itemId}`}>
              <span className="pill neutral">recipe item</span>
              <ItemName itemId={i.itemId} name={i.name} quality={i.quality} />
              <span className="muted"> · not seen sold or dropped yet</span>
            </li>
          ))}
        </ul>
      )}
      <p className="muted small">
        Known by {plural(d.learnedBy, 'character')}
        {d.learnedVia.length > 0 &&
          ` · learned via ${d.learnedVia
            .map((v) => `${viaLabel(v.via)}${v.count > 1 ? ` ×${v.count}` : ''}`)
            .join(', ')}`}
        {d.sourceText && ` · the game says: ${d.sourceText}`}
      </p>
    </div>
  );
}
