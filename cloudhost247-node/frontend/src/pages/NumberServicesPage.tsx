import { Link } from 'react-router-dom';
import { ProductPlansSection } from '../components/ProductPlansSection';
import { usePageMeta } from '../lib/usePageMeta';
import './number-services.css';

export default function NumberServicesPage() {
  usePageMeta('Virtual Number Services', 'Explore virtual number plans for your business and find a connection that fits your needs.');
  return <main className="number-store">
    <section className="number-hero"><div className="number-wrap number-hero-grid"><div>
      <p className="number-kicker">NUMBER SERVICES / CLOUDHOST247</p><h1>Be there,<br/><em>where it matters.</em></h1>
      <p className="number-lead">A number can bring your business closer to the people you serve. Explore virtual number plans and find a connection that fits your needs.</p>
      <div className="number-actions"><a className="number-button" href="#number-plans">Explore number plans ↗</a><Link className="number-hero-link" to="/contact">Talk to our team →</Link></div><p className="number-caption">A BETTER WAY TO CONNECT &nbsp; / &nbsp; CLOUDHOST247</p>
    </div><div className="number-visual" data-tilt data-tilt-max="5" aria-label="Illustration of a virtual phone number and connections"><img className="ch-service-art" data-showcase-depth src="/media/cloudhost247/storefronts/number-services.svg" width="640" height="480" alt="Phone number services — conceptual illustration"/></div></div></section>
    <div className="number-strip"><div className="number-wrap"><span>YOUR PRESENCE</span><span>✳</span><span>YOUR CONNECTION</span><span>✳</span><span>YOUR BUSINESS</span></div></div>
    <section className="number-section" id="number-plans"><div className="number-wrap"><div className="number-heading"><div><p className="number-kicker">01 / FIND YOUR FIT</p><h2>A number for<br/>your next step.</h2></div><p>Compare published number plans. Availability, number types, and capabilities depend on the country and provider.</p></div><ProductPlansSection slug="number-services"/><p className="number-portal">Plans appear here when published in this platform's catalog. For availability and ordering, <Link to="/contact">contact sales</Link>.</p></div></section>
    <section className="number-section number-soft"><div className="number-wrap"><div className="number-heading"><div><p className="number-kicker">02 / THE CONNECTION</p><h2>Stay close to<br/>what matters.</h2></div><p>Choose a service around the people you want to reach and the way you work.</p></div><div className="number-cards">{[['01 / CHOOSE','Find the right number','Explore number types and locations offered by the configured provider.'],['02 / CONNECT','Build your presence','Use a virtual number to give customers another way to connect with your business.'],['03 / MANAGE','Keep things together','Manage your numbers through the phone services client area.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="number-section"><div className="number-wrap number-bottom"><div><p className="number-kicker">03 / GET STARTED</p><h2>Let's get you connected.</h2><p>Explore available plans or speak to our team about your requirements.</p></div><div className="number-actions"><a className="number-button number-dark-button" href="#number-plans">View number plans ↗</a><Link to="/contact">Contact sales →</Link></div></div></section>
  </main>;
}
