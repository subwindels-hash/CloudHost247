import { Link } from 'react-router-dom';
import { ProductPlansSection } from '../components/ProductPlansSection';
import { usePageMeta } from '../lib/usePageMeta';
import './smtp-hosting.css';

export default function SmtpHostingPage() {
  usePageMeta('SMTP Hosting', 'Explore SMTP hosting plans for your email needs.');
  return <main className="smtp-store">
    <section className="smtp-hero"><div className="smtp-wrap smtp-hero-grid"><div>
      <p className="smtp-kicker"><span>●</span> SMTP HOSTING / CLOUDHOST247</p><h1>Make every<br/><em>message count.</em></h1>
      <p className="smtp-lead">Give your applications and workflows a place to send from. Explore SMTP hosting plans and find the right fit for your email needs.</p>
      <div className="smtp-actions"><a className="smtp-button" href="#smtp-plans">Explore SMTP plans ↗</a><Link className="smtp-hero-link" to="/contact">Talk to our team →</Link></div><p className="smtp-caption">YOUR MESSAGES &nbsp; / &nbsp; YOUR CONNECTION</p>
    </div><div className="smtp-panel" data-tilt data-tilt-max="5" aria-label="Illustration of email messages moving through an SMTP server"><img className="ch-service-art" data-showcase-depth src="/media/cloudhost247/storefronts/smtp-hosting.svg" width="640" height="480" alt="SMTP message routing — conceptual illustration"/></div></div></section>
    <div className="smtp-strip"><div className="smtp-wrap"><span>CONNECT</span><span>✳</span><span>SEND</span><span>✳</span><span>MANAGE</span></div></div>
    <section className="smtp-section" id="smtp-plans"><div className="smtp-wrap"><div className="smtp-heading"><div><p className="smtp-kicker">01 / EXPLORE YOUR OPTIONS</p><h2>Find a plan for<br/>your messages.</h2></div><p>Compare published SMTP hosting plans and review their limits and features before ordering.</p></div><ProductPlansSection slug="smtp-hosting"/><p className="smtp-note">Plans appear here when published in this platform's catalog. For availability and ordering, <Link to="/contact">contact sales</Link>. Sending limits, configuration and availability depend on the selected plan and provider.</p></div></section>
    <section className="smtp-section smtp-soft"><div className="smtp-wrap"><div className="smtp-heading"><div><p className="smtp-kicker">02 / MADE FOR YOUR WORKFLOW</p><h2>Get your messages<br/>moving.</h2></div><p>Choose a service that fits the way you send. Features and availability vary by plan and provider.</p></div><div className="smtp-cards">{[['01 / CONNECT','Connect your application','Use SMTP settings provided with your service to configure compatible applications.'],['02 / SEND','Support your workflow','Choose a plan based on your email needs and the sending limits it provides.'],['03 / MANAGE','Keep things together','Manage your service through your client account once it is provisioned.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="smtp-section"><div className="smtp-wrap smtp-bottom"><div><p className="smtp-kicker">03 / GET STARTED</p><h2>Ready to get connected?</h2><p>Explore available plans or speak to our team about your email requirements.</p></div><div className="smtp-actions"><a className="smtp-button smtp-dark-button" href="#smtp-plans">View SMTP plans ↗</a><Link to="/contact">Contact sales →</Link></div></div></section>
  </main>;
}
