/** Structured view of the actual response; never synthesizes missing fields. */
export default function ToolResult({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span>Not reported</span>;
  if (typeof value !== 'object') return <span>{String(value)}</span>;
  if (Array.isArray(value)) {
    if (!value.length) return <p>No entries returned.</p>;
    if (
      value.every(
        (row) => row && typeof row === 'object' && !Array.isArray(row)
      )
    ) {
      const keys = [...new Set(value.flatMap((row) => Object.keys(row)))].slice(
        0,
        12
      );
      return (
        <div
          className="tools-table-scroll"
          tabIndex={0}
          role="region"
          aria-label="Scrollable result table"
        >
          <table>
            <thead>
              <tr>
                {keys.map((key) => (
                  <th key={key}>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {value.slice(0, 100).map((row, index) => (
                <tr key={index}>
                  {keys.map((key) => (
                    <td key={key}>
                      {typeof row[key] === 'object'
                        ? JSON.stringify(row[key])
                        : String(row[key] ?? 'Not reported')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {value.length > 100 && (
            <p>Showing 100 entries. Download JSON for all returned entries.</p>
          )}
        </div>
      );
    }
    return (
      <ul>
        {value.slice(0, 100).map((item, index) => (
          <li key={index}>
            {typeof item === 'object' ? JSON.stringify(item) : String(item)}
          </li>
        ))}
      </ul>
    );
  }
  return (
    <dl className="tools-result-fields">
      {Object.entries(value)
        .slice(0, 40)
        .map(([key, item]) => (
          <div key={key}>
            <dt>{key.replace(/([a-z])([A-Z])/g, '$1 $2')}</dt>
            <dd>
              {Array.isArray(item) ? (
                <ToolResult value={item} />
              ) : item && typeof item === 'object' ? (
                <pre className="tools-json tools-json--small">
                  {JSON.stringify(item, null, 2)}
                </pre>
              ) : (
                String(item ?? 'Not reported')
              )}
            </dd>
          </div>
        ))}
    </dl>
  );
}
