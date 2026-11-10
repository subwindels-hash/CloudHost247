import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import { getToken } from '../lib/auth';
import {
  getOnlineVisitors,
  getVisitorCountryDetail,
  getVisitorMap,
  getVisitorOverview,
  updateVisitorSettings,
  type OnlineVisitor,
  type VisitorCountryDetail,
  type VisitorDateRange,
  type VisitorLiveSnapshot,
  type VisitorMapLocation,
  type VisitorOverview,
  type VisitorSettings,
  type VisitorWindow,
} from '../lib/visitor-intelligence-api';
import './admin-visitor-intelligence.css';

const numberFormat = new Intl.NumberFormat();
const RANGE_OPTIONS: Array<{ value: VisitorDateRange; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom dates' },
];

function formatNumber(value: number) { return numberFormat.format(Number.isFinite(value) ? value : 0); }
function formatTime(value: string | null | undefined) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
function formatDuration(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) return `${safe}s`;
  if (safe < 3600) return `${Math.floor(safe / 60)}m ${safe % 60}s`;
  return `${Math.floor(safe / 3600)}h ${Math.floor((safe % 3600) / 60)}m`;
}
function messageOf(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}
function validCustomWindow(from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return false;
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  return Number.isFinite(start) && Number.isFinite(end) && (end - start) / 86_400_000 < 366;
}

function TrendChart({ points }: { points: VisitorOverview['timeseries'] }) {
  const width = 760;
  const height = 250;
  const pad = { left: 42, right: 18, top: 18, bottom: 36 };
  const max = Math.max(1, ...points.flatMap((point) => [point.pageViews, point.visitors]));
  const x = (index: number) => pad.left + (points.length <= 1 ? 0 : index / (points.length - 1)) * (width - pad.left - pad.right);
  const y = (value: number) => height - pad.bottom - (value / max) * (height - pad.top - pad.bottom);
  const visitors = points.map((point, index) => `${x(index)},${y(point.visitors)}`).join(' ');
  const pageViews = points.map((point, index) => `${x(index)},${y(point.pageViews)}`).join(' ');
  const labels = points.length <= 1 ? points : [points[0]!, points[Math.floor((points.length - 1) / 2)]!, points[points.length - 1]!];
  if (!points.length) return <p className="ch247-page__hint">No visitor events in this date range yet.</p>;
  return (
    <div className="vi-chart" role="img" aria-label="Visitor and pageview totals over time">
      <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const lineY = height - pad.bottom - fraction * (height - pad.top - pad.bottom);
          return <g key={fraction}><line x1={pad.left} x2={width - pad.right} y1={lineY} y2={lineY} className="vi-chart__grid" /><text x={pad.left - 8} y={lineY + 4} textAnchor="end" className="vi-chart__tick">{Math.round(max * fraction)}</text></g>;
        })}
        <polyline points={pageViews} className="vi-chart__line vi-chart__line--views" />
        <polyline points={visitors} className="vi-chart__line vi-chart__line--visitors" />
        {points.map((point, index) => <circle key={`${point.bucket}-${index}`} cx={x(index)} cy={y(point.pageViews)} r="2.8" className="vi-chart__point vi-chart__point--views" />)}
        {labels.map((point) => {
          const index = points.indexOf(point);
          return <text key={`${point.bucket}-label`} x={x(index)} y={height - 10} textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} className="vi-chart__tick">{formatTime(point.bucket)}</text>;
        })}
      </svg>
      <div className="vi-chart__legend"><span><i className="vi-chart__swatch vi-chart__swatch--views" /> Pageviews</span><span><i className="vi-chart__swatch vi-chart__swatch--visitors" /> Unique visitors</span></div>
    </div>
  );
}

