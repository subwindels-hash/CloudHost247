import { useEffect } from 'react';
import { toolsHost } from '../../lib/tools-runtime';
export default function ToolSeo({
  title,
  description,
  path,
}: {
  title: string;
  description: string;
  path: string;
}) {
  useEffect(() => {
    const base = toolsHost().embedded
      ? toolsHost().webRoot
      : import.meta.env.BASE_URL.replace(/\/$/, '');
    const canonical = window.location.origin + base + path;
    const updates: Array<() => void> = [];
    const set = (
      selector: string,
      tag: string,
      attributes: Record<string, string>
    ) => {
      const existing = document.head.querySelector(selector);
      const element = existing ?? document.createElement(tag);
      const previous =
        element.getAttribute('content') ?? element.getAttribute('href');
      Object.entries(attributes).forEach(([key, value]) =>
        element.setAttribute(key, value)
      );
      if (!existing) document.head.append(element);
      updates.push(() => {
        if (!existing) element.remove();
        else if (previous !== null)
          element.setAttribute(tag === 'link' ? 'href' : 'content', previous);
      });
    };
    set('link[rel="canonical"]', 'link', { rel: 'canonical', href: canonical });
    for (const [key, value] of Object.entries({
      title,
      description,
      url: canonical,
      type: 'website',
      site_name: 'CloudHost247',
    }))
      set(`meta[property="og:${key}"]`, 'meta', {
        property: `og:${key}`,
        content: value,
      });
    const schema = document.createElement('script');
    schema.type = 'application/ld+json';
    schema.textContent = JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'WebPage',
      name: title,
      description,
      url: canonical,
    });
    document.head.append(schema);
    return () => {
      updates.forEach((restore) => restore());
      schema.remove();
    };
  }, [title, description, path]);
  return null;
}
