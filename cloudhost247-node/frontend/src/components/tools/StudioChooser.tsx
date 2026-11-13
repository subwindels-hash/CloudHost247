import { useId, useMemo, useState } from 'react';
import type { StudioField, StudioOption } from '../../../../src/tools/design-studio/forms';
import './studio-chooser.css';

/**
 * The "choose a type" panel at the top of a Design Studio form.
 *
 * A dropdown of ninety barcode types is a list nobody reads, and the choice decides what the whole
 * rest of the form asks for. This shows the same options as cards, each with the one line that says
 * what it is for, filterable by the registry's own groups and searchable by name. Shortcut chips
 * put the handful of types most people want one click away.
 *
 * The control is a real radio group, so arrow keys, screen readers and form semantics behave as they
 * would for any other set of radio buttons; only the presentation is a grid.
 */

interface Props {
  field: StudioField;
  value: string;
  onChange: (value: string) => void;
  /** Label for the group of shortcut chips, e.g. "Popular types". */
  popularLabel?: string;
  /** What the options are called in the search box, e.g. "barcode types". */
  searchNoun?: string;
}

function matches(option: StudioOption, needle: string): boolean {
  if (needle === '') return true;
  return `${option.label} ${option.help ?? ''} ${option.group ?? ''}`.toLowerCase().includes(needle);
}

export default function StudioChooser({ field, value, onChange, popularLabel = 'Popular', searchNoun }: Props) {
  const options = field.options ?? [];
  const searchId = useId();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState<string | null>(null);

  const groups = useMemo(() => {
    const seen = new Map<string, number>();
    for (const option of options) {
      if (!option.group) continue;
      seen.set(option.group, (seen.get(option.group) ?? 0) + 1);
    }
    return [...seen.entries()];
  }, [options]);

  const needle = query.trim().toLowerCase();
  const shown = options.filter((option) => (group === null || option.group === group) && matches(option, needle));
  const popular = (field.popular ?? [])
    .map((id) => options.find((option) => option.value === id))
    .filter((option): option is StudioOption => option !== undefined)
    .filter((option) => option.value !== value);

  // A long list would push the rest of the form off the screen; it scrolls inside its own panel
  // instead. A short one (three or four choices) is simply laid out.
  const scrolls = options.length > 12;

  return (
    <fieldset className="studio-chooser">
      <legend className="studio-chooser__legend">{field.label}</legend>

      {popular.length > 0 ? (
        <div className="studio-chooser__popular">
          <span className="studio-chooser__popular-label">{popularLabel}</span>
          <div className="studio-chooser__chips">
            {popular.map((option) => (
              <button key={option.value} type="button" className="studio-chooser__chip" onClick={() => onChange(option.value)}>
                {option.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {options.length > 6 ? (
        <div className="studio-chooser__filter">
          <label className="studio-chooser__search" htmlFor={searchId}>
            <span className="studio-chooser__search-icon" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8">
                <circle cx="7" cy="7" r="4.6" />
                <path d="M10.4 10.4 14 14" strokeLinecap="round" />
              </svg>
            </span>
            <input
              id={searchId}
              type="search"
              value={query}
              placeholder={`Search ${options.length} ${searchNoun ?? 'options'}`}
              autoComplete="off"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          {groups.length > 1 ? (
            <div className="studio-chooser__groups" role="group" aria-label="Filter by group">
              <button
                type="button"
                className={`studio-chooser__group${group === null ? ' is-active' : ''}`}
                aria-pressed={group === null}
                onClick={() => setGroup(null)}
              >
                All <span>{options.length}</span>
              </button>
              {groups.map(([name, count]) => (
                <button
                  key={name}
                  type="button"
                  className={`studio-chooser__group${group === name ? ' is-active' : ''}`}
                  aria-pressed={group === name}
                  onClick={() => setGroup(group === name ? null : name)}
                >
                  {name} <span>{count}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div className={`studio-chooser__rack${scrolls ? ' studio-chooser__rack--scroll' : ''}`}>
        {shown.length === 0 ? (
          <p className="studio-chooser__empty">
            Nothing matches “{query}”.{' '}
            <button
              type="button"
              className="studio-link"
              onClick={() => {
                setQuery('');
                setGroup(null);
              }}
            >
              Show every option
            </button>
          </p>
        ) : (
          <div className="studio-chooser__grid" role="none">
            {shown.map((option) => {
              const selected = option.value === value;
              return (
                <label key={option.value} className={`studio-choice${selected ? ' is-selected' : ''}`} data-value={option.value}>
                  <input type="radio" name={field.name} value={option.value} checked={selected} onChange={() => onChange(option.value)} />
                  <span className="studio-choice__body">
                    <span className="studio-choice__title">
                      <span className="studio-choice__name">{option.label}</span>
                      <span className="studio-choice__tick" aria-hidden="true">
                        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="2.4">
                          <path d="m2.5 8.5 3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      </span>
                    </span>
                    {option.help ? <span className="studio-choice__help">{option.help}</span> : null}
                    {option.group ? <span className="studio-choice__group">{option.group}</span> : null}
                  </span>
                </label>
              );
            })}
          </div>
        )}
      </div>
      <p className="studio-chooser__count" aria-live="polite">
        {options.length === 1 ? '1 option' : shown.length === options.length ? `${options.length} options` : `${shown.length} of ${options.length} options`}
      </p>
    </fieldset>
  );
}
