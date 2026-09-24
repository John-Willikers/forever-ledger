import { createColumnHelper } from '@tanstack/react-table';
import { Link } from 'react-router';
import { useAdminQuery } from '../api';
import { Card } from '../components/Card';
import { Chart, useChartPalette } from '../components/Chart';
import { DataTable } from '../components/DataTable';
import type { SortableFeatures } from '../components/DataTable';
import { Kpi } from '../components/Kpi';
import { Empty, QueryState } from '../components/State';
import {
  hourlySummary,
  hourlyUploadsOption,
  recordsByKindOption,
  recordsChartHeight,
} from '../lib/charts';
import { formatCompact, formatNumber, plural } from '../lib/format';
import { summarizeRecords } from '../lib/records';
import { formatChicago, formatChicagoHour, formatChicagoShort, timeAgo } from '../lib/time';
import type {
  BuildSeen,
  Overview,
  Upload,
  UploadsHourly,
  UploadsPage,
  VersionInUse,
} from '../types';

/** The live feed polls this often (the plan's 15 s). */
export const FEED_REFRESH_MS = 15_000;
const OVERVIEW_REFRESH_MS = 60_000;

export function OverviewPage() {
  const overview = useAdminQuery<Overview>(['overview'], '/admin/api/overview', {
    refetchInterval: OVERVIEW_REFRESH_MS,
  });
  return (
    <div className="page">
      <header className="page-head">
        <h1>Overview</h1>
        <p className="muted">Uploads, records and health at a glance. Times are America/Chicago.</p>
      </header>
      <QueryState query={overview}>{(o) => <Kpis o={o} />}</QueryState>
      <div className="grid-2">
        <HourlyCard />
        <QueryState query={overview}>{(o) => <RecordsCard o={o} />}</QueryState>
      </div>
      <LiveFeed />
      <QueryState query={overview}>
        {(o) => (
          <div className="grid-2">
            <BuildsCard builds={o.builds} />
            <VersionsCard addon={o.versions.addon} tray={o.versions.tray} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

function Kpis({ o }: { o: Overview }) {
  const diag = o.health.diagnostics7d;
  const problems = (diag.error ?? 0) + (diag.fatal ?? 0) + o.health.ingestErrors7d;
  const flagged = o.health.flaggedSamples.length;
  return (
    <div className="kpis">
      <Kpi
        label="Uploads today"
        value={formatNumber(o.uploads.today)}
        hint={`${formatNumber(o.uploads.last7d)} in 7 days · ${formatNumber(o.uploads.total)} total`}
      />
      <Kpi
        label="Last upload"
        value={o.uploads.lastAt ? timeAgo(o.uploads.lastAt) : 'never'}
        hint={o.uploads.lastAt ? formatChicagoShort(o.uploads.lastAt) : undefined}
      />
      <Kpi
        label="Records uploaded"
        value={formatCompact(o.totals.records)}
        hint={`${o.recordsByKind.length} kinds`}
      />
      <Kpi
        label="Characters"
        value={formatNumber(o.totals.characters)}
        hint={`${plural(o.totals.accounts, 'account')} · ${plural(o.totals.uploaders, 'PC')}`}
      />
      <Kpi
        label="Builds seen"
        value={formatNumber(o.builds.length)}
        hint={
          o.builds[0] ? `latest ${o.builds[0].build} (${o.builds[0].version ?? '?'})` : undefined
        }
      />
      <Kpi
        label="Health, 7 days"
        value={problems === 0 && flagged === 0 ? 'OK' : formatNumber(problems)}
        tone={problems > 0 ? 'bad' : flagged > 0 || (diag.warn ?? 0) > 0 ? 'warn' : undefined}
        hint={
          <Link to="/health">
            {plural(o.health.ingestErrors7d, 'refused batch', 'refused batches')} ·{' '}
            {plural(diag.error ?? 0, 'error')} · {plural(diag.warn ?? 0, 'warning')}
            {flagged > 0 ? ` · ${plural(flagged, 'addon report')}` : ''}
          </Link>
        }
      />
    </div>
  );
}

function HourlyCard() {
  const palette = useChartPalette();
  const hourly = useAdminQuery<UploadsHourly>(
    ['uploads-hourly', 7],
    '/admin/api/uploads/hourly?days=7',
    {
      refetchInterval: OVERVIEW_REFRESH_MS,
    },
  );
  return (
    <Card title="Uploads per hour, last 7 days">
      <QueryState query={hourly}>
        {(h) => {
          const { total, peak } = hourlySummary(h.buckets);
          if (total === 0) return <Empty>No uploads in the last 7 days.</Empty>;
          return (
            <>
              <Chart
                option={hourlyUploadsOption(h.buckets, palette)}
                height={220}
                label={`Uploads per hour over ${h.days} days: ${total} in total`}
              />
              <p className="muted small">
                {plural(total, 'upload')}
                {peak ? ` · busiest hour ${formatChicagoHour(peak.hour)} (${peak.count})` : ''}
              </p>
            </>
          );
        }}
      </QueryState>
    </Card>
  );
}

function RecordsCard({ o }: { o: Overview }) {
  const palette = useChartPalette();
  if (o.recordsByKind.length === 0)
    return (
      <Card title="Records by kind">
        <Empty>No records yet.</Empty>
      </Card>
    );
  return (
    <Card title="Records by kind (all uploads)">
      <Chart
        option={recordsByKindOption(o.recordsByKind, palette)}
        height={recordsChartHeight(o.recordsByKind.length)}
        label={`Records by kind: ${summarizeRecords(Object.fromEntries(o.recordsByKind.map((r) => [r.kind, r.count])), 5).text}`}
      />
    </Card>
  );
}

const uploadCol = createColumnHelper<SortableFeatures, Upload>();
const uploadColumns = uploadCol.columns([
  // Sorted by epoch ms: ISO strings with -05:00 and -06:00 offsets don't sort as text.
  uploadCol.accessor((u) => Date.parse(u.receivedAt), {
    id: 'receivedAt',
    header: 'Received',
    sortFn: 'basic',
    cell: (c) => (
      <span className="nowrap" title={formatChicago(c.row.original.receivedAt, { seconds: true })}>
        {formatChicagoShort(c.row.original.receivedAt)}
      </span>
    ),
  }),
  uploadCol.accessor((u) => u.tokenLabel ?? '', {
    id: 'who',
    header: 'Who',
    cell: (c) => {
      const u = c.row.original;
      return (
        <span>
          {u.tokenLabel ?? <span className="muted">no token</span>}
          {u.owner && <span className="muted"> · {u.owner.battletag}</span>}
        </span>
      );
    },
  }),
  uploadCol.accessor('account', { header: 'Account' }),
  uploadCol.accessor((u) => u.addonVersion ?? '', {
    id: 'addon',
    header: 'Addon',
    cell: (c) => c.getValue() || '—',
  }),
  uploadCol.accessor('schemaVersion', { header: 'Schema' }),
  uploadCol.accessor('clientBuild', { header: 'Build' }),
  uploadCol.accessor('total', {
    header: 'Records',
    cell: (c) => {
      const s = summarizeRecords(c.row.original.records);
      return (
        <span title={s.text}>
          <strong>{formatNumber(s.total)}</strong>{' '}
          <span className="muted small">{s.total > 0 ? s.text : ''}</span>
        </span>
      );
    },
  }),
]);

function LiveFeed() {
  const uploads = useAdminQuery<UploadsPage>(['uploads', 'feed'], '/admin/api/uploads?limit=25', {
    refetchInterval: FEED_REFRESH_MS,
  });
  return (
    <Card
      title="Live feed"
      actions={
        <span className="muted small">
          {uploads.isFetching ? 'refreshing…' : `refreshes every ${FEED_REFRESH_MS / 1000} s`}
          {uploads.dataUpdatedAt ? ` · updated ${formatChicagoShort(uploads.dataUpdatedAt)}` : ''}
        </span>
      }
    >
      <QueryState query={uploads}>
        {(page) => (
          <DataTable
            data={page.items}
            columns={uploadColumns}
            rowKey={(u) => u.id}
            empty="No uploads yet."
          />
        )}
      </QueryState>
    </Card>
  );
}

function BuildsCard({ builds }: { builds: BuildSeen[] }) {
  return (
    <Card title="Builds">
      {builds.length === 0 ? (
        <Empty>No builds yet.</Empty>
      ) : (
        <div className="table-wrap">
          <table className="data compact">
            <thead>
              <tr>
                <th>Build</th>
                <th>Version</th>
                <th>First seen</th>
                <th>Last seen</th>
                <th>Uploads</th>
              </tr>
            </thead>
            <tbody>
              {builds.map((b) => (
                <tr key={b.build}>
                  <td>{b.build}</td>
                  <td>{b.version ?? '—'}</td>
                  <td className="nowrap">{formatChicagoShort(b.firstSeen)}</td>
                  <td className="nowrap">{formatChicagoShort(b.lastSeen)}</td>
                  <td>{formatNumber(b.uploads)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function VersionList({
  title,
  versions,
  none,
}: {
  title: string;
  versions: VersionInUse[];
  none: string;
}) {
  return (
    <div>
      <h3>{title}</h3>
      {versions.length === 0 ? (
        <p className="muted small">{none}</p>
      ) : (
        <ul className="versions">
          {versions.map((v) => (
            <li key={v.version}>
              <strong>{v.version}</strong>{' '}
              <span className="muted">
                {plural(v.uploaders, 'PC')} · last {timeAgo(v.lastSeen)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function VersionsCard({ addon, tray }: { addon: VersionInUse[]; tray: VersionInUse[] }) {
  return (
    <Card title="Versions in use">
      <div className="grid-2 tight">
        <VersionList title="Addon (latest upload per PC)" versions={addon} none="No uploads yet." />
        <VersionList
          title="Tray app (latest report per PC)"
          versions={tray}
          none="No tray app reports yet (it only reports problems)."
        />
      </div>
    </Card>
  );
}