const CONTINENT_PATHS = [
  // A small, self-contained world silhouette in the same equirectangular projection used by the
  // coarse location dots. No tile provider receives visitor data or browser location.
  'M42 65 L106 43 L157 52 L183 72 L216 79 L240 102 L276 106 L308 128 L330 150 L319 176 L289 185 L279 213 L255 218 L242 199 L224 193 L209 177 L190 169 L172 143 L150 137 L131 111 L105 108 L83 92 L55 89 Z',
  'M275 211 L305 215 L327 228 L342 249 L355 276 L365 300 L359 323 L349 352 L337 380 L324 410 L310 426 L298 405 L289 373 L278 346 L271 318 L267 286 L272 255 Z',
  'M457 88 L476 75 L506 79 L521 89 L540 82 L559 89 L578 78 L605 83 L618 98 L609 109 L583 113 L570 126 L552 128 L544 143 L522 140 L513 129 L494 127 L484 111 L464 109 Z',
  'M476 139 L499 129 L526 140 L543 160 L547 184 L538 207 L529 231 L518 258 L507 286 L496 314 L482 324 L473 303 L468 279 L460 256 L455 231 L457 206 L463 184 L462 163 Z',
  'M553 120 L582 111 L611 111 L638 102 L672 104 L699 96 L731 105 L760 103 L795 117 L825 125 L853 145 L867 166 L852 181 L822 174 L799 185 L779 176 L754 187 L733 179 L715 193 L696 182 L675 185 L658 171 L636 174 L617 160 L596 159 L580 145 L560 143 Z',
  'M818 248 L843 239 L866 246 L880 260 L873 278 L859 291 L841 289 L829 275 Z',
  'M862 338 L892 328 L922 337 L945 354 L953 374 L941 394 L916 402 L894 394 L878 378 L865 361 Z',
  'M392 64 L415 58 L433 67 L430 81 L412 89 L395 82 Z',
];

function mapPoint(location: VisitorMapLocation) {
  if (location.latitude === null || location.longitude === null || !Number.isFinite(location.latitude) || !Number.isFinite(location.longitude)) return null;
  return { x: ((location.longitude + 180) / 360) * 1000, y: ((90 - location.latitude) / 180) * 500 };
}

function WorldMap({ locations, selectedCountry, onSelect }: {
  locations: VisitorMapLocation[]; selectedCountry: string | null; onSelect: (location: VisitorMapLocation) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const markers = locations.map((location, index) => ({ location, index, point: mapPoint(location) })).filter((marker) => marker.point !== null).slice(0, 180);
  return (
    <div className="vi-map-frame">
      <div className="vi-map-tools" aria-label="Map controls">
        <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(2.5, Number((value + 0.25).toFixed(2))))}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(1, Number((value - 0.25).toFixed(2))))}>−</button>
        <button type="button" aria-label="Reset map zoom" onClick={() => setZoom(1)}>Reset</button>
      </div>
      <svg className="vi-map" viewBox="0 0 1000 500" role="group" aria-label="Approximate visitor locations by city">
        <rect x="0" y="0" width="1000" height="500" rx="18" className="vi-map__ocean" />
        <g transform={`translate(${500 - 500 * zoom} ${250 - 250 * zoom}) scale(${zoom})`}>
          {[0, 1, 2, 3].map((row) => <line key={`lat-${row}`} x1="0" x2="1000" y1={row * 125 + 62.5} y2={row * 125 + 62.5} className="vi-map__graticule" />)}
          {[1, 2, 3, 4, 5, 6, 7].map((column) => <line key={`lon-${column}`} x1={column * 125} x2={column * 125} y1="0" y2="500" className="vi-map__graticule" />)}
          {CONTINENT_PATHS.map((path, index) => <path key={index} d={path} className="vi-map__land" />)}
          {markers.map(({ location, index, point }) => {
            const xy = point!;
            const radius = Math.min(15, 5 + Math.log2(location.visitors + 1) * 2);
            const selected = selectedCountry === location.countryCode;
            const label = [location.cityName, location.regionName, location.countryName].filter(Boolean).join(', ');
            return (
              <g key={`${location.countryCode}-${location.cityName}-${location.regionName}-${index}`} className="vi-map__marker" role="button" tabIndex={0} aria-pressed={selected} aria-label={`${label}: ${formatNumber(location.visitors)} visitors, ${formatNumber(location.online)} online`} onClick={() => onSelect(location)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(location); } }}>
                <circle cx={xy.x} cy={xy.y} r={radius + 6} className="vi-map__pulse" />
                <circle cx={xy.x} cy={xy.y} r={radius} className={selected ? 'vi-map__dot vi-map__dot--selected' : 'vi-map__dot'} />
                <title>{label} — {formatNumber(location.visitors)} visitors, {formatNumber(location.online)} online</title>
              </g>
            );
          })}
        </g>
      </svg>
      <p className="vi-map__caption">Approximate city-centre GeoIP estimates only. No GPS or residential location is collected.</p>
    </div>
  );
}

