import { Link } from 'react-router-dom';
import { ProductPlansSection } from '../components/ProductPlansSection';
import { usePageMeta } from '../lib/usePageMeta';
import './rdp-hosting.css';

export default function RdpHostingPage() {
  usePageMeta('Remote Desktop Servers', 'Explore remote desktop server plans for a workspace you can access remotely.');
  return <main className="rdp-store">
    <section className="rdp-store-hero"><div className="rdp-store-wrap rdp-store-hero-grid"><div>
      <p className="rdp-store-kicker">● &nbsp; REMOTE DESKTOP SERVERS</p>
      <h1>Your desktop.<br/><span>Wherever work takes you.</span></h1>
      <p className="rdp-store-lead">A remote workspace that moves with you. Explore RDP server plans and find the resources for the way you work.</p>
      <div className="rdp-store-actions"><a className="rdp-store-button" href="#rdp-plans">Explore RDP plans ↗</a><Link to="/contact">Talk to our team →</Link></div>
      <p className="rdp-store-caption">A REMOTE WORKSPACE &nbsp; / &nbsp; BUILT FOR YOUR DAY</p>
    </div><div className="rdp-store-window" data-tilt data-tilt-max="5" aria-label="Illustration of a remote desktop connection"><div className="rdp-store-window-bar"><span>● ● ●</span><span>REMOTE WORKSPACE</span><span>↗</span></div><div className="rdp-store-screen" data-showcase-depth><div className="rdp-store-screen-bar"><span>● &nbsp; REMOTE CONNECTION</span><span>DESKTOP / 01</span></div><div className="rdp-store-screen-body"><svg viewBox="0 0 160 130" fill="none" aria-hidden="true"><rect x="13" y="9" width="134" height="91" rx="8" stroke="currentColor" strokeWidth="2"/><path d="M13 78h134M80 100v17M54 118h52" stroke="currentColor" strokeWidth="2"/><path d="M48 40h21v-16H48v16zm26 0h27V24H74v16zM48 45h21v18H48V45zm26 0h27v18H74V45z" fill="currentColor" opacity=".75"/></svg><p>YOUR WORKSPACE, CONNECTED</p><h2>A familiar desktop.<br/>More freedom.</h2><span>REMOTE ACCESS &nbsp; ↗</span></div></div><div className="rdp-store-window-bar rdp-store-window-bottom"><span>● &nbsp; CLOUDHOST247</span><span>REMOTE DESKTOP</span></div></div></div></section>
    <div className="rdp-store-strip"><div className="rdp-store-wrap"><span>WORK FROM ANYWHERE</span><span>✳</span><span>YOUR REMOTE WORKSPACE</span><span>✳</span><span>FIND YOUR FIT</span></div></div>
    <section className="rdp-store-section" id="rdp-plans"><div className="rdp-store-wrap"><div className="rdp-store-heading"><div><p className="rdp-store-kicker">01 / FIND YOUR WORKSPACE</p><h2>Choose your RDP plan.</h2></div><p>Compare available configurations and find the right fit for your remote workspace.</p></div><ProductPlansSection slug="rdp-hosting"/><p className="rdp-store-note">RDP plans on this platform are listed when published in its catalog. For availability and ordering, <Link to="/contact">contact sales</Link>.</p></div></section>
    <section className="rdp-store-section rdp-store-soft"><div className="rdp-store-wrap"><div className="rdp-store-heading"><div><p className="rdp-store-kicker">02 / THE REMOTE ADVANTAGE</p><h2>Make space for better work.</h2></div><p>Keep your workspace within reach, whether you're at your desk or on the move.</p></div><div className="rdp-store-cards">{[['01 / ACCESS','Work from more places','Connect to your remote desktop from a compatible device when you need your workspace.'],['02 / CONTROL','A familiar environment','Use a desktop interface to work with your applications and files remotely.'],['03 / CHOICE','Pick your resources','Compare the specifications and terms of each available plan before you order.']].map(([label,title,body]) => <article key={label} data-tilt data-tilt-max="3"><p className="rdp-store-kicker">{label}</p><h3>{title}</h3><p>{body}</p></article>)}</div></div></section>
    <section className="rdp-store-section"><div className="rdp-store-wrap rdp-store-heading"><div><p className="rdp-store-kicker">03 / GET STARTED</p><h2>Ready to work remotely?</h2><p>Find a server that fits your needs, or get in touch if you have questions.</p></div><Link className="rdp-store-button rdp-store-button-dark" to="/contact">Contact sales ↗</Link></div></section>
  </main>;
}
