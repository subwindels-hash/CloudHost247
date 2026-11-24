import { Link } from 'react-router-dom';
import { ProductPlansSection } from '../components/ProductPlansSection';
import { usePageMeta } from '../lib/usePageMeta';
import './office-365.css';
import './productivity-heroes.css';

export default function Office365Page() {
  usePageMeta('Microsoft 365', 'Explore Microsoft 365, formerly Office 365, for a more connected workday.');
  return <main className="office-store">
    <section className="office-hero"><div className="office-wrap office-hero-grid"><div>
      <div className="office-brand-header">
        <a className="office-brand" href="https://www.microsoft.com/microsoft-365" target="_blank" rel="noopener noreferrer" aria-label="Microsoft 365 official website"><img src="/media/brands/microsoft-365.svg" width="466" height="512" alt="Microsoft 365" /></a>
        <div className="office-brand-copy"><span className="office-brand-name">Microsoft 365</span><span className="office-brand-description">Email. Productivity. Collaboration.</span></div>
      </div>
      <p className="office-kicker">BUILT FOR YOUR WORKDAY</p><h1>Big ideas.<br/><em>Better together.</em></h1>
      <p className="office-lead">Bring your team’s email and productivity tools together. Explore Microsoft 365, formerly Office 365, for a more connected workday.</p>
      <div className="office-actions"><a className="office-button" href="#office-plans">Explore plans ↗</a><Link className="office-hero-link" to="/contact">Talk to our team →</Link></div><p className="office-caption">YOUR WORK, WORKING TOGETHER &nbsp; / &nbsp; CLOUDHOST247</p>
    </div><div className="office-visual productivity-scene productivity-scene--microsoft">
      <img className="ch-service-art" src="/media/brands/team-collaboration.webp" width="1200" height="900" alt="Illustrative office scene of two colleagues collaborating at a laptop" loading="eager" />
      <div className="productivity-note"><span className="productivity-note-label">SPACE FOR YOUR NEXT IDEA</span><strong>Work better, together.</strong><span>Create. Connect. Collaborate.</span></div>
      <ul className="productivity-apps" aria-label="Microsoft productivity apps">
        {([['word', 'Word'], ['excel', 'Excel'], ['powerpoint', 'PowerPoint'], ['outlook', 'Outlook'], ['teams', 'Teams']] as const).map(([slug, label]) => <li key={slug}><img src={`/media/brands/microsoft-${slug}.svg`} alt={`${label} logo`} width="40" height="40"/><span>{label}</span></li>)}
      </ul>
      <div className="productivity-scene-caption"><span className="productivity-status-dot" />Apps and features vary by plan.</div>
    </div></div></section>
    <div className="office-strip"><div className="office-wrap"><span>COMMUNICATE</span><span>✳</span><span>CREATE</span><span>✳</span><span>COLLABORATE</span></div></div>
    <section className="office-section" id="office-plans"><div className="office-wrap"><div className="office-heading"><div><p className="office-kicker">01 / EXPLORE YOUR OPTIONS</p><h2>Find a plan for<br/>the way you work.</h2></div><p>Compare published Microsoft 365 plans and review their details before ordering.</p></div><ProductPlansSection slug="office-365"/><p className="office-note">Plans appear here when published in this platform's catalog. For availability and ordering, <Link to="/contact">contact sales</Link>. Our existing WHMCS integration manages users and license assignments in an existing, authorized Microsoft 365 tenant with available licenses; it does not purchase or renew subscriptions or seats. Contact us to confirm your setup before ordering.</p></div></section>
    <section className="office-section office-soft"><div className="office-wrap"><div className="office-heading"><div><p className="office-kicker">02 / MADE FOR YOUR WORKDAY</p><h2>Do more with<br/>your day.</h2></div><p>Keep your team connected and your work moving. Available apps and features depend on your Microsoft 365 edition and configuration.</p></div><div className="office-cards">{[['01 / COMMUNICATE','A professional inbox','Connect with customers and colleagues using business email on your domain.'],['02 / CREATE','Bring ideas to life','Work with documents, spreadsheets and presentations using familiar productivity tools.'],['03 / COLLABORATE','Work better together','Keep your team in sync and make space for shared work.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="office-section"><div className="office-wrap office-bottom"><div><p className="office-kicker">03 / GET STARTED</p><h2>Ready for a better workday?</h2><p>Explore available plans or speak to our team about your existing Microsoft 365 setup.</p></div><div className="office-actions"><a className="office-button office-dark-button" href="#office-plans">View plans ↗</a><Link to="/contact">Contact sales →</Link></div></div><div className="office-wrap office-disclaimer">Microsoft 365 and Office 365 are trademarks of the Microsoft group of companies. CloudHost247 is an independent service provider.</div></section>
  </main>;
}
