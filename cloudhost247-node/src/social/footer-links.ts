/** Only explicitly configured profile links are public. Blank values leave the icon without a link. */
export const SOCIAL_HOSTS = {
  instagram: ['instagram.com', 'www.instagram.com'],
  whatsapp: ['wa.me', 'api.whatsapp.com', 'www.whatsapp.com', 'whatsapp.com'],
  tiktok: ['tiktok.com', 'www.tiktok.com'],
  telegram: ['t.me', 'telegram.me', 'www.telegram.me'],
} as const;
export type SocialNetwork = keyof typeof SOCIAL_HOSTS;
export function isValidSocialUrl(network: SocialNetwork, value: string): boolean {
  if (!value) return true;
  if (value.length > 512) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
      (SOCIAL_HOSTS[network] as readonly string[]).includes(url.hostname.toLowerCase());
  } catch { return false; }
}
