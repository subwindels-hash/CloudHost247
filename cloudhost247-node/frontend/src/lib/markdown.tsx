import type { ReactNode } from 'react';

/**
 * A deliberately small Markdown renderer for the published documentation.
 *
 * Why not a library: the documents are first-party, the syntax they use is a known subset
 * (headings, paragraphs, lists, tables, fenced code, blockquotes, inline code/emphasis/links), and
 * the alternative is shipping a parser plus a sanitiser to every visitor. This renders to React
 * elements rather than to an HTML string, so there is no `dangerouslySetInnerHTML` anywhere in the
 * documentation path — raw HTML inside a document is displayed as text, not executed.
 *
 * Anything it does not understand degrades to a paragraph, which is the correct failure mode for
 * documentation: worst case a reader sees the source text, never a broken page.
 */

type Inline = (text: string) => ReactNode[];

interface Block {
  type: 'heading' | 'paragraph' | 'code' | 'quote' | 'list' | 'table' | 'rule';
  level?: number;
  text?: string;
  ordered?: boolean;
  items?: string[];
  rows?: string[][];
  head?: string[];
  lang?: string;
}

function parseInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  // Links first, then code, then emphasis — order matters, because a link label may contain code.
  const pattern = /(\[[^\]]+\]\([^)\s]+\)|`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    const key = `${keyPrefix}-i${index++}`;
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)$/.exec(token);
    if (link) {
      const [, label, href] = link;
      const external = /^https?:\/\//i.test(href);
      nodes.push(
        external ? (
          // Outbound links from documentation open in a new tab and are marked as such, so a
          // reader can tell the difference between our docs and somebody else's site.
          <a key={key} href={href} target="_blank" rel="noopener noreferrer nofollow">{label}</a>
        ) : (
          <a key={key} href={href}>{label}</a>
        )
      );
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
    } else if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

function splitTableRow(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
}

export function parseMarkdown(markdown: string): Block[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? '';

    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = /^```\s*([a-zA-Z0-9+#-]*)\s*$/.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```\s*$/.test(lines[index] ?? '')) {
        body.push(lines[index] ?? '');
        index += 1;
      }
      index += 1;
      blocks.push({ type: 'code', text: body.join('\n'), lang: fence[1] });
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]!.trim() });
      index += 1;
      continue;
    }

    if (/^\s*([-*_])\s*\1\s*\1[\s-]*$/.test(line)) {
      blocks.push({ type: 'rule' });
      index += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (index < lines.length && /^>\s?/.test(lines[index] ?? '')) {
        body.push((lines[index] ?? '').replace(/^>\s?/, ''));
        index += 1;
      }
      blocks.push({ type: 'quote', text: body.join(' ') });
      continue;
    }

    if (/^\s*[-*+]\s+/.test(line) || /^\s*\d+[.)]\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line);
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index] ?? '';
        const itemMatch = ordered ? /^\s*\d+[.)]\s+(.*)$/.exec(current) : /^\s*[-*+]\s+(.*)$/.exec(current);
        if (itemMatch) {
          items.push(itemMatch[1]!);
          index += 1;
          continue;
        }
        // A continuation line (indented, no marker) belongs to the previous item.
        if (items.length > 0 && /^\s{2,}\S/.test(current) && !/^\s*[-*+]\s+/.test(current)) {
          items[items.length - 1] = `${items[items.length - 1]} ${current.trim()}`;
          index += 1;
          continue;
        }
        break;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    if (/^\|.*\|$/.test(line) && /^\|[\s:|-]+\|$/.test(lines[index + 1] ?? '')) {
      const head = splitTableRow(line);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && /^\|.*\|$/.test(lines[index] ?? '')) {
        rows.push(splitTableRow(lines[index] ?? ''));
        index += 1;
      }
      blocks.push({ type: 'table', head, rows });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && (lines[index] ?? '').trim() && !/^(#{1,6}\s|```|>|\s*[-*+]\s|\s*\d+[.)]\s|\|)/.test(lines[index] ?? '')) {
      paragraph.push((lines[index] ?? '').trim());
      index += 1;
    }
    if (paragraph.length) blocks.push({ type: 'paragraph', text: paragraph.join(' ') });
    else index += 1;
  }

  return blocks;
}

export function Markdown({ source }: { source: string }) {
  const blocks = parseMarkdown(source);
  return (
    <>
      {blocks.map((block, index) => {
        const key = `block-${index}`;
        switch (block.type) {
          case 'heading': {
            const level = Math.min(block.level ?? 2, 4);
            const text = parseInline(block.text ?? '', key);
            if (level === 1) return <h1 key={key}>{text}</h1>;
            if (level === 2) return <h2 key={key}>{text}</h2>;
            if (level === 3) return <h3 key={key}>{text}</h3>;
            return <h4 key={key}>{text}</h4>;
          }
          case 'code':
            return (
              <pre key={key}>
                <code>{block.text}</code>
              </pre>
            );
          case 'quote':
            return <blockquote key={key}>{parseInline(block.text ?? '', key)}</blockquote>;
          case 'rule':
            return <hr key={key} />;
          case 'list':
            return block.ordered ? (
              <ol key={key}>
                {(block.items ?? []).map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{parseInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ol>
            ) : (
              <ul key={key}>
                {(block.items ?? []).map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>{parseInline(item, `${key}-${itemIndex}`)}</li>
                ))}
              </ul>
            );
          case 'table':
            return (
              <div className="ch-table-wrap" key={key} style={{ marginBottom: '22px' }}>
                <table className="ch-table">
                  <thead>
                    <tr>
                      {(block.head ?? []).map((cell, cellIndex) => (
                        <th key={`${key}-h${cellIndex}`} scope="col">{parseInline(cell, `${key}-h${cellIndex}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(block.rows ?? []).map((row, rowIndex) => (
                      <tr key={`${key}-r${rowIndex}`}>
                        {row.map((cell, cellIndex) => (
                          <td key={`${key}-r${rowIndex}-c${cellIndex}`}>{parseInline(cell, `${key}-r${rowIndex}-c${cellIndex}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          default:
            return <p key={key}>{parseInline(block.text ?? '', key)}</p>;
        }
      })}
    </>
  );
}
