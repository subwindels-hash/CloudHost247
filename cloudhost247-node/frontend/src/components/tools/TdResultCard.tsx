import type { TdValidationResult } from '../../../../src/tools/mrz/td-formats';

const LABELS: Record<string, string> = {
  layout: 'Line count and length',
  characters: 'Allowed characters',
  documentCode: 'Document code',
  issuingState: 'Issuing state',
  nationality: 'Nationality',
  sex: 'Sex',
  name: 'Name field',
  dateOfBirthValid: 'Date of birth is a real date',
  expiryDateValid: 'Expiry date is a real date',
  documentNumberCheck: 'Document number check digit',
  dateOfBirthCheck: 'Date of birth check digit',
  expiryDateCheck: 'Expiry date check digit',
  compositeCheck: 'Composite check digit',
};

/**
 * Shows a TD1 or TD2 result: parsed fields, each rule with its outcome, and the authenticity
 * notice. The notice always appears, because a passing check digit proves only internal
 * consistency.
 */
export function TdResultCard({
  result,
  showFields = true,
}: {
  result: TdValidationResult;
  showFields?: boolean;
}) {
  const ruleEntries = Object.entries(result.checks);
  return (
    <div data-testid="td-result" style={{ marginTop: '1rem' }}>
      <p style={{ margin: '0 0 0.5rem', fontWeight: 700 }}>
        {result.format} {result.valid ? 'passes every structural check' : 'has failing checks'}
      </p>
      {result.reasons.length > 0 && (
        <ul style={{ margin: '0 0 0.75rem', paddingLeft: '1.25rem' }}>
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
      {ruleEntries.length > 0 && (
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '0.75rem' }}>
          <caption style={{ textAlign: 'left', fontWeight: 600, marginBottom: '0.25rem' }}>Rules</caption>
          <tbody>
            {ruleEntries.map(([key, status]) => (
              <tr key={key} style={{ borderTop: '1px solid var(--ch247-border)' }}>
                <td style={{ padding: '0.35rem 0.5rem' }}>{LABELS[key] ?? key}</td>
                <td style={{ padding: '0.35rem 0.5rem', fontWeight: 700 }}>{status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {showFields && result.fields && (
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '0.25rem 1rem', margin: '0 0 0.75rem' }}>
          <dt>Document code</dt>
          <dd>{result.fields.documentCode}</dd>
          <dt>Issuing state</dt>
          <dd>{result.fields.issuingState}</dd>
          <dt>Surname</dt>
          <dd>{result.fields.surname}</dd>
          <dt>Given names</dt>
          <dd>{result.fields.givenNames}</dd>
          <dt>Document number</dt>
          <dd>{result.fields.documentNumber}</dd>
          <dt>Nationality</dt>
          <dd>{result.fields.nationality}</dd>
          <dt>Date of birth (YYMMDD)</dt>
          <dd>{result.fields.dateOfBirth}</dd>
          <dt>Sex</dt>
          <dd>{result.fields.sex}</dd>
          <dt>Expiry (YYMMDD)</dt>
          <dd>{result.fields.expiryDate}</dd>
          <dt>Optional data</dt>
          <dd>{result.fields.optionalData || '(none)'}</dd>
        </dl>
      )}
      <p className="ch247-page__hint" role="note" style={{ margin: 0 }}>
        {result.authenticityNotice}
      </p>
    </div>
  );
}