function Metric({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return <div className="vi-metric"><span>{label}</span><strong>{formatNumber(value)}</strong>{hint ? <small>{hint}</small> : null}</div>;
}

function DataTable({ title, headers, rows, empty }: { title: string; headers: string[]; rows: ReactNode; empty: boolean }) {
  return <section className="ch247-card vi-card"><h2>{title}</h2>{empty ? <p className="ch247-page__hint">No data for this date range.</p> : <div className="ch247-table-wrap"><table className="ch247-table"><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{rows}</tbody></table></div>}</section>;
}

export default function AdminVisitorIntelligencePage() {
  usePageMeta('Visitor Intelligence', 'First-party, consent-aware website analytics for CloudHost247 administrators.');
  const [range, setRange] = useState<VisitorDateRange>('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [overview, setOverview] = useState<VisitorOverview | null>(null);
  const [locations, setLocations] = useState<VisitorMapLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshTick, setRefreshTick] = useState(0);
  const [onlineVisitors, setOnlineVisitors] = useState<OnlineVisitor[]>([]);
  const [liveStats, setLiveStats] = useState<VisitorLiveSnapshot['stats'] | null>(null);
  const [liveUpdatedAt, setLiveUpdatedAt] = useState<string | null>(null);
  const [liveMode, setLiveMode] = useState<'connecting' | 'live' | 'polling' | 'unavailable'>('connecting');
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [countryDetail, setCountryDetail] = useState<VisitorCountryDetail | null>(null);
  const [countryError, setCountryError] = useState('');
  const [settingsDraft, setSettingsDraft] = useState<VisitorSettings | null>(null);
  const [savingSettings, setSavingSettings] = useState(false);
  const [settingsMessage, setSettingsMessage] = useState('');
  const [settingsError, setSettingsError] = useState('');

  const customDatesValid = range !== 'custom' || validCustomWindow(from, to);
  const settingsDraftValid = Boolean(settingsDraft &&
    Number.isInteger(settingsDraft.retentionDays) && settingsDraft.retentionDays >= 7 && settingsDraft.retentionDays <= 365 &&
    Number.isInteger(settingsDraft.idleAfterSeconds) && settingsDraft.idleAfterSeconds >= 60 && settingsDraft.idleAfterSeconds <= 3600 &&
    Number.isInteger(settingsDraft.onlineTimeoutSeconds) && settingsDraft.onlineTimeoutSeconds >= 60 && settingsDraft.onlineTimeoutSeconds <= 600);
  const reportWindow = useMemo<VisitorWindow>(() => range === 'custom' ? { range, from, to } : { range }, [range, from, to]);
  const windowKey = `${range}:${from}:${to}`;

  const applyLiveSnapshot = useCallback((snapshot: VisitorLiveSnapshot) => {
    if (!snapshot || !Array.isArray(snapshot.visitors)) return;
    setOnlineVisitors(snapshot.visitors);
    setLiveStats(snapshot.stats ?? null);
    setLiveUpdatedAt(snapshot.generatedAt || new Date().toISOString());
  }, []);

  useEffect(() => {
    if (!customDatesValid) return;
    let cancelled = false;
    setLoading((current) => current || !overview);
    Promise.all([getVisitorOverview(reportWindow), getVisitorMap(reportWindow)])
      .then(([nextOverview, nextMap]) => {
        if (cancelled) return;
        setOverview(nextOverview);
        setLocations(nextMap.locations ?? []);
        setSettingsDraft((current) => current ?? nextOverview.tracking);
        setError('');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(messageOf(err, 'Visitor reports could not be loaded.'));
      })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [windowKey, refreshTick, customDatesValid]);

  useEffect(() => {
    const timer = window.setInterval(() => setRefreshTick((value) => value + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // The stream is authorized with the same Bearer session as other admin APIs. If streaming is
  // unavailable at the proxy/browser, the same protected online endpoint is polled until retry.
  useEffect(() => {
    const controller = new AbortController();
    let pollTimer: number | null = null;
    let retryTimer: number | null = null;
    let active = true;
    const fetchOnline = async () => {
      try {
        const result = await getOnlineVisitors();
        if (!active) return;
        setOnlineVisitors(result.visitors);
        setLiveStats(null);
        setLiveUpdatedAt(result.generatedAt);
      } catch {
        if (active) setLiveMode('unavailable');
      }
    };
    const startFallback = () => {
      if (!active) return;
      setLiveMode('polling');
      void fetchOnline();
      if (pollTimer === null) pollTimer = window.setInterval(() => void fetchOnline(), 10_000);
      if (retryTimer === null) retryTimer = window.setTimeout(() => {
        if (pollTimer !== null) { window.clearInterval(pollTimer); pollTimer = null; }
        retryTimer = null;
        void connect();
      }, 30_000);
    };
    const connect = async () => {
      try {
        const token = getToken();
        if (!token) throw new Error('Admin session unavailable');
        const response = await fetch('/api/v1/admin/visitor-intelligence/stream', {
          method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: controller.signal,
          headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}` },
        });
        if (!response.ok || !response.body) throw new Error(`Live stream unavailable (${response.status})`);
        setLiveMode('live');
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        while (active) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
          let separator = buffer.indexOf('\n\n');
          while (separator >= 0) {
            const frame = buffer.slice(0, separator);
            buffer = buffer.slice(separator + 2);
            let eventName = 'message';
            const data: string[] = [];
            frame.split('\n').forEach((line) => {
              if (line.startsWith('event:')) eventName = line.slice(6).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            });
            if (eventName === 'visitor-update' && data.length) {
              try { applyLiveSnapshot(JSON.parse(data.join('\n')) as VisitorLiveSnapshot); } catch { /* ignore malformed event */ }
            }
            separator = buffer.indexOf('\n\n');
          }
        }
        if (active && !controller.signal.aborted) throw new Error('Live stream closed');
      } catch {
        if (active && !controller.signal.aborted) startFallback();
      }
    };
    void connect();
    return () => {
      active = false;
      controller.abort();
      if (pollTimer !== null) window.clearInterval(pollTimer);
      if (retryTimer !== null) window.clearTimeout(retryTimer);
    };
  }, [applyLiveSnapshot]);

  useEffect(() => {
    if (!selectedCountry || !customDatesValid) { setCountryDetail(null); setCountryError(''); return; }
    let cancelled = false;
    getVisitorCountryDetail(selectedCountry, reportWindow)
      .then((detail) => { if (!cancelled) { setCountryDetail(detail); setCountryError(''); } })
      .catch((err: unknown) => { if (!cancelled) setCountryError(messageOf(err, 'Country details could not be loaded.')); });
    return () => { cancelled = true; };
  }, [selectedCountry, windowKey, customDatesValid]);

  async function saveSettings() {
    if (!settingsDraft) return;
    if (settingsDraft.enabled && !overview?.tracking.enabled && !window.confirm('Enable first-party visitor collection? Only visitors who explicitly allow Analytics will be counted. GA4 and Meta settings are unchanged.')) return;
    setSavingSettings(true);
    setSettingsMessage('');
    setSettingsError('');
    try {
      const result = await updateVisitorSettings(settingsDraft);
      setSettingsDraft(result.settings);
      setOverview((current) => current ? { ...current, tracking: result.settings } : current);
      setSettingsMessage(result.settings.enabled ? 'Visitor Intelligence is enabled for analytics-consented visits.' : 'Collection is paused. Historical data remains until its retention period expires.');
      setRefreshTick((value) => value + 1);
    } catch (err) {
      setSettingsError(messageOf(err, 'Settings could not be saved.'));
    } finally { setSavingSettings(false); }
  }

  function selectLocation(location: VisitorMapLocation) {
    setSelectedCountry(location.countryCode);
  }

  const onlineCount = liveStats?.currentlyOnline ?? onlineVisitors.length;
  const activeCount = liveStats?.activeVisitors ?? onlineVisitors.filter((visitor) => visitor.status === 'online').length;
  const selectedCountryName = countryDetail?.countryName ?? overview?.countries.find((country) => country.countryCode === selectedCountry)?.countryName ?? selectedCountry;

  return (
    <div className="ch247-stack vi-page">
      <section className="ch247-card vi-hero">
        <div>
          <p className="vi-eyebrow">Admin + Super Admin</p>
          <h1>Visitor Intelligence</h1>
          <p className="ch247-page__hint">First-party website analytics, independent of GA4 and advertising integrations. Collection requires the visitor’s Analytics choice and an explicit operator enablement.</p>
        </div>
        <div className="vi-hero__actions">
          <Link className="vi-link" to="/admin">← Admin dashboard</Link>
          <button type="button" className="vi-refresh" onClick={() => setRefreshTick((value) => value + 1)} disabled={loading || !customDatesValid}>Refresh reports</button>
        </div>
      </section>

      <section className="ch247-card vi-controls" aria-label="Analytics date range">
        <label>Date range<select value={range} onChange={(event) => setRange(event.target.value as VisitorDateRange)}>{RANGE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
        {range === 'custom' ? <>
          <label>From<input type="date" value={from} max={to || undefined} onChange={(event) => setFrom(event.target.value)} /></label>
          <label>Through<input type="date" value={to} min={from || undefined} onChange={(event) => setTo(event.target.value)} /></label>
        </> : null}
        <span className={`vi-live-indicator vi-live-indicator--${liveMode}`}><i aria-hidden="true" />{liveMode === 'live' ? 'Live updates' : liveMode === 'polling' ? 'Live stream reconnecting · polling' : liveMode === 'connecting' ? 'Connecting to live updates' : 'Live data unavailable'}</span>
        <small className="vi-updated">Updated {formatTime(liveUpdatedAt)}</small>
      </section>
      {range === 'custom' && !customDatesValid ? <p className="ch247-card vi-warning" role="status">Choose a valid start and end date. The range can be no longer than 366 days.</p> : null}
      {error ? <section className="ch247-card vi-error" role="alert"><strong>Reports unavailable</strong><p>{error}</p><p>If this deployment has not applied schema migration 0099, analytics tables do not yet exist. Tracking stays disabled by default.</p><button type="button" onClick={() => setRefreshTick((value) => value + 1)}>Try again</button></section> : null}
      {loading && !overview ? <p className="ch247-card" role="status">Loading first-party reports…</p> : null}
      {overview ? <>
        {!overview.tracking.enabled ? <section className="ch247-card vi-disabled" role="status"><strong>Collection is currently disabled.</strong> Reports will remain empty until an authorized operator enables it. Consent choices alone never turn on collection.</section> : null}
        <section className="vi-metrics" aria-label="Visitor summary">
          <Metric label="Online now" value={onlineCount} hint={`${formatNumber(activeCount)} active · idle visitors shown below`} />
          <Metric label="Unique visitors" value={overview.stats.uniqueVisitors} hint={range === 'today' ? 'Today (UTC)' : `Selected range · ${overview.range.label}`} />
          <Metric label="Pageviews" value={overview.stats.pageViews} hint={`${formatNumber(overview.stats.pageViewsToday)} today`} />
          <Metric label="New visitors" value={overview.stats.newVisitors} hint={`${formatNumber(overview.stats.returningVisitors)} returning`} />
        </section>

        <section className="ch247-card vi-card">
          <div className="vi-section-heading"><div><h2>Traffic over time</h2><p className="ch247-page__hint">Visitor and pageview totals by hour for one-day ranges, by day for longer ranges (UTC).</p></div><span>{loading ? 'Updating…' : `Range: ${overview.range.label}`}</span></div>
          <TrendChart points={overview.timeseries} />
        </section>

        <section className="ch247-card vi-card">
          <div className="vi-section-heading"><div><h2>Approximate visitor map</h2><p className="ch247-page__hint">Select a marker to inspect its country and city-level summary.</p></div><span className="vi-map-legend"><i /> Visitors · marker size represents volume</span></div>
          {locations.some((location) => mapPoint(location)) ? <WorldMap locations={locations} selectedCountry={selectedCountry} onSelect={selectLocation} /> : <p className="ch247-page__hint">No approximate GeoIP locations are available in this date range.</p>}
          {selectedCountry ? <div className="vi-country-detail">
            <div className="vi-section-heading"><h3>{selectedCountryName ?? 'Country details'}</h3><button type="button" className="vi-quiet-button" onClick={() => setSelectedCountry(null)}>Clear selection</button></div>
            {countryError ? <p role="alert">{countryError}</p> : countryDetail ? <>
              <div className="vi-detail-metrics"><span><strong>{formatNumber(countryDetail.visitors)}</strong> visitors</span><span><strong>{formatNumber(countryDetail.sessions)}</strong> sessions</span><span><strong>{formatNumber(countryDetail.pageViews)}</strong> pageviews</span></div>
              <div className="vi-detail-columns"><div><h4>Cities / regions</h4>{countryDetail.cities.length ? <ul>{countryDetail.cities.slice(0, 8).map((city) => <li key={`${city.cityName}-${city.regionName}`}>{city.cityName}{city.regionName ? `, ${city.regionName}` : ''} — {formatNumber(city.visitors)}</li>)}</ul> : <p>No city-level data.</p>}</div><div><h4>Top pages</h4>{countryDetail.topPages.length ? <ul>{countryDetail.topPages.slice(0, 8).map((page) => <li key={page.pagePath}><code>{page.pagePath}</code> — {formatNumber(page.pageViews)}</li>)}</ul> : <p>No pageviews in this range.</p>}</div></div>
            </> : <p role="status">Loading country detail…</p>}
          </div> : null}
        </section>

        <div className="vi-report-grid">
          <DataTable title="Top pages" headers={['Page path', 'Pageviews', 'Visitors']} empty={!overview.topPages.length} rows={overview.topPages.slice(0, 10).map((row) => <tr key={row.pagePath}><td><code>{row.pagePath}</code></td><td>{formatNumber(row.pageViews)}</td><td>{formatNumber(row.visitors)}</td></tr>)} />
          <DataTable title="Countries" headers={['Country', 'Visitors', 'Sessions', 'Pageviews']} empty={!overview.countries.length} rows={overview.countries.slice(0, 10).map((row) => <tr key={row.countryCode}><td><button type="button" className="vi-table-link" onClick={() => setSelectedCountry(row.countryCode)}>{row.countryName} <span>{row.countryCode}</span></button></td><td>{formatNumber(row.visitors)}</td><td>{formatNumber(row.sessions)}</td><td>{formatNumber(row.pageViews)}</td></tr>)} />
          <DataTable title="Cities / regions" headers={['Approximate location', 'Country', 'Visitors']} empty={!overview.cities.length} rows={overview.cities.slice(0, 10).map((row) => <tr key={`${row.countryCode}-${row.cityName}-${row.regionName}`}><td>{row.cityName}{row.regionName ? `, ${row.regionName}` : ''}</td><td>{row.countryName}</td><td>{formatNumber(row.visitors)}</td></tr>)} />
          <DataTable title="Referrers" headers={['Source', 'Referrer host', 'Visitors', 'Sessions']} empty={!overview.referrers.length} rows={overview.referrers.slice(0, 10).map((row, index) => <tr key={`${row.host ?? 'direct'}-${index}`}><td>{row.source}</td><td>{row.host ?? 'Direct / none'}</td><td>{formatNumber(row.visitors)}</td><td>{formatNumber(row.sessions)}</td></tr>)} />
        </div>

        <div className="vi-report-grid vi-report-grid--dimensions">
          {[['Devices', overview.devices], ['Browsers', overview.browsers], ['Operating systems', overview.operatingSystems]].map(([title, rows]) => {
            const dimensionRows = rows as VisitorOverview['devices'];
            return <DataTable key={title as string} title={title as string} headers={['Category', 'Visitors', 'Sessions']} empty={!dimensionRows.length} rows={dimensionRows.map((row) => <tr key={row.label}><td>{row.label}</td><td>{formatNumber(row.visitors)}</td><td>{formatNumber(row.sessions)}</td></tr>)} />;
          })}
        </div>
      </> : null}

      <section className="ch247-card vi-card">
        <div className="vi-section-heading"><div><h2>Live visitors and journey</h2><p className="ch247-page__hint">One visitor is counted across open tabs. Presence expires after a missed heartbeat; each visitor’s journey is limited to recent sanitized page paths.</p></div><span>{formatNumber(onlineVisitors.length)} present</span></div>
        {!onlineVisitors.length ? <p className="ch247-page__hint">No consented visitors are currently online.</p> : <div className="vi-visitor-list">
          {onlineVisitors.slice(0, 100).map((visitor) => <VisitorRow key={visitor.visitorId} visitor={visitor} />)}
        </div>}
      </section>

      <section className="ch247-card vi-card vi-settings">
        <div className="vi-section-heading"><div><h2>Privacy, collection and retention</h2><p className="ch247-page__hint">Changes apply to first-party Visitor Intelligence only. GA4, Meta Pixel and other marketing integrations retain their independent settings and consent behavior.</p></div><span>{overview?.tracking.enabled ? 'Collection enabled' : 'Collection disabled'}</span></div>
        {settingsError ? <p className="vi-error-text" role="alert">{settingsError}</p> : null}
        {settingsMessage ? <p className="vi-success-text" role="status">{settingsMessage}</p> : null}
        {settingsDraft ? <div className="vi-settings-grid">
          <label className="vi-setting-toggle"><input type="checkbox" checked={settingsDraft.enabled} onChange={(event) => setSettingsDraft({ ...settingsDraft, enabled: event.target.checked })} /><span><strong>Enable first-party collection</strong><small>Only after Analytics consent; disabled by default on new installs.</small></span></label>
          <label>Retention period (days)<input type="number" min={7} max={365} value={settingsDraft.retentionDays} onChange={(event) => setSettingsDraft({ ...settingsDraft, retentionDays: Number(event.target.value) })} /><small>Allowed range: 7–365 days. Default: 90.</small></label>
          <label>Idle after (seconds)<input type="number" min={60} max={3600} value={settingsDraft.idleAfterSeconds} onChange={(event) => setSettingsDraft({ ...settingsDraft, idleAfterSeconds: Number(event.target.value) })} /><small>Marks a present visitor as idle after no activity.</small></label>
          <label>Online timeout (seconds)<input type="number" min={60} max={600} value={settingsDraft.onlineTimeoutSeconds} onChange={(event) => setSettingsDraft({ ...settingsDraft, onlineTimeoutSeconds: Number(event.target.value) })} /><small>Removes a tab from live presence after missed heartbeats.</small></label>
        </div> : <p className="ch247-page__hint">Settings are unavailable until migration 0099 has been applied.</p>}
        <div className="vi-privacy-notes"><p><strong>Stored:</strong> random anonymous visitor/session/tab IDs, sanitized paths and coarse referrer domains, coarse client family and approximate country/city.</p><p><strong>Not stored or shown:</strong> raw IP, raw User-Agent, GPS, full referrer URL, query strings, form contents, account IDs, names, emails, passwords or authentication credentials.</p><p>Pageview and session data is purged by the daily worker according to the configured retention period. Withdrawing Analytics consent stops new collection and deletes linked visitor records.</p></div>
        {settingsDraft && !settingsDraftValid ? <p className="vi-error-text" role="alert">Check the allowed ranges: retention 7–365 days, idle 60–3,600 seconds, online timeout 60–600 seconds.</p> : null}
        <button type="button" onClick={() => void saveSettings()} disabled={!settingsDraftValid || savingSettings || !overview}>{savingSettings ? 'Saving…' : 'Save Visitor Intelligence settings'}</button>
        <small className="vi-audit-note">Settings changes are role-protected and written to the existing admin audit log. Enabling production collection remains an explicit administrator decision.</small>
      </section>
    </div>
  );
}

function VisitorRow({ visitor }: { visitor: OnlineVisitor }) {
  const location = [visitor.city, visitor.region, visitor.country].filter(Boolean).join(', ') || 'Location unknown';
  return (
    <details className="vi-visitor-row">
      <summary>
        <span className={`vi-status-dot vi-status-dot--${visitor.status}`} aria-label={visitor.status} />
        <strong>{visitor.status === 'online' ? 'Active' : 'Idle'}</strong>
        <span>{location}</span>
        <code>{visitor.currentPage}</code>
        <span>{visitor.device} · {visitor.browser}</span>
        <small>{formatDuration(visitor.visitDurationSeconds)} · {visitor.openTabs} tab{visitor.openTabs === 1 ? '' : 's'}</small>
      </summary>
      <div className="vi-visitor-details">
        <p><strong>Current pages:</strong> {visitor.currentPages.join(' · ') || visitor.currentPage}</p>
        <p><strong>Operating system:</strong> {visitor.operatingSystem} · <strong>Referrer:</strong> {visitor.referrerHost ?? 'Direct / none'}</p>
        <p><strong>First seen:</strong> {formatTime(visitor.firstSeenAt)} · <strong>Last activity:</strong> {formatTime(visitor.lastActivityAt)} · <strong>Last heartbeat:</strong> {formatTime(visitor.lastHeartbeatAt)}</p>
        <h4>Recent journey</h4>
        {visitor.journey.length ? <ol>{visitor.journey.map((event, index) => <li key={`${event.occurredAt}-${index}`}><code>{event.pagePath}</code><time dateTime={event.occurredAt}>{formatTime(event.occurredAt)}</time></li>)}</ol> : <p>No recent pageviews.</p>}
      </div>
    </details>
  );
}
