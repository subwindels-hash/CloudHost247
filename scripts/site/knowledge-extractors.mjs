/** Registered public storefronts whose prose is authored outside the generated content map. */
export const CUSTOM_STOREFRONTS = {
  'rdp-hosting.php': 'RdpHostingPage',
  'smm-services.php': 'SmmServicesPage',
  'smtp-hosting.php': 'SmtpHostingPage',
  'proxy-services.php': 'ProxyServicesPage',
  'google-workspace.php': 'GoogleWorkspacePage',
  'office-365.php': 'Office365Page',
  'number-services.php': 'NumberServicesPage',
  'digital-products.php': 'DigitalProductsPage',
};

/** Static, first-party text only. No PHP/Smarty/JavaScript execution or runtime state. */
export function staticStorefrontText(template) {
  // A section with a conditional catalogue mixes mutually exclusive runtime states. Omit the
  // whole section, not just tags: otherwise "no plans" and paid offers become simultaneous facts.
  const sections = template.match(/<section\b[^>]*>[\s\S]*?<\/section>/gi) ?? [];
  const blocks = [];
  for (const section of sections) {
    if (/\{\s*(?:if|foreach|include|php|literal|capture|function|while)\b/i.test(section)) continue;
    // Do not flatten JSX conditional branches into simultaneous published assertions either.
    if (/\{[^{}]*(?:&&|\?)/.test(section)) continue;
    const safe = section.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    for (const match of safe.matchAll(/<(h[1-6]|p|li)\b[^>]*>([\s\S]*?)<\/\1>/gi)) {
      // Variable-containing prose is not a static assertion. Never index template internals.
      if (/[{}]/.test(match[2])) continue;
      blocks.push(match[2].replace(/<br\s*\/?\s*>/gi, ' ').replace(/<[^>]+>/g, ' '));
    }
  }
  return blocks.join('\n');
}

/** Read a literal catalogue field without evaluating code; preserve escaped apostrophes. */
export function catalogueString(block, field) {
  if (!/^[a-z]+$/i.test(field)) throw new Error('Invalid catalogue field');
  const match = new RegExp(`^\\s*${field}:\\s*(['"])((?:\\\\.|(?!\\1)[^\\\\\\r\\n])*)\\1`, 'm').exec(block);
  if (!match) return null;
  return match[2].replace(/\\(['"\\nrt])/g, (_, value) => ({ n: '\n', r: '\r', t: '\t' }[value] ?? value));
}
