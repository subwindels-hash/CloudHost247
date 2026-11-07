import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import './experience-3d.css';

/**
 * "3D Experience" — an interactive, dependency-free 3D section for the homepage.
 *
 * Four platform layers are drawn as real CSS 3D planes (perspective + translateZ) inside a
 * `data-tilt` stage. `shared/site/motion.js` already owns pointer tilt, parallax and the hard
 * reduced-motion / coarse-pointer / small-screen off switches, so this component adds no new
 * animation controller and no WebGL dependency: it reuses the site's existing motion contract.
 *
 * The planes are decorative (`aria-hidden`). The interactive version is a set of four real buttons
 * with `aria-pressed` that drive an `aria-live` detail panel containing a link to a real page. That
 * means keyboard and screen-reader users get the same information and the same destination as
 * somebody moving a mouse over the stack. Under reduced motion or below 1024px the planes become
 * an ordinary stacked list (see experience-3d.css), never an overlapping pile of invisible layers.
 */

interface Layer {
  id: string;
  step: string;
  title: string;
  meta: string;
  icon: IconName;
  to: string;
  cta: string;
  description: string;
}

/** Destinations are all real registry routes; no invented pages or marketing numbers. */
const LAYERS: Layer[] = [
  {
    id: 'edge', step: '01', title: 'Edge & DNS', meta: 'Domains · DNS · Anycast',
    icon: 'dns', to: '/domains', cta: 'Explore domains',
    description: 'Register a name, point it at the platform and manage DNS records from the same account that hosts the site. The edge layer is where every request begins.',
  },
  {
    id: 'compute', step: '02', title: 'Compute & Hosting', meta: 'Shared · VPS · Dedicated',
    icon: 'server-rack', to: '/hosting', cta: 'Compare hosting plans',
    description: 'Choose the compute shape that fits the workload — from a first website to isolated virtual machines and dedicated servers — with prices from the live catalogue.',
  },
  {
    id: 'cloud', step: '03', title: 'Cloud & Storage', meta: 'Cloud · Backups · Networks',
    icon: 'cloud', to: '/cloud', cta: 'Explore cloud infrastructure',
    description: 'Private networks, data centres, backups and managed services sit beneath the compute layer, so a growing site does not need a different provider.',
  },
  {
    id: 'operations', step: '04', title: 'Operations', meta: 'Monitoring · Status · Support',
    icon: 'activity', to: '/status', cta: 'View platform status',
    description: 'One place to check service health, raise a ticket and see what is happening across the account. Every layer above is operated from here.',
  },
];

export default function Experience3D() {
  const [activeId, setActiveId] = useState(LAYERS[0].id);
  const active = LAYERS.find((layer) => layer.id === activeId) ?? LAYERS[0];

  return (
    <section className="hg-section hg-exp3d" id="experience-3d" aria-labelledby="hg-exp3d-title">
      <div className="hg-wrap">
        <div className="hg-section__head--split" data-reveal>
          <div>
            <p className="hg-eyebrow">3D Experience</p>
            <h2 className="hg-h2" id="hg-exp3d-title">Explore the platform in three dimensions</h2>
          </div>
          <p className="hg-lede">
            Move your pointer across the stack to see its depth, or choose a layer with the controls.
            Each layer opens the real product area it represents.
          </p>
        </div>

        <div className="hg-exp3d__layout">
          <div className="hg-exp3d__stage" data-tilt data-tilt-max="7">
            <div className="hg-exp3d__glow" aria-hidden="true" />
            <div className="hg-exp3d__stack" aria-hidden="true">
              {LAYERS.map((layer, index) => (
                <div
                  key={layer.id}
                  className={`hg-exp3d__plane${active.id === layer.id ? ' is-active' : ''}`}
                  style={{
                    // Lower layers sit further back in Z and lower on the stage, so the first
                    // (and highlighted) plane is the nearest one rather than being hidden behind
                    // the rest of the stack.
                    '--plane-y': `${index * 96}px`,
                    '--plane-z': `${(LAYERS.length - 1 - index) * 32}px`,
                  } as CSSProperties}
                >
                  <span className="hg-exp3d__plane-step">{layer.step}</span>
                  <span className="hg-exp3d__plane-icon"><Icon name={layer.icon} size={22} /></span>
                  <span className="hg-exp3d__plane-text">
                    <b>{layer.title}</b>
                    <small>{layer.meta}</small>
                  </span>
                </div>
              ))}
            </div>
            <p className="hg-exp3d__hint" aria-hidden="true">Interactive 3D · pointer or layer controls</p>
          </div>

          <div className="hg-exp3d__panel">
            <div className="hg-exp3d__controls" role="group" aria-label="Choose a platform layer">
              {LAYERS.map((layer) => (
                <button
                  type="button"
                  key={layer.id}
                  className={`hg-exp3d__control${active.id === layer.id ? ' is-active' : ''}`}
                  aria-pressed={active.id === layer.id}
                  aria-controls="hg-exp3d-detail"
                  onClick={() => setActiveId(layer.id)}
                >
                  <Icon name={layer.icon} size={16} />
                  <span>{layer.title}</span>
                  <span className="hg-exp3d__control-step" aria-hidden="true">{layer.step}</span>
                </button>
              ))}
            </div>

            <div className="hg-exp3d__detail" id="hg-exp3d-detail" aria-live="polite">
              <p className="hg-exp3d__detail-step">Layer {active.step}</p>
              <h3 className="hg-h3">{active.title}</h3>
              <p>{active.description}</p>
              <Link className="hg-link" to={active.to}>
                {active.cta} <span className="hg-link__arrow" aria-hidden="true">→</span>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
