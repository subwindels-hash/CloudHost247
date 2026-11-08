import { Link } from 'react-router-dom';
import CreationScene from './CreationScene';
import './creation-showcase.css';

const images = '/media/homepage/showcase';

/** Illustrative concepts, not customer sites or claims about available templates. */
export default function CreationShowcase() {
  return (
    <section className="creation-showcase" aria-labelledby="creation-showcase-title">
      <div className="creation-showcase__inner">
        <header className="creation-showcase__heading">
          <p className="creation-showcase__eyebrow">Made for your next idea</p>
          <h2 id="creation-showcase-title">See what you can create<br />with CloudHost247<span>.</span></h2>
          <p>Every great idea deserves a place online. Yours could be next.</p>
          <Link className="creation-showcase__cta" to="/websites/templates">Explore templates <span aria-hidden="true">↗</span></Link>
        </header>

        <CreationScene />

        <p className="creation-showcase__swipe-hint" aria-hidden="true">Swipe to explore <span>← &nbsp; →</span></p>
        <div className="creation-showcase__gallery" role="region" tabIndex={0} aria-label="Illustrative website ideas. Scroll to explore.">
          <div className="creation-showcase__column">
            <article className="creation-card creation-card--architecture">
              <img src={`${images}/architecture.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Real estate</span>
              <div className="creation-mini creation-mini--estate" aria-hidden="true">
                <div className="creation-mini__nav"><b>STILL / FORM</b><span>MENU &nbsp; ☰</span></div>
                <div className="creation-mini__estate-image" />
                <div className="creation-mini__copy"><small>SPACES TO BELONG</small><strong>Room to<br />live well.</strong><span>Explore properties ↗</span></div>
              </div>
              <span className="creation-card__label">A place to call home <span>↗</span></span>
            </article>
            <article className="creation-card creation-card--portrait">
              <img src={`${images}/creative.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Creative studio</span>
              <div className="creation-card__portrait-copy"><small>THE PERSONAL BRAND</small><strong>Make your<br />work seen.</strong><span>Ideas worth sharing, beautifully presented.</span></div>
            </article>
          </div>

          <div className="creation-showcase__column">
            <article className="creation-card creation-card--note">
              <span className="creation-card__note-mark" aria-hidden="true">✳</span>
              <p>From the first spark to your first visitor, make it feel like <em>you.</em></p>
              <div className="creation-card__note-footer"><span className="creation-card__note-icon">✦</span><span><b>Your idea, your way</b><small>Start with a little inspiration</small></span></div>
            </article>
            <article className="creation-card creation-card--wellness">
              <img src={`${images}/wellness.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Wellness</span>
              <div className="creation-mini creation-mini--wellness" aria-hidden="true">
                <div className="creation-mini__nav"><b>SOFTLY</b><span>☰</span></div>
                <div className="creation-mini__wellness-image" />
                <div className="creation-mini__wellness-copy"><small>A MOMENT FOR YOU</small><strong>Find your<br />own rhythm.</strong><span>DISCOVER MORE &nbsp; ↗</span></div>
              </div>
            </article>
            <article className="creation-card creation-card--small-note">
              <span>01 / THE BEGINNING</span>
              <p>Start small.<br /><em>Dream big.</em></p>
              <small>A website that grows with your ideas.</small>
            </article>
          </div>

          <div className="creation-showcase__column">
            <article className="creation-card creation-card--cafe">
              <img src={`${images}/cafe.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Food &amp; drink</span>
              <div className="creation-mini creation-mini--cafe" aria-hidden="true">
                <div className="creation-mini__nav"><b>good morning.</b><span>MENU &nbsp; ☰</span></div>
                <div className="creation-mini__cafe-copy"><small>COFFEE &amp; COMPANY</small><strong>Good things<br />start here.</strong><span>COME ON IN ↗</span></div>
              </div>
            </article>
            <article className="creation-card creation-card--statement">
              <span className="creation-card__tag">Portfolio</span>
              <div><small>AN ONLINE HOME FOR YOUR WORK</small><p>Make space<br />for <em>what's next.</em></p></div>
              <span className="creation-card__statement-foot">THE CREATIVE COLLECTION <span>✳</span></span>
            </article>
          </div>

          <div className="creation-showcase__column">
            <article className="creation-card creation-card--feature">
              <img src={`${images}/creative.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Personal brand</span>
              <div className="creation-card__feature-copy"><small>CREATE SOMETHING MEANINGFUL</small><strong>A story only<br />you can tell.</strong><span>Made to stand out.</span></div>
            </article>
            <article className="creation-card creation-card--note creation-card--note-alt">
              <span className="creation-card__note-mark" aria-hidden="true">↗</span>
              <p>Big ideas begin with a <em>simple start.</em></p>
              <div className="creation-card__note-footer"><span className="creation-card__note-icon">✳</span><span><b>Built for possibility</b><small>Ideas for every kind of project</small></span></div>
            </article>
            <article className="creation-card creation-card--shop">
              <img src={`${images}/wellness.jpg`} alt="" loading="lazy" />
              <span className="creation-card__tag">Online shop</span>
              <div className="creation-mini creation-mini--shop" aria-hidden="true"><div className="creation-mini__nav"><b>THE EVERYDAY</b><span>SHOP &nbsp; ↗</span></div><p>Little things.<br /><em>Beautifully made.</em></p><span>EXPLORE THE COLLECTION</span></div>
            </article>
          </div>
        </div>
        <p className="creation-showcase__disclaimer">Illustrative concepts for inspiration, not customer testimonials or live sites.</p>
      </div>
    </section>
  );
}
