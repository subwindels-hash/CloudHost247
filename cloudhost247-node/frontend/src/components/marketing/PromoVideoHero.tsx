import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PROMO_SLIDES } from './promo-slides';
import './promo-video-hero.css';

const MEDIA = '/media/homepage/promo/';
const TRANSITION_MS = 700;
const matches = (query: string) => typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;

/** Two original motion-graphics videos, with real HTML copy overlaid on the footage. */
export default function PromoVideoHero() {
  const section = useRef<HTMLElement>(null);
  const videos = useRef<Record<number, HTMLVideoElement | null>>({});
  const cleanupTimer = useRef<number | undefined>(undefined);
  const [index, setIndex] = useState(0);
  const [previous, setPrevious] = useState<number | null>(null);
  const [mobile, setMobile] = useState(() => matches('(max-width: 600px)'));
  const [reducedMotion, setReducedMotion] = useState(() => matches('(prefers-reduced-motion: reduce)'));
  const [requestedPlay, setRequestedPlay] = useState(() => !matches('(prefers-reduced-motion: reduce)'));
  const [visible, setVisible] = useState(false);
  const [activated, setActivated] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [pageHidden, setPageHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const variant = mobile ? 'mobile' : 'desktop';
  const slide = PROMO_SLIDES[index];

  const select = useCallback((next: number) => {
    const target = (next + PROMO_SLIDES.length) % PROMO_SLIDES.length;
    if (target === index) return;
    window.clearTimeout(cleanupTimer.current);
    setPrevious(index);
    setIndex(target);
    setPlaying(false);
    setFailed(false);
    cleanupTimer.current = window.setTimeout(() => setPrevious(null), reducedMotion ? 0 : TRANSITION_MS);
  }, [index, reducedMotion]);
  useEffect(() => () => window.clearTimeout(cleanupTimer.current), []);

  useEffect(() => {
    const responsive = window.matchMedia?.('(max-width: 600px)');
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const resize = () => setMobile(!!responsive?.matches);
    const motionChanged = () => {
      const reduced = !!motion?.matches;
      setReducedMotion(reduced);
      if (reduced) setRequestedPlay(false);
    };
    responsive?.addEventListener?.('change', resize);
    motion?.addEventListener?.('change', motionChanged);
    return () => { responsive?.removeEventListener?.('change', resize); motion?.removeEventListener?.('change', motionChanged); };
  }, []);

  useEffect(() => {
    const node = section.current;
    if (!node) return;
    if (!('IntersectionObserver' in window)) { setVisible(true); setActivated(true); return; }
    const observer = new IntersectionObserver(([entry]) => {
      const onScreen = !!entry?.isIntersecting;
      setVisible(onScreen);
      if (onScreen) setActivated(true);
    }, { threshold: 0.1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const update = () => setPageHidden(document.hidden);
    update();
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useEffect(() => {
    const element = videos.current[index];
    if (!element || !activated) return;
    if (previous !== null) videos.current[previous]?.pause();
    if (requestedPlay && visible && !pageHidden) {
      void element.play().catch(() => setPlaying(false));
    } else {
      element.pause();
    }
  }, [activated, requestedPlay, visible, pageHidden, variant, index, previous]);

  useEffect(() => {
    if (!requestedPlay || !playing || !visible || pageHidden || reducedMotion || hovered || focused) return;
    const timer = window.setTimeout(() => select(index + 1), slide.durationMs);
    return () => window.clearTimeout(timer);
  }, [requestedPlay, playing, visible, pageHidden, reducedMotion, hovered, focused, index, slide.durationMs, select]);

  function togglePlayback() {
    const element = videos.current[index];
    if (!element) return;
    if (playing) {
      setRequestedPlay(false);
      element.pause();
    } else {
      setFailed(false);
      setRequestedPlay(true);
      void element.play().catch(() => { setPlaying(false); setFailed(true); });
    }
  }

  const visibleSlides = previous === null || previous === index ? [index] : [previous, index];
  return (
    <section ref={section} className="promo-video" aria-label="Discover CloudHost247" aria-roledescription="carousel"
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false); }}>
      <div className={`promo-video__canvas promo-video__canvas--${slide.tone}`}>
        {visibleSlides.map((slot) => {
          const item = PROMO_SLIDES[slot];
          const current = slot === index;
          const stem = `${MEDIA}${item.video}-${variant}`;
          return <video key={`${slot}-${variant}-${activated}`} ref={(node) => { videos.current[slot] = node; }}
            className={`promo-video__background ${current ? 'promo-video__background--current' : 'promo-video__background--outgoing'}`}
            muted loop playsInline preload={activated && current ? 'auto' : 'none'} aria-hidden="true"
            poster={`${stem}-poster.webp`}
            onPlay={() => { if (current) { setPlaying(true); setFailed(false); } }}
            onPause={() => { if (current) setPlaying(false); }}
            onError={() => { if (current) { setPlaying(false); setFailed(true); } }}>
            {activated && <><source src={`${stem}.webm`} type="video/webm" /><source src={`${stem}.mp4`} type="video/mp4" /></>}
          </video>;
        })}
        <div className="promo-video__veil" aria-hidden="true" />
        <div className="promo-video__content" aria-live={focused || !requestedPlay || reducedMotion ? 'polite' : 'off'} aria-atomic="true">
          <div className="promo-video__copy" key={slide.id} role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${PROMO_SLIDES.length}: ${slide.category}`}>
            <p className="promo-video__eyebrow"><span aria-hidden="true">✳</span> CLOUDHOST247 <i aria-hidden="true" /> {slide.label}</p>
            <h2>{slide.title}</h2>
            <p className="promo-video__description">{slide.description}</p>
            <div className="promo-video__actions">
              <Link className="promo-video__button promo-video__button--primary" to={slide.primary.to}>{slide.primary.label} <span aria-hidden="true">↗</span></Link>
              {slide.secondary && <Link className="promo-video__button promo-video__button--secondary" to={slide.secondary.to}>{slide.secondary.label} <span aria-hidden="true">→</span></Link>}
            </div>
            <p className="promo-video__support">{slide.support}</p>
          </div>
        </div>
        <div className="promo-video__footer">
          <div className="promo-video__categories" role="group" aria-label="Choose a promotion">
            {PROMO_SLIDES.map((item, i) => <button type="button" key={item.id} aria-pressed={i === index} onClick={() => select(i)}>{item.category}</button>)}
          </div>
          <button className="promo-video__round" type="button" onClick={togglePlayback} aria-label={playing ? 'Pause promotional videos' : 'Play promotional videos'} title={playing ? 'Pause promotional videos' : 'Play promotional videos'}><span aria-hidden="true">{playing ? 'Ⅱ' : '▶'}</span></button>
          {failed && <span className="promo-video__error" role="status">Video unavailable</span>}
          <div className="promo-video__navigation" role="group" aria-label="Slide navigation">
            <button className="promo-video__round" type="button" aria-label="Previous slide" onClick={() => select(index - 1)}>‹</button>
            <div className="promo-video__dots" role="group" aria-label="Slide indicators">{PROMO_SLIDES.map((item, i) => <button type="button" key={item.id} className={i === index ? 'is-active' : ''} aria-label={`Show ${item.category} slide`} aria-current={i === index ? 'true' : undefined} onClick={() => select(i)} />)}</div>
            <button className="promo-video__round" type="button" aria-label="Next slide" onClick={() => select(index + 1)}>›</button>
          </div>
          <small>Illustrative previews</small>
        </div>
      </div>
      <div className="promo-video__base">
        <span>CloudHost247</span>
        <Link to="/support">Support</Link>
      </div>
    </section>
  );
}
