import { Link } from 'react-router-dom';
import { ProductPlansSection } from '../components/ProductPlansSection';
import { usePageMeta } from '../lib/usePageMeta';
import './digital-products.css';

export default function DigitalProductsPage() {
  usePageMeta('Digital Products', 'Explore downloadable digital products for your next project.');
  return <main className="digital-store">
    <section className="digital-hero"><div className="digital-wrap digital-hero-grid"><div>
      <p className="digital-kicker">DIGITAL PRODUCTS / CLOUDHOST247</p><h1>Ideas made<br/><em>ready to use.</em></h1>
      <p className="digital-lead">Discover downloadable products for the work you want to do. Find the right fit, order with confidence, and access your purchases from your account.</p>
      <div className="digital-actions"><a className="digital-button" href="#digital-products">Explore products ↗</a><Link className="digital-hero-link" to="/contact">Talk to our team →</Link></div><p className="digital-caption">CURATED FOR YOUR NEXT PROJECT &nbsp; / &nbsp; CLOUDHOST247</p>
    </div><div className="digital-visual" data-tilt data-tilt-max="5" aria-label="Illustration of a digital product library"><div className="digital-window-bar"><span>● &nbsp; ● &nbsp; ●</span><span>YOUR DIGITAL LIBRARY</span><span>↗</span></div><div className="digital-window" data-showcase-depth><img className="ch-service-art" data-showcase-depth src="/media/cloudhost247/storefronts/digital-products.svg" width="640" height="480" alt="Digital product library — conceptual illustration"/></div></div></div></section>
    <div className="digital-strip"><div className="digital-wrap"><span>DISCOVER</span><span>✳</span><span>DOWNLOAD</span><span>✳</span><span>CREATE</span></div></div>
    <section className="digital-section" id="digital-products"><div className="digital-wrap"><div className="digital-heading"><div><p className="digital-kicker">01 / EXPLORE THE COLLECTION</p><h2>Find something<br/>for your next project.</h2></div><p>Browse published digital products and review their details before ordering.</p></div><ProductPlansSection slug="digital-products"/><p className="digital-note">Products appear here when published in this platform's catalog. For availability and ordering, <Link to="/contact">contact sales</Link>.</p></div></section>
    <section className="digital-section digital-soft"><div className="digital-wrap"><div className="digital-heading"><div><p className="digital-kicker">02 / HOW IT WORKS</p><h2>From discovery<br/>to doing.</h2></div><p>Get from the right product to your next project in a few simple steps.</p></div><div className="digital-cards">{[['01 / DISCOVER','Find your fit','Explore the collection and review the product details before you choose.'],['02 / ORDER','Make it yours','Complete your order through the CloudHost247 checkout.'],['03 / DOWNLOAD','Get to work','Access eligible downloads in your client area after payment and activation.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><span>{label}</span><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="digital-section"><div className="digital-wrap digital-bottom"><div><p className="digital-kicker">03 / GET STARTED</p><h2>Ready for what’s next?</h2><p>Explore the collection or speak to our team about what you need.</p></div><div className="digital-actions"><a className="digital-button digital-dark-button" href="#digital-products">Explore products ↗</a><Link to="/contact">Contact sales →</Link></div></div></section>
  </main>;
}
