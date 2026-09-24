// 🗺️ Maps: the uiMapIDs our data has points on, and the zone map art under them. Admins upload a map exported with
// wow.export from their own client: a local preview (object URL, never sent anywhere) shows our points on it, the
// admin confirms they line up, then it is saved with a PUT carrying the CSRF header. The server checks the bytes again.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { sendWithCsrf, useAdminQuery, useCsrf } from '../../api';
import { Card } from '../../components/Card';
import { ConfirmButton } from '../../components/ConfirmButton';
import { Empty, QueryState } from '../../components/State';
import { MAP_IMAGES_KEY, MapView } from '../../components/ZoneMap';
import { formatBytes, formatNumber, plural } from '../../lib/format';
import { formatChicago, formatChicagoShort } from '../../lib/time';
import { aspectOff, mapImageUrl, ZONE_CANVAS } from '../../lib/zoneMap';
import type { MapPoint } from '../../lib/zoneMap';
import { buildQuery, fileProblem, mimeLabel, sizeProblem, zoneName } from './mapsLib';
import type { UploadResult, ZoneMapPoints, ZoneMapRow, ZoneMapsList } from './types';

const MAPS_KEY = ['maps'];

function useInvalidateMaps() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all(
      [MAPS_KEY, [...MAP_IMAGES_KEY]].map((queryKey) =>
        queryClient.invalidateQueries({ queryKey }),
      ),
    );
}

export function MapsPage() {
  const list = useAdminQuery<ZoneMapsList>(MAPS_KEY, '/admin/api/maps');
  const [params, setParams] = useSearchParams();
  const raw = params.get('map');
  const selected = raw !== null && /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : null;
  const select = (id: number | null) => setParams(id === null ? {} : { map: String(id) });
  const row =
    selected === null
      ? null
      : (list.data?.maps.find((m) => m.uiMapId === selected) ?? {
          uiMapId: selected,
          zone: null,
          points: { gathering: 0, quests: 0, npcs: 0, total: 0 },
          image: null,
        });
  return (
    <div className="page">
      <header className="page-head">
        <h1>Maps</h1>
        <p className="muted">
          Zone map art under the panel's points (gathering, quest givers and enders, vendors,
          trainers). Export a zone from your own game client with wow.export, upload it on its row,
          check that the dots sit on the right terrain, and save. Only admins upload; nothing
          changes for the tray app or the addon.
        </p>
      </header>
      {row && list.data && (
        <MapEditor
          key={row.uiMapId}
          row={row}
          latestBuild={list.data.latestBuild}
          onClose={() => select(null)}
        />
      )}
      <Card title="Zone maps">
        <QueryState query={list}>
          {(l) =>
            l.maps.length === 0 ? (
              <Empty>No map points recorded yet.</Empty>
            ) : (
              <MapsTable maps={l.maps} selected={selected} onSelect={select} />
            )
          }
        </QueryState>
      </Card>
      <HowTo />
    </div>
  );
}

