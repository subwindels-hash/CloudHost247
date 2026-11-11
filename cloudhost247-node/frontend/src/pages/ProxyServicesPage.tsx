import { Link } from 'react-router-dom';
import { usePageMeta } from '../lib/usePageMeta';
import './proxy-services.css';

export default function ProxyServicesPage() {
  usePageMeta('LTE Proxy Services', 'Explore LTE proxy services for your connection and workflow.');
  return <main className="proxy-store">
    <section className="proxy-hero"><div className="proxy-wrap proxy-hero-grid"><div>
      <p className="proxy-kicker"><span>●</span> LTE PROXY SERVICES / CLOUDHOST247</p><h1>A smarter route<br/><em>to the web.</em></h1>
      <p className="proxy-lead">Explore LTE proxy services built around how you connect. Find a plan that fits your workflow and manage your service from your account.</p>
      <div className="proxy-actions"><a className="proxy-button" href="#proxy-plans">Explore proxy plans ↗</a><Link className="proxy-hero-link" to="/contact">Talk to our team →</Link></div><p className="proxy-caption">YOUR CONNECTION &nbsp; / &nbsp; YOUR CONTROL</p>
    </div><div className="proxy-panel" data-tilt data-tilt-max="5" aria-label="Illustration of a connection routed through a proxy network"><img className="ch-service-art" data-showcase-depth src="/media/cloudhost247/storefronts/proxy-services.svg" width="640" height="480" alt="Proxy routing diagram — conceptual illustration"/></div></div></section>
    <div className="proxy-strip"><div className="proxy-wrap"><span>CONNECT</span><span>✳</span><span>CONFIGURE</span><span>✳</span><span>MANAGE</span></div></div>
    <section className="proxy-section" id="proxy-plans"><div className="proxy-wrap"><div className="proxy-heading"><div><p className="proxy-kicker">01 / EXPLORE YOUR OPTIONS</p><h2>Find the right route<br/>for your workflow.</h2></div><p>Regions, protocols and rotation options depend on the plan and provider configuration.</p></div><div className="proxy-empty"><h3>Proxy services are coming soon.</h3><p>Ordering is not yet available on this platform. Contact our team to discuss availability and your requirements.</p><Link to="/contact">Contact sales →</Link></div><p className="proxy-note">Availability and provisioning depend on the configured provider.</p></div></section>
    <section className="proxy-section proxy-soft"><div className="proxy-wrap"><div className="proxy-heading"><div><p className="proxy-kicker">02 / BUILT AROUND YOUR WORKFLOW</p><h2>Connection, with<br/>more control.</h2></div><p>Choose the options that suit your use case. Features and availability vary by plan and provider.</p></div><div className="proxy-cards">{[['01 / CONNECT','Choose your protocol','Explore plans with available HTTP, HTTPS or SOCKS5 options where supported.'],['02 / CONFIGURE','Set your rotation','Review the available IP rotation settings for your selected service.'],['03 / MANAGE','Keep control in one place','Manage your proxy service through your client account when provisioned.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="proxy-section"><div className="proxy-wrap proxy-bottom"><div><p className="proxy-kicker">03 / GET STARTED</p><h2>Ready to find your route?</h2><p>Speak to our team about your requirements.</p></div><div className="proxy-actions"><Link className="proxy-button proxy-dark-button" to="/contact">Contact sales ↗</Link></div></div></section>
  </main>;
}
