/**
 * Employee ID Card Generator — the badge maker.
 *
 * This page is the interactive half of the tool; the engine lives in
 * `cloudhost247-node/src/tools/business/id-card/` and is shared with the API and the test suite. The
 * split is deliberate: every layout decision, every validation rule and both code encoders are in
 * the engine, so the same card is produced by the browser, by the API and by the tests, and only the
 * DOM work (uploads, canvas, downloads, storage) lives here.
 *
 * Three behaviours are load-bearing and easy to lose in a refactor:
 *
 *  1. The preview is the export. `renderFace()` draws at 300 dpi and the preview scales that canvas
 *     with CSS, so what is on screen is what is downloaded.
 *  2. The form never reports success it cannot back up. Missing validation blocks the downloads and
 *     says which field is at fault; advisories are shown without blocking anything.
 *  3. Photographs and signatures stay in memory unless the user opts in to local storage, and there
 *     is a control that removes everything this tool has stored.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../../components/ui/Icon';
import { usePageMeta } from '../../lib/usePageMeta';
import IdCardBulkPanel from '../../components/tools/IdCardBulkPanel';
import IdCardExportPanel from '../../components/tools/IdCardExportPanel';
import IdCardPreview, { type PreviewSide } from '../../components/tools/IdCardPreview';
import { readImageFile } from '../../lib/id-card/read-image';
import { loadCard, saveCard } from '../../lib/id-card/storage';
import {
  BLOOD_GROUPS,
  CARD_PRESETS,
  CARD_TEMPLATES,
  buildCardLayout,
  buildSpec,
  defaultFormState,
  fileSlug,
  validateQrUrl,
  type CardFormState,
  type CardPresetId,
  type CardTemplateId,
  type FieldIssue,
} from '../../../../src/tools/business/id-card';

const ROOT = '/tools/business-tools';

type Tab = 'design' | 'bulk' | 'export';

export default function IdCardGeneratorPage() {
  usePageMeta(
    'Employee ID Card Generator — Free Staff Badge Maker | CloudHost247',
    'Create print-ready employee ID cards in your browser: 12 templates, eight colour presets, custom colours, live front-and-back preview, real QR and Code 128 codes, PDF/PNG/JPG downloads and bulk generation from CSV or Excel. Your employee data never leaves the browser.',
    {
      canonical: `${ROOT}/employee-id-card-generator`,
      jsonLd: {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: 'Employee ID Card Generator',
        applicationCategory: 'BusinessApplication',
        operatingSystem: 'Any browser',
        description:
          'Free employee ID badge maker with twelve templates, live front-and-back preview, scannable QR and Code 128 codes, high-resolution PDF/PNG/JPG export and bulk generation from CSV or Excel. All processing happens in the browser.',
        offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN' },
      },
    }
  );

  const [state, setState] = useState<CardFormState>(() => {
    const found = loadCard();
    return found ? { ...defaultFormState(), ...found.state } : defaultFormState();
  });
  const [tab, setTab] = useState<Tab>('design');
  const [side, setSide] = useState<PreviewSide>('front');
  const [zoom, setZoom] = useState(9);
  const [flash, setFlash] = useState<{ ok: boolean; message: string } | null>(null);
  const [uploadError, setUploadError] = useState<Record<string, string>>({});
  const [restored] = useState(() => loadCard());
  const [autoSaved, setAutoSaved] = useState<string>('');
  const firstRender = useRef(true);

  /** Every render re-validates: the preview, the downloads and the messages read one result. */
  const validation = useMemo(() => buildSpec(state), [state]);
  const layout = useMemo(() => buildCardLayout(validation.spec), [validation.spec]);
  const ready = validation.errors.length === 0;
  const slug = useMemo(() => fileSlug(validation.spec.employee.employeeId || validation.spec.employee.fullName, 'employee'), [validation.spec]);
  const title = `${validation.spec.employee.fullName || 'Employee'} — employee ID card`;

  const set = useCallback(<Key extends keyof CardFormState>(key: Key, value: CardFormState[Key]): void => {
    setState((current) => ({ ...current, [key]: value }));
  }, []);

  /* Save the text fields shortly after typing stops. Sensitive fields are handled by the storage
     module, which leaves them out unless the user consented. */
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      const result = saveCard(state);
      setAutoSaved(result.message);
    }, 900);
    return () => window.clearTimeout(timer);
  }, [state]);

  async function onUpload(kind: 'photo' | 'logo' | 'signature', file: File | undefined): Promise<void> {
    if (!file) return;
    const result = await readImageFile(kind === 'photo' ? 'photo' : kind === 'logo' ? 'logo' : 'signature', file);
    if (!result.ok) {
      setUploadError((current) => ({ ...current, [kind]: result.message }));
      return;
    }
    setUploadError((current) => {
      const next = { ...current };
      delete next[kind];
      return next;
    });
    set(kind, result.dataUrl);
    setFlash({ ok: true, message: `${kind === 'photo' ? 'Photograph' : kind === 'logo' ? 'Logo' : 'Signature'} added — ${result.width} × ${result.height} px.${result.warning ? ` ${result.warning}` : ''}` });
  }

  function applyPreset(id: CardPresetId): void {
    const preset = CARD_PRESETS.find((entry) => entry.id === id);
    if (!preset) return;
    setState((current) => ({
      ...current,
      preset: id,
      primary: preset.accent,
      detail: preset.detail,
    }));
  }

  function resetForm(): void {
    const fresh = defaultFormState();
    setState(fresh);
    setUploadError({});
    setFlash({ ok: true, message: 'Form reset to the default template, Salario Green palette and empty fields. Nothing was saved.' });
  }

  const errorFor = useCallback((key: string): string | undefined => validation.errors.find((error: FieldIssue) => error.key === key)?.message, [validation.errors]);
  const fieldProps = (key: string): { 'aria-invalid'?: boolean; 'aria-describedby'?: string } =>
    errorFor(key) ? { 'aria-invalid': true, 'aria-describedby': `idc-error-${key}` } : {};

  return (
    <div className="idc">
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <nav aria-label="Breadcrumb">
            <ol className="bt247-breadcrumbs">
              <li>
                <Link to="/">Home</Link>
              </li>
              <li>
                <Link to="/tools">Tools</Link>
              </li>
              <li>
                <Link to={ROOT}>Business Tools</Link>
              </li>
              <li aria-current="page">Employee ID Card Generator</li>
            </ol>
          </nav>
          <h1>Employee ID Card Generator</h1>
          <p>
            Design a print-ready staff badge: twelve templates, the eight CloudHost247 colour presets
            or your own four colours, a live front-and-back preview, real scannable QR and Code 128
            codes, and high-resolution PDF, PNG and JPG downloads. When you have a roster rather than a
            person, the bulk importer generates the whole team from a CSV or Excel file.
          </p>
          <ul className="bt247-hero__counts">
            <li>
              <strong>12</strong> templates
            </li>
            <li>
              <strong>8</strong> colour presets
            </li>
            <li>
              <strong>300</strong> dpi exports
            </li>
            <li>
              <strong>0</strong> uploads — everything runs in your browser
            </li>
          </ul>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-page--wide ch247-stack">
          {restored ? (
            <p className="idc-flash" role="status">
              Restored the card details saved in this browser on {restored.savedAt ? new Date(restored.savedAt).toLocaleString() : 'a previous visit'}.
              Nothing was sent anywhere. Use <strong>Clear stored data</strong> below to remove it.
            </p>
          ) : null}

          {flash ? (
            <p className={flash.ok ? 'idc-flash idc-flash--ok' : 'idc-flash idc-flash--error'} role="status" aria-live="polite">
              {flash.message}
            </p>
          ) : null}

          {validation.errors.length > 0 ? (
            <div className="idc-flash idc-flash--error" role="alert">
              <p style={{ margin: 0 }}>
                <strong>{validation.errors.length} field{validation.errors.length === 1 ? '' : 's'} still need attention.</strong> The preview
                below shows what the card will look like; the downloads stay locked until these are fixed.
              </p>
              <ul>
                {validation.errors.map((error) => (
                  <li key={error.key}>
                    <a href={`#idc-field-${error.key}`}>{error.message}</a>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="idc-layout">
            {/* ---------------- Left: the form ---------------- */}
            <form className="idc-form" noValidate onSubmit={(event) => event.preventDefault()}>
              <fieldset className="bt247-fieldset">
                <legend>Employee</legend>
                <div className="bt247-fields">
                  <Field id="fullName" label="Full name" required error={errorFor('fullName')}>
                    <input
                      id="idc-field-fullName"
                      type="text"
                      value={state.fullName}
                      maxLength={60}
                      autoComplete="off"
                      placeholder="Amara Okafor"
                      onChange={(event) => set('fullName', event.target.value)}
                      {...fieldProps('fullName')}
                    />
                  </Field>
                  <Field id="employeeId" label="Employee ID" required error={errorFor('employeeId')} help="Printed on the card and used for the QR code and barcode.">
                    <input
                      id="idc-field-employeeId"
                      type="text"
                      value={state.employeeId}
                      maxLength={32}
                      autoComplete="off"
                      placeholder="EMP00123"
                      onChange={(event) => set('employeeId', event.target.value)}
                      {...fieldProps('employeeId')}
                    />
                  </Field>
                  <Field id="jobTitle" label="Job title" error={errorFor('jobTitle')}>
                    <input id="idc-field-jobTitle" type="text" value={state.jobTitle} maxLength={60} placeholder="People Operations Manager" onChange={(event) => set('jobTitle', event.target.value)} />
                  </Field>
                  <Field id="department" label="Department" error={errorFor('department')}>
                    <input id="idc-field-department" type="text" value={state.department} maxLength={60} placeholder="People" onChange={(event) => set('department', event.target.value)} />
                  </Field>
                  <Field id="email" label="Email address" error={errorFor('email')}>
                    <input id="idc-field-email" type="email" value={state.email} maxLength={80} placeholder="amara.okafor@example.com" onChange={(event) => set('email', event.target.value)} {...fieldProps('email')} />
                  </Field>
                  <Field id="phone" label="Phone number" error={errorFor('phone')}>
                    <input id="idc-field-phone" type="tel" value={state.phone} maxLength={30} placeholder="+234 801 234 5678" onChange={(event) => set('phone', event.target.value)} {...fieldProps('phone')} />
                  </Field>
                  <Field id="bloodGroup" label="Blood group" error={errorFor('bloodGroup')} help="Optional. Printed on the back, where a first-aider looks for it.">
                    <select id="idc-field-bloodGroup" value={state.bloodGroup} onChange={(event) => set('bloodGroup', event.target.value)} {...fieldProps('bloodGroup')}>
                      <option value="">Not printed</option>
                      {BLOOD_GROUPS.map((group) => (
                        <option key={group} value={group}>
                          {group}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="dateOfJoining" label="Date of joining" error={errorFor('dateOfJoining')}>
                    <input id="idc-field-dateOfJoining" type="date" value={state.dateOfJoining} onChange={(event) => set('dateOfJoining', event.target.value)} {...fieldProps('dateOfJoining')} />
                  </Field>
                  <Field id="emergencyContact" label="Emergency contact" error={errorFor('emergencyContact')}>
                    <input id="idc-field-emergencyContact" type="text" value={state.emergencyContact} maxLength={120} placeholder="Chidi Okafor +234 802 111 2222" onChange={(event) => set('emergencyContact', event.target.value)} />
                  </Field>
                  <Field id="validFrom" label="Card issue date" error={errorFor('validFrom')}>
                    <input id="idc-field-validFrom" type="date" value={state.validFrom} onChange={(event) => set('validFrom', event.target.value)} {...fieldProps('validFrom')} />
                  </Field>
                  <Field id="validUntil" label="Card expiry date" error={errorFor('validUntil')}>
                    <input id="idc-field-validUntil" type="date" value={state.validUntil} onChange={(event) => set('validUntil', event.target.value)} {...fieldProps('validUntil')} />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="bt247-fieldset">
                <legend>Company</legend>
                <div className="bt247-fields">
                  <Field id="companyName" label="Company name" required error={errorFor('companyName')}>
                    <input id="idc-field-companyName" type="text" value={state.companyName} maxLength={60} placeholder="Northstar Technologies" onChange={(event) => set('companyName', event.target.value)} {...fieldProps('companyName')} />
                  </Field>
                  <Field id="companyAddress" label="Company address" error={errorFor('companyAddress')}>
                    <input id="idc-field-companyAddress" type="text" value={state.companyAddress} maxLength={160} placeholder="12 Adeola Odeku Street, Victoria Island, Lagos" onChange={(event) => set('companyAddress', event.target.value)} />
                  </Field>
                  <Field id="companyWebsite" label="Website" error={errorFor('companyWebsite')}>
                    <input id="idc-field-companyWebsite" type="text" value={state.companyWebsite} maxLength={120} placeholder="https://example.com" onChange={(event) => set('companyWebsite', event.target.value)} {...fieldProps('companyWebsite')} />
                  </Field>
                </div>
              </fieldset>

              <fieldset className="bt247-fieldset">
                <legend>Photographs and branding</legend>
                <div className="bt247-fields">
                  <ImageField
                    id="photo"
                    label="Employee photograph"
                    value={state.photo}
                    error={uploadError.photo ?? errorFor('photo')}
                    help="PNG, JPEG or WebP, at least 240 × 240 px, up to 6 MB. Cropped to fill the photo frame."
                    onPick={(file) => void onUpload('photo', file)}
                    onRemove={() => set('photo', '')}
                  />
                  <ImageField
                    id="logo"
                    label="Company logo"
                    value={state.logo}
                    error={uploadError.logo ?? errorFor('logo')}
                    help="Transparent PNG looks best. Shown on the card header instead of the company initials."
                    onPick={(file) => void onUpload('logo', file)}
                    onRemove={() => set('logo', '')}
                  />
                  <ImageField
                    id="signature"
                    label="Employee signature"
                    value={state.signature}
                    error={uploadError.signature ?? errorFor('signature')}
                    help="Optional. A photographed signature on plain paper works; it is drawn above the signature line."
                    onPick={(file) => void onUpload('signature', file)}
                    onRemove={() => set('signature', '')}
                  />
                </div>
              </fieldset>

              <fieldset className="bt247-fieldset">
                <legend>Machine-readable codes</legend>
                <div className="bt247-fields">
                  <Toggle
                    id="showQr"
                    label="QR code on the card"
                    checked={state.showQr}
                    onChange={(next) => set('showQr', next)}
                    help="A real, scannable QR symbol, drawn from the content you set below."
                  />
                  <Field
                    id="qrContent"
                    label="QR content or verification URL"
                    error={errorFor('qrContent')}
                    help="Leave blank to encode the employee ID. A full https:// URL must resolve on its own — this tool does not run a verification service, so only provide a link if you have one."
                  >
                    <input
                      id="idc-field-qrContent"
                      type="text"
                      value={state.qrContent}
                      maxLength={512}
                      placeholder="https://staff.example.com/verify/EMP00123"
                      disabled={!state.showQr}
                      onChange={(event) => set('qrContent', event.target.value)}
                      {...fieldProps('qrContent')}
                    />
                  </Field>
                  {state.showQr && state.qrContent.trim() !== '' ? <QrContentNote value={state.qrContent} /> : null}
                  <Toggle
                    id="showBarcode"
                    label="Code 128 barcode on the card"
                    checked={state.showBarcode}
                    onChange={(next) => set('showBarcode', next)}
                    help="Printed on the back, where a turnstile or stock-room scanner reads it."
                  />
                  <Field id="barcodeValue" label="Barcode value" help="Leave blank to encode the employee ID. Letters, digits and keyboard punctuation only.">
                    <input
                      id="idc-field-barcodeValue"
                      type="text"
                      value={state.barcodeValue}
                      maxLength={48}
                      placeholder={state.employeeId || 'EMP00123'}
                      disabled={!state.showBarcode}
                      onChange={(event) => set('barcodeValue', event.target.value)}
                    />
                  </Field>
                </div>
              </fieldset>

              <div className="bt247-actions">
                <button type="button" className="ch247-button ch247-button--ghost" onClick={resetForm}>
                  Reset form
                </button>
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost"
                  onClick={() => {
                    setState({ ...state, photo: '', logo: '', signature: '' });
                    setFlash({ ok: true, message: 'Uploaded images removed from this session.' });
                  }}
                >
                  Remove all images
                </button>
              </div>
              {autoSaved ? (
                <p className="ch247-page__hint" role="status" aria-live="polite">
                  {autoSaved}
                </p>
              ) : null}
            </form>

            {/* ---------------- Right: preview ---------------- */}
            <div className="idc-preview-col">
              <IdCardPreview front={layout.front} back={layout.back} side={side} onSideChange={setSide} disabled={false} zoom={zoom} />

              <div className="idc-zoom" role="group" aria-label="Preview size">
                <span className="ch247-field-label">Preview size</span>
                <button type="button" className="ch247-button ch247-button--small ch247-button--ghost" onClick={() => setZoom((value) => Math.max(4, value - 1))} aria-label="Make the preview smaller">
                  −
                </button>
                <span aria-live="polite">{zoom === 4 ? 'smallest' : zoom === 14 ? 'largest' : `${zoom * 10}%`}</span>
                <button type="button" className="ch247-button ch247-button--small ch247-button--ghost" onClick={() => setZoom((value) => Math.min(14, value + 1))} aria-label="Make the preview larger">
                  +
                </button>
              </div>

              {state.showQr ? (
                <p className="ch247-page__hint">
                  The QR code contains:{' '}
                  <code>{validation.qrPayload || '(nothing yet — add an employee ID)'}</code>
                </p>
              ) : null}
              {state.showBarcode ? (
                <p className="ch247-page__hint">
                  The barcode contains: <code>{state.barcodeValue.trim() || state.employeeId || '(nothing yet)'}</code>
                </p>
              ) : null}

              {layout.warnings.length > 0 ? (
                <ul className="bt247-advisories" aria-label="Advisories about this card">
                  {layout.warnings.map((warning, index) => (
                    <li className="bt247-advisory" key={index}>
                      {warning}
                    </li>
                  ))}
                </ul>
              ) : null}

              {!ready ? (
                <div className="bt247-state">
                  <h3 className="bt247-state__title">Fill in the employee and company details</h3>
                  <p style={{ margin: '0 auto', maxWidth: '34rem' }}>
                    The preview updates as you type. The fields marked in red above have to be
                    corrected before the card can be downloaded — a badge with no name or no company
                    is not a badge anybody can act on.
                  </p>
                </div>
              ) : null}
            </div>
          </div>

          {/* ---------------- Design controls ---------------- */}
          <div className="idc-tabs" role="tablist" aria-label="Card options">
            {(
              [
                ['design', 'Templates & colour'],
                ['export', 'Download & print'],
                ['bulk', 'Bulk generation'],
              ] as Array<[Tab, string]>
            ).map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={tab === value} aria-controls={`idc-tabpanel-${value}`} id={`idc-tab-${value}`} className="bt247-filter" onClick={() => setTab(value)}>
                {label}
              </button>
            ))}
          </div>

          <div className="idc-tabpanels">
            {tab === 'design' ? (
              <section className="idc-panel" role="tabpanel" id="idc-tabpanel-design" aria-labelledby="idc-tab-design">
                <h3 className="bt247-panel__title">Choose a template design</h3>
                <p className="ch247-page__hint" style={{ marginTop: 0 }}>
                  Each template is a different layout — where the photograph, the details and the codes
                  sit — not a colour swap. Your details stay exactly as they are when you switch.
                </p>
                <div className="idc-templates" role="radiogroup" aria-label="Card template">
                  {CARD_TEMPLATES.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      role="radio"
                      aria-checked={state.template === template.id}
                      className="idc-template"
                      onClick={() => set('template', template.id as CardTemplateId)}
                    >
                      <span className="idc-template__swatch" aria-hidden="true" data-template={template.id} />
                      <span className="idc-template__name">{template.name}</span>
                      <span className="idc-template__blurb">{template.blurb}</span>
                    </button>
                  ))}
                </div>

                <h3 className="bt247-panel__title">Colour</h3>
                <div className="idc-presets" role="radiogroup" aria-label="Colour preset">
                  {CARD_PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      type="button"
                      role="radio"
                      aria-checked={state.preset === preset.id}
                      className="idc-preset"
                      onClick={() => applyPreset(preset.id)}
                    >
                      <span className="idc-preset__chip" style={{ background: preset.accent }} aria-hidden="true" />
                      <span className="idc-preset__label">{preset.name}</span>
                      <span className="idc-preset__hex">{preset.accent}</span>
                    </button>
                  ))}
                </div>

                <div className="bt247-fields idc-colors">
                  <ColorField id="primary" label="Primary accent" value={state.primary} onChange={(value) => setState((current) => ({ ...current, preset: 'custom', primary: value }))} error={errorFor('primary')} />
                  <ColorField id="background" label="Card background" value={state.background} onChange={(value) => setState((current) => ({ ...current, preset: 'custom', background: value }))} error={errorFor('background')} />
                  <ColorField id="text" label="Text colour" value={state.text} onChange={(value) => setState((current) => ({ ...current, preset: 'custom', text: value }))} error={errorFor('text')} help="Checked automatically against the background; you are warned if it falls below 4.5:1." />
                  <ColorField id="detail" label="Detail accent" value={state.detail} onChange={(value) => setState((current) => ({ ...current, preset: 'custom', detail: value }))} error={errorFor('detail')} />
                </div>
                <p className="ch247-page__hint">
                  Choosing a preset or editing any colour switches the palette to <strong>custom</strong>; the preset chips show which
                  starting point is in use.
                </p>

                <h3 className="bt247-panel__title">Orientation</h3>
                <div className="idc-radio-row">
                  {(
                    [
                      ['landscape', 'Landscape (1011 × 638 px)'],
                      ['portrait', 'Portrait (638 × 1011 px)'],
                    ] as Array<[CardFormState['orientation'], string]>
                  ).map(([value, label]) => (
                    <label key={value}>
                      <input type="radio" name="idc-orientation" checked={state.orientation === value} onChange={() => set('orientation', value)} /> {label}
                    </label>
                  ))}
                </div>
                <p className="ch247-page__hint">Portrait is the same CR80 card turned 90°; both print at 85.60 × 53.98 mm.</p>
              </section>
            ) : null}

            {tab === 'export' ? (
              <div role="tabpanel" id="idc-tabpanel-export" aria-labelledby="idc-tab-export">
                <IdCardExportPanel
                  front={layout.front}
                  back={layout.back}
                  slug={slug}
                  title={title}
                  disabled={!ready}
                  onClearStored={() => setFlash({ ok: true, message: 'Stored card details were cleared. Your current form is untouched until you close the tab.' })}
                  onConsentChange={(consent) =>
                    setFlash({
                      ok: true,
                      message: consent
                        ? 'Uploaded images and contact details will now be remembered in this browser.'
                        : 'Uploaded images and contact details are no longer stored between visits.',
                    })
                  }
                />
                {validation.warnings.length > 0 ? (
                  <section className="idc-panel">
                    <h3 className="bt247-panel__title">What this card does not do</h3>
                    <ul className="bt247-advisories" aria-label="Limitations">
                      {validation.warnings.map((warning, index) => (
                        <li className="bt247-advisory" key={index}>
                          {warning}
                        </li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
            ) : null}

            {tab === 'bulk' ? (
              <div role="tabpanel" id="idc-tabpanel-bulk" aria-labelledby="idc-tab-bulk">
                <IdCardBulkPanel base={state} />
              </div>
            ) : null}
          </div>

          <section className="idc-panel">
            <h3 className="bt247-panel__title">How this tool works — and what it refuses to claim</h3>
            <ul className="bt247-notes">
              <li>
                The card is composed entirely in your browser. Employee names, identifiers, contact
                details, photographs and signatures are never uploaded, and no card is stored on a
                CloudHost247 server.
              </li>
              <li>
                The QR code and the Code 128 barcode are produced by real encoders — the QR with error
                correction M and a module-by-module renderer, the barcode with its modulo-103 check
                symbol. They are drawn the same way in the preview and in every download, so a code
                that scans on screen scans on the printed card.
              </li>
              <li>
                A QR code that contains a URL is a link, not a verification service. CloudHost247 does
                not check that the employee works for the organisation printing the card, does not
                host a verification endpoint, and does not add any claim of verification to the card.
                If you supply a URL, make sure it resolves — the tool will tell you if it does not look
                like one.
              </li>
              <li>
                Exports are 300 dpi at ISO/IEC 7810 ID-1 size. Print at 100% scale on CR80 card stock;
                “fit to page” will shrink the card below the standard.
              </li>
              <li>
                Bulk import reads CSV and <code>.xlsx</code> in the browser. Rows it cannot use are
                listed with a reason and can be downloaded as a CSV — they are never dropped quietly.
                Photographs referenced by <code>https://</code> URL are the only data fetched from the
                network, and only for the rows that ask for them.
              </li>
              <li>
                An ID card is an identity artefact. Printing one for someone who does not work for the
                organisation, or altering an existing card, may constitute fraud where you live.
              </li>
            </ul>
          </section>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Small field components                                              */
/* ------------------------------------------------------------------ */

function Field({
  id,
  label,
  required,
  error,
  help,
  children,
}: {
  id: string;
  label: string;
  required?: boolean;
  error?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bt247-field">
      <label className="ch247-field-label" htmlFor={`idc-field-${id}`}>
        {label}
        {required ? <span className="bt247-field__required"> *</span> : null}
      </label>
      {children}
      {help && !error ? <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>{help}</p> : null}
      {error ? (
        <p className="bt247-field__error" id={`idc-error-${id}`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function Toggle({ id, label, checked, onChange, help }: { id: string; label: string; checked: boolean; onChange: (next: boolean) => void; help?: string }) {
  return (
    <div className="bt247-field">
      <label className="idc-check" htmlFor={`idc-field-${id}`}>
        <input id={`idc-field-${id}`} type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <span>{label}</span>
      </label>
      {help ? <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>{help}</p> : null}
    </div>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
  error,
  help,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  help?: string;
}) {
  return (
    <div className="bt247-field idc-color">
      <label className="ch247-field-label" htmlFor={`idc-color-${id}`}>
        {label}
      </label>
      <div className="idc-color__row">
        <input id={`idc-color-${id}`} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(event) => onChange(event.target.value)} aria-describedby={`idc-color-${id}-text`} />
        <input
          id={`idc-color-${id}-text`}
          type="text"
          className="idc-color__hex"
          value={value}
          maxLength={7}
          spellCheck={false}
          aria-label={`${label} hex value`}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
      {help && !error ? <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>{help}</p> : null}
      {error ? (
        <p className="bt247-field__error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function ImageField({
  id,
  label,
  value,
  error,
  help,
  onPick,
  onRemove,
}: {
  id: string;
  label: string;
  value: string;
  error?: string;
  help: string;
  onPick: (file: File | undefined) => void;
  onRemove: () => void;
}) {
  return (
    <div className="bt247-field idc-image">
      <label className="ch247-field-label" htmlFor={`idc-image-${id}`}>
        {label}
      </label>
      <div className="idc-image__row">
        <span className="idc-image__thumb" aria-hidden="true">
          {value ? <img src={value} alt="" /> : <Icon name="file-text" />}
        </span>
        <div className="idc-image__actions">
          <input
            id={`idc-image-${id}`}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(event) => {
              onPick(event.target.files?.[0]);
              // Cleared so re-selecting the same file fires a change event again.
              event.target.value = '';
            }}
          />
          {value ? (
            <button type="button" className="ch247-button ch247-button--small ch247-button--ghost" onClick={onRemove}>
              Remove {label.toLowerCase()}
            </button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p className="bt247-field__error" role="alert">
          {error}
        </p>
      ) : (
        <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>
          {help}
        </p>
      )}
    </div>
  );
}

/** Tells the user what the QR will and will not do, based on the value they typed. */
function QrContentNote({ value }: { value: string }) {
  const looksLikeUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(value.trim());
  if (!looksLikeUrl) {
    return (
      <p className="idc-flash idc-flash--warn" style={{ margin: 0 }}>
        This is plain text: the QR code carries it verbatim and nothing is looked up when it is
        scanned. That is fine for a stock reference or a contact string, but it does not verify
        employment.
      </p>
    );
  }
  const check = validateQrUrl(value);
  if ('ok' in check && check.ok) {
    return (
      <p className="ch247-page__hint" style={{ margin: 0 }}>
        The QR code will open <code>{check.url}</code>. CloudHost247 does not host or check that page —
        make sure it resolves and that anything it shows is accurate about the holder.
      </p>
    );
  }
  return (
    <p className="idc-flash idc-flash--error" style={{ margin: 0 }} role="alert">
      {check.message}
    </p>
  );
}
