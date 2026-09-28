import { usePageMeta } from '../lib/usePageMeta';

export default function NotFoundPage() {
  usePageMeta('Page not found', 'The page you were looking for does not exist.');

  return (
    <div className="ch247-card">
      <h1>Page not found</h1>
      <p>The page you were looking for does not exist.</p>
    </div>
  );
}