function MapsTable({
  maps,
  selected,
  onSelect,
}: {
  maps: ZoneMapRow[];
  selected: number | null;
  onSelect: (id: number) => void;
}) {
  const csrf = useCsrf();
  const invalidate = useInvalidateMaps();
  const remove = useMutation({
    mutationFn: (id: number) => sendWithCsrf('DELETE', `/admin/api/maps/${id}`, csrf),
    onSettled: () => invalidate(),
  });
  return (
    <>
      {remove.isError && (
        <div className="callout warn" role="alert">
          Couldn't delete: {remove.error.message}
        </div>
      )}
      <div className="table-wrap">
        <table className="data compact">
          <thead>
            <tr>
              <th>Map</th>
              <th>Zone</th>
              <th>Gathering spots</th>
              <th>Quest points</th>
              <th>NPCs</th>
              <th>Image</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {maps.map((m) => (
              <tr key={m.uiMapId} className={m.uiMapId === selected ? 'selected' : undefined}>
                <td>{m.uiMapId}</td>
                <td>{m.zone ?? <span className="muted">unknown</span>}</td>
                <td>{formatNumber(m.points.gathering)}</td>
                <td>{formatNumber(m.points.quests)}</td>
                <td>{formatNumber(m.points.npcs)}</td>
                <td>
                  {m.image ? (
                    <span className="small">
                      {m.image.width}×{m.image.height} {mimeLabel(m.image.mime)} ·{' '}
                      {formatBytes(m.image.size)}
                      {m.image.aspectWarning && (
                        <span className="pill neutral" title={m.image.aspectWarning}>
                          aspect
                        </span>
                      )}
                      <br />
                      <span className="muted" title={formatChicago(m.image.uploadedAt)}>
                        {formatChicagoShort(m.image.uploadedAt)}
                        {m.image.uploadedBy && ` by ${m.image.uploadedBy}`}
                        {m.image.build !== null && ` · build ${m.image.build}`}
                      </span>
                    </span>
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td className="nowrap">
                  <button
                    type="button"
                    className="secondary small"
                    onClick={() => onSelect(m.uiMapId)}
                  >
                    {m.image ? 'View / replace' : 'Upload'}
                  </button>{' '}
                  {m.image && (
                    <ConfirmButton
                      danger
                      confirmLabel="Delete map"
                      disabled={remove.isPending}
                      onConfirm={() => remove.mutate(m.uiMapId)}
                    >
                      Delete
                    </ConfirmButton>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

interface Preview {
  url: string;
  width: number;
  height: number;
}

/** One map: its points on the current image (or the grid), and the upload flow with a local preview. */
function MapEditor({
  row,
  latestBuild,
  onClose,
}: {
  row: ZoneMapRow;
  latestBuild: number | null;
  onClose: () => void;
}) {
  const csrf = useCsrf();
  const invalidate = useInvalidateMaps();
  const ref = useRef<HTMLDivElement>(null);
  const points = useAdminQuery<ZoneMapPoints>(
    ['map-points', row.uiMapId],
    `/admin/api/maps/${row.uiMapId}/points`,
  );
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [aligned, setAligned] = useState(false);
  const [build, setBuild] = useState(latestBuild === null ? '' : String(latestBuild));
  const [result, setResult] = useState<UploadResult | null>(null);
  const picked = useRef<File | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => ref.current?.scrollIntoView({ block: 'nearest' }), []);
  // A pick still loading when the editor closes revokes its own object URL (it no longer matches).
  useEffect(
    () => () => {
      picked.current = null;
    },
    [],
  );
  // The preview's object URL lives as long as the preview.
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview.url)), [preview]);

  const clear = () => {
    picked.current = null;
    setFile(null);
    setPreview(null);
    setAligned(false);
    setProblem(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  const pick = (f: File | null) => {
    clear();
    setResult(null);
    if (!f) return;
    const p = fileProblem(f);
    if (p) return setProblem(p);
    picked.current = f;
    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      if (picked.current !== f) return URL.revokeObjectURL(url);
      const sp = sizeProblem(img.naturalWidth, img.naturalHeight);
      if (sp) {
        URL.revokeObjectURL(url);
        return setProblem(sp);
      }
      setFile(f);
      setPreview({ url, width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      if (picked.current === f) setProblem("That file isn't an image this browser can show.");
    };
    img.src = url;
  };

  const save = useMutation({
    mutationFn: (f: File) =>
      sendWithCsrf<UploadResult>(
        'PUT',
        `/admin/api/maps/${row.uiMapId}${buildQuery(build)}`,
        csrf,
        f,
      ),
    onSuccess: (r) => {
      setResult(r);
      clear();
      void invalidate();
    },
  });

  const list: MapPoint[] = points.data?.points ?? [];
  const noPoints = points.isSuccess && list.length === 0;
  const label = `${zoneName(row)}: ${plural(list.length, 'point')}`;

  return (
    <div ref={ref}>
      <Card
        title={row.zone ? `${row.zone} · map ${row.uiMapId}` : `Map ${row.uiMapId}`}
        actions={
          <button type="button" className="secondary small" onClick={onClose}>
            Close
          </button>
        }
      >
        <p className="small muted">
          {plural(row.points.gathering, 'gathering spot')} ·{' '}
          {plural(row.points.quests, 'quest point')} · {plural(row.points.npcs, 'NPC')}. Hover a dot
          for its name.
        </p>
        {points.isError && (
          <div className="callout warn" role="alert">
            Couldn't load this map's points: {points.error.message}
          </div>
        )}

        {preview ? (
          <>
            <h3>Preview (not saved yet)</h3>
            <MapView src={preview.url} size={preview} points={list} label={`Preview of ${label}`} />
            <p className="small">
              {preview.width}×{preview.height} px · {file && formatBytes(file.size)}
            </p>
            {aspectOff(preview.width, preview.height) && (
              <div className="callout warn" role="note">
                This image is {preview.width}×{preview.height}, not {ZONE_CANVAS.width}:
                {ZONE_CANVAS.height} like wow.export's zone maps: the dots may not line up. Check
                them closely, or export the zone again at full size.
              </div>
            )}
            <div className="filters">
              <label>
                <input
                  type="checkbox"
                  checked={aligned || noPoints}
                  disabled={noPoints}
                  onChange={(e) => setAligned(e.target.checked)}
                />{' '}
                {noPoints
                  ? 'No points on this map yet to check against'
                  : 'The dots sit on the right terrain (nodes on veins/herbs, NPCs in their camps)'}
              </label>
              <label>
                Client build
                <input
                  type="text"
                  inputMode="numeric"
                  size={8}
                  value={build}
                  onChange={(e) => setBuild(e.target.value)}
                  placeholder="optional"
                />
              </label>
              <button
                type="button"
                disabled={!file || !(aligned || noPoints) || save.isPending}
                onClick={() => file && save.mutate(file)}
              >
                {save.isPending ? 'Saving…' : row.image ? 'Replace the map' : 'Save the map'}
              </button>
              <button type="button" className="secondary" onClick={clear}>
                Cancel
              </button>
            </div>
          </>
        ) : row.image ? (
          <MapView
            src={mapImageUrl(row.uiMapId, row.image.sha256)}
            size={row.image}
            points={list}
            label={label}
          />
        ) : (
          <MapView src={null} points={list} label={`${label} (no map uploaded)`} />
        )}

        {save.isError && (
          <div className="callout warn" role="alert">
            Upload refused: {save.error.message}
          </div>
        )}
        {problem && (
          <div className="callout warn" role="alert">
            {problem}
          </div>
        )}
        {result && (
          <div className="callout" role="status">
            Saved {result.map.width}×{result.map.height} {mimeLabel(result.map.mime)} (
            {formatBytes(result.map.size)}).
            {result.warnings.map((w) => (
              <span key={w}> ⚠️ {w}</span>
            ))}
          </div>
        )}

        <label className="file-pick">
          {row.image ? 'Replace with' : 'Upload'} a PNG, WebP or JPEG (≤ 8 MB, ≤ 4096 px per side):{' '}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/webp,image/jpeg"
            onChange={(e) => pick(e.target.files?.[0] ?? null)}
          />
        </label>
      </Card>
    </div>
  );
}

function HowTo() {
  return (
    <Card title="How to export a zone map with wow.export">
      <ol className="howto">
        <li>
          On the gaming PC, download wow.export from its GitHub releases page
          (github.com/Kruithne/wow.export/releases).
        </li>
        <li>
          Open it → <strong>Open Local Installation</strong> → pick the WoW: Forever folder → choose
          the <code>wow_classic_beta</code> 1.60.1 build.
        </li>
        <li>
          <strong>Zones</strong> tab → pick the zone (e.g. Durotar, The Barrens) → export as{' '}
          <strong>PNG</strong> (or WebP) at full size ({ZONE_CANVAS.width}×{ZONE_CANVAS.height}).
        </li>
        <li>
          Here: <strong>Upload</strong> on that zone's row → check that the dots line up → Save.
        </li>
      </ol>
      <p className="muted small">
        If a patch changes a zone's art, export it again and replace the upload; the client build is
        kept for reference. Map art is Blizzard's: it stays in this private, login-only panel.
      </p>
    </Card>
  );
}
