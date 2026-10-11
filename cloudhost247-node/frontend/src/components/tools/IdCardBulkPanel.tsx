/**
 * Bulk employee import: template, upload, preview, error report and batch generation.
 *
 * The panel is deliberately faithful to what the importer actually does. It shows the accepted and
 * rejected rows separately, names the reason for each rejection, offers the rejected rows as a CSV
 * the user can fix and re-upload, and reports per-card failures from the generation pass instead of
 * claiming a clean run. A batch tool that quietly drops the rows it could not read is worse than no
 * batch tool.
 */

import { useMemo, useState } from 'react';
import {
  BULK_MAX_ROWS,
  buildCardLayout,
  csvTemplate,
  parseWorkbookFile,
  rejectedRowsCsv,
  summariseReport,
  validateRows,
  type BulkAccepted,
  type BulkReport,
  type CardSpec,
  type CardFormState,
  type CardLayout,
} from '../../../../src/tools/business/id-card';
import { exportBulk } from '../../lib/id-card/export';

export default function IdCardBulkPanel({ base }: { base: CardFormState }) {
  const [report, setReport] = useState<BulkReport | null>(null);
  const [fileName, setFileName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [format, setFormat] = useState<'png' | 'pdf'>('png');
  const [progress, setProgress] = useState<{ done: number; total: number; current: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string; failed: Array<{ rowNumber: number; name: string; reason: string }> } | null>(null);

  const summary = useMemo(() => (report ? summariseReport(report) : ''), [report]);
  const overLimit = report !== null && report.accepted.length > BULK_MAX_ROWS;

  async function onFile(file: File): Promise<void> {
    setError('');
    setResult(null);
    setReport(null);
    setFileName(file.name);
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is larger than 20 MB. Split the roster and import it in parts.');
      return;
    }
    setBusy(true);
    try {
      const rows = await parseWorkbookFile(file);
      if (rows.length === 0) {
        setError('That file has no rows this importer can read. Download the template and check the header row.');
        return;
      }
      if (rows.length - 1 > 5000) {
        setError(`That file has ${rows.length - 1} employee rows. This tool imports up to 5,000 rows at a time — split the file.`);
        return;
      }
      setReport(validateRows(rows, { base }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'That file could not be read.');
    } finally {
      setBusy(false);
    }
  }

  function downloadBlob(content: string, filename: string, type = 'text/csv'): void {
    const blob = new Blob([content], { type: `${type};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  async function generate(): Promise<void> {
    if (!report) return;
    setBusy(true);
    setProgress({ done: 0, total: report.accepted.length, current: '' });
    setResult(null);
    try {
      const outcome = await exportBulk({
        entries: report.accepted,
        format,
        companyName: base.companyName,
        templateLabel: base.template,
        report,
        layoutFor: (spec: CardSpec): CardLayout => buildCardLayout(spec),
        onProgress: setProgress,
      });
      setResult({ ok: outcome.ok, message: outcome.message, failed: outcome.failed });
    } catch (failure) {
      setResult({
        ok: false,
        message: failure instanceof Error ? failure.message : 'The batch could not be completed.',
        failed: [],
      });
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <section className="idc-panel" aria-labelledby="idc-bulk-title">
      <h3 className="bt247-panel__title" id="idc-bulk-title">
        Bulk generation from Excel or CSV
      </h3>
      <p className="ch247-page__hint" style={{ marginTop: 0 }}>
        Generate the whole team in one pass, using the template and company branding set above.
        Nothing is uploaded: the file is read in this tab, and the cards are produced and packed here.
      </p>

      <ol className="idc-steps">
        <li>
          <strong>Download the template.</strong> It carries the exact column headers this importer maps,
          with two example rows you can delete.
          <div className="bt247-actions" style={{ marginTop: '0.5rem' }}>
            <button type="button" className="ch247-button ch247-button--small" onClick={() => downloadBlob(csvTemplate(), 'cloudhost247-employee-id-card-template.csv')}>
              Download CSV template
            </button>
          </div>
        </li>
        <li>
          <strong>Fill it in.</strong> Name and Employee ID are required; every other column is optional.
          Photo URLs must be <code>https://</code> links, because the browser fetches them to draw the card.
        </li>
        <li>
          <strong>Upload the CSV or <code>.xlsx</code>.</strong>
          <div className="idc-file">
            <label className="ch247-field-label" htmlFor="idc-bulk-file">
              Employee roster
            </label>
            <input
              id="idc-bulk-file"
              type="file"
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void onFile(file);
              }}
            />
          </div>
        </li>
      </ol>

      {busy && !progress ? <p role="status">Reading {fileName}…</p> : null}
      {error ? (
        <p className="idc-flash idc-flash--error" role="alert">
          {error}
        </p>
      ) : null}

      {report ? (
        <div className="idc-bulk__report">
          <p role="status" aria-live="polite" className="idc-bulk__summary">
            <strong>{fileName}</strong> — {summary}
          </p>

          {report.missingColumns.length > 0 ? (
            <p className="idc-flash idc-flash--error" role="alert">
              This file is missing required columns: {report.missingColumns.join(', ')}. Download the
              template, move your data into it, and upload that.
            </p>
          ) : null}

          {report.unmappedHeaders.length > 0 ? (
            <p className="idc-flash idc-flash--warn">
              These columns were not recognised and were ignored: {report.unmappedHeaders.join(', ')}. Their data is not on any card.
            </p>
          ) : null}

          {report.accepted.length > 0 ? (
            <div className="bt247-table-wrap">
              <table className="bt247-table">
                <caption>
                  Employees ready to generate ({report.accepted.length}
                  {overLimit ? `, first ${BULK_MAX_ROWS} shown` : ''})
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Row</th>
                    <th scope="col">Name</th>
                    <th scope="col">Employee ID</th>
                    <th scope="col">Department</th>
                    <th scope="col">Photo</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {report.accepted.slice(0, BULK_MAX_ROWS).map((entry: BulkAccepted) => (
                    <tr key={entry.rowNumber}>
                      <th scope="row">{entry.rowNumber}</th>
                      <td>{entry.spec.spec.employee.fullName}</td>
                      <td>{entry.spec.spec.employee.employeeId}</td>
                      <td>{entry.spec.spec.employee.department || '—'}</td>
                      <td>{entry.photoUrl ? 'URL' : entry.spec.spec.images.photo ? 'Embedded' : 'Monogram'}</td>
                      <td className="bt247-row__hint">{entry.warnings.slice(0, 1).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {report.rejected.length > 0 ? (
            <>
              <h4 className="idc-bulk__subtitle">
                {report.rejected.length} row{report.rejected.length === 1 ? '' : 's'} need attention
              </h4>
              <p className="ch247-page__hint" style={{ marginTop: 0 }}>
                Nothing was discarded silently. Fix these rows in your file and upload it again, or
                carry on and generate the {report.accepted.length} valid card
                {report.accepted.length === 1 ? '' : 's'}.
              </p>
              <div className="bt247-table-wrap">
                <table className="bt247-table">
                  <caption>Rejected rows and why</caption>
                  <thead>
                    <tr>
                      <th scope="col">Row</th>
                      <th scope="col">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.rejected.map((entry) => (
                      <tr key={entry.rowNumber}>
                        <th scope="row">{entry.rowNumber}</th>
                        <td>{entry.reasons.join(' ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="bt247-actions">
                <button
                  type="button"
                  className="ch247-button ch247-button--small ch247-button--ghost"
                  onClick={() => downloadBlob(rejectedRowsCsv(report), 'rejected-employee-rows.csv')}
                >
                  Download rejected rows (CSV)
                </button>
              </div>
            </>
          ) : null}

          {overLimit ? (
            <p className="idc-flash idc-flash--warn">
              {report.accepted.length} cards is more than this tool will render in one batch
              ({BULK_MAX_ROWS}). The first {BULK_MAX_ROWS} are generated; split the roster and run the
              rest, so the tab does not run out of memory half way through.
            </p>
          ) : null}

          <div className="idc-export__group">
            <h4>Generate the batch</h4>
            <div className="idc-radio-row">
              <label>
                <input type="radio" name="idc-bulk-format" checked={format === 'png'} onChange={() => setFormat('png')} /> PNG
                (front and back per employee)
              </label>
              <label>
                <input type="radio" name="idc-bulk-format" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> PDF
                (one two-page document per employee)
              </label>
            </div>
            <div className="bt247-actions">
              <button
                type="button"
                className="ch247-button"
                disabled={busy || report.accepted.length === 0}
                onClick={() => void generate()}
              >
                {busy ? 'Generating…' : `Generate ${Math.min(report.accepted.length, BULK_MAX_ROWS)} cards`}
              </button>
            </div>
            {progress ? (
              <p role="status" aria-live="polite" className="idc-bulk__progress">
                {progress.done} of {progress.total} rendered{progress.current ? ` — ${progress.current}` : ''}
              </p>
            ) : null}
          </div>

          {result ? (
            <div className={result.ok ? 'idc-flash idc-flash--ok' : 'idc-flash idc-flash--error'} role="status" aria-live="polite">
              <p style={{ margin: 0 }}>{result.message}</p>
              {result.failed.length > 0 ? (
                <ul>
                  {result.failed.map((entry) => (
                    <li key={entry.rowNumber}>
                      Row {entry.rowNumber} ({entry.name}): {entry.reason}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
