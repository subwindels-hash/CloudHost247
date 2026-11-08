import { useEffect, useRef } from 'react';

/** Decorative, CSS-rendered scene. It never blocks the templates link or requires WebGL. */
export default function CreationScene() {
  const scene = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = scene.current;
    if (!element || typeof IntersectionObserver === 'undefined') return undefined;
    const observer = new IntersectionObserver(([entry]) => {
      element.classList.toggle('is-visible', Boolean(entry?.isIntersecting));
    }, { rootMargin: '100px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="creation-scene" ref={scene} aria-hidden="true">
      <div className="creation-scene__ambient" />
      <div className="creation-scene__depth" data-tilt data-tilt-max="4">
        <div className="creation-scene__orbit creation-scene__orbit--back" />
        <div className="creation-scene__plinth" />
        <div className="creation-scene__browser-float">
          <div className="creation-scene__browser">
            <div className="creation-scene__browser-bar"><span className="creation-scene__dots"><i /><i /><i /></span><span className="creation-scene__address">your-idea.com</span><span className="creation-scene__bar-end">✦</span></div>
            <div className="creation-scene__site">
              <div className="creation-scene__site-nav"><strong>STUDIO<span>.</span></strong><span>WORK &nbsp;&nbsp; ABOUT &nbsp;&nbsp; CONTACT</span><i>↗</i></div>
              <div className="creation-scene__site-content">
                <div className="creation-scene__site-copy"><small>AN IDEA, MADE REAL</small><b>Make space<br />for <em>more.</em></b><span>Thoughtful ideas for a<br />more beautiful everyday.</span><i>EXPLORE THE STUDIO &nbsp; ↗</i></div>
                <div className="creation-scene__site-image" />
              </div>
              <div className="creation-scene__site-bottom"><span>CREATIVE BY NATURE</span><span>01 — 03</span></div>
            </div>
          </div>
        </div>
        <div className="creation-scene__phone-float">
          <div className="creation-scene__phone-parallax" data-parallax="0.10">
            <div className="creation-scene__phone"><div className="creation-scene__phone-notch" /><div className="creation-scene__phone-screen"><span>STUDIO<span>.</span></span><div className="creation-scene__phone-image" /><b>Made for<br /><em>more.</em></b><i>EXPLORE &nbsp; ↗</i></div></div>
          </div>
        </div>
        <div className="creation-scene__palette-float">
          <div className="creation-scene__palette"><span>CREATE YOUR SPACE</span><b>Made to feel like you.</b><div><i /><i /><i /><i /></div><small>DESIGN / BUILD / GROW</small></div>
        </div>
        <div className="creation-scene__orbit creation-scene__orbit--front" />
        <div className="creation-scene__sphere" />
        <div className="creation-scene__spark creation-scene__spark--one">✳</div>
        <div className="creation-scene__spark creation-scene__spark--two">✦</div>
      </div>
      <div className="creation-scene__caption"><span>THE CREATIVE SPACE</span><span>IDEAS INTO REALITY <b>↗</b></span></div>
    </div>
  );
}
