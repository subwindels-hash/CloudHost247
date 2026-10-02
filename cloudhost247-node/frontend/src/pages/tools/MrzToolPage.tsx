import { FormEvent, useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { usePageMeta } from '../../lib/usePageMeta';
import {
  explainMrzWithAi,
  generateSyntheticTestData,
  generateTd3Mrz,
  MRZ_AUTHENTICITY_NOTICE,
  parseTd3Mrz,
  validateTd3Mrz,
  type MrzAiExplanationResult,
  type MrzFieldError,
  type MrzGenerateResult,
  type MrzParseResult,
  type MrzValidationResult,
} from '../../lib/mrz-engine';

interface MrzToolConfigResponse {
  calculatorEnabled: boolean;
  parserEnabled: boolean;
  testDataEnabled: boolean;
  availability: 'public' | 'authenticated' | 'admin_only';
}

type ToolTab = 'calculator' | 'validator' | 'parser';

export interface MrzToolPageProps {
  defaultTab?: ToolTab;
}

export default function MrzToolPage({ defaultTab }: MrzToolPageProps) {
  const location = useLocation();
  const initialTab: ToolTab =
    defaultTab ?? (location.pathname.endsWith('/mrz-parser') ? 'parser' : 'calculator');

  usePageMeta(
    initialTab === 'parser'
      ? 'MRZ Parser — Developer / Document Tools — CloudHost247'
      : 'MRZ Calculator — Developer / Document Tools — CloudHost247',
    'Generate, validate, and parse ICAO Doc 9303 TD3 machine-readable passport format data for software testing.'
  );

  const [activeTab, setActiveTab] = useState<ToolTab>(initialTab);

  useEffect(() => {
    if (defaultTab) {
      setActiveTab(defaultTab);
    } else if (location.pathname.endsWith('/mrz-parser')) {
      setActiveTab('parser');
    } else if (location.pathname.endsWith('/mrz')) {
      setActiveTab('calculator');
    }
  }, [defaultTab, location.pathname]);

  // Tool configuration fetched best-effort from backend; falls back to client-side defaults if offline
  const [config, setConfig] = useState<MrzToolConfigResponse>({
    calculatorEnabled: true,
    parserEnabled: true,
    testDataEnabled: true,
    availability: 'public',
  });

  useEffect(() => {
    let active = true;
    fetch('/api/tools/mrz/config')
      .then(async (res) => {
        if (!res.ok) return null;
        return (await res.json()) as MrzToolConfigResponse;
      })
      .then((data) => {
        if (active && data && typeof data.calculatorEnabled === 'boolean') {
          setConfig(data);
        }
      })
      .catch(() => {
        // Offline / standalone fallback: client-side MRZ engine remains operational
      });
    return () => {
      active = false;
    };
  }, []);

  // Calculator state (never persisted to localStorage/sessionStorage for privacy)
  const [documentType, setDocumentType] = useState('P<');
  const [issuingState, setIssuingState] = useState('');
  const [surname, setSurname] = useState('');
  const [givenNames, setGivenNames] = useState('');
  const [nationality, setNationality] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [sex, setSex] = useState<'M' | 'F' | '<'>('<');
  const [documentNumber, setDocumentNumber] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [optionalData, setOptionalData] = useState('');

  const [isSyntheticActive, setIsSyntheticActive] = useState(false);
  const [syntheticSeed, setSyntheticSeed] = useState(0);
  const [generatedResult, setGeneratedResult] = useState<MrzGenerateResult | null>(null);
  const [calculatorErrors, setCalculatorErrors] = useState<MrzFieldError[]>([]);
  const [copyFeedback, setCopyFeedback] = useState('');
  const [inlineValidation, setInlineValidation] = useState<MrzValidationResult | null>(null);

  // Validator state
  const [validatorInput, setValidatorInput] = useState('');
  const [validationResult, setValidationResult] = useState<MrzValidationResult | null>(null);

  // Parser state
  const [parserInput, setParserInput] = useState('');
  const [parseResult, setParseResult] = useState<MrzParseResult | null>(null);

  // CloudHost247 AI Explanation state
  const [aiExplanation, setAiExplanation] = useState<MrzAiExplanationResult | null>(null);

  function handleGenerateMrz(event: FormEvent) {
    event.preventDefault();
    setCopyFeedback('');
    setInlineValidation(null);

    if (!config.calculatorEnabled) {
      setGeneratedResult(null);
      setCalculatorErrors([
        {
          field: 'form',
          code: 'TOOL_DISABLED',
          message: 'The MRZ Calculator is currently disabled by an administrator.',
        },
      ]);
      return;
    }

    const outcome = generateTd3Mrz({
      documentType,
      issuingState,
      surname,
      givenNames,
      nationality,
      dateOfBirth,
      sex,
      documentNumber,
      expiryDate,
      optionalData,
    });

    if (!outcome.success) {
      setGeneratedResult(null);
      setCalculatorErrors(outcome.errors);
      return;
    }

    setCalculatorErrors([]);
    setGeneratedResult(outcome);
  }

  function handleGenerateTestData() {
    if (!config.testDataEnabled) return;
    const specimen = generateSyntheticTestData(syntheticSeed);
    setSyntheticSeed((s) => s + 1);
    setIsSyntheticActive(true);
    setDocumentType(specimen.fields.documentType);
    setIssuingState(specimen.fields.issuingState);
    setSurname(specimen.fields.surname);
    setGivenNames(specimen.fields.givenNames);
    setNationality(specimen.fields.nationality);
    setDateOfBirth(specimen.fields.dateOfBirth);
    setSex(specimen.fields.sex);
    setDocumentNumber(specimen.fields.documentNumber);
    setExpiryDate(specimen.fields.expiryDate);
    setOptionalData(specimen.fields.optionalData);
    setCalculatorErrors([]);
    setCopyFeedback('');

    const outcome = generateTd3Mrz({
      documentType: specimen.fields.documentType,
      issuingState: specimen.fields.issuingState,
      surname: specimen.fields.surname,
      givenNames: specimen.fields.givenNames,
      nationality: specimen.fields.nationality,
      dateOfBirth: specimen.fields.dateOfBirth,
      sex: specimen.fields.sex,
      documentNumber: specimen.fields.documentNumber,
      expiryDate: specimen.fields.expiryDate,
      optionalData: specimen.fields.optionalData,
    });
    if (outcome.success) {
      setGeneratedResult(outcome);
      setInlineValidation(null);
    }
  }

  function handleClearCalculator() {
    setDocumentType('P<');
    setIssuingState('');
    setSurname('');
    setGivenNames('');
    setNationality('');
    setDateOfBirth('');
    setSex('<');
    setDocumentNumber('');
    setExpiryDate('');
    setOptionalData('');
    setIsSyntheticActive(false);
    setGeneratedResult(null);
    setCalculatorErrors([]);
    setInlineValidation(null);
    setCopyFeedback('');
    setAiExplanation(null);
  }

  async function handleCopyMrz(line1: string, line2: string) {
    const text = `${line1}\n${line2}`;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }
      setCopyFeedback('Copied MRZ to clipboard.');
    } catch {
      setCopyFeedback('Copy ready.');
    }
  }

  function handleValidateGenerated() {
    if (!generatedResult) return;
    const val = validateTd3Mrz(generatedResult.mrz);
    setInlineValidation(val);
    setValidatorInput(`${generatedResult.mrz.line1}\n${generatedResult.mrz.line2}`);
    setValidationResult(val);
  }

  function handleDownloadText(line1: string, line2: string) {
    const content = `${line1}\n${line2}\n`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mrz-td3-test.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleValidateMrzSubmit(event: FormEvent) {
    event.preventDefault();
    const res = validateTd3Mrz(validatorInput);
    setValidationResult(res);
  }

  function handleParseMrzSubmit(event: FormEvent) {
    event.preventDefault();
    if (!config.parserEnabled) return;
    const res = parseTd3Mrz(parserInput);
    setParseResult(res);
  }

  function handleLoadSyntheticIntoParserOrValidator(mode: 'validator' | 'parser') {
    const specimen = generateSyntheticTestData(syntheticSeed);
    setSyntheticSeed((s) => s + 1);
    const text = `${specimen.mrz.line1}\n${specimen.mrz.line2}`;
    if (mode === 'validator') {
      setValidatorInput(text);
      setValidationResult(validateTd3Mrz(text));
    } else {
      setParserInput(text);
      setParseResult(parseTd3Mrz(text));
    }
  }

  function handleExplainCurrentState() {
    if (activeTab === 'calculator') {
      if (calculatorErrors.length > 0) {
        setAiExplanation(
          explainMrzWithAi({
            topic: 'invalid_input',
            inputErrors: calculatorErrors,
          })
        );
      } else if (generatedResult) {
        setAiExplanation(
          explainMrzWithAi({
            topic: 'fields',
            mrz: generatedResult.mrz,
          })
        );
      } else {
        setAiExplanation(explainMrzWithAi({ topic: 'overview' }));
      }
      return;
    }

    if (activeTab === 'validator') {
      setAiExplanation(
        explainMrzWithAi({
          topic: 'check_digits',
          mrz: validatorInput.trim() ? validatorInput : undefined,
        })
      );
      return;
    }

    setAiExplanation(
      explainMrzWithAi({
        topic: 'parsing',
        mrz: parserInput.trim() ? parserInput : undefined,
      })
    );
  }

  return (
    <div>
      <section className="ch247-hero ch247-hero--compact">
        <div className="ch247-hero__inner">
          <nav aria-label="Breadcrumb" style={{ marginBottom: '0.4rem', fontSize: '0.85rem', opacity: 0.9 }}>
            <Link to="/tools" style={{ color: '#fff', textDecoration: 'underline' }}>
              Tools
            </Link>{' '}
            → <span>Developer / Document Tools</span> →{' '}
            <strong>{activeTab === 'parser' ? 'MRZ Parser' : 'MRZ Calculator'}</strong>
          </nav>
          <h1>{activeTab === 'parser' ? 'MRZ Parser' : 'MRZ Calculator'}</h1>
          <p>
            Generate and validate machine-readable passport-format data for software testing.
          </p>
        </div>
      </section>

      <section className="ch247-section">
        <div className="ch247-page ch247-stack">
          {/* Privacy & Non-Authenticity Banner */}
          <div className="ch247-card" style={{ borderLeft: '4px solid var(--ch247-primary)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
              <div>
                <strong>Developer &amp; OCR Testing Utility (ICAO Doc 9303 TD3 Format)</strong>
                <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>
                  Privacy-first &amp; stateless by default: MRZ inputs are processed locally and are never stored or sent to analytics.
                  {' '}{MRZ_AUTHENTICITY_NOTICE}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <Link className="ch247-button ch247-button--ghost" to="/tools/document/mrz">
                  MRZ Calculator
                </Link>
                <Link className="ch247-button ch247-button--ghost" to="/tools/document/mrz-parser">
                  MRZ Parser
                </Link>
              </div>
            </div>
          </div>

          {/* Mode Tabs */}
          <div className="ch247-card">
            <div role="tablist" aria-label="MRZ Tool Modes" style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', borderBottom: '1px solid var(--ch247-border)', paddingBottom: '0.85rem', marginBottom: '1.25rem' }}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'calculator'}
                className={activeTab === 'calculator' ? 'ch247-button' : 'ch247-button ch247-button--ghost'}
                onClick={() => setActiveTab('calculator')}
              >
                MRZ Calculator
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'validator'}
                className={activeTab === 'validator' ? 'ch247-button' : 'ch247-button ch247-button--ghost'}
                onClick={() => setActiveTab('validator')}
              >
                MRZ Validator
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'parser'}
                className={activeTab === 'parser' ? 'ch247-button' : 'ch247-button ch247-button--ghost'}
                onClick={() => setActiveTab('parser')}
              >
                MRZ Parser
              </button>
              <button
                type="button"
                className="ch247-button ch247-button--ghost"
                style={{ marginLeft: 'auto' }}
                onClick={handleExplainCurrentState}
              >
                Explain with CloudHost247 AI
              </button>
            </div>

            {/* TAB 1: MRZ CALCULATOR */}
            {activeTab === 'calculator' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>TD3 / ICAO Passport MRZ Calculator</h2>
                    <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>
                      Enter TD3 fields below or load a clearly labeled synthetic specimen for software testing.
                    </p>
                  </div>
                  {config.testDataEnabled && (
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost"
                      onClick={handleGenerateTestData}
                    >
                      Generate Test Data
                    </button>
                  )}
                </div>

                {isSyntheticActive && (
                  <div
                    role="status"
                    className="ch247-banner ch247-banner--info"
                    style={{ marginBottom: '1rem', fontWeight: 600 }}
                  >
                    SYNTHETIC TEST DATA — FOR SOFTWARE DEVELOPMENT &amp; TESTING ONLY (Uses reserved ICAO test code UTO / XXA; not a real identity).
                  </div>
                )}

                {calculatorErrors.length > 0 && (
                  <div role="alert" className="ch247-banner ch247-banner--error" style={{ marginBottom: '1rem' }}>
                    <strong>MRZ validation failed — input cannot safely be represented:</strong>
                    <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.25rem' }}>
                      {calculatorErrors.map((err, idx) => (
                        <li key={`${err.field}-${idx}`}>
                          <strong>{err.field}:</strong> {err.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <form onSubmit={handleGenerateMrz} noValidate>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                      gap: '1rem',
                    }}
                  >
                    <div>
                      <label htmlFor="mrz-doc-type" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Document Type
                      </label>
                      <select
                        id="mrz-doc-type"
                        value={documentType}
                        onChange={(e) => setDocumentType(e.target.value)}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      >
                        <option value="P<">TD3 Passport (P&lt;)</option>
                        <option value="PO">Official / Service Passport (PO)</option>
                        <option value="PD">Diplomatic Passport (PD)</option>
                        <option value="PS">Stateless / Service (PS)</option>
                        <option value="PM">Emergency / Military (PM)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="mrz-issuing-state" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Issuing State
                      </label>
                      <input
                        id="mrz-issuing-state"
                        type="text"
                        maxLength={3}
                        placeholder="e.g. UTO"
                        value={issuingState}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setIssuingState(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-surname" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Surname
                      </label>
                      <input
                        id="mrz-surname"
                        type="text"
                        maxLength={60}
                        placeholder="e.g. TEST PERSON"
                        value={surname}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setSurname(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-given-names" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Given Names
                      </label>
                      <input
                        id="mrz-given-names"
                        type="text"
                        maxLength={60}
                        placeholder="e.g. SYNTHETIC SPECIMEN"
                        value={givenNames}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setGivenNames(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-nationality" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Nationality
                      </label>
                      <input
                        id="mrz-nationality"
                        type="text"
                        maxLength={3}
                        placeholder="e.g. UTO"
                        value={nationality}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setNationality(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-dob" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Date of Birth (YYMMDD)
                      </label>
                      <input
                        id="mrz-dob"
                        type="text"
                        maxLength={6}
                        placeholder="YYMMDD (e.g. 850115)"
                        value={dateOfBirth}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setDateOfBirth(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-sex" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Sex
                      </label>
                      <select
                        id="mrz-sex"
                        value={sex}
                        onChange={(e) => setSex(e.target.value as 'M' | 'F' | '<')}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      >
                        <option value="M">Male (M)</option>
                        <option value="F">Female (F)</option>
                        <option value="<">Unspecified (&lt;)</option>
                      </select>
                    </div>

                    <div>
                      <label htmlFor="mrz-doc-number" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Document Number
                      </label>
                      <input
                        id="mrz-doc-number"
                        type="text"
                        maxLength={9}
                        placeholder="e.g. TEST10001"
                        value={documentNumber}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setDocumentNumber(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-expiry" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Expiry Date (YYMMDD)
                      </label>
                      <input
                        id="mrz-expiry"
                        type="text"
                        maxLength={6}
                        placeholder="YYMMDD (e.g. 321231)"
                        value={expiryDate}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setExpiryDate(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>

                    <div>
                      <label htmlFor="mrz-optional-data" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                        Optional Data
                      </label>
                      <input
                        id="mrz-optional-data"
                        type="text"
                        maxLength={14}
                        placeholder="Optional (max 14 chars)"
                        value={optionalData}
                        onChange={(e) => {
                          setIsSyntheticActive(false);
                          setOptionalData(e.target.value);
                        }}
                        style={{ width: '100%', padding: '0.55rem 0.7rem', border: '1px solid #cfd8e6', borderRadius: 6 }}
                      />
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginTop: '1.25rem' }}>
                    <button type="submit" className="ch247-button">
                      Generate MRZ
                    </button>
                    <button type="button" className="ch247-button ch247-button--ghost" onClick={handleClearCalculator}>
                      Clear
                    </button>
                  </div>
                </form>

                {/* Generated MRZ Output */}
                {generatedResult && (
                  <div style={{ marginTop: '1.5rem', borderTop: '1px solid var(--ch247-border)', paddingTop: '1.25rem' }}>
                    <h3 style={{ marginTop: 0 }}>Generated MRZ</h3>
                    <div
                      aria-label="Generated MRZ Output"
                      style={{
                        background: '#0f172a',
                        color: '#f8fafc',
                        padding: '1rem 1.25rem',
                        borderRadius: 8,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                        fontSize: '0.98rem',
                        letterSpacing: '0.08em',
                        overflowX: 'auto',
                      }}
                    >
                      <div style={{ color: '#94a3b8', fontSize: '0.78rem', marginBottom: '0.25rem' }}>
                        MRZ (TD3 — 2 lines × 44 characters — Machine-Readable Text for Software Testing Only)
                      </div>
                      <div style={{ color: '#64748b', marginBottom: '0.5rem' }}>
                        ────────────────────────────────────────────
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>LINE 1</div>
                      <div data-testid="mrz-line-1" style={{ fontWeight: 700, marginBottom: '0.5rem' }}>
                        {generatedResult.mrz.line1}
                      </div>
                      <div style={{ color: '#94a3b8', fontSize: '0.75rem' }}>LINE 2</div>
                      <div data-testid="mrz-line-2" style={{ fontWeight: 700 }}>
                        {generatedResult.mrz.line2}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.9rem' }}>
                      <button
                        type="button"
                        className="ch247-button"
                        onClick={() => handleCopyMrz(generatedResult.mrz.line1, generatedResult.mrz.line2)}
                      >
                        Copy
                      </button>
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost"
                        onClick={handleValidateGenerated}
                      >
                        Validate
                      </button>
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost"
                        onClick={() => handleDownloadText(generatedResult.mrz.line1, generatedResult.mrz.line2)}
                      >
                        Download as text
                      </button>
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost"
                        onClick={handleClearCalculator}
                      >
                        Clear
                      </button>
                    </div>

                    {copyFeedback && (
                      <p className="ch247-page__hint" role="status" style={{ marginTop: '0.5rem' }}>
                        {copyFeedback}
                      </p>
                    )}

                    {/* Normalization Transformation Stages */}
                    <div style={{ marginTop: '1.25rem' }}>
                      <h4>Character Normalization Pipeline (ICAO Doc 9303 Part 3)</h4>
                      <dl className="ch247-dsvc-kv">
                        <dt>Normal name</dt>
                        <dd>
                          <code>{generatedResult.normalization.surname.original}</code> /{' '}
                          <code>{generatedResult.normalization.givenNames.original}</code>
                        </dd>
                        <dt>Transliterated ASCII</dt>
                        <dd>
                          <code>{generatedResult.normalization.surname.transliterated}</code> /{' '}
                          <code>{generatedResult.normalization.givenNames.transliterated}</code>
                        </dd>
                        <dt>MRZ-compatible representation</dt>
                        <dd>
                          <code>{generatedResult.normalization.combinedIdentifier}</code>
                        </dd>
                        <dt>Fixed-width field (39 chars + filler &lt;)</dt>
                        <dd>
                          <code>{generatedResult.normalization.fixedWidthField}</code> ({generatedResult.normalization.fillerCount}{' '}
                          filler chars)
                        </dd>
                      </dl>
                    </div>

                    {/* Check Digits Summary */}
                    <div style={{ marginTop: '1.25rem' }}>
                      <h4>Calculated Check Digits (Weights 7, 3, 1 Modulo 10)</h4>
                      <div className="ch247-dsvc-facts">
                        <div className="ch247-dsvc-fact">
                          <dt>Document Number Check</dt>
                          <dd>{generatedResult.checkDigits.documentNumber}</dd>
                        </div>
                        <div className="ch247-dsvc-fact">
                          <dt>Date of Birth Check</dt>
                          <dd>{generatedResult.checkDigits.dateOfBirth}</dd>
                        </div>
                        <div className="ch247-dsvc-fact">
                          <dt>Expiry Date Check</dt>
                          <dd>{generatedResult.checkDigits.expiryDate}</dd>
                        </div>
                        <div className="ch247-dsvc-fact">
                          <dt>Optional Data Check</dt>
                          <dd>{generatedResult.checkDigits.optionalData}</dd>
                        </div>
                        <div className="ch247-dsvc-fact">
                          <dt>Composite Check Digit</dt>
                          <dd>{generatedResult.checkDigits.composite}</dd>
                        </div>
                      </div>
                    </div>

                    {inlineValidation && (
                      <div style={{ marginTop: '1rem' }}>
                        <ValidationSummaryCard validation={inlineValidation} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* TAB 2: MRZ VALIDATOR */}
            {activeTab === 'validator' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>MRZ Validator</h2>
                    <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>
                      Verify line count, 44-character line lengths, allowed characters, dates, and 7-3-1 check digits.
                    </p>
                  </div>
                  {config.testDataEnabled && (
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost"
                      onClick={() => handleLoadSyntheticIntoParserOrValidator('validator')}
                    >
                      Generate Test Data
                    </button>
                  )}
                </div>

                <form onSubmit={handleValidateMrzSubmit}>
                  <label htmlFor="mrz-validator-input" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                    Paste MRZ here
                  </label>
                  <textarea
                    id="mrz-validator-input"
                    rows={3}
                    placeholder={'P<UTOTEST<PERSON<<SYNTHETIC<SPECIMEN<<<<<<<<\nTEST100016UTO8501159<3212315TEST<DOCUMENT<82'}
                    value={validatorInput}
                    onChange={(e) => setValidatorInput(e.target.value)}
                    style={{
                      width: '100%',
                      padding: '0.7rem',
                      border: '1px solid #cfd8e6',
                      borderRadius: 6,
                      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                    }}
                  />
                  <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem' }}>
                    <button type="submit" className="ch247-button">
                      Validate MRZ
                    </button>
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost"
                      onClick={() => {
                        setValidatorInput('');
                        setValidationResult(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>
                </form>

                {validationResult && (
                  <div style={{ marginTop: '1.25rem' }}>
                    <ValidationSummaryCard validation={validationResult} />
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: MRZ PARSER */}
            {activeTab === 'parser' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div>
                    <h2 style={{ margin: 0 }}>TD3 / ICAO Passport MRZ Parser</h2>
                    <p className="ch247-page__hint" style={{ margin: '0.25rem 0 0' }}>
                      Parse a two-line TD3 MRZ string into structured fields and inspect check-digit verification.
                    </p>
                  </div>
                  {config.testDataEnabled && (
                    <button
                      type="button"
                      className="ch247-button ch247-button--ghost"
                      onClick={() => handleLoadSyntheticIntoParserOrValidator('parser')}
                    >
                      Generate Test Data
                    </button>
                  )}
                </div>

                {!config.parserEnabled ? (
                  <div className="ch247-banner ch247-banner--error" role="alert">
                    The MRZ Parser is currently disabled by an administrator.
                  </div>
                ) : (
                  <form onSubmit={handleParseMrzSubmit}>
                    <label htmlFor="mrz-parser-input" style={{ display: 'block', fontWeight: 600, marginBottom: '0.35rem' }}>
                      Paste MRZ
                    </label>
                    <textarea
                      id="mrz-parser-input"
                      rows={3}
                      placeholder={'P<UTOTEST<PERSON<<SYNTHETIC<SPECIMEN<<<<<<<<\nTEST100016UTO8501159<3212315TEST<DOCUMENT<82'}
                      value={parserInput}
                      onChange={(e) => setParserInput(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '0.7rem',
                        border: '1px solid #cfd8e6',
                        borderRadius: 6,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
                      }}
                    />
                    <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.9rem' }}>
                      <button type="submit" className="ch247-button">
                        Parse MRZ
                      </button>
                      <button
                        type="button"
                        className="ch247-button ch247-button--ghost"
                        onClick={() => {
                          setParserInput('');
                          setParseResult(null);
                        }}
                      >
                        Clear
                      </button>
                    </div>
                  </form>
                )}

                {parseResult && (
                  <div style={{ marginTop: '1.25rem' }}>
                    {/* Explicit Distinction: Successfully Parsed vs. Authenticity Verified */}
                    <div className="ch247-dsvc-facts" style={{ marginBottom: '1rem' }}>
                      <div className="ch247-dsvc-fact">
                        <dt>Parser Status</dt>
                        <dd>{parseResult.parsedStatus}</dd>
                      </div>
                      <div className="ch247-dsvc-fact">
                        <dt>MRZ Structure &amp; Checksums</dt>
                        <dd>{parseResult.structureValid ? 'VALID' : 'INVALID'}</dd>
                      </div>
                      <div className="ch247-dsvc-fact">
                        <dt>Authenticity Verified</dt>
                        <dd>{parseResult.authenticityStatus}</dd>
                      </div>
                    </div>

                    {parseResult.fields ? (
                      <div className="ch247-table-wrap">
                        <table className="ch247-table" aria-label="Parsed MRZ Fields">
                          <thead>
                            <tr>
                              <th>MRZ Field</th>
                              <th>Parsed Value</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr>
                              <td>Document Type</td>
                              <td>
                                <code>{parseResult.fields.documentType}</code> ({parseResult.fields.documentFormat})
                              </td>
                            </tr>
                            <tr>
                              <td>Issuing State</td>
                              <td>
                                <code>{parseResult.fields.issuingState}</code>
                              </td>
                            </tr>
                            <tr>
                              <td>Surname</td>
                              <td>{parseResult.fields.surname}</td>
                            </tr>
                            <tr>
                              <td>Given Names</td>
                              <td>{parseResult.fields.givenNames}</td>
                            </tr>
                            <tr>
                              <td>Nationality</td>
                              <td>
                                <code>{parseResult.fields.nationality}</code>
                              </td>
                            </tr>
                            <tr>
                              <td>Document Number</td>
                              <td>
                                <code>{parseResult.fields.documentNumber}</code>
                              </td>
                            </tr>
                            <tr>
                              <td>Date of Birth</td>
                              <td>
                                <code>{parseResult.fields.dateOfBirth}</code> (YYMMDD)
                              </td>
                            </tr>
                            <tr>
                              <td>Sex</td>
                              <td>
                                {parseResult.fields.sex} (<code>{parseResult.fields.sexCode}</code>)
                              </td>
                            </tr>
                            <tr>
                              <td>Expiry Date</td>
                              <td>
                                <code>{parseResult.fields.expiryDate}</code> (YYMMDD)
                              </td>
                            </tr>
                            <tr>
                              <td>Optional Data</td>
                              <td>
                                <code>{parseResult.fields.optionalData}</code>
                              </td>
                            </tr>
                            <tr>
                              <td>Check Digit Status</td>
                              <td>
                                <strong>{parseResult.fields.checkDigitStatus}</strong>
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <div className="ch247-banner ch247-banner--error" role="alert">
                        <strong>Could not parse MRZ into TD3 fields:</strong>
                        <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.25rem' }}>
                          {parseResult.validation.reasons.map((r, i) => (
                            <li key={i}>{r}</li>
                          ))}
                        </ul>
                      </div>
                    )}

                    <div style={{ marginTop: '1rem' }}>
                      <ValidationSummaryCard validation={parseResult.validation} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* CloudHost247 AI Explanation Panel */}
          {aiExplanation && (
            <div className="ch247-card" role="region" aria-label="CloudHost247 AI Explanation">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
                <h2 style={{ margin: 0 }}>{aiExplanation.title}</h2>
                <button
                  type="button"
                  className="ch247-button ch247-button--ghost"
                  onClick={() => setAiExplanation(null)}
                >
                  Close AI Explanation
                </button>
              </div>
              <p className="ch247-page__hint">{aiExplanation.summary}</p>
              {aiExplanation.sections.map((sec, idx) => (
                <div key={idx} style={{ marginTop: '0.85rem' }}>
                  <h3 style={{ marginBottom: '0.25rem', fontSize: '1rem' }}>{sec.heading}</h3>
                  <pre
                    style={{
                      whiteSpace: 'pre-wrap',
                      fontFamily: 'inherit',
                      margin: 0,
                      background: '#f8fafc',
                      padding: '0.75rem 1rem',
                      borderRadius: 6,
                      border: '1px solid var(--ch247-border)',
                    }}
                  >
                    {sec.body}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function ValidationSummaryCard({ validation }: { validation: MrzValidationResult }) {
  const rows: Array<{ label: string; status: 'PASS' | 'FAIL' }> = [
    { label: 'Document format', status: validation.checks.documentFormat },
    { label: 'Line length', status: validation.checks.lineLength },
    { label: 'Document number', status: validation.checks.documentNumber },
    { label: 'Date of birth', status: validation.checks.dateOfBirth },
    { label: 'Expiry date', status: validation.checks.expiryDate },
    { label: 'Check digits', status: validation.checks.checkDigits },
    { label: 'Character validation', status: validation.checks.characterValidation },
    { label: 'Issuing state', status: validation.checks.issuingState },
    { label: 'Nationality', status: validation.checks.nationality },
    { label: 'Composite check digit', status: validation.checks.compositeCheckDigit },
    { label: 'Structural validity', status: validation.checks.structuralValidity },
  ];

  return (
    <div style={{ border: '1px solid var(--ch247-border)', borderRadius: 8, padding: '1rem', background: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <span
            style={{
              display: 'inline-block',
              padding: '0.25rem 0.65rem',
              borderRadius: 6,
              fontWeight: 800,
              marginRight: '0.6rem',
              background: validation.valid ? '#d1fae5' : '#fee2e2',
              color: validation.valid ? '#065f46' : '#991b1b',
            }}
          >
            {validation.status}
          </span>
          <strong>{validation.summary}</strong>
        </div>
      </div>

      {!validation.valid && validation.reasons.length > 0 && (
        <div role="alert" style={{ marginTop: '0.75rem', color: '#991b1b' }}>
          <strong>Reason:</strong>
          <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.25rem' }}>
            {validation.reasons.map((reason, idx) => (
              <li key={idx}>{reason}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="ch247-table-wrap" style={{ marginTop: '0.85rem' }}>
        <table className="ch247-table" aria-label="MRZ Validation Checks">
          <thead>
            <tr>
              <th>Validation Check</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td>
                  <strong style={{ color: r.status === 'PASS' ? '#065f46' : '#991b1b' }}>{r.status}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="ch247-page__hint" style={{ marginTop: '0.75rem', marginBottom: 0 }}>
        {validation.authenticityNotice}
      </p>
    </div>
  );
}
