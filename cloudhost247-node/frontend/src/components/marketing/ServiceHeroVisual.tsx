import './service-showcase.css';
import heroAssets from './service-hero-assets.json';
export { default as SERVICE_HERO_ASSETS } from './service-hero-assets.json';

const scenes = {
  email: { title: 'Make every message matter', tags: ['Compose', 'Send', 'Connect'] },
  social: { title: 'Content worth talking about', tags: ['Like', 'Comment', 'Share', 'Follow'] },
  hosting: { title: 'A home for your next idea', tags: ['Hosting', 'Resources', 'Your project'] },
  cloud: { title: 'Room for what comes next', tags: ['Compute', 'Storage', 'Control'] },
  network: { title: 'Bring your world together', tags: ['Connect', 'Configure', 'Manage'] },
  security: { title: 'Plan for peace of mind', tags: ['Review', 'Protect', 'Monitor'] },
  developer: { title: 'From idea to your next release', tags: ['Build', 'Deploy', 'Create'] },
  business: { title: 'Make space for better work', tags: ['Discover', 'Connect', 'Create'] },
} as const;
export type ServiceScene = keyof typeof scenes;

/** Only public product landing pages opt in. Never decorate account/checkout screens. */
export function serviceSceneForRoute(route: string): ServiceScene | null {
  if (!/^\/(hosting|cloud|developers|platforms|websites)(\/|$)/.test(route)) return null;
  if (route === '/hosting/email') return 'email';
  if (/security|firewall|backup|monitor/.test(route)) return 'security';
  if (/network|ip-management/.test(route)) return 'network';
  if (/developers|platforms|websites/.test(route)) return 'developer';
  if (/cloud|vps|dedicated/.test(route)) return 'cloud';
  return 'hosting';
}

export default function ServiceHeroVisual({ scene, title, route, imageDescription }: { scene: ServiceScene; title: string; route: string; imageDescription?: string }) {
  const item = scenes[scene];
  const asset: { root: string; format: string; people?: boolean; description?: string } = heroAssets[route as keyof typeof heroAssets];
  if (!asset) throw new Error(`Missing dedicated service hero image for ${route}`);
  const { root } = asset;
  const raster = asset.format === 'raster';
  return <figure className={`service-showcase service-showcase--${scene}${raster ? "" : " service-showcase--diagram"}${asset.people ? " service-showcase--people" : ""}`} aria-label={`${title} illustrative scene`}>
    <picture>
      {raster && <source type="image/avif" srcSet={`${root}-640.avif 640w, ${root}-960.avif 960w, ${root}-1280.avif 1280w`} sizes="(max-width: 800px) 90vw, 48vw" />}
      <img className="service-showcase__photo" src={raster ? `${root}-960.webp` : `${root}.svg`} width="960" height="720" alt={imageDescription ?? `${asset.description ? `AI-generated illustration: ${asset.description}` : `Illustrative ${title.toLowerCase()} scene`} — not a photograph of our facilities or customers`} loading="eager" />
    </picture>
    <div className="service-showcase__note"><span>YOUR NEXT CHAPTER</span><strong>{item.title}</strong><small>Explore {title.toLowerCase()}</small></div>
    <ul className="service-showcase__tiles" aria-label={scene === 'social' ? 'Example social engagement, not actual results' : `${title} themes`}>
      {item.tags.map((tag, i) => <li key={tag}><span className="service-showcase__number" aria-hidden="true">{scene === 'social' ? ['❤️', '💬', '📤', '👥'][i] : `0${i + 1}`}</span><span className="service-showcase__metric">{scene === 'social' && <strong>{['12.8K', '2.4K', '3.6K', '25.0K'][i]}</strong>}<span>{tag}</span></span></li>)}
    </ul>
    <figcaption>{scene === 'social' ? 'Example engagement — illustrative numbers, not actual results' : 'Illustrative imagery'} <span aria-hidden="true">·</span> Options vary by plan</figcaption>
  </figure>;
}
