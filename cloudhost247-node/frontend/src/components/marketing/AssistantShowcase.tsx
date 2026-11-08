import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../ui/Icon';
import './assistant-showcase.css';

const FEATURES: { id: string; title: string; description: string; icon: IconName; prompt: string; preview: string; detail: string }[] = [
  { id: 'speed', title: 'Speed it up', description: 'Find a clearer path to a faster website, one improvement at a time.', icon: 'gauge', prompt: 'Where should I start with site speed?', preview: 'Start with the essentials', detail: 'Review images, caching and page assets.' },
  { id: 'migrate', title: 'Migrate', description: 'Plan the move to a new home for your website with less guesswork.', icon: 'transfer', prompt: 'How do I prepare to move my site?', preview: 'Make a moving checklist', detail: 'Gather your files, database and domain details.' },
  { id: 'fix', title: 'Fix', description: 'Work through website issues with a little more direction.', icon: 'wrench', prompt: 'Where can I look when a site is down?', preview: 'Check the basics', detail: 'Start with DNS, hosting and service status.' },
  { id: 'manage', title: 'Manage', description: 'Keep the details of your online presence in view.', icon: 'settings', prompt: 'What is happening with my services?', preview: 'Get account context', detail: 'Ask about services, billing and domains.' },
  { id: 'edit', title: 'Edit', description: 'Shape your website and make it feel more like your idea.', icon: 'pen', prompt: 'How can I start a new website?', preview: 'Build from an idea', detail: 'Create a draft and make it your own.' },
];

/** Illustrative guidance, not a claim that the assistant performs changes automatically. */
export default function AssistantShowcase() {
  const [active, setActive] = useState(FEATURES[0].id);
  const container = useRef<HTMLDivElement>(null);
  const visual = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelReset = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => cancelReset(), []);
  useEffect(() => {
    const element = visual.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      element.classList.toggle('is-visible', Boolean(entry?.isIntersecting));
    }, { rootMargin: '100px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="assistant-showcase" aria-labelledby="assistant-showcase-title">
      <div className="assistant-showcase__inner">
        <div className="assistant-showcase__intro">
          <p className="assistant-showcase__eyebrow">A little help goes a long way</p>
          <h2 id="assistant-showcase-title">More confidence at every step<span>.</span></h2>
          <p>From your first idea to the everyday details, explore ways to keep your website moving.</p>
        </div>
        <div
          className="assistant-features"
          ref={container}
          aria-label="Website feature ideas"
          onPointerEnter={cancelReset}
          onPointerLeave={(event) => {
            if (event.pointerType !== 'mouse') return;
            cancelReset();
            timer.current = setTimeout(() => {
              if (!container.current?.contains(document.activeElement)) setActive(FEATURES[0].id);
            }, 300);
          }}
        >
          {FEATURES.map((feature, index) => {
            const selected = active === feature.id;
            return (
              <button
                type="button"
                key={feature.id}
                className={`assistant-feature${selected ? ' is-active' : ''}`}
                aria-pressed={selected}
                aria-label={feature.title}
                aria-describedby={selected ? `assistant-feature-${feature.id}-description` : undefined}
                onPointerEnter={(event) => { if (event.pointerType === 'mouse') { cancelReset(); setActive(feature.id); } }}
                onFocus={() => { cancelReset(); setActive(feature.id); }}
                onClick={() => { cancelReset(); setActive(feature.id); }}
              >
                <span className="assistant-feature__top"><span className="assistant-feature__number">0{index + 1}</span><span className="assistant-feature__icon"><Icon name={feature.icon} size={19} /></span></span>
                <span className="assistant-feature__title">{feature.title}</span>
                <span className="assistant-feature__content" aria-hidden={!selected}>
                  <span className="assistant-feature__description" id={`assistant-feature-${feature.id}-description`}>{feature.description}</span>
                  <span className="assistant-demo" aria-hidden="true">
                    <span className="assistant-demo__bar"><span>✦ &nbsp; CLOUDHOST247</span><span>···</span></span>
                    <span className="assistant-demo__question">{feature.prompt}</span>
                    <span className="assistant-demo__response"><span className="assistant-demo__spark">✦</span><span><b>{feature.preview}</b><small>{feature.detail}</small><i>Explore the next step &nbsp; ↗</i></span></span>
                  </span>
                </span>
                <span className="assistant-feature__arrow" aria-hidden="true">↗</span>
              </button>
            );
          })}
        </div>
        <p className="assistant-showcase__note">Illustrative examples of website guidance, not automated actions.</p>

        <div className="assistant-promo">
          <div className="assistant-promo__copy">
            <p className="assistant-showcase__eyebrow">CLOUD ASSISTANT</p>
            <h2>Your assistant.<br /><span>More clarity for your business.</span></h2>
            <p>Ask about the details that keep your business online — from your domains and services to billing and support.</p>
            <Link className="assistant-promo__link" to="/account/assistant">Learn more <span aria-hidden="true">↗</span></Link>
          </div>
          <div className="assistant-promo__visual" ref={visual} aria-hidden="true">
            <div className="assistant-promo__halo" />
            <div className="assistant-promo__nav"><span>✦</span><b>Cloud Assistant</b><small>ACCOUNT</small><i>Chat</i><i>Activity</i><i>Services</i></div>
            <div className="assistant-promo__task assistant-promo__task--one"><span>◉</span><div><small>DOMAINS</small><b>Show my domain DNS records.</b></div></div>
            <div className="assistant-promo__task assistant-promo__task--two"><span>↗</span><div><small>BILLING</small><b>What is my billing status?</b></div></div>
            <div className="assistant-promo__task assistant-promo__task--three"><span>◇</span><div><small>SECURITY</small><b>What is my SSL certificate status?</b></div></div>
            <div className="assistant-promo__orb">✦</div>
            <div className="assistant-promo__visual-label">YOUR ACCOUNT, IN CONTEXT <span>↗</span></div>
          </div>
        </div>
      </div>
    </section>
  );
}
