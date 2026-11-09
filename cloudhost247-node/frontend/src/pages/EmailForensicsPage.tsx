/**
 * Customer Email Trace & Forensics Analyzer (`/account/email-forensics`).
 *
 * Defensive header-analysis feature: customers upload an .eml file or paste raw email headers,
 * and the server returns source-IP candidates, a reconstructed route, authentication findings,
 * and DNS diagnostics — all derived from the headers supplied, with no external tracing API.
 *
 * Presentation rules (mirroring the server's evidence vocabulary):
 *   - Nothing here computes a forensic conclusion. Every label, confidence level and limitation
 *     comes from the API.
 *   - Results distinguish extracted evidence, independently verified information, approximate
 *     information (local IP intelligence), unverified information, and unavailable information.
 *   - The page never labels a report as a certified forensic report, and never implies an IP
 *     address identifies a person or a precise location.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePageMeta } from '../lib/usePageMeta';
import { CatalogErrorBanner, CatalogLoadingBanner } from '../components/CatalogStateBanner';
import {
  analyzeFile, analyzeHeaders, deleteAnalysis, detailToResult, fetchAnalysis,
  fetchDatabaseStatus, fetchHistory, fetchReport, type EmailForensicsResult,
  type AnalysisSummary, type IpCandidate,
} from '../lib/email-forensics-api';
import './email-forensics.css';

const MAX_FILE_SIZE = 5_000_000; // kept in sync with EMAIL_FORENSICS_MAX_FILE_SIZE

function formatTimestamp(value: string | null) {
  if (!value) return '—';
  return new Date(value).toLocaleString();
}

function confidenceTone(level: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (level) {
    case 'high': return 'ok';
    case 'medium': return 'warn';
    case 'low': return 'neutral';
    case 'none': return 'bad';
    default: return 'neutral';
  }
}

function addressClassTone(cls: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (cls) {
    case 'public': return 'warn';
    case 'private': case 'loopback': case 'reserved': case 'multicast': return 'neutral';
    default: return 'neutral';
  }
}

function trustTone(cls: string): 'ok' | 'warn' | 'bad' | 'neutral' {
  switch (cls) {
    case 'trusted_receiving_server': return 'ok';
    case 'unverified_upstream': return 'warn';
    case 'private_internal': return 'neutral';
    case 'public_candidate': return 'warn';
    case 'hidden_unavailable': return 'bad';
    default: return 'neutral';
  }
}

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

type Tab = 'input' | 'results';

export default function EmailForensicsPage() {
  usePageMeta(
    'Email Trace & Forensics Analyzer',
    'Analyse raw email headers, inspect sender IP information, reconstruct email routes and review authentication results.'
  );

  const [tab, setTab] = useState<Tab>('input');
  const [rawHeaders, setRawHeaders] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<EmailForensicsResult | null>(null);
  const [history, setHistory] = useState<AnalysisSummary[] | null>(null);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyError, setHistoryError] = useState('');
  const [dbStatus, setDbStatus] = useState<{ versions: Array<{ provider: string; name: string; version: string | null; status: string }>; note: string } | null>(null);

  const pasteRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryError('');
    try {
      const response = await fetchHistory({ limit: 20, offset: 0 });
      setHistory(response.analyses);
      setHistoryTotal(response.total);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'Could not load history.');
    }
  }, []);

  useEffect(() => {
    loadHistory();
    fetchDatabaseStatus()
      .then(setDbStatus)
      .catch(() => { /* database status is optional context */ });
  }, [loadHistory]);

  const handlePaste = useCallback((event: React.ClipboardEvent) => {
    const clipboardData = event.clipboardData;
    if (!clipboardData) return;
    const text = clipboardData.getData('text/plain');
    if (text && text.includes('Received:') || text.includes('From:')) {
      event.preventDefault();
      setRawHeaders(text);
      setFile(null);
      setFileError('');
      setTab('input');
    }
  }, []);

  const handleFileChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const selected = event.target.files?.[0] ?? null;
    setFile(null);
    setFileError('');
    if (!selected) return;
    if (!/\.(eml|txt)$/i.test(selected.name)) {
      setFileError('Only .eml or .txt files are accepted.');
      return;
    }
    if (selected.size > MAX_FILE_SIZE) {
      setFileError(`File is too large (${fileSize(selected.size)}). Maximum is ${fileSize(MAX_FILE_SIZE)}.`);
      return;
    }
    setFile(selected);
  }, []);

  const clearInput = useCallback(() => {
    setRawHeaders('');
    setFile(null);
    setFileError('');
    setError('');
    setResult(null);
    setTab('input');
    if (pasteRef.current) pasteRef.current.value = '';
  }, []);

  const analyzePasted = useCallback(async () => {
    if (!rawHeaders.trim()) {
      setError('Paste email headers or upload a file first.');
      return;
    }
    setError('');
    setAnalyzing(true);
    try {
      const analyzed = await analyzeHeaders({ rawHeaders });
      setResult(analyzed);
      setTab('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }, [rawHeaders]);

  const analyzeUploaded = useCallback(async () => {
    if (!file) {
      setError('Select a file first.');
      return;
    }
    setError('');
    setAnalyzing(true);
    try {
      const analyzed = await analyzeFile({ file });
      setResult(analyzed);
      setTab('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed.');
    } finally {
      setAnalyzing(false);
    }
  }, [file]);

  const rerunHistoryItem = useCallback(async (id: string) => {
    setError('');
    setAnalyzing(true);
    try {
      const detail = await fetchAnalysis(id);
      setResult(detailToResult(detail));
      setTab('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not reopen analysis.');
    } finally {
      setAnalyzing(false);
    }
  }, [history]);

  const deleteHistoryItem = useCallback(async (id: string, reference: string) => {
    if (!window.confirm(`Delete analysis ${reference}? This cannot be undone.`)) return;
    try {
      await deleteAnalysis(id);
      setHistory((current) => (current ? current.filter((h) => h.id !== id) : current));
      if (result?.analysisReference === reference) setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed.');
    }
  }, [result]);

  const downloadReport = useCallback((format: 'json' | 'pdf') => {
    if (!result) return;
    void fetchReport(result.analysisReference, format).then((blob) => {
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `forensics-${result.analysisReference}.${format}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    }).catch((err) => {
      setError(err instanceof Error ? err.message : 'Report download failed.');
    });
  }, [result]);

  const inputTab = (
    <>
      {error && <CatalogErrorBanner message={error} />}
      <div className="ch247-card ef-card">
        <h1>Email Trace & Forensics Analyzer</h1>
        <p className="ch247-page__hint ef-intro">
          Analyse raw email headers to inspect available sender IP information, reconstruct the
          transmission route and review authentication results. No external tracing or IP-lookup
          API is used — everything is computed from the headers you supply.
        </p>

        <div className="ef-input-group">
          <label className="ef-label">Paste raw email headers</label>
          <textarea
            ref={pasteRef}
            className="ef-textarea"
            placeholder="Paste the complete raw email headers here…"
            value={rawHeaders}
            onChange={(event) => {
              setRawHeaders(event.target.value);
              setFile(null);
              setFileError('');
            }}
            onPaste={handlePaste}
            aria-label="Raw email headers"
            rows={16}
          />
          <p className="ch247-page__hint ef-hint">
            Include the full header block (Received, From, Return-Path, SPF/DKIM/DMARC results,
            etc.). Headers are analysed locally — nothing is sent to an external tracing service.
          </p>
        </div>

        <div className="ef-input-group">
          <label className="ef-label">Or upload an email file</label>
          <div className="ef-upload">
            <input
              type="file"
              accept=".eml,.txt"
              aria-label="Email file"
              onChange={handleFileChange}
            />
            {file && (
              <span className="ef-file-name">
                {file.name} ({fileSize(file.size)})
                <button type="button" className="ch247-btn ch247-button--small" onClick={() => {
                  setFile(null); setFileError('');
                }}>Remove</button>
              </span>
            )}
            {fileError && <span className="ef-file-error">{fileError}</span>}
          </div>
          <p className="ch247-page__hint ef-hint">
            Upload a .eml file or a plain-text raw-header file (max {fileSize(MAX_FILE_SIZE)}).
            Attachments and message bodies are not stored — only header-derived evidence is kept.
          </p>
        </div>

        <div className="ef-actions">
          <button
            type="button"
            className="ch247-btn ch247-btn--primary"
            disabled={analyzing || (!rawHeaders.trim() && !file)}
            onClick={file ? analyzeUploaded : analyzePasted}
          >
            {analyzing ? 'Analyzing…' : 'Analyze Email'}
          </button>
          <button
            type="button"
            className="ch247-btn"
            disabled={analyzing}
            onClick={clearInput}
          >
            Clear Input
          </button>
        </div>
      </div>
    </>
  );

  const renderCandidate = (c: IpCandidate) => (
    <tr key={`${c.ipAddress}-${c.sourceHeader}-${c.hopNumber ?? 0}`}>
      <td>{c.ipAddress}</td>
      <td>{c.ipVersion}</td>
      <td>
        <span className={`ef-badge ef-badge--${addressClassTone(c.addressClass)}`}>
          {c.addressClass}
        </span>
      </td>
      <td>
        <span className={`ef-badge ef-badge--${trustTone(c.trustClassification)}`}>
          {c.trustClassification.replace(/_/g, ' ')}
        </span>
      </td>
      <td>
        <span className={`ef-badge ef-badge--${confidenceTone(c.confidenceLevel)}`}>
          {c.confidenceLevel} confidence
        </span>
      </td>
      <td>{c.sourceHeader}{c.hopNumber !== null ? ` (hop ${c.hopNumber})` : ''}</td>
      <td className="ef-mono">{c.rawValue}</td>
    </tr>
  );

  const resultsTab = (
    <>
      {!result && (
        <div className="ch247-card ef-card">
          <CatalogLoadingBanner label="Loading analysis…" />
        </div>
      )}
      {result && (
        <>
          <div className="ch247-card ef-card">
            <h1>Analysis Results</h1>
            <p className="ch247-page__hint ef-hint">
              Reference <strong>{result.analysisReference}</strong> •{' '}
              {new Date(result.createdAt).toLocaleString()}
            </p>
            <div className="ef-actions">
              <button type="button" className="ch247-btn" onClick={() => setTab('input')}>
                New Analysis
              </button>
              <button
                type="button"
                className="ch247-btn ch247-btn--primary"
                onClick={() => downloadReport('json')}
              >
                Download JSON Report
              </button>
              <button
                type="button"
                className="ch247-btn ch247-btn--primary"
                onClick={() => downloadReport('pdf')}
              >
                Download PDF Report
              </button>
            </div>
          </div>

          {/* A. Email Overview */}
          <div className="ch247-card ef-card">
            <h2>A. Email Overview</h2>
            <table className="ch247-table ef-table">
              <tbody>
                <tr><td className="ef-label-col">Sender</td><td>{result.emailOverview.sender ?? '—'}</td></tr>
                <tr><td className="ef-label-col">Recipient</td><td>{result.emailOverview.recipient ?? '—'}</td></tr>
                <tr><td className="ef-label-col">Subject</td><td>{result.emailOverview.subject ?? '—'}</td></tr>
                <tr><td className="ef-label-col">Message-ID</td><td className="ef-mono">{result.emailOverview.messageId ?? '—'}</td></tr>
                <tr><td className="ef-label-col">Date</td><td>{formatTimestamp(result.emailOverview.date)}</td></tr>
                <tr><td className="ef-label-col">Sending domain</td><td>{result.emailOverview.sendingDomain ?? '—'}</td></tr>
              </tbody>
            </table>
          </div>

          {/* B. Source IP Analysis */}
          <div className="ch247-card ef-card">
            <h2>B. Source IP Analysis</h2>
            <p className="ef-note">{result.sourceIpAnalysis.originIpMessage}</p>
            <table className="ch247-table ef-table">
              <thead>
                <tr>
                  <th>IP address</th><th>Version</th><th>Class</th><th>Trust</th>
                  <th>Confidence</th><th>Source header</th><th>Raw value</th>
                </tr>
              </thead>
              <tbody>
                {result.sourceIpAnalysis.candidates.length === 0 ? (
                  <tr><td colSpan={7}>No IP candidates found in the supplied headers.</td></tr>
                ) : result.sourceIpAnalysis.candidates.map(renderCandidate)}
              </tbody>
            </table>
          </div>

          {/* C. Email Route */}
          <div className="ch247-card ef-card">
            <h2>C. Email Route</h2>
            <p className="ch247-page__hint ef-hint">
              Hops are reconstructed from the Received headers. Hop 1 was added by the receiving
              server closest to you and is treated as the most trustworthy observation; earlier
              headers are unverified upstream and may be forged. Timestamps are not corrected.
            </p>
            {result.emailRoute.hops.length === 0 ? (
              <p>No route hops could be reconstructed (no Received headers present).</p>
            ) : (
              <table className="ch247-table ef-table">
                <thead>
                  <tr>
                    <th>Hop</th><th>Receiving server</th><th>IP</th><th>Timestamp</th>
                    <th>TLS</th><th>Trust</th><th>Source</th>
                  </tr>
                </thead>
                <tbody>
                  {result.emailRoute.hops.map((h) => (
                    <tr key={`hop-${h.hopNumber}`}>
                      <td>{h.hopNumber}</td>
                      <td>{h.hostname ?? '—'}</td>
                      <td className="ef-mono">{h.ipAddress ?? '—'}</td>
                      <td>{formatTimestamp(h.receivedTimestamp)}</td>
                      <td>{h.tlsInformation ?? '—'}</td>
                      <td>
                        <span className={`ef-badge ef-badge--${trustTone(h.trustClassification)}`}>
                          {h.trustClassification.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="ef-mono ef-small">{h.headerSource}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!result.emailRoute.chronological && (
              <p className="ch247-page__hint ef-warn">
                Route timestamps contradict each other and have not been corrected — treat the
                order as approximate.
              </p>
            )}
          </div>

          {/* D. Authentication */}
          <div className="ch247-card ef-card">
            <h2>D. Authentication</h2>
            <table className="ch247-table ef-table">
              <thead>
                <tr><th>Check</th><th>Reported result</th><th>Verified by CloudHost247</th><th>Explanation</th></tr>
              </thead>
              <tbody>
                {result.authentication.map((a) => (
                  <tr key={a.authenticationType}>
                    <td>{a.authenticationType.toUpperCase()}</td>
                    <td>{a.reportedResult ?? 'not reported'}</td>
                    <td>{a.independentlyVerified ? 'Yes' : 'No — reported by receiving server only'}</td>
                    <td>{a.explanation ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="ch247-page__hint ef-hint">
              Results reported by the receiving mail server are shown separately from checks
              CloudHost247 performed itself (via local DNS lookups). A pass does not guarantee the
              email is safe.
            </p>
          </div>

          {/* E. DNS Diagnostics */}
          <div className="ch247-card ef-card">
            <h2>E. DNS Diagnostics</h2>
            <table className="ch247-table ef-table">
              <tbody>
                <tr>
                  <td className="ef-label-col">MX</td>
                  <td>{result.dnsDiagnostics.mx?.records.join(', ') ?? '—'}</td>
                  <td className="ef-small">Source: {result.dnsDiagnostics.mx?.source ?? 'unavailable'}</td>
                </tr>
                <tr>
                  <td className="ef-label-col">SPF</td>
                  <td className="ef-mono">{result.dnsDiagnostics.spf?.record ?? '—'}</td>
                  <td className="ef-small">Source: {result.dnsDiagnostics.spf?.source ?? 'unavailable'}</td>
                </tr>
                <tr>
                  <td className="ef-label-col">DKIM</td>
                  <td className="ef-mono">{result.dnsDiagnostics.dkim?.record ?? '—'}</td>
                  <td className="ef-small">
                    Selector: {result.dnsDiagnostics.dkim?.selector ?? '—'} • Domain:{' '}
                    {result.dnsDiagnostics.dkim?.domain ?? '—'} • Source: {result.dnsDiagnostics.dkim?.source ?? 'unavailable'}
                  </td>
                </tr>
                <tr>
                  <td className="ef-label-col">DMARC</td>
                  <td className="ef-mono">{result.dnsDiagnostics.dmarc?.record ?? '—'}</td>
                  <td className="ef-small">Source: {result.dnsDiagnostics.dmarc?.source ?? 'unavailable'}</td>
                </tr>
                <tr>
                  <td className="ef-label-col">PTR</td>
                  <td>{result.dnsDiagnostics.ptr?.hostname ?? '—'}</td>
                  <td className="ef-small">Source: {result.dnsDiagnostics.ptr?.source ?? 'unavailable'}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* F. Forensic Assessment */}
          <div className="ch247-card ef-card">
            <h2>F. Forensic Assessment</h2>
            {result.forensicAssessment.missingInformation.length > 0 && (
              <>
                <h3>Missing information</h3>
                <ul>{result.forensicAssessment.missingInformation.map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            )}
            {result.forensicAssessment.unverifiedHeaders.length > 0 && (
              <>
                <h3>Unverified headers</h3>
                <ul>{result.forensicAssessment.unverifiedHeaders.map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            )}
            {result.forensicAssessment.routingAnomalies.length > 0 && (
              <>
                <h3>Routing anomalies</h3>
                <ul>
                  {result.forensicAssessment.routingAnomalies.map((a) => (
                    <li key={`${a.hop}-${a.flag}`}>{a.description}</li>
                  ))}
                </ul>
              </>
            )}
            {result.forensicAssessment.authenticationConcerns.length > 0 && (
              <>
                <h3>Authentication concerns</h3>
                <ul>{result.forensicAssessment.authenticationConcerns.map((m) => <li key={m}>{m}</li>)}</ul>
              </>
            )}
            <h3>Technical limitations</h3>
            <ul>{result.forensicAssessment.technicalLimitations.map((m) => <li key={m}>{m}</li>)}</ul>
            <p className="ch247-page__hint ef-limits">
              IP geolocation is approximate and comes from a locally stored database. The analyzer
              cannot guarantee recovery of the sender's original device IP, and an IP address
              cannot reliably identify a specific person or their precise physical location.
            </p>
          </div>
        </>
      )}
    </>
  );

  const historyTab = (
    <div className="ch247-card ef-card">
      <h2>Analysis History</h2>
      {historyError && <CatalogErrorBanner message={historyError} />}
      {history === null && <CatalogLoadingBanner label="Loading history…" />}
      {history !== null && history.length === 0 && (
        <p>No analyses yet. Upload or paste email headers to get started.</p>
      )}
      {history !== null && history.length > 0 && (
        <table className="ch247-table ef-table">
          <thead>
            <tr>
              <th>Reference</th><th>Subject</th><th>Sender</th><th>Status</th><th>Created</th><th /> <th />
            </tr>
          </thead>
          <tbody>
            {history.map((item) => (
              <tr key={item.id}>
                <td className="ef-mono">{item.analysisReference}</td>
                <td>{item.subject ?? '—'}</td>
                <td>{item.sender ?? '—'}</td>
                <td>{item.status}</td>
                <td>{formatTimestamp(item.createdAt)}</td>
                <td>
                  <button
                    type="button"
                    className="ch247-btn ch247-button--small"
                    onClick={() => rerunHistoryItem(item.id)}
                  >
                    Reopen
                  </button>
                </td>
                <td>
                  <button
                    type="button"
                    className="ch247-btn ch247-button--small ef-btn-delete"
                    onClick={() => deleteHistoryItem(item.id, item.analysisReference)}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="ch247-stack" onPaste={handlePaste}>
      {tab === 'input' ? inputTab : resultsTab}
      {tab === 'results' && historyTab}
    </div>
  );
}
