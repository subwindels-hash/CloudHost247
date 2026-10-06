import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { toolsPresentation } from '../../lib/tools-presentation';
type NavigationTool = {
  slug: string;
  name: string;
  path: string;
  discoveryCategories?: string[];
};
const Context = createContext<NavigationTool[]>([]);
export function ToolsNavigationProvider({ children }: { children: ReactNode }) {
  const [tools, setTools] = useState<NavigationTool[]>([]);
  useEffect(() => {
    let active = true;
    void apiFetch<{ tools: NavigationTool[] }>('/api/tools/navigation')
      .then((result) => {
        if (active && Array.isArray(result.tools)) setTools(result.tools);
      })
      .catch(() => {
        if (active) setTools([]);
      });
    return () => {
      active = false;
    };
  }, []);
  return <Context.Provider value={tools}>{children}</Context.Provider>;
}
export function ToolsFooter() {
  const tools = useContext(Context);
  return (
    <nav className="tools-footer-links" aria-label="Tools">
      <h2>Tools</h2>
      <Link to="/tools">All Tools</Link>
      {toolsPresentation.footer
        .map((slug) => tools.find((tool) => tool.slug === slug))
        .filter((tool): tool is NavigationTool => Boolean(tool))
        .map((tool) => (
          <Link key={tool.slug} to={tool.path}>
            {tool.name}
          </Link>
        ))}
      <Link className="tools-card-link" to="/tools">
        View All Tools →
      </Link>
    </nav>
  );
}
export function ToolsMegaMenu({ onNavigate }: { onNavigate?: () => void }) {
  const tools = useContext(Context);
  const node = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (node.current && !node.current.contains(event.target as Node))
        node.current.open = false;
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);
  return (
    <details
      className="tools-nav-disclosure"
      ref={node}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && node.current) {
          node.current.open = false;
          node.current.querySelector('summary')?.focus();
          event.stopPropagation();
        }
      }}
      onPointerEnter={(event) => {
        if (
          event.pointerType === 'mouse' &&
          window.matchMedia('(min-width:1200px)').matches &&
          node.current
        )
          node.current.open = true;
      }}
      onPointerLeave={() => {
        if (
          node.current &&
          !node.current.contains(document.activeElement) &&
          window.matchMedia('(min-width:1200px)').matches
        )
          node.current.open = false;
      }}
    >
      <summary>
        Tools <span aria-hidden="true">⌄</span>
      </summary>
      <div className="tools-mega-panel">
        <div className="tools-mega-intro">
          <h2>CloudHost247 Tools</h2>
          <p>
            Inspect, troubleshoot and build with tools that explain their
            results.
          </p>
          <Link
            to="/tools"
            onClick={() => {
              if (node.current) node.current.open = false;
              onNavigate?.();
            }}
          >
            All Tools →
          </Link>
        </div>
        <div className="tools-mega-groups">
          {Object.entries(toolsPresentation.categories).map(([slug, label]) => {
            const entries = tools
              .filter((tool) => tool.discoveryCategories?.includes(slug))
              .slice(0, 6);
            return entries.length ? (
              <section key={slug}>
                <h3>{label}</h3>
                <ul>
                  {entries.map((tool) => (
                    <li key={tool.slug}>
                      <Link
                        to={tool.path}
                        onClick={() => {
                          if (node.current) node.current.open = false;
                          onNavigate?.();
                        }}
                      >
                        {tool.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null;
          })}
        </div>
      </div>
    </details>
  );
}
