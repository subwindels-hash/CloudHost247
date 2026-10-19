import { ReactNode } from 'react';

/**
 * Shared frame for the public account pages: log in, register and the recovery flow.
 *
 * The frame exists so the four auth screens read as one product rather than four standalone
 * forms. It owns the page heading, the supporting copy and the trust notes; the caller owns the
 * form itself, because each form's field contract is different and belongs with its route.
 *
 * Copy is plain ASCII on purpose: the repository-wide hygiene check rejects decorative bullets
 * and replacement characters in committed text.
 */
interface AuthFrameProps {
  title: string;
  lede: string;
  points?: string[];
  asideTitle?: string;
  asideNotes?: { title: string; body: string }[];
  children: ReactNode;
}

export function AuthFrame({ title, lede, points = [], asideTitle, asideNotes = [], children }: AuthFrameProps) {
  return (
    <div className="ch247-auth">
      <div className="ch247-auth__body">
        <div className="ch247-auth__form">
          <header className="ch247-auth__header">
            <p className="ch247-auth__eyebrow">CloudHost247 account</p>
            <h1>{title}</h1>
            <p className="ch247-auth__lede">{lede}</p>
            {points.length > 0 && (
              <ul className="ch247-auth__points">
                {points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            )}
          </header>
          {children}
        </div>
        {asideNotes.length > 0 && (
          <aside className="ch247-auth__aside" aria-label={asideTitle ?? 'Account notes'}>
            {asideTitle && <h2>{asideTitle}</h2>}
            {asideNotes.map((note) => (
              <div className="ch247-auth__note" key={note.title}>
                <h3>{note.title}</h3>
                <p>{note.body}</p>
              </div>
            ))}
          </aside>
        )}
      </div>
    </div>
  );
}

export default AuthFrame;
