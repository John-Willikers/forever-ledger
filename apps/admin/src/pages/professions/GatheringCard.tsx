import { createColumnHelper } from '@tanstack/react-table';
import { useState } from 'react';
import { useAdminQuery } from '../../api';
import { Card } from '../../components/Card';
import { Chart, useChartPalette } from '../../components/Chart';
import { DataTable } from '../../components/DataTable';
import type { SortableFeatures } from '../../components/DataTable';
import { Empty, QueryState } from '../../components/State';
import { formatNumber, plural } from '../../lib/format';
import './echarts';
import { gatheringScatterOption, lootLine, nodeLabel, zoneLabel } from './lib';
import type { GatheringMap, GatheringNode, GatherMap } from './types';

const numberFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** Gathering: node spots per zone on the map grid, then yield per harvest and the lowest rank seen per node type. */
export function GatheringCard() {
  const [build, setBuild] = useState<number | null>(null);
  const [mapId, setMapId] = useState<number | null>(null);
  const q = build === null ? '' : `?build=${build}`;
  const map = useAdminQuery<GatheringMap>(
    ['gathering-map', build],
    `/admin/api/professions/gathering-map${q}`,
  );
  const nodes = useAdminQuery<GatheringNode[]>(
    ['v1-gathering', build],
    `/v1/professions/gathering${q}`,
  );
  const builds = map.data?.builds ?? [];
  return (
    <Card
      title="Gathering"
      actions={
        builds.length > 1 && (
          <label className="filters">
            Build
            <select
              value={build ?? ''}
              onChange={(e) => setBuild(e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">all builds</option>
              {builds.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        )
      }
    >
      <QueryState query={map}>
        {(m) =>
          m.maps.length === 0 ? (
            <Empty>No gathering spots recorded{build === null ? '' : ` in build ${build}`}.</Empty>
          ) : (
            <ZoneMap
              maps={m.maps}
              current={m.maps.find((z) => z.mapId === mapId) ?? m.maps[0]!}
              onPick={setMapId}
            />
          )
        }
      </QueryState>
      <h3 className="section-gap">Yield per harvest</h3>
      <QueryState query={nodes}>
        {(list) => (
          <DataTable
            data={list}
            columns={yieldColumns}
            rowKey={(n) => `${n.build}-${n.objectId}`}
            initialSorting={[{ id: 'opens', desc: true }]}
            empty="Nothing gathered yet."
          />
        )}
      </QueryState>
    </Card>
  );
}

function ZoneMap({
  maps,
  current,
  onPick,
}: {
  maps: GatherMap[];
  current: GatherMap;
  onPick: (mapId: number) => void;
}) {
  const palette = useChartPalette();
  const spots = current.nodes.reduce((n, x) => n + x.spots.length, 0);
  return (
    <>
      <div className="filters">
        <label>
          Zone
          <select value={current.mapId} onChange={(e) => onPick(Number(e.target.value))}>
            {maps.map((z) => (
              <option key={z.mapId} value={z.mapId}>
                {zoneLabel(z)} ({numberFmt.format(z.opens)} opens)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="gather-map">
        <Chart
          option={gatheringScatterOption(current, palette)}
          height={440}
          label={`Gathering spots in ${zoneLabel(current)}: ${plural(spots, 'spot')} of ${plural(current.nodes.length, 'node type')}`}
        />
      </div>
      <p className="muted small">
        Map coordinates 0–100 (y down, like the world map). Marker size: opens at the spot, each
        session's opens spread evenly over the spots it recorded.
      </p>
      <div className="table-wrap">
        <table className="data compact">
          <thead>
            <tr>
              <th>Node</th>
              <th>Profession</th>
              <th>Opens here</th>
              <th>Spots</th>
              <th>Lowest rank seen</th>
            </tr>
          </thead>
          <tbody>
            {current.nodes.map((n) => (
              <tr key={n.objectId}>
                <td>{nodeLabel(n)}</td>
                <td>{n.skillLineName ?? '—'}</td>
                <td>{numberFmt.format(n.opens)}</td>
                <td>{formatNumber(n.spots.length)}</td>
                <td>{n.rankMin ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

const col = createColumnHelper<SortableFeatures, GatheringNode>();
const yieldColumns = col.columns([
  col.accessor((n) => nodeLabel(n), { id: 'node', header: 'Node' }),
  col.accessor((n) => n.skillLineName ?? '', {
    id: 'profession',
    header: 'Profession',
    cell: (c) => c.getValue() || '—',
  }),
  col.accessor('build', { header: 'Build' }),
  col.accessor('opens', { header: 'Harvests', sortFn: 'basic' }),
  col.accessor((n) => n.rankMin ?? -1, {
    id: 'rankMin',
    header: 'Min rank',
    sortFn: 'basic',
    cell: (c) => c.row.original.rankMin ?? '—',
  }),
  col.accessor((n) => n.zones.length, {
    id: 'zones',
    header: 'Maps',
    sortFn: 'basic',
  }),
  col.accessor((n) => lootLine(n.loot), {
    id: 'loot',
    header: 'Yield per harvest',
    cell: (c) => <span className="small">{c.getValue() || '—'}</span>,
  }),
]);
