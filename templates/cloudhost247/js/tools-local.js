/** Browser-only tools. Nothing in this module contacts the network. */
import QRCode from './vendor/qrcode.mjs';

const TONES = [
  ['Harbor', 16, 30, 44], ['Mint Signal', 180, 242, 205], ['Kelp', 25, 105, 71], ['Fog', 244, 247, 247],
  ['Copper', 176, 122, 78], ['Slate', 85, 101, 112], ['Tide', 38, 103, 88], ['Paper', 255, 255, 255],
  ['Night', 8, 18, 26], ['Lagoon', 46, 140, 126], ['Sand', 232, 214, 184], ['Signal Red', 176, 64, 48],
  ['Amber', 214, 164, 64], ['Iris', 92, 104, 168], ['Graphite', 52, 64, 74], ['Foam', 214, 236, 226],
];

/** Column names that hold a generated secret rather than a measurement. */
const SECRET_COLUMNS = new Set(['Password', 'Passphrase', 'Key', 'Secret', 'Token']);

/**
 * Should this cell be masked until the visitor asks to see it?
 *
 * Two row shapes carry secrets: `{ Measure: 'Password', Value: ... }` and the single-purpose rows
 * the generators emit, `{ Password: '...' }` or `{ '#': 1, Key: '...' }`. Only the first was being
 * masked, which left the password and API-key tools printing their secret on screen. The rule lives
 * here rather than in the page script so the acceptance suite can exercise the same function the
 * browser calls.
 */
export function isSecretCell(row, key) {
  if (!row || typeof row !== 'object') return false;
  if (SECRET_COLUMNS.has(String(key))) return true;
  return SECRET_COLUMNS.has(String(row.Measure)) && key === 'Value';
}

export async function runLocal(handler, input) {
  const fn = handlers[handler];
  if (!fn) return fail('This browser tool is not implemented.');
  try { return await fn(input || {}); }
  catch (error) { return fail(error && error.message ? error.message : 'The value could not be processed.'); }
}

const handlers = {
  md5: async (input) => ok('MD5 checksum', [{ MD5: md5(text(input)) }], ['MD5 is a checksum, not a password hash.']),
  base64: async (input) => {
    const value = text(input);
    const urlSafe = String(input.variant) === 'urlsafe';
    if (input.op === 'decode') {
      const stripped = value.replace(/\s+/g, '');
      if (!stripped) throw new Error('Enter the Base64 to decode.');
      const alphabet = urlSafe ? /[^A-Za-z0-9_\-=]/ : /[^A-Za-z0-9+/=]/;
      const invalid = stripped.match(alphabet);
      if (invalid) throw new Error('"' + invalid[0] + '" is not in the ' + (urlSafe ? 'URL-safe' : 'standard') + ' Base64 alphabet. Switch the alphabet, or correct the input — a permissive decode would silently drop it.');
      const body = stripped.replace(/=+$/, '');
      if (body.length % 4 === 1) throw new Error('This Base64 is truncated: after removing padding the length is ' + body.length + ', and a valid Base64 body never leaves a remainder of 1 when divided by 4.');
      const normalized = urlSafe
        ? body.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (body.length % 4)) % 4)
        : stripped;
      let binary;
      try {
        binary = atob(normalized);
      } catch (error) {
        throw new Error('Base64 decoding failed: ' + (error && error.message ? error.message : 'malformed input'));
      }
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      const decoded = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
      if (decoded.includes('\uFFFD')) {
        return ok('Decoded — but the bytes are not valid UTF-8', [
          { Measure: 'Text', Value: decoded },
          { Measure: 'Bytes', Value: bytes.length },
          { Measure: 'Hex', Value: hex(bytes) },
        ], [
          'The Base64 was well formed, but it does not encode UTF-8 text. The hex view is the faithful reading — the replacement characters are not in the original.',
          BASE64_NOTE, CALC_PRIVACY_NOTE,
        ]);
      }
      return attachCopy(ok('Decoded ' + bytes.length + ' bytes', [
        { Measure: 'Text', Value: decoded },
        { Measure: 'Characters', Value: [...decoded].length },
        { Measure: 'Bytes', Value: bytes.length },
      ], ['Decoding is strict: characters outside the chosen alphabet and a bad padding length are reported, not skipped.', BASE64_NOTE, CALC_PRIVACY_NOTE]), decoded, 'decoded.txt');
    }
    if (!value) throw new Error('Enter the text to encode.');
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    const standard = btoa(binary);
    const encoded = urlSafe ? standard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : standard;
    return attachCopy(ok('Encoded ' + bytes.length + ' bytes', [
      { Measure: 'Base64', Value: encoded },
      { Measure: 'Alphabet', Value: urlSafe ? 'URL-safe (- _ without padding)' : 'standard (+ / with = padding)' },
      { Measure: 'Input characters', Value: [...value].length },
      { Measure: 'UTF-8 bytes', Value: bytes.length },
      { Measure: 'Output characters', Value: encoded.length },
    ], ['Text is encoded as UTF-8, so multi-byte characters survive a round trip.', BASE64_NOTE, CALC_PRIVACY_NOTE]), encoded, 'encoded.txt');
  },
  binary: async (input) => ok('Decoded binary', [{ Text: binaryToText(text(input)) }]),
  text_binary: async (input) => ok('Encoded text', [{ Binary: textToBinary(text(input)) }]),
  json_view: async (input) => jsonResult(text(input), true),
  json_beautify: async (input) => jsonResult(text(input), true),
  json_minify: async (input) => jsonResult(text(input), false),
  htaccess: async (input) => ok('Redirect snippet', [{ Snippet: `Redirect ${input.code || '301'} ${must(input.source, 'from path')} ${must(input.target, 'target')}` }], ['Review the snippet before placing it in a server configuration.']),
  rewrite: async (input) => ok('Rewrite snippet', [{ Snippet: `RewriteEngine On\nRewriteRule ${must(input.pattern, 'pattern')} ${must(input.dest, 'substitution')} [L,QSA]` }]),
  raid: async (input) => {
    const disks = num(input.disks, 2, 64);
    const size = num(input.size, 1, 100000);
    const level = String(input.level || '5');
    const usable = { '0': disks * size, '1': Math.floor(disks / 2) * size, '5': (disks - 1) * size, '6': (disks - 2) * size, '10': Math.floor(disks / 2) * size }[level];
    if (usable == null || usable <= 0) throw new Error('That RAID level needs more disks.');
    return ok('Capacity estimate', [{ Level: 'RAID ' + level, Disks: disks, 'Usable GB': usable }], ['Parity and mirror overhead only. Filesystem and hot spares are not included.']);
  },
  color_rgb: async (input) => colorResult(clamp(input.r), clamp(input.g), clamp(input.b)),
  color_hex: async (input) => { const [r, g, b] = hexToRgb(input.hex); return colorResult(r, g, b); },
  color_cmyk: async (input) => colorResult(...cmykToRgb(num(input.c, 0, 100), num(input.m, 0, 100), num(input.y, 0, 100), num(input.k, 0, 100))),
  color_hsv: async (input) => colorResult(...hsvToRgb(num(input.h, 0, 360), num(input.s, 0, 100), num(input.v, 0, 100))),
  password_hash: async (input) => {
    const password = must(input.password, 'password');
    const algo = input.algo || 'pbkdf2';
    const encoded = new TextEncoder().encode(password);
    if (algo === 'pbkdf2') {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      const key = await crypto.subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 210000, hash: 'SHA-256' }, key, 256);
      return ok('PBKDF2-SHA-256', [{ Iterations: 210000, Salt: hex(salt), Hash: hex(new Uint8Array(bits)) }], ['The password was not uploaded. Store the salt with the hash if you keep it.']);
    }
    const map = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512' };
    const digest = await crypto.subtle.digest(map[algo] || 'SHA-256', encoded);
    return ok(map[algo] || 'SHA-256', [{ Hash: hex(new Uint8Array(digest)) }], ['A plain digest has no salt. Prefer PBKDF2 for passwords.']);
  },
  password_generate: async (input) => {
    const kind = String(input.kind) === 'passphrase' ? 'passphrase' : 'password';
    const notes = [
      'Generated with window.crypto.getRandomValues and rejection sampling — no modulo bias, no Math.random.',
      'Not uploaded, not logged, not stored, never placed in a URL. Copy it now; leaving this page discards it.',
    ];
    if (kind === 'passphrase') {
      const words = num(input.length, 3, 12, 7);
      const separators = ['-', '.', ' '];
      const separator = separators[secureIndex(separators.length)];
      // Rejection-sample the word index so no word is favoured by a modulo remainder.
      const picked = Array.from({ length: words }, () => PASSPHRASE_WORDS[secureIndex(PASSPHRASE_WORDS.length)]);
      const passphrase = picked.join(separator);
      const bits = Math.round(words * Math.log2(PASSPHRASE_WORDS.length) * 100) / 100;
      notes.push('Words come from a built-in ' + PASSPHRASE_WORDS.length + '-word list; the separator is random. Entropy assumes the list is public, which it is.');
      const result = ok('Passphrase generated in this browser', [{ Passphrase: passphrase, Words: words, 'Entropy (bits)': bits, Separator: separator === ' ' ? 'space' : separator }], notes);
      return attachCopy(result, passphrase, 'passphrase.txt');
    }
    const length = num(input.length, 8, 128);
    const unambiguous = String(input.unambiguous) === 'yes';
    const strip = (set) => (unambiguous ? set.replace(/[Il1O0]/g, '') : set);
    const sets = [];
    if (String(input.uppercase) !== 'no') sets.push(strip('ABCDEFGHIJKLMNOPQRSTUVWXYZ'));
    if (String(input.lowercase) !== 'no') sets.push(strip('abcdefghijklmnopqrstuvwxyz'));
    if (String(input.numbers) !== 'no') sets.push(strip('0123456789'));
    if (String(input.symbols) !== 'no') sets.push(strip('!@#$%^&*()-_=+[]{};:,.<>?/~'));
    const alphabet = sets.join('');
    if (!alphabet) throw new Error('Select at least one character set. An empty alphabet cannot produce a password.');
    if (alphabet.length < 4) throw new Error('That combination leaves fewer than four distinct characters. Enable another set or allow look-alike characters.');
    // Guarantee one character from every enabled set, then fill, then shuffle — so a policy that
    // demands "at least one of each" is met without leaking which position holds which class.
    const characters = sets.map((set) => set[secureIndex(set.length)]);
    while (characters.length < length) characters.push(alphabet[secureIndex(alphabet.length)]);
    const password = shuffle(characters.slice(0, length)).join('');
    const bits = Math.round(length * Math.log2(alphabet.length) * 100) / 100;
    notes.push('Estimated entropy: ' + bits + ' bits over a ' + alphabet.length + '-character alphabet.'
      + (bits < 60 ? ' Below the 60 bits generally expected for an unattended secret — raise the length.' : ''));
    if (unambiguous) notes.push('Look-alike characters (I, l, 1, O, 0) were excluded, which reduces the alphabet and therefore the entropy.');
    const result = ok('Password generated in this browser', [{ Password: password, Length: length, 'Character classes': sets.length, 'Alphabet size': alphabet.length, 'Entropy (bits)': bits }], notes);
    return attachCopy(result, password, 'password.txt');
  },
  password_strength: async (input) => {
    const password = must(input.password, 'password');
    let score = Math.min(40, password.length * 2);
    if (/[a-z]/.test(password)) score += 10;
    if (/[A-Z]/.test(password)) score += 10;
    if (/\d/.test(password)) score += 15;
    if (/[^A-Za-z0-9]/.test(password)) score += 15;
    if (password.length < 10) score = Math.min(score, 35);
    const label = score >= 80 ? 'Strong' : score >= 55 ? 'Fair' : 'Weak';
    return ok(label, [{ Score: score, Length: password.length }], ['This is a local variety score, not a breach-list check.']);
  },
  qr_generate: async (input) => {
    const value = text(input);
    if (!value.trim()) throw new Error('Enter the text or URL to encode.');
    if (value.length > 4000) throw new Error('That is ' + value.length + ' characters. A QR symbol holds at most about 2,953 bytes, and this tool caps input at 4,000 characters.');
    const ecl = ['L', 'M', 'Q', 'H'].includes(String(input.ecl)) ? String(input.ecl) : 'M';
    const size = input.size === '' || input.size == null ? 320 : num(input.size, 128, 1024);
    const output = String(input.output) === 'svg' ? 'svg' : 'png';
    const options = { margin: 2, width: size, errorCorrectionLevel: ecl };
    let symbol;
    try {
      symbol = QRCode.create(value, { errorCorrectionLevel: ecl });
    } catch (error) {
      throw new Error('The encoder rejected this payload at error-correction level ' + ecl + ': ' + (error && error.message ? error.message : 'too much data') + '. Lower the error-correction level or shorten the content.');
    }
    const modules = symbol.modules.size;
    const notes = [
      'Encoded locally with a Reed–Solomon encoder. No image service was called and the content was not uploaded.',
      'Error correction ' + ecl + ' recovers roughly ' + ({ L: '7', M: '15', Q: '25', H: '30' })[ecl] + '% of damaged codewords.',
    ];
    if (output === 'svg') {
      const svg = await QRCode.toString(value, Object.assign({ type: 'svg' }, options));
      return attachCopy(ok('QR code ready (SVG)', [
        { Measure: 'Content characters', Value: value.length },
        { Measure: 'Symbol version', Value: symbol.version },
        { Measure: 'Modules', Value: modules + '×' + modules },
        { Measure: 'Error correction', Value: ecl },
        { Measure: 'SVG', Value: svg },
      ], notes), svg, 'qrcode.svg');
    }
    // The pixels are written by hand rather than through a canvas: identical output in every
    // browser, no dependency on a DOM, and the bytes can be verified by the acceptance tests.
    const margin = 2;
    const scale = Math.max(1, Math.floor(size / (modules + margin * 2)));
    const png = await pngFromMatrix(symbol.modules, scale, margin);
    const edge = (modules + margin * 2) * scale;
    const dataUrl = 'data:image/png;base64,' + toBase64(png);
    return attachCopy(ok('QR code ready (PNG)', [
      { Preview: dataUrl },
      { Measure: 'Content characters', Value: value.length },
      { Measure: 'Symbol version', Value: symbol.version },
      { Measure: 'Modules', Value: modules + '×' + modules },
      { Measure: 'Error correction', Value: ecl },
      { Measure: 'Image', Value: edge + '×' + edge + ' px (' + png.length.toLocaleString('en-US') + ' bytes, ' + scale + ' px per module)' },
    ], notes), dataUrl, 'qrcode.png');
  },
  qr_scan: async (input) => scan(input, false),
  wifi_qr: async (input) => scan(input, true),
  lorem: async (input) => {
    const count = num(input.paragraphs, 1, 8);
    const sentence = 'CloudHost247 placeholder copy describes infrastructure without claiming a price, a location or a certification.';
    return ok('Placeholder text', [{ Text: Array.from({ length: count }, () => sentence + ' ' + sentence).join('\n\n') }]);
  },
  timecard: async (input) => {
    const lines = text(input).split(/\n/).map((line) => line.trim()).filter(Boolean);
    let minutes = 0;
    const rows = lines.map((line) => {
      const match = line.match(/^(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})$/);
      if (!match) throw new Error('Use lines like 09:00-17:30.');
      const start = (+match[1]) * 60 + (+match[2]);
      const end = (+match[3]) * 60 + (+match[4]);
      if (end < start) throw new Error('A shift cannot end before it starts in this calculator.');
      const span = end - start;
      minutes += span;
      return { Entry: line, Minutes: span };
    });
    rows.push({ Entry: 'Total', Minutes: minutes, Hours: (minutes / 60).toFixed(2) });
    return ok((minutes / 60).toFixed(2) + ' hours', rows, ['Arithmetic only. It is not a payroll calculation.']);
  },
  bin: async (input) => {
    const digits = String(input.bin || '').replace(/\D/g, '');
    if (digits.length < 6 || digits.length > 8) throw new Error('Enter the first 6 to 8 digits only.');
    return ok('Brand inferred from the prefix', [{ Prefix: digits, Brand: cardBrand(digits) }], ['This is not the issuing bank and not an authorization.']);
  },
  card: async (input) => {
    const digits = String(input.number || '').replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(digits)) throw new Error('Enter 12 to 19 digits. Nothing is stored.');
    const brand = cardBrand(digits);
    return ok(luhn(digits) ? 'Checksum matches' : 'Checksum does not match', [{ Brand: brand, Length: digits.length, Luhn: luhn(digits) ? 'Valid' : 'Invalid', Masked: '•••• ' + digits.slice(-4) }], ['No payment was attempted.']);
  },
  reverse_image: async (input) => {
    const url = input.url ? new URL(input.url) : null;
    if (url && !/^https?:$/.test(url.protocol)) throw new Error('Use an http or https image URL.');
    const encoded = url ? encodeURIComponent(url.href) : '';
    return ok(url ? 'Search links' : 'No CloudHost247 image index', [{
      Google: url ? 'https://lens.google.com/uploadbyurl?url=' + encoded : 'Open Google Lens and upload the file yourself',
      Bing: url ? 'https://www.bing.com/images/search?q=imgurl:' + encoded + '&view=detailv2&iss=sbi' : 'Open Bing image search',
    }], ['CloudHost247 does not upload or retain the image.']);
  },
  notepad: async (input) => ok('Kept in this tab only', [{ Characters: text(input).length, Text: text(input) }], ['The note is not sent to CloudHost247. Refreshing clears it unless you copy it.']),
  small_text: async (input) => ok('Small text', [{ Text: mapChars(text(input), smallMap()) }]),
  word_count: async (input) => {
    const value = text(input);
    const words = value.trim() ? value.trim().split(/\s+/).length : 0;
    return ok(words + ' words', [{ Words: words, Characters: value.length, Sentences: (value.match(/[.!?]+/g) || []).length, 'Minutes at 200 wpm': Math.max(1, Math.ceil(words / 200)) }]);
  },
  rot13: async (input) => ok('ROT13', [{ Text: text(input).replace(/[A-Za-z]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + (ch.toLowerCase() < 'n' ? 13 : -13))) }], ['ROT13 is not encryption.']),
  morse: async (input) => ok('Morse', [{ Result: morse(text(input)) }]),
  runic: async (input) => ok('Runic-style display', [{ Text: mapChars(text(input), runicMap()) }], ['This is a display mapping, not a historical transcription.']),
  invisible: async (input) => {
    const chars = { zwsp: '\u200b', zwnj: '\u200c', zwj: '\u200d', wj: '\u2060' };
    const value = chars[input.kind] || chars.zwsp;
    return ok('Character copied into the result', [{ Name: input.kind || 'zwsp', 'Code point': 'U+' + value.codePointAt(0).toString(16).toUpperCase(), Value: value }]);
  },
  minecraft: async (input) => ok('Formatting reference', minecraftRows(input.text || 'Hello'), ['Minecraft is a trademark of its owner. This page is an unofficial reference.']),
  punycode: async (input) => {
    const value = must(input.text, 'domain').trim();
    const encoded = value.split('.').map((label) => /[^\u0000-\u007f]/.test(label) ? 'xn--' + puny(label) : label).join('.');
    const decoded = value.split('.').map((label) => label.startsWith('xn--') ? depuny(label.slice(4)) : label).join('.');
    return ok('IDN conversion', [{ Punycode: encoded, Unicode: decoded }], ['Conversion does not mean the name is safe to visit.']);
  },
  user_agent: async () => ok('This browser', [{ 'User agent': navigator.userAgent, Platform: navigator.platform || '', Language: navigator.language || '' }], ['A declared user agent is not proof of the client.']),
  serp: async (input) => {
    const title = must(input.title, 'title');
    const description = must(input.description, 'description');
    return ok('Illustrative snippet', [{ Title: clip(title, 60), URL: input.url || '', Description: clip(description, 160) }], ['Truncation is approximate. This is not a Google ranking.']);
  },
  robots: async (input) => {
    const split = (value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const agents = split(input.agent);
    if (!agents.length) throw new Error('Enter at least one user-agent. Use * for every crawler.');
    agents.forEach((agent) => {
      // RFC 9309 defines the value as a product token, so a space ends it and the rest of the line
      // is silently ignored by the crawler — refuse rather than publish a rule that does nothing.
      if (/\s/.test(agent)) throw new Error('The user-agent "' + agent + '" contains a space. A User-agent line holds a single product token such as *, Googlebot or Bingbot, and anything after a space is ignored by crawlers.');
      if (!/^[A-Za-z0-9*_\-.]+$/.test(agent)) throw new Error('The user-agent "' + agent + '" contains characters a robots.txt token cannot use. Use letters, digits, * _ - and .');
    });
    const requirePath = (value, directive) => {
      if (!value.startsWith('/')) throw new Error(directive + ' "' + value + '" must start with a forward slash. robots.txt paths are URL path prefixes, not full URLs.');
      if (/\s/.test(value)) throw new Error(directive + ' "' + value + '" contains a space, which ends the directive.');
      return value;
    };
    const disallow = split(input.disallow).map((path) => requirePath(path, 'Disallow path'));
    const allow = split(input.allow).map((path) => requirePath(path, 'Allow path'));
    const sitemaps = split(input.sitemap).map((url) => {
      let parsed;
      try { parsed = new URL(url); } catch { throw new Error('Sitemap "' + url + '" is not an absolute URL. Use https://example.com/sitemap.xml.'); }
      if (!/^https?:$/.test(parsed.protocol)) throw new Error('Sitemap "' + url + '" must be http or https. The specification ignores a relative Sitemap line.');
      return parsed.href;
    });
    let crawlDelay = null;
    if (String(input.crawlDelay ?? '').trim() !== '') {
      crawlDelay = num(input.crawlDelay, 1, 86400);
    }
    if (!disallow.length && !allow.length && !crawlDelay && !sitemaps.length) {
      throw new Error('Nothing to publish: no Disallow, Allow, crawl-delay or sitemap was supplied. An empty robots.txt is not generated as a placeholder.');
    }
    const body = [];
    agents.forEach((agent) => body.push('User-agent: ' + agent));
    disallow.forEach((path) => body.push('Disallow: ' + path));
    allow.forEach((path) => body.push('Allow: ' + path));
    if (crawlDelay !== null) body.push('Crawl-delay: ' + crawlDelay);
    const file = body.concat(sitemaps.length ? [''].concat(sitemaps.map((url) => 'Sitemap: ' + url)) : []).join('\n');
    const notes = [
      'Publish the file yourself after review. This tool does not deploy anything.',
      'robots.txt is a request that cooperating crawlers honour. It is not an access control and hides nothing from a client that ignores it.',
      'Privacy: this ran in your browser. The file was built locally, and no path, sitemap or user-agent you entered was uploaded or logged.',
    ];
    if (crawlDelay !== null) notes.push('Crawl-delay is honoured by Bing and Yandex and ignored by Googlebot.');
    if (String(input.noindexNote) !== 'no') notes.push('To keep a page out of the index, use a robots meta tag or an X-Robots-Tag header on that page — a Disallow can hide it from crawling while other sites still link to it.');
    allow.forEach((path) => {
      if (disallow.some((blocked) => path.startsWith(blocked) && path !== blocked)) {
        notes.push('Allow ' + path + ' re-opens part of a Disallowed directory. That is valid, but only crawlers that support Allow will honour it.');
      }
    });
    return attachCopy(ok('robots.txt drafted (' + agents.length + ' agent' + (agents.length > 1 ? 's' : '') + ', ' + (disallow.length + allow.length) + ' rule' + (disallow.length + allow.length === 1 ? '' : 's') + ')', [
      { Measure: 'File', Value: file },
      { Measure: 'User-agents', Value: agents.join(', ') },
      { Measure: 'Rules', Value: disallow.length + ' disallow, ' + allow.length + ' allow' + (crawlDelay !== null ? ', crawl-delay ' + crawlDelay : '') },
      { Measure: 'Sitemaps', Value: sitemaps.length ? sitemaps.join(', ') : '(none)' },
    ], notes), file + '\n', 'robots.txt');
  },
  ip_decimal: async (input) => {
    const value = must(input.target, 'value').trim();
    if (/^\d+$/.test(value)) {
      const n = BigInt(value);
      if (n < 0n || n > 0xffffffffn) throw new Error('Decimal is outside IPv4.');
      return ok('IPv4 address', [{ Address: [24, 16, 8, 0].map((shift) => Number((n >> BigInt(shift)) & 255n)).join('.') }]);
    }
    return ok('Decimal', [{ Decimal: ipv4ToInt(value).toString() }]);
  },
  ipv4_to_ipv6: async (input) => {
    const parts = ipv4Parts(input.target);
    const hex = parts.map((part) => part.toString(16).padStart(2, '0')).join('');
    return ok('Encodings, not connectivity', [{ Mapped: '::ffff:' + parts.join('.'), '6to4': compress('2002:' + hex.slice(0, 4) + ':' + hex.slice(4) + '::') }], ['These encodings do not mean the host has IPv6 service.']);
  },
  ipv6_to_ipv4: async (input) => {
    const expanded = expand(input.target);
    const groups = expanded.split(':');
    if (groups[0] === '0000' && groups[1] === '0000' && groups[2] === '0000' && groups[3] === '0000' && groups[4] === '0000' && groups[5] === 'ffff') {
      const tail = groups.slice(6).join('');
      return ok('IPv4-mapped address', [{ IPv4: [0, 2, 4, 6].map((i) => parseInt(tail.slice(i, i + 2), 16)).join('.') }]);
    }
    if (groups[0] === '2002') {
      const hex = groups[1] + groups[2];
      return ok('6to4 embedded address', [{ IPv4: [0, 4, 8, 12].map((i) => parseInt(hex.slice(i, i + 4), 16)).join('.') }]);
    }
    return fail('This address does not contain a mapped, 6to4 or NAT64 IPv4 form CloudHost247 recognizes.');
  },
  ipv6_ula: async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[0] = 0xfd;
    const groups = [];
    for (let i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    return ok('Unique local address', [{ Address: compress(groups.join(':')) }], ['fd00::/8 is not routed on the public internet.']);
  },
  ipv6_cidr_range: async (input) => {
    const [addr, prefix] = String(input.target || '').split('/');
    const bits = Number(prefix);
    if (!Number.isInteger(bits) || bits < 0 || bits > 128) throw new Error('Enter a prefix from 0 to 128.');
    const first = applyPrefix(expand(addr), bits, false);
    const last = applyPrefix(expand(addr), bits, true);
    return ok('Prefix range', [{ First: compress(first), Last: compress(last), Prefix: bits }]);
  },
  ipv6_range_cidr: async (input) => {
    const start = BigInt('0x' + expand(input.start).replace(/:/g, ''));
    const end = BigInt('0x' + expand(input.end).replace(/:/g, ''));
    if (end < start) throw new Error('The last address is before the first.');
    return ok('CIDR summary', [{ Prefixes: summarize(start, end).join(', ') }], ['Unaligned ranges are split into the exact covering prefixes.']);
  },
  ipv6_compress: async (input) => ok('Compressed', [{ Address: compress(expand(input.target)) }]),
  ipv6_expand: async (input) => ok('Expanded', [{ Address: expand(input.target) }]),
  subnet: async (input) => {
    const [addr, prefixRaw] = String(input.target || '').split('/');
    const prefix = Number(prefixRaw);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) throw new Error('Enter an IPv4 CIDR such as 203.0.113.10/24.');
    const ip = ipv4ToInt(addr);
    const mask = prefix === 0 ? 0n : (0xffffffffn << BigInt(32 - prefix)) & 0xffffffffn;
    const network = ip & mask;
    const broadcast = network | (~mask & 0xffffffffn);
    const hosts = prefix >= 31 ? 0n : broadcast - network - 1n;
    return ok('IPv4 subnet', [{
      Network: intToIpv4(network), Broadcast: intToIpv4(broadcast), Mask: intToIpv4(mask),
      First: prefix >= 31 ? 'n/a' : intToIpv4(network + 1n), Last: prefix >= 31 ? 'n/a' : intToIpv4(broadcast - 1n), Hosts: hosts.toString(),
    }]);
  },
  mac_lookup: async (input) => {
    const mac = String(input.mac || '').toUpperCase().replace(/[^0-9A-F]/g, '');
    if (mac.length < 6) throw new Error('Enter a MAC address.');
    const prefix = mac.slice(0, 6);
    const vendor = OUI[prefix] || 'Not in the bundled public sample';
    return ok(vendor, [{ Prefix: prefix.match(/../g).join(':'), Vendor: vendor, 'Locally administered': (parseInt(mac[1], 16) & 2) ? 'Yes' : 'No' }], ['Unknown means the prefix is not in this sample, not that no vendor exists.']);
  },
  mac_generate: async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    bytes[0] = (bytes[0] | 0x02) & 0xfe;
    const mac = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(':');
    return ok('Locally administered address', [{ MAC: mac }], ['The address is for lab use. It is not assigned by a manufacturer.']);
  },
  multi_url: async (input) => {
    const urls = text(input).split(/\s+/).filter(Boolean).slice(0, 8).map((item) => {
      const url = new URL(item);
      if (!/^https?:$/.test(url.protocol)) throw new Error('Only http and https URLs can be opened.');
      return url.href;
    });
    if (!urls.length) throw new Error('Enter at least one URL.');
    if (confirm('Open ' + urls.length + ' tabs?')) urls.forEach((url) => window.open(url, '_blank', 'noopener'));
    return ok(urls.length + ' URLs prepared', urls.map((url) => ({ URL: url })), ['Other schemes were rejected.']);
  },
  uuid: async (input) => {
    const version = ['v4', 'v7', 'nil'].includes(String(input.version)) ? String(input.version) : 'v4';
    const count = num(input.count, 1, 1000);
    const format = ['standard', 'hex', 'braces', 'urn', 'upper'].includes(String(input.format)) ? String(input.format) : 'standard';
    const values = [];
    for (let i = 0; i < count; i += 1) values.push(formatUuid(version === 'nil' ? NIL_UUID : version === 'v7' ? uuidv7() : uuidv4(), format));
    const notes = ['Generated from window.crypto — never Math.random.'];
    if (version === 'v7') notes.push('v7 embeds a 48-bit Unix millisecond timestamp, so the values sort by creation time. The remaining 74 bits are random.');
    if (version === 'v4') notes.push('v4 carries 122 bits of randomness; the version and variant bits are fixed by the layout.');
    if (version === 'nil') notes.push('The nil UUID is all zeros. It is a sentinel, not an identifier — every call returns the same value.');
    notes.push('Nothing was uploaded and nothing is stored. Copy the list now if you need it.');
    return attachCopy(ok(count + ' UUID' + (count > 1 ? 's' : '') + ' (' + version + ')', values.map((value, index) => ({ '#': index + 1, UUID: value })), notes), values.join('\n'), 'uuids.txt');
  },
  dmarc_generate: async (input) => {
    const domain = must(input.domain, 'domain');
    const policy = ['none', 'quarantine', 'reject'].includes(input.policy) ? input.policy : 'none';
    let record = `v=DMARC1; p=${policy}`;
    if (input.rua) record += `; rua=mailto:${input.rua}`;
    return ok('Draft record', [{ Host: '_dmarc.' + domain, Type: 'TXT', Value: record }], ['Publish this yourself. CloudHost247 did not change DNS.']);
  },
  spf_generate: async (input) => {
    const includes = String(input.includes || '').split(/[\s,]+/).filter(Boolean).map((host) => 'include:' + host);
    const policy = ['-all', '~all', '?all'].includes(input.policy) ? input.policy : '-all';
    return ok('Draft SPF', [{ Value: ['v=spf1', ...includes, policy].join(' ') }], ['Nested lookup limits still apply after you publish it.']);
  },
  trace_email: async (input) => {
    const value = text(input);
    const rows = [];
    value.split(/\n/).forEach((line) => {
      if (!/^received:/i.test(line) && !/\bfrom\b/i.test(line)) return;
      const ips = line.match(/\b(?:\d{1,3}\.){3}\d{1,3}\b|\b[a-f0-9:]{2,}\b/ig) || [];
      rows.push({ Line: line.slice(0, 240), Addresses: ips.join(', ') });
    });
    return ok(rows.length ? rows.length + ' header lines' : 'No Received lines found', rows, ['Headers were parsed locally. Geolocation is not inferred here.']);
  },
  image_text: async (input) => {
    const file = input.file;
    if (!file) throw new Error('Choose an image.');
    if (file.type === 'image/svg+xml') {
      const xml = await file.text();
      const found = Array.from(xml.matchAll(/<(?:text|tspan)[^>]*>([^<]+)/g)).map((match) => match[1].trim()).filter(Boolean);
      return found.length ? ok('Text from SVG', found.map((item) => ({ Text: item }))) : fail('The SVG has no text elements. No text was invented.');
    }
    if (!('TextDetector' in window)) return fail('This browser has no text detector. No OCR result was invented.');
    const bitmap = await createImageBitmap(file);
    const detector = new TextDetector();
    const items = await detector.detect(bitmap);
    if (!items.length) return fail('No text was detected.');
    return ok('Detected text', items.map((item) => ({ Text: item.rawValue })));
  },
  /**
   * ICAO Doc 9303 machine-readable zones: generate, validate and parse TD1, TD2 and TD3.
   *
   * Everything happens in this module — there is no fetch, no localStorage and no URL parameter, so
   * the values a visitor types stay in the tab. The only things that leave are the characters
   * rendered on screen and, if the visitor clicks for it, the clipboard they asked for.
   */
  mrz_generate: async (input) => {
    const action = ['generate', 'validate', 'parse'].includes(String(input.mode)) ? String(input.mode) : 'generate';
    if (action !== 'generate') {
      const lines = mrzLines(input.mrz);
      if (!lines.length) throw new Error('Paste the machine-readable lines you want to ' + action + '.');
      const report = mrzInspect(lines);
      const notes = report.notes.concat([MRZ_AUTHENTICITY_NOTE, MRZ_PRIVACY_NOTE]);
      const label = report.format ? report.format : 'this';
      if (action === 'parse') {
        // A zone that is not even the right shape has no fields to report; say so instead of
        // presenting a table of guesses.
        if (!report.structureOk) {
          return fail(label + ' is not a readable machine-readable zone: the line count or line widths do not match any ICAO 9303 layout. The measurements below are what was found.', report.rows, notes);
        }
        return attachCopy(ok('Parsed ' + report.format + ' — structure and check digits only; authenticity is not verified', report.rows.concat(report.fields), notes), lines.join('\n'), 'mrz-parsed.txt');
      }
      if (!report.ok) {
        // Validation is the one tool in the collection whose failure is the answer, so it is
        // reported as a failure and keeps the table that explains which check did not pass.
        return attachCopy(fail(
          report.format + ' zone failed validation. Every check marked FAIL below has to be corrected before this zone can be read as the layout it claims to be. Passing these checks would still not prove the document is genuine.',
          report.rows, notes, 'Validation failed'
        ), lines.join('\n'), 'mrz.txt');
      }
      return attachCopy(ok(report.format + ' zone is structurally valid and every check digit matches.', report.rows, notes), lines.join('\n'), 'mrz.txt');
    }
    const generated = mrzGenerate(input || {});
    const report = mrzInspect(generated.lines);
    const width = generated.lines[0].length;
    const rows = generated.lines.map((line, index) => ({
      Field: 'Line ' + (index + 1) + ' (' + width + ' characters)',
      Value: line,
    })).concat([
      { Field: 'Name field as encoded', Value: generated.nameField },
      { Field: 'Check digits', Value: Object.entries(generated.checkDigits).map(([key, value]) => key + '=' + value).join('  ') },
    ], report.rows);
    const generateNotes = [generated.formatLabel + '.', generated.normalization, MRZ_AUTHENTICITY_NOTE, MRZ_PRIVACY_NOTE];
    if (!report.ok) {
      // The generator verifies its own output. A failure here means the zone must not be used.
      return attachCopy(fail(
        generated.format + ' zone was built but failed its own check-digit verification — do not use it. The failing checks are listed below.',
        rows, generateNotes, 'Generation failed verification'
      ), generated.lines.join('\n'), 'mrz-' + generated.format.toLowerCase() + '.txt');
    }
    return attachCopy(ok(
      generated.format + ' machine-readable zone generated: ' + generated.lines.length + ' lines of ' + width + ' characters with valid ICAO 9303 check digits.',
      rows, generateNotes
    ), generated.lines.join('\n'), 'mrz-' + generated.format.toLowerCase() + '.txt');
  },

  // --- Compliance & Document Tools: calculators -------------------------------------------------

  age_date: async (input) => {
    const birth = parseCalendarDate(must(input.dateOfBirth, 'date of birth'), 'date of birth');
    const reference = input.referenceDate && String(input.referenceDate).trim()
      ? parseCalendarDate(input.referenceDate, 'reference date')
      : localToday();
    // Part objects do not order with <, so the two dates are compared as day numbers.
    if (Date.UTC(reference.y, reference.m - 1, reference.d) < Date.UTC(birth.y, birth.m - 1, birth.d)) throw new Error('The reference date is before the date of birth. An age cannot be negative here — swap the two dates or leave the reference date empty to use today.');
    const [years, months, days] = calendarSpan(birth, reference);
    const totalDays = Math.round((Date.UTC(reference.y, reference.m - 1, reference.d) - Date.UTC(birth.y, birth.m - 1, birth.d)) / 86400000);
    const nextBirthday = nextOccurrence(birth, reference);
    const daysToBirthday = Math.round((Date.UTC(nextBirthday.y, nextBirthday.m - 1, nextBirthday.d) - Date.UTC(reference.y, reference.m - 1, reference.d)) / 86400000);
    return ok(years + ' years, ' + months + ' months and ' + days + ' days', [
      { Measure: 'Exact age', Value: years + 'y ' + months + 'm ' + days + 'd' },
      { Measure: 'Completed years', Value: years },
      { Measure: 'Completed months (total)', Value: years * 12 + months },
      { Measure: 'Total days', Value: totalDays },
      { Measure: 'Total weeks', Value: Math.floor(totalDays / 7) + ' weeks, ' + (totalDays % 7) + ' days' },
      { Measure: 'Total hours', Value: (totalDays * 24).toLocaleString('en-US') },
      { Measure: 'Date of birth', Value: iso(birth) + ' (' + weekday(birth) + ')' },
      { Measure: 'Reference date', Value: iso(reference) + ' (' + weekday(reference) + ')' },
      { Measure: 'Next birthday', Value: iso(nextBirthday) + ' — in ' + daysToBirthday + ' day(s)' },
    ], [
      'Calendar arithmetic, not a fixed 365-day year: leap days and real month lengths are counted.',
      'Both dates are read as calendar dates with no time zone attached, so the answer is the same everywhere.',
      MRZ_PRIVACY_NOTE.replace('this ran in your browser', 'this calculation ran in your browser'),
    ]);
  },

  date_duration: async (input) => {
    const action = ['difference', 'add', 'subtract'].includes(String(input.action)) ? String(input.action) : 'difference';
    const start = parseCalendarDate(must(input.startDate, 'start date'), 'start date');
    if (action === 'difference') {
      const end = parseCalendarDate(must(input.endDate, 'end date'), 'end date');
      // Part objects cannot be ordered with <, so the direction is decided on day numbers.
      const reversed = Date.UTC(end.y, end.m - 1, end.d) < Date.UTC(start.y, start.m - 1, start.d);
      const [a, b] = reversed ? [end, start] : [start, end];
      const [years, months, days] = calendarSpan(a, b);
      const totalDays = Math.round((Date.UTC(b.y, b.m - 1, b.d) - Date.UTC(a.y, a.m - 1, a.d)) / 86400000);
      const leapDays = countLeapDays(a, b);
      return ok(totalDays + ' days between ' + iso(a) + ' and ' + iso(b), [
        { Measure: 'Exact duration', Value: years + 'y ' + months + 'm ' + days + 'd' },
        { Measure: 'Total days', Value: totalDays },
        { Measure: 'Weeks and days', Value: Math.floor(totalDays / 7) + ' weeks, ' + (totalDays % 7) + ' days' },
        { Measure: 'Total months (calendar)', Value: years * 12 + months },
        { Measure: 'Total hours', Value: (totalDays * 24).toLocaleString('en-US') },
        { Measure: 'Business days (Mon–Fri)', Value: businessDays(a, b) },
        { Measure: 'Leap days in range', Value: leapDays },
        { Measure: 'Direction', Value: reversed ? 'the end date is earlier than the start date — the figures above are the absolute distance' : 'start → end' },
      ], ['Month and year lengths are real, so a span crossing February in a leap year counts 366-day years correctly.', CALC_PRIVACY_NOTE]);
    }
    const unit = ['days', 'weeks', 'months', 'years'].includes(String(input.unit)) ? String(input.unit) : 'days';
    const amountText = String(input.amount ?? '').trim();
    // An empty field is not zero: adding "no days" is never what the visitor meant to ask.
    if (!amountText) throw new Error('Enter the number of ' + unit + ' to ' + action + '.');
    const raw = Number(amountText);
    if (!Number.isFinite(raw) || !Number.isInteger(raw)) throw new Error('Enter a whole number of ' + unit + ' to ' + action + '. Fractions of a ' + unit.replace(/s$/, '') + ' have no calendar meaning.');
    if (Math.abs(raw) > 100000) throw new Error('That is more than 100,000 ' + unit + '. Narrow the range.');
    const amount = action === 'subtract' ? -raw : raw;
    const result = unit === 'days' || unit === 'weeks'
      ? addDays(start, amount * (unit === 'weeks' ? 7 : 1))
      : addMonths(start, amount * (unit === 'years' ? 12 : 1));
    const delta = Math.round((Date.UTC(result.y, result.m - 1, result.d) - Date.UTC(start.y, start.m - 1, start.d)) / 86400000);
    return ok(iso(start) + ' ' + (amount < 0 ? 'minus ' : 'plus ') + Math.abs(amount) + ' ' + unit + ' = ' + iso(result), [
      { Measure: 'Start date', Value: iso(start) + ' (' + weekday(start) + ')' },
      { Measure: 'Result date', Value: iso(result) + ' (' + weekday(result) + ')' },
      { Measure: 'Actual day difference', Value: delta },
      { Measure: 'Operation', Value: action + ' ' + Math.abs(amount) + ' ' + unit },
    ], [
      'Month arithmetic keeps the day of the month and clamps to the last valid day, so 31 January plus one month is 28 or 29 February — never 3 March.',
      CALC_PRIVACY_NOTE,
    ]);
  },

  percentage: async (input) => {
    const action = ['change', 'of', 'isWhat', 'reverse', 'difference'].includes(String(input.action)) ? String(input.action) : 'change';
    const rows = [];
    const note = (message) => rows.push({ Measure: message[0], Value: message[1] });
    let summary;
    if (action === 'change') {
      const from = decimal(must(input.from, 'original value'), 'original value');
      const to = decimal(must(input.to, 'new value'), 'new value');
      if (from === 0) throw new Error('The original value is 0, so a percentage change from it is undefined. Use "X is what % of Y" instead.');
      const change = ((to - from) / Math.abs(from)) * 100;
      // The sign lives in the wording, so the number itself is reported as a magnitude.
      summary = (change >= 0 ? 'An increase of ' : 'A decrease of ') + trim(Math.abs(change)) + '%';
      note(['Original value', trim(from)]);
      note(['New value', trim(to)]);
      note(['Absolute change', trim(to - from)]);
      note(['Percentage change', trim(change) + '%']);
      note(['Multiplier', trim(to / from) + '×']);
    } else if (action === 'of') {
      const percent = decimal(must(input.percent, 'percentage'), 'percentage');
      const value = decimal(must(input.to, 'value'), 'value');
      summary = trim(percent) + '% of ' + trim(value) + ' = ' + trim((percent / 100) * value);
      note(['Percentage', trim(percent) + '%']);
      note(['Of value', trim(value)]);
      note(['Result', trim((percent / 100) * value)]);
      note(['Remaining', trim(value - (percent / 100) * value)]);
    } else if (action === 'isWhat') {
      const part = decimal(must(input.from, 'part'), 'part');
      const whole = decimal(must(input.to, 'whole'), 'whole');
      if (whole === 0) throw new Error('The whole is 0, so the part is not a percentage of it.');
      summary = trim(part) + ' is ' + trim((part / whole) * 100) + '% of ' + trim(whole);
      note(['Part', trim(part)]);
      note(['Whole', trim(whole)]);
      note(['Percentage', trim((part / whole) * 100) + '%']);
    } else if (action === 'reverse') {
      const percent = decimal(must(input.percent, 'percentage'), 'percentage');
      const result = decimal(must(input.to, 'final value'), 'final value');
      const factor = 1 + percent / 100;
      if (factor === 0) throw new Error('A -100% change leaves nothing to reverse from.');
      const original = result / factor;
      summary = 'Before a ' + trim(percent) + '% change, the value was ' + trim(original);
      note(['Final value', trim(result)]);
      note(['Change applied', trim(percent) + '%']);
      note(['Original value', trim(original)]);
      note(['Difference', trim(result - original)]);
    } else {
      const a = decimal(must(input.from, 'first value'), 'first value');
      const b = decimal(must(input.to, 'second value'), 'second value');
      const midpoint = (Math.abs(a) + Math.abs(b)) / 2;
      if (midpoint === 0) throw new Error('Both values are 0, so there is no percentage difference to report.');
      const difference = (Math.abs(b - a) / midpoint) * 100;
      summary = 'The percentage difference is ' + trim(difference) + '%';
      note(['First value', trim(a)]);
      note(['Second value', trim(b)]);
      note(['Absolute difference', trim(Math.abs(b - a))]);
      note(['Average of the two', trim(midpoint)]);
      note(['Percentage difference', trim(difference) + '%']);
    }
    rows.push({ Measure: 'Calculation', Value: action });
    return ok(summary, rows, ['Percentage difference is measured against the average of the two values; percentage change is measured against the original. They are not the same number.', CALC_PRIVACY_NOTE]);
  },

  unit_data: async (input) => {
    const amount = decimal(must(input.amount, 'amount'), 'amount');
    if (amount < 0) throw new Error('A data quantity cannot be negative here.');
    const from = must(input.fromUnit, 'source unit');
    const to = must(input.toUnit, 'target unit');
    if (!(from in DATA_UNITS)) throw new Error('"' + from + '" is not a unit this tool converts.');
    if (!(to in DATA_UNITS)) throw new Error('"' + to + '" is not a unit this tool converts.');
    const precision = input.precision === '' || input.precision == null ? 6 : num(input.precision, 0, 15);
    const fromUnit = DATA_UNITS[from];
    const toUnit = DATA_UNITS[to];
    // Convert through bytes with integer arithmetic where the value allows, so a binary/decimal
    // comparison is exact rather than the product of two rounded floats.
    const bytes = amount * fromUnit.factor;
    const converted = bytes / toUnit.factor;
    const rows = [
      { Measure: 'Input', Value: trim(amount) + ' ' + from },
      { Measure: 'Output', Value: formatNumber(converted, precision) + ' ' + to },
      { Measure: 'In bytes', Value: formatNumber(bytes, 0) + ' B' },
      { Measure: 'System', Value: fromUnit.system + ' → ' + toUnit.system },
    ];
    if (fromUnit.system !== toUnit.system) {
      const ratio = fromUnit.factor / toUnit.factor;
      rows.push({ Measure: 'Ratio', Value: '1 ' + from + ' = ' + formatNumber(ratio, 6) + ' ' + to });
      rows.push({ Measure: 'Note', Value: fromUnit.system === 'binary' ? 'Binary units are powers of 1024; decimal units are powers of 1000. A drive labelled in decimal reads smaller in binary.' : 'Decimal units are powers of 1000; binary units are powers of 1024.' });
    }
    return ok(trim(amount) + ' ' + from + ' = ' + formatNumber(converted, precision) + ' ' + to, rows, [
      'KiB/MiB/GiB are powers of 1024 (what an operating system reports). kB/MB/GB are powers of 1000 (what a drive label uses).',
      CALC_PRIVACY_NOTE,
    ]);
  },

  unix_timestamp: async (input) => {
    const action = ['decode', 'encode', 'now'].includes(String(input.action)) ? String(input.action) : 'decode';
    const useLocal = String(input.zone) === 'local';
    const zoneName = useLocal ? localZoneName() : 'UTC';
    if (action === 'now') {
      const now = new Date();
      return attachCopy(ok('Now — ' + now.toISOString(), [
        { Measure: 'Seconds', Value: String(Math.floor(now.getTime() / 1000)) },
        { Measure: 'Milliseconds', Value: String(now.getTime()) },
        { Measure: 'ISO 8601 (UTC)', Value: now.toISOString() },
        { Measure: 'UTC date and time', Value: formatParts(now, false) },
        { Measure: 'Local date and time', Value: formatParts(now, true) + ' (' + localZoneName() + ')' },
        { Measure: 'RFC 2822', Value: now.toUTCString() },
      ], ['Your browser supplied the clock. CloudHost247 did not.']), String(Math.floor(now.getTime() / 1000)), 'timestamp.txt');
    }
    if (action === 'decode') {
      const raw = String(must(input.timestamp, 'Unix timestamp')).trim().replace(/[_\s]/g, '');
      if (!/^-?\d+$/.test(raw)) throw new Error('A Unix timestamp is a whole number of seconds or milliseconds since 1970-01-01T00:00:00Z. "' + raw + '" is not.');
      const value = Number(raw);
      // 1e11 seconds is the year 5138; 1e11 milliseconds is 1973. Above that threshold the number
      // can only sensibly be milliseconds. The tool says which reading it used rather than guessing
      // silently.
      const isMillis = Math.abs(value) >= 1e11;
      const millis = isMillis ? value : value * 1000;
      const date = new Date(millis);
      if (!Number.isFinite(date.getTime())) throw new Error('That timestamp is outside the range this tool can represent.');
      const rows = [
        { Measure: 'Input', Value: raw },
        { Measure: 'Read as', Value: isMillis ? 'milliseconds' : 'seconds' },
        { Measure: 'Seconds', Value: String(Math.floor(millis / 1000)) },
        { Measure: 'Milliseconds', Value: String(millis) },
        { Measure: 'ISO 8601 (UTC)', Value: date.toISOString() },
        { Measure: 'UTC date and time', Value: formatParts(date, false) + ' (' + weekdayOf(date, false) + ')' },
        { Measure: 'Local date and time', Value: formatParts(date, true) + ' (' + localZoneName() + ', ' + weekdayOf(date, true) + ')' },
        { Measure: 'RFC 2822', Value: date.toUTCString() },
        { Measure: 'Relative to now', Value: relativeToNow(date) },
      ];
      return attachCopy(ok('Timestamp ' + raw + ' = ' + (useLocal ? formatParts(date, true) + ' ' + localZoneName() : date.toISOString()), rows, [
        'A Unix timestamp has no time zone: it counts from 1970-01-01T00:00:00Z. UTC and the local reading are the same instant.',
      ]), date.toISOString(), 'timestamp.txt');
    }
    const raw = String(must(input.datetime, 'date and time')).trim();
    const parsed = parseDateTime(raw, useLocal);
    const rows = [
      { Measure: 'Input', Value: raw },
      { Measure: 'Read as', Value: useLocal ? 'local time (' + localZoneName() + ')' : 'UTC' },
      { Measure: 'Seconds', Value: String(Math.floor(parsed.getTime() / 1000)) },
      { Measure: 'Milliseconds', Value: String(parsed.getTime()) },
      { Measure: 'ISO 8601 (UTC)', Value: parsed.toISOString() },
      { Measure: 'UTC date and time', Value: formatParts(parsed, false) },
      { Measure: 'Local date and time', Value: formatParts(parsed, true) + ' (' + localZoneName() + ')' },
    ];
    return attachCopy(ok('Date → ' + Math.floor(parsed.getTime() / 1000) + ' (seconds)', rows, [
      'The same instant is shown in UTC and in your local zone so a time-zone mistake is visible.',
    ]), String(Math.floor(parsed.getTime() / 1000)), 'timestamp.txt');
  },

  // --- Compliance & Document Tools: generators --------------------------------------------------

  api_key_generate: async (input) => {
    const alphabet = API_KEY_ALPHABETS[String(input.alphabet || 'base62')] || API_KEY_ALPHABETS.base62;
    const length = num(input.length, 16, 256);
    const count = num(input.count, 1, 100);
    const prefix = String(input.prefix || '').trim().replace(/[^A-Za-z0-9_-]/g, '').slice(0, 24);
    const keys = Array.from({ length: count }, () => (prefix ? prefix + '_' : '') + secureToken(alphabet, length));
    const bits = Math.round(length * Math.log2(alphabet.length) * 100) / 100;
    const rows = keys.map((key, index) => ({ '#': index + 1, Key: key }));
    return attachCopy(ok(count + ' key' + (count > 1 ? 's' : '') + ' generated in this browser', rows, [
      'Estimated entropy: ' + bits + ' bits (' + length + ' characters from a ' + alphabet.length + '-character set). The prefix is not secret and is not counted.',
      'Generated with window.crypto.getRandomValues and rejection sampling — no modulo bias, no Math.random.',
      'Not uploaded, not logged, not stored, not placed in a URL. Copy it now; leaving this page discards it.',
      'This generates random material. It does not register, rotate or validate a key in any service.',
    ]), keys.join('\n'), 'api-keys.txt');
  },

  checksum_hash: async (input) => {
    const algorithm = String(input.algorithm || 'sha256').toLowerCase();
    const map = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512', sha1: 'SHA-1', md5: 'MD5' };
    if (!(algorithm in map)) throw new Error('Supported algorithms: SHA-256, SHA-384, SHA-512, SHA-1 (compatibility) and MD5 (legacy checksum).');
    let bytes;
    let sourceLabel;
    if (String(input.source) === 'file') {
      const file = input.file;
      if (!file) throw new Error('Choose a file to hash.');
      if (file.size > 256 * 1024 * 1024) throw new Error('That file is larger than the 256 MB this browser tool will read.');
      bytes = new Uint8Array(await file.arrayBuffer());
      sourceLabel = file.name + ' (' + file.size.toLocaleString('en-US') + ' bytes)';
    } else {
      const value = String(input.text ?? '');
      bytes = new TextEncoder().encode(value);
      sourceLabel = 'text (' + bytes.length + ' bytes UTF-8)';
    }
    const digest = await digestBytes(algorithm, bytes);
    const notes = [];
    if (algorithm === 'md5') notes.push('MD5 is offered only as a legacy checksum. It is broken for collision resistance — do not use it for signatures, certificates or passwords.');
    if (algorithm === 'sha1') notes.push('SHA-1 is offered for compatibility with systems that still publish SHA-1 fingerprints. Prefer SHA-256 or stronger.');
    notes.push('Computed in your browser with the Web Crypto API. The ' + (String(input.source) === 'file' ? 'file was read locally and was not uploaded.' : 'text was not uploaded.'));
    notes.push('A digest proves the bytes match the bytes that produced a reference digest. It says nothing about whether those bytes are trustworthy.');
    return attachCopy(ok(map[algorithm] + ' of ' + sourceLabel, [
      { Measure: 'Algorithm', Value: map[algorithm] },
      { Measure: 'Input', Value: sourceLabel },
      { Measure: 'Hex', Value: hex(digest) },
      { Measure: 'Base64', Value: toBase64(digest) },
    ], notes), hex(digest), 'checksum-' + algorithm + '.txt');
  },

  json_format: async (input) => {
    const action = ['format', 'minify', 'validate'].includes(String(input.action)) ? String(input.action) : 'format';
    const value = String(input.text ?? '');
    if (!value.trim()) throw new Error('Enter the JSON to ' + action + '.');
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch (error) {
      throw new Error(jsonErrorMessage(value));
    }
    const warnings = jsonPrecisionWarnings(value);
    const notes = warnings.concat([CALC_PRIVACY_NOTE]);
    if (action === 'validate') {
      notes.push('Valid JSON. Key order and value types are preserved by the parser; nothing was rewritten.');
      return ok('Valid JSON', [
        { Measure: 'Result', Value: 'Valid' },
        { Measure: 'Top-level type', Value: jsonType(parsed) },
        { Measure: 'Size', Value: value.length.toLocaleString('en-US') + ' characters' },
        { Measure: 'Keys (top level)', Value: jsonType(parsed) === 'object' ? Object.keys(parsed).length : 'n/a' },
      ], notes);
    }
    const indentChoice = String(input.indent || '2');
    const indent = indentChoice === 'tab' ? '\t' : Number(indentChoice);
    const output = action === 'minify' ? JSON.stringify(parsed) : JSON.stringify(parsed, null, indent);
    notes.push(action === 'minify' ? 'Whitespace removed. Semantics are unchanged.' : 'Re-serialised by the parser, so key order follows the input and no value is invented.');
    return attachCopy(ok(action === 'minify' ? 'Minified JSON' : 'Formatted JSON', [
      { Measure: 'Result', Value: output },
      { Measure: 'Characters', Value: output.length.toLocaleString('en-US') + ' (input ' + value.length.toLocaleString('en-US') + ')' },
      { Measure: 'Top-level type', Value: jsonType(parsed) },
    ], notes), output, action === 'minify' ? 'minified.json' : 'formatted.json');
  },

  http_security_headers: async (input) => {
    const headers = buildSecurityHeaders(input || {});
    const format = ['nginx', 'apache', 'caddy', 'cloudflare', 'raw'].includes(String(input.server)) ? String(input.server) : 'nginx';
    const rendered = renderSecurityHeaders(headers, format);
    const notes = [
      'Configuration assistance only: this generates text for you to deploy. It does not scan your site, test the policy, or verify what a host currently sends.',
      'Deploy to staging first and watch the browser console for violations before enforcing a strict CSP.',
    ];
    if (headers.some((header) => header.name === 'Strict-Transport-Security' && /preload/.test(header.value))) {
      notes.push('HSTS preload is effectively irreversible for months. Only enable it when every host and subdomain serves valid HTTPS permanently.');
    }
    return attachCopy(ok('Security headers for ' + format, [
      { Measure: 'Headers', Value: headers.map((header) => header.name).join(', ') },
      { Measure: 'Configuration', Value: rendered },
    ], notes), rendered, 'security-headers.' + (format === 'apache' ? 'conf' : format === 'raw' ? 'txt' : 'conf'));
  },

  password_policy: async (input) => {
    const policy = buildPasswordPolicy(input || {});
    return attachCopy(ok('Password and authentication policy drafted', [
      { Measure: 'Minimum length', Value: policy.minLength + ' characters' },
      { Measure: 'Multi-factor authentication', Value: policy.mfaLabel },
      { Measure: 'Lockout', Value: policy.lockoutLabel },
      { Measure: 'Password history', Value: policy.historyLabel },
      { Measure: 'Maximum age', Value: policy.maxAgeLabel },
      { Measure: 'Idle session timeout', Value: policy.sessionMinutes + ' minutes' },
      { Measure: 'Storage', Value: policy.storageLabel },
      { Measure: 'Policy document', Value: policy.document },
    ], [
      'Policy authoring only. This writes down the controls you chose; it does not configure an identity provider or verify that your systems enforce them.',
      'Privacy: this ran in your browser. The policy text was generated locally and nothing was uploaded or stored.',
      'Certification requires your systems to enforce the controls and evidence that they do.',
    ]), policy.document, 'password-policy.md');
  },

  dns_record_generate: async (input) => {
    const result = buildDnsRecords(input || {});
    const format = ['zone', 'json', 'cloudflare'].includes(String(input.format)) ? String(input.format) : 'zone';
    const rendered = renderDnsRecords(result.records, format, result.domain, result.ttl);
    return attachCopy(ok(result.records.length + ' record(s) drafted for ' + result.domain, [
      { Measure: 'Domain', Value: result.domain },
      { Measure: 'Default TTL', Value: result.ttl + ' seconds' },
      { Measure: 'Records', Value: result.records.map((record) => record.type).join(', ') || '(none)' },
      { Measure: 'Configuration', Value: rendered },
    ], result.warnings.concat([
      'Nothing was published and no resolver was queried. Review the output and apply it yourself.',
      'No value was invented: an empty input produces no record.',
      'Privacy: this ran in your browser. The zone was built locally, and no hostname, address or key you entered was uploaded or logged.',
    ])), rendered, format === 'json' ? 'dns-records.json' : format === 'cloudflare' ? 'cloudflare-dns.csv' : 'zone.txt');
  },
};

const OUI = {
  '00000C': 'Cisco (sample)', '001A11': 'Google (sample)', '3C22FB': 'Apple (sample)', 'F4F5E8': 'Apple (sample)',
  '00163E': 'Xensource (sample)', '525400': 'QEMU/KVM locally common (sample)', '000C29': 'VMware (sample)',
  'B827EB': 'Raspberry Pi (sample)', 'DCA632': 'Raspberry Pi (sample)', '001B63': 'Apple (sample)',
  '180373': 'Dell (sample)', '0026B9': 'Dell (sample)', '000D3A': 'Microsoft (sample)', '7C2F80': 'Intel (sample)',
};

function ok(summary, rows, notes = []) { return { ok: true, summary, rows, notes, error: null, checkedAt: new Date().toISOString() }; }
function fail(error, rows = [], notes = [], summary = '') { return { ok: false, summary, rows, notes, error }; }
function text(input) { return String(input.text ?? input.target ?? ''); }
function must(value, label) { if (!value) throw new Error('Enter the ' + label + '.'); return String(value); }
/**
 * A bounded whole number. `fallback` is only used when the caller declares the field optional and
 * nothing was entered; without it an absent field is an error like any other out-of-range value.
 */
function num(value, min, max, fallback) {
  const blank = value === undefined || value === null || String(value).trim() === '';
  if (blank && fallback !== undefined) return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error('Enter a number from ' + min + ' to ' + max + '.');
  return Math.round(n);
}
function clamp(value) { return num(value, 0, 255); }
function clip(value, max) { return value.length <= max ? value : value.slice(0, max - 1) + '…'; }
function hex(bytes) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(''); }

function jsonResult(value, pretty) {
  const parsed = JSON.parse(value);
  return ok(pretty ? 'Formatted JSON' : 'Minified JSON', [{ JSON: pretty ? JSON.stringify(parsed, null, 2) : JSON.stringify(parsed) }]);
}
function textToBinary(value) { return Array.from(new TextEncoder().encode(value), (byte) => byte.toString(2).padStart(8, '0')).join(' '); }
function binaryToText(value) {
  const bytes = value.trim().split(/\s+/).map((part) => {
    if (!/^[01]{8}$/.test(part)) throw new Error('Use space-separated 8-bit groups.');
    return parseInt(part, 2);
  });
  return new TextDecoder().decode(Uint8Array.from(bytes));
}
function luhn(digits) {
  let sum = 0; let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = digits.charCodeAt(i) - 48; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
}
function cardBrand(digits) {
  if (/^4/.test(digits)) return 'Visa range';
  if (/^5[1-5]|^2[2-7]/.test(digits)) return 'Mastercard range';
  if (/^3[47]/.test(digits)) return 'American Express range';
  if (/^6(?:011|5)/.test(digits)) return 'Discover range';
  if (/^35/.test(digits)) return 'JCB range';
  if (/^62/.test(digits)) return 'UnionPay range';
  return 'Unknown prefix in the bundled ranges';
}
function hexToRgb(value) {
  const hex = String(value || '').trim().replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) throw new Error('Enter a 6-digit HEX color.');
  return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
}
function cmykToRgb(c, m, y, k) {
  return [c, m, y].map((channel) => Math.round(255 * (1 - channel / 100) * (1 - k / 100)));
}
function hsvToRgb(h, s, v) {
  s /= 100; v /= 100;
  const c = v * s; const x = c * (1 - Math.abs((h / 60) % 2 - 1)); const m = v - c;
  const table = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][Math.floor(h / 60) % 6];
  return table.map((channel) => Math.round((channel + m) * 255));
}
function colorResult(r, g, b) {
  let best = TONES[0]; let bestDist = Infinity;
  TONES.forEach((tone) => {
    const dist = (tone[1] - r) ** 2 + (tone[2] - g) ** 2 + (tone[3] - b) ** 2;
    if (dist < bestDist) { best = tone; bestDist = dist; }
  });
  const hex = '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
  return ok(best[0], [{
    Preview: hex, HEX: hex, RGB: `${r}, ${g}, ${b}`, Colortone: best[0],
    'Colortone HEX': '#' + [best[1], best[2], best[3]].map((n) => n.toString(16).padStart(2, '0')).join(''),
    CMYK: rgbToCmyk(r, g, b), HSV: rgbToHsv(r, g, b),
  }], ['Colortone is CloudHost247\'s own named palette, not a third-party color system.']);
}
function rgbToCmyk(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255; const k = 1 - Math.max(rr, gg, bb);
  if (k === 1) return '0, 0, 0, 100';
  return [rr, gg, bb].map((channel) => Math.round((1 - channel - k) / (1 - k) * 100)).concat(Math.round(k * 100)).join(', ');
}
function rgbToHsv(r, g, b) {
  const rr = r / 255; const gg = g / 255; const bb = b / 255;
  const max = Math.max(rr, gg, bb); const min = Math.min(rr, gg, bb); const d = max - min;
  let h = 0;
  if (d) h = max === rr ? 60 * (((gg - bb) / d) % 6) : max === gg ? 60 * ((bb - rr) / d + 2) : 60 * ((rr - gg) / d + 4);
  if (h < 0) h += 360;
  return Math.round(h) + ', ' + (max ? Math.round(d / max * 100) : 0) + ', ' + Math.round(max * 100);
}
function smallMap() {
  const from = 'abcdefghijklmnopqrstuvwxyz';
  const to = 'ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖᑫʳˢᵗᵘᵛʷˣʸᶻ';
  return Object.fromEntries([...from].map((ch, i) => [ch, [...to][i] || ch]));
}
function runicMap() {
  const from = 'abcdefghijklmnopqrstuvwxyz';
  const to = 'ᚨᛒᚲᛞᛖᚠᚷᚺᛁᛃᚲᛚᛗᚾᛟᛈᛩᚱᛊᛏᚢᚡᚹᛪᚤᛉ';
  return Object.fromEntries([...from].map((ch, i) => [ch, [...to][i]]));
}
function mapChars(value, map) { return [...value].map((ch) => map[ch.toLowerCase()] || ch).join(''); }
function morse(value) {
  const map = { a: '.-', b: '-...', c: '-.-.', d: '-..', e: '.', f: '..-.', g: '--.', h: '....', i: '..', j: '.---', k: '-.-', l: '.-..', m: '--', n: '-.', o: '---', p: '.--.', q: '--.-', r: '.-.', s: '...', t: '-', u: '..-', v: '...-', w: '.--', x: '-..-', y: '-.--', z: '--..', 1: '.----', 2: '..---', 3: '...--', 4: '....-', 5: '.....', 6: '-....', 7: '--...', 8: '---..', 9: '----.', 0: '-----', ' ': '/' };
  if (/^[.\-\s/]+$/.test(value.trim())) {
    const reverse = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
    return value.trim().split(/\s+/).map((code) => reverse[code] || '?').join('');
  }
  return [...value.toLowerCase()].map((ch) => map[ch] || '?').join(' ');
}
function minecraftRows(sample) {
  const codes = [['0', 'Black', '#000'], ['1', 'Dark blue', '#00a'], ['2', 'Dark green', '#0a0'], ['3', 'Dark aqua', '#0aa'], ['4', 'Dark red', '#a00'], ['5', 'Dark purple', '#a0a'], ['6', 'Gold', '#fa0'], ['7', 'Gray', '#aaa'], ['8', 'Dark gray', '#555'], ['9', 'Blue', '#55f'], ['a', 'Green', '#5f5'], ['b', 'Aqua', '#5ff'], ['c', 'Red', '#f55'], ['d', 'Light purple', '#f5f'], ['e', 'Yellow', '#ff5'], ['f', 'White', '#fff'], ['k', 'Obfuscated', ''], ['l', 'Bold', ''], ['m', 'Strikethrough', ''], ['n', 'Underline', ''], ['o', 'Italic', ''], ['r', 'Reset', '']];
  return codes.map(([code, name, color]) => ({ Code: '§' + code, Name: name, Color: color, Preview: color ? sample : name }));
}
function ipv4Parts(value) {
  const parts = String(value || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) throw new Error('Enter an IPv4 address.');
  return parts;
}
function ipv4ToInt(value) { return ipv4Parts(value).reduce((acc, part) => (acc << 8n) + BigInt(part), 0n); }
function intToIpv4(value) { return [24, 16, 8, 0].map((shift) => Number((value >> BigInt(shift)) & 255n)).join('.'); }
function expand(value) {
  let input = String(value || '').trim().toLowerCase();
  if (input.includes('.')) {
    const last = input.slice(input.lastIndexOf(':') + 1);
    const parts = ipv4Parts(last);
    const hex = ((parts[0] << 8) | parts[1]).toString(16) + ':' + ((parts[2] << 8) | parts[3]).toString(16);
    input = input.slice(0, input.lastIndexOf(':') + 1) + hex;
  }
  if (!/^[0-9a-f:]+$/.test(input) || (input.match(/::/g) || []).length > 1) throw new Error('Enter an IPv6 address.');
  const sides = input.split('::');
  const head = sides[0] ? sides[0].split(':') : [];
  const tail = sides[1] ? sides[1].split(':') : [];
  if (sides.length === 1 && head.length !== 8) throw new Error('IPv6 address is incomplete.');
  const missing = 8 - head.length - tail.length;
  if (missing < 0) throw new Error('IPv6 address has too many groups.');
  return [...head, ...Array(missing).fill('0'), ...tail].map((group) => group.padStart(4, '0')).join(':');
}
function compress(expanded) {
  const groups = expanded.split(':').map((group) => group.replace(/^0+/, '') || '0');
  let best = [0, 0];
  let index = 0;
  while (index < groups.length) {
    if (groups[index] !== '0') { index++; continue; }
    let end = index;
    while (groups[end] === '0') end++;
    if (end - index > best[1] - best[0]) best = [index, end];
    index = end;
  }
  if (best[1] - best[0] < 2) return groups.join(':');
  return groups.slice(0, best[0]).join(':') + '::' + groups.slice(best[1]).join(':');
}
function applyPrefix(expanded, bits, ones) {
  const chars = expanded.replace(/:/g, '').split('');
  chars.forEach((ch, index) => {
    const bit = index * 4;
    if (bit >= bits) chars[index] = ones ? 'f' : '0';
    else if (bit + 4 > bits) {
      const keep = bits - bit;
      const mask = (0xf << (4 - keep)) & 0xf;
      const value = parseInt(ch, 16);
      chars[index] = (ones ? (value | (~mask & 0xf)) : (value & mask)).toString(16);
    }
  });
  return chars.join('').match(/.{4}/g).join(':');
}
function summarize(start, end) {
  const prefixes = [];
  let cursor = start;
  while (cursor <= end) {
    let size = 0n;
    while (size < 128n && cursor + (1n << size) - 1n <= end && (size === 0n || (cursor & ((1n << size) - 1n)) === 0n)) size++;
    size -= 1n;
    const prefix = 128n - size;
    prefixes.push(compress(bigintToV6(cursor)) + '/' + prefix.toString());
    cursor += 1n << size;
    if (prefixes.length > 32) break;
  }
  return prefixes;
}
function bigintToV6(value) { return value.toString(16).padStart(32, '0').match(/.{4}/g).join(':'); }
function puny(label) {
  const output = [];
  let n = 128; let bias = 72; let delta = 0;
  [...label].forEach((ch) => { if (ch.codePointAt(0) < 128) output.push(ch); });
  const basic = output.length;
  let handled = basic;
  if (basic) output.push('-');
  const points = [...label].map((ch) => ch.codePointAt(0));
  while (handled < points.length) {
    let m = Infinity;
    points.forEach((point) => { if (point >= n && point < m) m = point; });
    delta += (m - n) * (handled + 1);
    n = m;
    points.forEach((point) => {
      if (point < n) delta++;
      if (point === n) { output.push(encodeDigit(delta, bias)); bias = adapt(delta, handled + 1, handled === basic); delta = 0; handled++; }
    });
    delta++; n++;
  }
  return output.join('');
}
function encodeDigit(delta, bias) {
  const digits = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  let q = delta;
  for (let k = 36; ; k += 36) {
    const t = k <= bias ? 1 : k >= bias + 26 ? 26 : k - bias;
    if (q < t) return result + digits[q];
    result += digits[t + ((q - t) % (36 - t))];
    q = Math.floor((q - t) / (36 - t));
  }
}
function adapt(delta, numPoints, first) {
  delta = first ? Math.floor(delta / 700) : delta >> 1;
  delta += Math.floor(delta / numPoints);
  let k = 0;
  while (delta > 455) { delta = Math.floor(delta / 35); k += 36; }
  return k + Math.floor((36 * delta) / (delta + 38));
}
function depuny(input) {
  try { return new URL('http://' + 'xn--' + input).hostname.replace(/^xn--/, ''); }
  catch { return input; }
}
async function scan(input, wifi) {
  const file = input.file;
  if (!file) throw new Error('Choose a QR image.');
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width; canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bitmap, 0, 0);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const jsQR = (await import('./vendor/jsQR.mjs')).default;
  const code = jsQR(image.data, image.width, image.height);
  if (!code) return fail('No QR code was found in that image.');
  if (!wifi) return ok('QR decoded', [{ Text: code.data }], ['The link was not opened.']);
  const match = code.data.match(/^WIFI:S:([^;]*);T:([^;]*);P:([^;]*);/i);
  if (!match) return fail('The QR code is not a Wi-Fi setup code.');
  return ok('Wi-Fi details decoded locally', [{ SSID: match[1], Security: match[2], Passphrase: match[3] }], ['The network was not joined and the passphrase was not stored.']);
}

function md5(value) { return hex(md5Bytes(new TextEncoder().encode(value))); }

function md5Bytes(input) {
  const bytes = Array.from(input instanceof Uint8Array ? input : new TextEncoder().encode(String(input)));
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  const len = new ArrayBuffer(8);
  const view = new DataView(len);
  view.setUint32(0, bitLength >>> 0, true);
  view.setUint32(4, Math.floor(bitLength / 2 ** 32), true);
  new Uint8Array(len).forEach((byte) => bytes.push(byte));
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const s = [7, 12, 17, 22, 5, 9, 14, 20, 4, 11, 16, 23, 6, 10, 15, 21];
  const k = Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 2 ** 32));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const m = [];
    for (let i = 0; i < 16; i++) m[i] = bytes[offset + i * 4] | (bytes[offset + i * 4 + 1] << 8) | (bytes[offset + i * 4 + 2] << 16) | (bytes[offset + i * 4 + 3] << 24);
    let a = a0, b = b0, c = c0, d = d0;
    for (let i = 0; i < 64; i++) {
      let f; let g;
      if (i < 16) { f = (b & c) | (~b & d); g = i; }
      else if (i < 32) { f = (d & b) | (~d & c); g = (5 * i + 1) % 16; }
      else if (i < 48) { f = b ^ c ^ d; g = (3 * i + 5) % 16; }
      else { f = c ^ (b | ~d); g = (7 * i) % 16; }
      const next = d; d = c; c = b;
      const sum = (a + f + k[i] + m[g]) | 0;
      const shift = s[(i >> 4) * 4 + (i % 4)];
      b = (b + ((sum << shift) | (sum >>> (32 - shift)))) | 0;
      a = next;
    }
    a0 = (a0 + a) | 0; b0 = (b0 + b) | 0; c0 = (c0 + c) | 0; d0 = (d0 + d) | 0;
  }
  const out = new Uint8Array(16);
  const view2 = new DataView(out.buffer);
  [a0, b0, c0, d0].forEach((word, index) => view2.setUint32(index * 4, word >>> 0, true));
  return out;
}

// --- ICAO Doc 9303 machine-readable zones: TD1, TD2 and TD3 (browser-only, no network) ---------
//
// There is no fetch, no localStorage and no URL parameter anywhere in this module, so the values a
// visitor types stay in the tab. That is the privacy promise the page and the catalogue entry both
// make, and this is where it is kept: the only things that leave are the characters rendered on
// screen and, if the visitor clicks for it, the clipboard they asked for.

const MRZ_AUTHENTICITY_NOTE = 'Syntactic validation only: structure, field widths, character set and check digits. Correct digits do not prove a document is genuine — that needs the document itself and cryptographic verification (ICAO PKD / passive authentication), which this tool does not perform.';
/** Every calculator and generator in the collection states where the input was processed. */
const BASE64_NOTE = 'Base64 is an encoding, not encryption: anyone with the output can read the input. Do not use it to protect a secret.';
const CALC_PRIVACY_NOTE = 'Privacy: this calculation ran in your browser. Nothing was uploaded, logged or stored, and no date, amount or value you typed left this device.';
const MRZ_PRIVACY_NOTE = 'Privacy: this ran in your browser. Nothing was uploaded, logged or stored — no MRZ string, document number or date of birth left this device.';

const MRZ_TRANSLITERATION = {
  'Ä': 'AE', 'Æ': 'AE', 'Ö': 'OE', 'Œ': 'OE', 'Ø': 'OE', 'Ü': 'UE', 'ẞ': 'SS', 'ß': 'SS', 'Å': 'AA',
  'Þ': 'TH', 'Ĳ': 'IJ', 'Đ': 'D', 'Ð': 'D', 'Ł': 'L', 'Ç': 'C', 'Ñ': 'N', 'Š': 'S', 'Ž': 'Z',
  'Č': 'C', 'Ř': 'R', 'Ť': 'T', 'Ď': 'D', 'Ň': 'N', 'Ě': 'E', 'Ů': 'U', 'Ő': 'O', 'Ű': 'U', 'İ': 'I',
  'Ğ': 'G', 'Ş': 'S', 'Ą': 'A', 'Ć': 'C', 'Ę': 'E', 'Ś': 'S', 'Ź': 'Z', 'Ż': 'Z', 'Ń': 'N',
};

/**
 * The three ICAO Doc 9303 layouts. `nameField` is the width of the surname<<given-names field,
 * `optional` the primary optional/personal-number field and `optional2` the TD1-only second one.
 */
const MRZ_FORMATS = {
  TD1: { label: 'TD1 — ID card, 3 lines of 30', lines: 3, width: 30, nameField: 30, optional: 15, optional2: 11, docCodePattern: /^[ACIV][A-Z<]$/, docCodeHint: 'A TD1 code starts with A, C, I or V (I for an identity card).' },
  TD2: { label: 'TD2 — ID card, 2 lines of 36', lines: 2, width: 36, nameField: 31, optional: 7, optional2: 0, docCodePattern: /^[ACIV][A-Z<]$/, docCodeHint: 'A TD2 code starts with A, C, I or V (I for an identity card).' },
  TD3: { label: 'TD3 — passport, 2 lines of 44', lines: 2, width: 44, nameField: 39, optional: 14, optional2: 0, docCodePattern: /^P[A-Z<]$/, docCodeHint: 'A TD3 document code starts with P, optionally followed by a letter or < (for example P< or PO).' },
};
const MRZ_FORMAT_KEYS = ['TD1', 'TD2', 'TD3'];

function attachCopy(payload, copyText, filename) {
  payload.copyText = copyText;
  if (filename) payload.downloadName = filename;
  return payload;
}

function mrzValue(ch) {
  if (ch === '<') return 0;
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  return null;
}

/** ICAO 9303 mod-10 check digit over the repeating weights 7, 3, 1. Null when a character is not allowed. */
function mrzCheckDigit(segment) {
  let sum = 0;
  for (let i = 0; i < segment.length; i++) {
    const value = mrzValue(segment[i]);
    if (value === null) return null;
    sum += value * [7, 3, 1][i % 3];
  }
  return String(sum % 10);
}

function mrzTransliterate(value) {
  return Array.from(String(value).toUpperCase()).map((ch) => {
    if (MRZ_TRANSLITERATION[ch]) return MRZ_TRANSLITERATION[ch];
    if (/[A-Z0-9]/.test(ch)) return ch;
    return ch.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  }).join('');
}

/** One name component. An unsupported character fails loudly instead of being silently deleted. */
function mrzNameComponent(value, label) {
  const out = [];
  for (const ch of mrzTransliterate(value)) {
    if (ch === "'" || ch === '\u2019') continue;
    if (ch === ' ' || ch === '-' || ch === '_') { if (out.length && out[out.length - 1] !== '<') out.push('<'); continue; }
    if (ch >= 'A' && ch <= 'Z') { out.push(ch); continue; }
    throw new Error('"' + ch + '" cannot be transliterated into the ' + label + ' field. Use the Latin letters printed on the document.');
  }
  while (out.length && out[out.length - 1] === '<') out.pop();
  if (!out.length) throw new Error('Enter the ' + label + '.');
  return out.join('');
}

function mrzStateCode(value, label) {
  const code = mrzTransliterate(String(value).replace(/\s+/g, ''));
  if (!/^[A-Z]{3}$/.test(code)) throw new Error(label + ' must be the three-letter ICAO code (for example UTO — the reserved test code).');
  return code;
}

function mrzDateField(value, label) {
  const digits = String(value).trim().replace(/[^0-9]/g, '');
  if (digits !== String(value).trim() || !/^\d{6}$/.test(digits)) {
    throw new Error(label + ' must be six digits in YYMMDD order (for example 850115).');
  }
  const year = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const day = Number(digits.slice(4, 6));
  if (month < 1 || month > 12) throw new Error(label + ' uses "' + digits.slice(2, 4) + '" as its month; the MRZ stores YYMMDD.');
  if (day < 1 || day > 31) throw new Error(label + ' uses "' + digits.slice(4, 6) + '" as its day; the MRZ stores YYMMDD.');
  // A real calendar date, not just a plausible-looking one: 31 February passes the digit test and
  // must not reach a check digit.
  const century = month > 12 ? 1900 : (year > Number(String(new Date().getFullYear()).slice(2)) ? 1900 : 2000);
  const probe = new Date(Date.UTC(century + year, month - 1, day));
  if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new Error(label + ' is not a real calendar date: ' + digits.slice(4, 6) + '/' + digits.slice(2, 4) + ' does not exist.');
  }
  return digits;
}

/**
 * Fixed-width alphanumeric fields. A value that cannot fit is rejected with the field name, the
 * layout and the limit — never truncated, because a truncated name would produce a syntactically
 * valid zone that misstates the document.
 */
function mrzFixedField(value, max, label, layout) {
  const clean = mrzTransliterate(String(value || '')).replace(/[^A-Z0-9]/g, '');
  if (!clean) throw new Error('Enter the ' + label + '.');
  if (clean.length > max) {
    throw new Error('The ' + label + ' is ' + clean.length + ' characters. ' + layout + ' allows ' + max + '. Shorten it — this tool does not truncate document fields.');
  }
  return clean.padEnd(max, '<');
}

function mrzOptionalField(value, max, label, layout) {
  const clean = mrzTransliterate(String(value || '')).replace(/[^A-Z0-9]/g, '');
  if (clean.length > max) {
    throw new Error('The ' + label + ' is ' + clean.length + ' characters. ' + layout + ' allows ' + max + ' in that position.');
  }
  return clean.padEnd(max, '<');
}

function mrzDocumentCode(value, formatKey) {
  const fmt = MRZ_FORMATS[formatKey];
  let code = mrzTransliterate(String(value || '').trim().replace(/\s+/g, ''));
  if (!code) code = formatKey === 'TD3' ? 'P<' : 'I<';
  if (code.length === 1) code += '<';
  if (code.length > 2) throw new Error('The document code is two characters (' + code + '). ' + fmt.docCodeHint);
  if (!fmt.docCodePattern.test(code)) throw new Error('"' + code + '" is not a valid ' + formatKey + ' document code. ' + fmt.docCodeHint);
  return code;
}

function mrzSex(value) {
  const raw = String(value || '<').trim().toUpperCase();
  if (/^M/.test(raw)) return 'M';
  if (/^F/.test(raw)) return 'F';
  if (raw === '' || raw === '<' || raw === 'X') return '<';
  throw new Error('Sex must be M, F or < (unspecified). "' + raw + '" is not an ICAO sex code.');
}

/** Build the machine-readable lines for the selected layout. Throws with a field-level message. */
function mrzGenerate(input) {
  const requested = String(input.format || 'TD3').trim().toUpperCase();
  const formatKey = MRZ_FORMAT_KEYS.includes(requested) ? requested : 'TD3';
  const fmt = MRZ_FORMATS[formatKey];
  const layout = formatKey + ' (' + fmt.lines + ' lines of ' + fmt.width + ')';

  const documentCode = mrzDocumentCode(input.documentCode, formatKey);
  const issuingState = mrzStateCode(input.issuingState || '', 'The issuing state');
  const surname = mrzNameComponent(input.surname || '', 'surname');
  const givenNames = mrzNameComponent(input.givenNames || '', 'given names');
  const nationality = mrzStateCode(input.nationality || '', 'The nationality');
  const documentNumber = mrzFixedField(input.documentNumber, 9, 'document number', layout);
  const dateOfBirth = mrzDateField(input.dateOfBirth || '', 'The date of birth');
  const expiryDate = mrzDateField(input.expiryDate || '', 'The expiry date');
  const sex = mrzSex(input.sex);
  const combinedName = surname + '<<' + givenNames;
  if (combinedName.length > fmt.nameField) {
    throw new Error('The combined name field (SURNAME<<GIVEN<NAMES) is ' + combinedName.length + ' characters. '
      + layout + ' allows ' + fmt.nameField + '. Shorten the printed name — this tool does not truncate it.');
  }
  const nameField = combinedName.padEnd(fmt.nameField, '<');
  const optional = mrzOptionalField(input.optionalData, fmt.optional, 'optional / personal number', layout);

  const documentNumberCheck = mrzCheckDigit(documentNumber);
  const birthCheck = mrzCheckDigit(dateOfBirth);
  const expiryCheck = mrzCheckDigit(expiryDate);
  const optionalCheck = mrzCheckDigit(optional);

  let lines;
  let compositeSource;
  const checkDigits = { documentNumber: documentNumberCheck, dateOfBirth: birthCheck, expiryDate: expiryCheck };

  if (formatKey === 'TD1') {
    const optional2 = mrzOptionalField(input.optionalData2, fmt.optional2, 'optional data 2', layout);
    checkDigits.optionalData = optionalCheck;
    checkDigits.optionalData2 = mrzCheckDigit(optional2);
    lines = [
      documentCode + issuingState + documentNumber + documentNumberCheck + optional,
      dateOfBirth + birthCheck + sex + expiryDate + expiryCheck + nationality + optional2,
      nameField,
    ];
    // ICAO Doc 9303 Part 5: the TD1 composite covers line 1 positions 6-30, then line 2 positions
    // 1-7 (date of birth + its check digit), 9-15 (expiry + its check digit) and 19-29 (optional
    // data 2). The sex code at position 8 and the nationality at 16-18 are deliberately outside it,
    // which is why the ranges are concatenated rather than sliced as one block.
    compositeSource = lines[0].slice(5, 30) + lines[1].slice(0, 7) + lines[1].slice(8, 15) + lines[1].slice(18, 29);
    const composite = mrzCheckDigit(compositeSource);
    checkDigits.composite = composite;
    lines[1] += composite;
  } else {
    const optionalWidth = fmt.optional;
    const line2Core = documentNumber + documentNumberCheck + nationality + dateOfBirth + birthCheck
      + sex + expiryDate + expiryCheck + optional + (formatKey === 'TD3' ? optionalCheck : '');
    if (formatKey === 'TD3') checkDigits.optionalData = optionalCheck;
    lines = [documentCode + issuingState + nameField, line2Core];
    compositeSource = documentNumber + documentNumberCheck + dateOfBirth + birthCheck
      + expiryDate + expiryCheck + optional + (formatKey === 'TD3' ? optionalCheck : '');
    const composite = mrzCheckDigit(compositeSource);
    checkDigits.composite = composite;
    lines[1] += composite;
    if (optionalWidth !== optional.length) throw new Error('Internal width error on the optional field.');
  }

  lines.forEach((line, index) => {
    if (line.length !== fmt.width) {
      throw new Error('Internal error: ' + formatKey + ' line ' + (index + 1) + ' is ' + line.length
        + ' characters, expected ' + fmt.width + '.');
    }
  });

  return {
    format: formatKey,
    formatLabel: fmt.label,
    lines,
    nameField,
    checkDigits,
    normalization: 'Names transliterated to the ICAO Latin character set; fields padded with < to the fixed ' + layout + ' widths.',
  };
}

function mrzLines(value) {
  return String(value || '').replace(/\r\n?/g, '\n').split('\n')
    .map((line) => line.trim().toUpperCase().replace(/\s+/g, ''))
    .filter(Boolean);
}

/** Which layout a pasted zone is, from its shape alone. Returns null when the shape is ambiguous. */
function mrzDetectFormat(lines) {
  if (lines.length === 3 && lines.every((line) => line.length === 30)) return 'TD1';
  if (lines.length === 2 && lines.every((line) => line.length === 36)) return 'TD2';
  if (lines.length === 2 && lines.every((line) => line.length === 44)) return 'TD3';
  return null;
}

function mrzRow(field, expected, found) {
  return { Field: field, Expected: expected, Found: found, Result: String(expected) === String(found) ? 'PASS' : 'FAIL' };
}

/** A check whose pass condition is not a string comparison (a regex test, a membership test). */
function mrzCheck(field, expected, found, pass) {
  return { Field: field, Expected: expected, Found: found, Result: pass ? 'PASS' : 'FAIL' };
}

/** A reported fact, not a check — it never fails. */
function mrzInfo(field, value) {
  return { Field: field, Expected: '—', Found: value, Result: 'PASS' };
}

function mrzCheckRow(field, computed, found) {
  return { Field: field, Expected: computed === null ? 'computable' : computed, Found: found, Result: computed !== null && computed === found ? 'PASS' : 'FAIL' };
}

/** Structural + check-digit inspection of a supplied zone. Reports every comparison it made. */
function mrzInspect(lines) {
  const printable = /^[A-Z0-9<]+$/;
  const shape = mrzDetectFormat(lines);
  if (!shape) {
    const found = lines.length ? lines.map((line) => line.length).join(' + ') : 'nothing';
    return {
      ok: false,
      structureOk: false,
      format: null,
      rows: [mrzRow('Zone shape', '3×30 (TD1), 2×36 (TD2) or 2×44 (TD3)', lines.length + ' line(s) of ' + found)],
      fields: [],
      notes: ['Paste the machine-readable lines exactly as printed, one per line. Whitespace is ignored; nothing else is.'],
    };
  }
  const fmt = MRZ_FORMATS[shape];
  const rows = [];
  lines.forEach((line, index) => {
    rows.push(mrzRow('Line ' + (index + 1) + ' length', fmt.width, line.length));
  });
  rows.push(mrzInfo('Detected format', shape + ' — ' + fmt.label));
  const charsetOk = lines.every((line) => printable.test(line));
  rows.push(mrzCheck('Character set', 'A-Z, 0-9 or < only', charsetOk ? 'allowed characters only' : 'unsupported characters present', charsetOk));

  const comparisons = [];
  const fields = [];
  let structureOk = charsetOk;

  if (shape === 'TD3' || shape === 'TD2') {
    const [line1, line2] = lines;
    const documentNumber = line2.slice(0, 9);
    const nationality = line2.slice(10, 13);
    const birth = line2.slice(13, 19);
    const sex = line2.slice(20, 21);
    const expiry = line2.slice(21, 27);
    const expiryCheckAt = 27;
    const optionalAt = 28;
    const optional = line2.slice(optionalAt, optionalAt + fmt.optional);
    const optionalCheckAt = optionalAt + fmt.optional;
    const hasOptionalCheck = shape === 'TD3';
    const composite = line2.slice(line2.length - 1);

    const codeOk = MRZ_FORMATS[shape].docCodePattern.test(line1.slice(0, 2));
    rows.push(mrzCheck('Document code', shape === 'TD3' ? 'starts with P' : 'starts with A, C, I or V',
      codeOk ? line1.slice(0, 2) : line1.slice(0, 2) + ' (not valid for ' + shape + ')', codeOk));
    if (!codeOk) structureOk = false;
    rows.push(mrzCheck('Issuing state', 'three letters', line1.slice(2, 5), /^[A-Z]{3}$/.test(line1.slice(2, 5))));
    rows.push(mrzCheck('Nationality', 'three letters', nationality, /^[A-Z]{3}$/.test(nationality)));
    rows.push(mrzCheck('Sex code', 'M, F or <', sex, ['M', 'F', '<'].includes(sex)));
    rows.push(mrzDateRow('Date of birth', birth));
    rows.push(mrzDateRow('Expiry date', expiry));

    comparisons.push(['Document number check digit', mrzCheckDigit(documentNumber), line2.slice(9, 10)]);
    comparisons.push(['Date of birth check digit', mrzCheckDigit(birth), line2.slice(19, 20)]);
    comparisons.push(['Expiry date check digit', mrzCheckDigit(expiry), line2.slice(expiryCheckAt, expiryCheckAt + 1)]);
    const compositeSource = documentNumber + line2.slice(9, 10) + birth + line2.slice(19, 20)
      + expiry + line2.slice(expiryCheckAt, expiryCheckAt + 1) + optional
      + (hasOptionalCheck ? line2.slice(optionalCheckAt, optionalCheckAt + 1) : '');
    if (hasOptionalCheck) {
      comparisons.push(['Optional data check digit', mrzCheckDigit(optional), line2.slice(optionalCheckAt, optionalCheckAt + 1)]);
    }
    comparisons.push(['Composite check digit', mrzCheckDigit(compositeSource), composite]);

    const namePart = line1.slice(5);
    const separator = namePart.indexOf('<<');
    fields.push(
      { Field: 'Format', Value: shape + ' — ' + fmt.label },
      { Field: 'Document code', Value: line1.slice(0, 2) },
      { Field: 'Issuing state', Value: line1.slice(2, 5) },
      { Field: 'Surname', Value: (separator >= 0 ? namePart.slice(0, separator) : namePart).replace(/</g, ' ').trim() },
      { Field: 'Given names', Value: (separator >= 0 ? namePart.slice(separator + 2) : '').replace(/</g, ' ').trim() },
      { Field: 'Document number', Value: documentNumber.replace(/</g, '') },
      { Field: 'Nationality', Value: nationality },
      { Field: 'Date of birth (YYMMDD)', Value: birth },
      { Field: 'Sex (MRZ code)', Value: sex },
      { Field: 'Expiry date (YYMMDD)', Value: expiry },
      { Field: 'Optional data', Value: optional.replace(/</g, '') || '(none)' },
    );
  } else {
    const [line1, line2, line3] = lines;
    const documentNumber = line1.slice(5, 14);
    const optional1 = line1.slice(15, 30);
    const birth = line2.slice(0, 6);
    const sex = line2.slice(7, 8);
    const expiry = line2.slice(8, 14);
    const nationality = line2.slice(15, 18);
    const optional2 = line2.slice(18, 29);
    const composite = line2.slice(29, 30);

    const codeOk = MRZ_FORMATS.TD1.docCodePattern.test(line1.slice(0, 2));
    rows.push(mrzCheck('Document code', 'starts with A, C, I or V',
      codeOk ? line1.slice(0, 2) : line1.slice(0, 2) + ' (not valid for TD1)', codeOk));
    if (!codeOk) structureOk = false;
    rows.push(mrzCheck('Issuing state', 'three letters', line1.slice(2, 5), /^[A-Z]{3}$/.test(line1.slice(2, 5))));
    rows.push(mrzCheck('Nationality', 'three letters', nationality, /^[A-Z]{3}$/.test(nationality)));
    rows.push(mrzCheck('Sex code', 'M, F or <', sex, ['M', 'F', '<'].includes(sex)));
    rows.push(mrzDateRow('Date of birth', birth));
    rows.push(mrzDateRow('Expiry date', expiry));

    comparisons.push(['Document number check digit', mrzCheckDigit(documentNumber), line1.slice(14, 15)]);
    comparisons.push(['Date of birth check digit', mrzCheckDigit(birth), line2.slice(6, 7)]);
    comparisons.push(['Expiry date check digit', mrzCheckDigit(expiry), line2.slice(14, 15)]);
    // Line 1 positions 6-30, then line 2 positions 1-7, 9-15 and 19-29 (see mrzGenerate).
    comparisons.push(['Composite check digit',
      mrzCheckDigit(line1.slice(5, 30) + line2.slice(0, 7) + line2.slice(8, 15) + line2.slice(18, 29)), composite]);

    const separator = line3.indexOf('<<');
    fields.push(
      { Field: 'Format', Value: 'TD1 — ' + MRZ_FORMATS.TD1.label },
      { Field: 'Document code', Value: line1.slice(0, 2) },
      { Field: 'Issuing state', Value: line1.slice(2, 5) },
      { Field: 'Surname', Value: (separator >= 0 ? line3.slice(0, separator) : line3).replace(/</g, ' ').trim() },
      { Field: 'Given names', Value: (separator >= 0 ? line3.slice(separator + 2) : '').replace(/</g, ' ').trim() },
      { Field: 'Document number', Value: documentNumber.replace(/</g, '') },
      { Field: 'Nationality', Value: nationality },
      { Field: 'Date of birth (YYMMDD)', Value: birth },
      { Field: 'Sex (MRZ code)', Value: sex },
      { Field: 'Expiry date (YYMMDD)', Value: expiry },
      { Field: 'Optional data 1', Value: optional1.replace(/</g, '') || '(none)' },
      { Field: 'Optional data 2', Value: optional2.replace(/</g, '') || '(none)' },
    );
  }

  comparisons.forEach(([field, computed, found]) => rows.push(mrzCheckRow(field, computed, found)));

  return {
    ok: structureOk && rows.every((row) => row.Result === 'PASS'),
    structureOk,
    format: shape,
    rows,
    fields,
    notes: ['YYMMDD carries no century; the surrounding document, not this tool, determines the full date.'],
  };
}

/** A YYMMDD shape check that also rejects impossible calendar dates. */
function mrzDateRow(label, value) {
  if (!/^\d{6}$/.test(value)) return mrzCheck(label + ' shape', 'six digits, YYMMDD', value, false);
  const month = Number(value.slice(2, 4));
  const day = Number(value.slice(4, 6));
  if (month < 1 || month > 12) return mrzCheck(label + ' shape', 'a month from 01 to 12', value, false);
  // 00 is a legitimate filler-only field on some documents, so only a non-zero day is calendar-tested.
  if (day >= 1) {
    const probe = new Date(Date.UTC(2001, month - 1, day));
    if (probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
      return mrzCheck(label + ' shape', 'a real calendar date', value + ' (' + day + '/' + month + ' does not exist)', false);
    }
  }
  return mrzCheck(label + ' shape', 'YYMMDD with a valid month and day', value, true);
}

// --- Compliance & Document Tools: shared helpers ------------------------------------------------
//
// Calendar arithmetic, number parsing, CSPRNG sampling, digests and the small config writers the
// Compliance & Document calculators and generators share. Everything here is pure: no network, no
// storage, no timers.

/** Storage and data units. `factor` is bytes per unit, so a conversion never compounds rounding. */
const DATA_UNITS = {
  bit: { factor: 1 / 8, system: 'bit' },
  B: { factor: 1, system: 'byte' },
  kB: { factor: 1e3, system: 'decimal' },
  KB: { factor: 1e3, system: 'decimal' },
  MB: { factor: 1e6, system: 'decimal' },
  GB: { factor: 1e9, system: 'decimal' },
  TB: { factor: 1e12, system: 'decimal' },
  PB: { factor: 1e15, system: 'decimal' },
  KiB: { factor: 2 ** 10, system: 'binary' },
  MiB: { factor: 2 ** 20, system: 'binary' },
  GiB: { factor: 2 ** 30, system: 'binary' },
  TiB: { factor: 2 ** 40, system: 'binary' },
  PiB: { factor: 2 ** 50, system: 'binary' },
};

const API_KEY_ALPHABETS = {
  base62: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
  hex: '0123456789abcdef',
  base32: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',
  urlsafe: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_',
  digits: '0123456789',
};

const PASSPHRASE_WORDS = [
  'alpha', 'anchor', 'anvil', 'apple', 'archer', 'arrow', 'atlas', 'attic',
  'autumn', 'badge', 'baker', 'balmy', 'barge', 'baron', 'basil', 'beacon',
  'beech', 'beetle', 'berry', 'bishop', 'bison', 'blade', 'blanket', 'blizzard',
  'blossom', 'bolt', 'bonfire', 'border', 'boulder', 'braided', 'brass', 'breeze',
  'brick', 'bridge', 'bristle', 'bronze', 'brook', 'brush', 'bubble', 'bucket',
  'buckle', 'buffalo', 'bundle', 'burrow', 'butter', 'cabin', 'cable', 'cactus',
  'cadence', 'camel', 'candle', 'canyon', 'cargo', 'cedar', 'cellar', 'chalk',
  'chasm', 'cherry', 'chestnut', 'chimney', 'cipher', 'citrus', 'clamber', 'clamor',
  'cliff', 'clover', 'cobra', 'cobble', 'cocoa', 'coconut', 'coffee', 'comet',
  'compass', 'copper', 'coral', 'cottage', 'cotton', 'cougar', 'cradle', 'craft',
  'cranberry', 'crater', 'creek', 'cricket', 'crimson', 'crocus', 'crystal', 'cubicle',
  'cucumber', 'currant', 'cypress', 'dagger', 'daisy', 'delta', 'denim', 'depot',
  'desert', 'diamond', 'digit', 'dolphin', 'domino', 'donkey', 'dragon', 'dragonfly',
  'drift', 'drum', 'dunlin', 'eagle', 'ebony', 'echelon', 'eclipse', 'edelweiss',
  'ember', 'emperor', 'enclave', 'engine', 'enamel', 'equinox', 'falcon', 'fathom',
  'fern', 'ferry', 'fiddle', 'figment', 'filament', 'finch', 'firefly', 'fjord',
  'flame', 'flannel', 'flint', 'flock', 'foliage', 'forest', 'fossil', 'fountain',
  'foxtrot', 'furnace', 'gable', 'galaxy', 'garden', 'garnet', 'gateway', 'gentle',
  'glacier', 'glade', 'glider', 'goblin', 'granite', 'grape', 'grasshopper', 'gravel',
  'grove', 'gull', 'harbor', 'harvest', 'haven', 'hazel', 'heron', 'hollow',
  'honey', 'horizon', 'husband', 'iceberg', 'idle', 'ivory', 'jacket', 'jasmine',
  'jasper', 'juniper', 'kayak', 'kettle', 'kingfisher', 'lantern', 'larch', 'lattice',
  'laurel', 'leaflet', 'lemon', 'leopard', 'lighthouse', 'lily', 'limestone', 'linnet',
  'lion', 'lizard', 'lobster', 'lodestone', 'lotus', 'lumen', 'lunar', 'lynx',
  'magnet', 'magnolia', 'mango', 'maple', 'marble', 'marigold', 'marlin', 'martin',
  'mastiff', 'meadow', 'meridian', 'minnow', 'mint', 'mirror', 'mistral', 'monarch',
  'monsoon', 'mountain', 'mulberry', 'narwhal', 'nebula', 'needle', 'nectar', 'nimbus',
  'nuthatch', 'oasis', 'oak', 'ocean', 'olive', 'onyx', 'opal', 'orchid',
  'osprey', 'otter', 'oven', 'owl', 'oyster', 'palm', 'panther', 'paper',
  'parcel', 'parrot', 'pasture', 'pebble', 'pecan', 'pelican', 'pepper', 'perch',
  'petal', 'pigeon', 'pine', 'pinnacle', 'planet', 'platinum', 'plum', 'plume',
  'pocket', 'polar', 'pollen', 'pond', 'poplar', 'poppy', 'porcelain', 'porcupine',
  'prairie', 'prism', 'pumice', 'pumpkin', 'quartz', 'quarry', 'quill', 'quince',
  'rabbit', 'raccoon', 'radar', 'rainbow', 'ramble', 'raptor', 'raven', 'ravine',
  'reef', 'reindeer', 'ridge', 'river', 'robin', 'robot', 'rocket', 'rookery',
  'root', 'rosemary', 'ruby', 'runway', 'sable', 'sabre', 'saddle', 'saffron',
  'sage', 'salmon', 'sandal', 'sandpiper', 'sapphire', 'scarlet', 'scholar', 'season',
  'selkie', 'sequoia', 'serpent', 'shallow', 'shamrock', 'shuttle', 'silver', 'sirocco',
  'skylark', 'slate', 'sloth', 'sorrel', 'sparrow', 'spindle', 'spruce', 'squid',
  'station', 'stellar', 'stone', 'stork', 'stratus', 'summit', 'sundial', 'sunset',
  'swallow', 'swan', 'swift', 'sycamore', 'table', 'talon', 'tangerine', 'temple',
  'terrace', 'thistle', 'thrush', 'thunder', 'timber', 'toad', 'topaz', 'torch',
  'toucan', 'tulip', 'tumbleweed', 'tunnel', 'turtle', 'umber', 'umbrella', 'upland',
  'valley', 'vanilla', 'vapour', 'venture', 'vessel', 'violet', 'vixen', 'vulture',
  'walnut', 'wanderer', 'wasp', 'waterfall', 'willow', 'winter', 'wisteria', 'wolverine',
  'woodpepper', 'wren', 'yak', 'yearling', 'yellow', 'zebra', 'zenith', 'zephyr'
];

function decimal(value, label) {
  const cleaned = String(value ?? '').trim().replace(/,/g, '').replace(/%$/, '');
  if (!cleaned) throw new Error('Enter the ' + label + '.');
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error('"' + cleaned + '" is not a number. Enter the ' + label + ' as digits, with an optional decimal point.');
  return parsed;
}

/** Trim trailing zeroes from a number so 2.5000000001 does not become 2.50000000010000001. */
function trim(value) {
  if (!Number.isFinite(value)) return String(value);
  const fixed = Number(value.toFixed(12));
  return String(fixed);
}

function formatNumber(value, precision) {
  if (!Number.isFinite(value)) return String(value);
  return value.toLocaleString('en-US', { minimumFractionDigits: precision, maximumFractionDigits: precision });
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

/**
 * Parse a calendar date with no time zone attached.
 *
 * Accepted: YYYY-MM-DD, YYYY/MM/DD and DD/MM/YYYY. A bare DD-MM-YYYY or MM/DD/YYYY is refused
 * rather than guessed, because 03/04 is 3 April in most of the world and 4 March in the United
 * States, and silently picking one would make an age or a duration wrong with no visible error.
 */
function parseCalendarDate(value, label) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter the ' + label + '.');
  let match = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  let year; let month; let day;
  if (match) {
    year = Number(match[1]); month = Number(match[2]); day = Number(match[3]);
  } else {
    match = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (!match) {
      throw new Error('The ' + label + ' "' + raw + '" is not a date this tool will guess at. Use YYYY-MM-DD (2026-03-04) or DD/MM/YYYY (04/03/2026).');
    }
    day = Number(match[1]); month = Number(match[2]); year = Number(match[3]);
  }
  if (year < 1 || year > 9999) throw new Error('The ' + label + ' year must be between 1 and 9999.');
  if (month < 1 || month > 12) throw new Error('The ' + label + ' has month "' + month + '"; months run from 1 to 12.');
  if (day < 1 || day > daysInMonth(year, month)) {
    throw new Error('The ' + label + ' is not a real date: ' + year + '-' + String(month).padStart(2, '0') + ' has ' + daysInMonth(year, month) + ' days, so day ' + day + ' does not exist.');
  }
  return { y: year, m: month, d: day };
}

function iso(part) {
  return part.y + '-' + String(part.m).padStart(2, '0') + '-' + String(part.d).padStart(2, '0');
}

function weekday(part) {
  return weekdayOf(new Date(Date.UTC(part.y, part.m - 1, part.d)), false);
}

function weekdayOf(date, local) {
  const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[local ? date.getDay() : date.getUTCDay()];
}

function localToday() {
  const now = new Date();
  return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
}

function localZoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'local time';
  } catch {
    return 'local time';
  }
}

/** Whole years, then whole months, then remaining days — the way a person states an age. */
function calendarSpan(from, to) {
  let years = to.y - from.y;
  let months = to.m - from.m;
  let days = to.d - from.d;
  if (days < 0) {
    months -= 1;
    const previousMonth = to.m === 1 ? 12 : to.m - 1;
    const previousMonthYear = to.m === 1 ? to.y - 1 : to.y;
    days += daysInMonth(previousMonthYear, previousMonth);
  }
  if (months < 0) { years -= 1; months += 12; }
  return [years, months, days];
}

function addDays(part, amount) {
  const date = new Date(Date.UTC(part.y, part.m - 1, part.d));
  date.setUTCDate(date.getUTCDate() + amount);
  return { y: date.getUTCFullYear(), m: date.getUTCMonth() + 1, d: date.getUTCDate() };
}

/** Month arithmetic clamps to the last valid day: 31 January + 1 month is 28/29 February, not 3 March. */
function addMonths(part, amount) {
  const total = part.y * 12 + (part.m - 1) + amount;
  const year = Math.floor(total / 12);
  const month = (total % 12 + 12) % 12 + 1;
  if (year < 1 || year > 9999) throw new Error('That offset lands outside the years 1 to 9999 this tool supports.');
  const day = Math.min(part.d, daysInMonth(year, month));
  return { y: year, m: month, d: day };
}

function nextOccurrence(birth, reference) {
  const thisYear = { y: reference.y, m: birth.m, d: birth.d };
  const validDay = Math.min(thisYear.d, daysInMonth(reference.y, thisYear.m));
  const candidate = { y: reference.y, m: thisYear.m, d: validDay };
  const candidateValue = Date.UTC(candidate.y, candidate.m - 1, candidate.d);
  const referenceValue = Date.UTC(reference.y, reference.m - 1, reference.d);
  if (candidateValue >= referenceValue) return candidate;
  return { y: reference.y + 1, m: candidate.m, d: Math.min(birth.d, daysInMonth(reference.y + 1, candidate.m)) };
}

function businessDays(from, to) {
  let count = 0;
  const cursor = Date.UTC(from.y, from.m - 1, from.d);
  const end = Date.UTC(to.y, to.m - 1, to.d);
  if (end - cursor > 86400000 * 200000) return 'range too large to count';
  for (let value = cursor; value <= end; value += 86400000) {
    const day = new Date(value).getUTCDay();
    if (day !== 0 && day !== 6) count += 1;
  }
  return count;
}

function countLeapDays(from, to) {
  let count = 0;
  for (let year = from.y; year <= to.y; year += 1) {
    if (!isLeapYear(year)) continue;
    const feb29 = Date.UTC(year, 1, 29);
    if (feb29 >= Date.UTC(from.y, from.m - 1, from.d) && feb29 <= Date.UTC(to.y, to.m - 1, to.d)) count += 1;
  }
  return count;
}

function formatParts(date, local) {
  const pad = (value) => String(value).padStart(2, '0');
  const y = local ? date.getFullYear() : date.getUTCFullYear();
  const m = local ? date.getMonth() + 1 : date.getUTCMonth() + 1;
  const d = local ? date.getDate() : date.getUTCDate();
  const hh = local ? date.getHours() : date.getUTCHours();
  const mm = local ? date.getMinutes() : date.getUTCMinutes();
  const ss = local ? date.getSeconds() : date.getUTCSeconds();
  return y + '-' + pad(m) + '-' + pad(d) + ' ' + pad(hh) + ':' + pad(mm) + ':' + pad(ss);
}

function relativeToNow(date) {
  const delta = date.getTime() - Date.now();
  const seconds = Math.round(Math.abs(delta) / 1000);
  const units = [[31536000, 'year'], [2592000, 'month'], [604800, 'week'], [86400, 'day'], [3600, 'hour'], [60, 'minute']];
  for (const [size, name] of units) {
    if (seconds >= size) {
      const amount = Math.round(seconds / size);
      return (delta < 0 ? amount + ' ' + name + (amount === 1 ? '' : 's') + ' ago' : 'in ' + amount + ' ' + name + (amount === 1 ? '' : 's'));
    }
  }
  return delta < 0 ? 'less than a minute ago' : 'in less than a minute';
}

/**
 * Parse a date/time for the timestamp encoder. Accepts ISO 8601 (with or without an offset) and
 * `YYYY-MM-DD HH:MM:SS`. A bare local date/time is read in whichever zone the visitor chose, so the
 * tool never has to guess.
 */
function parseDateTime(value, useLocal) {
  const raw = String(value ?? '').trim();
  if (!raw) throw new Error('Enter a date and time.');
  const isoMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?\s*(Z|z|[+-]\d{2}:?\d{2})?$/);
  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!isoMatch && !dateOnly) {
    throw new Error('"' + raw + '" is not a date/time this tool accepts. Use ISO 8601 (2026-01-01T00:00:00Z, 2026-01-01T00:00:00+01:00) or YYYY-MM-DD HH:MM:SS.');
  }
  if (dateOnly) {
    const part = parseCalendarDate(raw, 'date');
    return new Date(Date.UTC(part.y, part.m - 1, part.d, 0, 0, 0));
  }
  const [, year, month, day, hour, minute, second = '0', fraction = '', zone = ''] = isoMatch;
  const millis = fraction ? Number(String(fraction).padEnd(3, '0').slice(0, 3)) : 0;
  for (const [name, text, min, max] of [['month', month, 1, 12], ['day', day, 1, 31], ['hour', hour, 0, 23], ['minute', minute, 0, 59], ['second', second, 0, 60]]) {
    const number = Number(text);
    if (number < min || number > max) throw new Error('The ' + name + ' "' + text + '" is outside ' + min + ' to ' + max + '.');
  }
  const dayLimit = daysInMonth(Number(year), Number(month));
  if (Number(day) > dayLimit) throw new Error('That month has ' + dayLimit + ' days, so ' + raw + ' is not a real date.');
  if (zone === 'Z' || zone === 'z') {
    return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, millis));
  }
  if (zone) {
    const sign = zone[0] === '-' ? -1 : 1;
    const offset = zone.slice(1).replace(':', '');
    const offsetMinutes = sign * (Number(offset.slice(0, 2)) * 60 + Number(offset.slice(2, 4)));
    return new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute - offsetMinutes, +second, millis));
  }
  return useLocal
    ? new Date(+year, +month - 1, +day, +hour, +minute, +second, millis)
    : new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute, +second, millis));
}

/**
 * Cryptographically secure sampling with rejection, so every character of the alphabet is equally
 * likely. A modulo-only implementation would make the first 256 % len characters slightly more
 * common, which is a real (if small) weakness in a secret generator.
 */
function secureToken(alphabet, length) {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('This browser exposes no cryptographic random source, so no secret was generated. A predictable fallback would be worse than no result.');
  }
  const limit = Math.floor(256 / alphabet.length) * alphabet.length;
  const out = [];
  let guard = 0;
  while (out.length < length) {
    if (++guard > 1000) throw new Error('Could not fill the requested length from the random source.');
    const bytes = crypto.getRandomValues(new Uint8Array(Math.max(64, (length - out.length) * 2)));
    for (const byte of bytes) {
      if (byte >= limit) continue;
      out.push(alphabet[byte % alphabet.length]);
      if (out.length === length) break;
    }
  }
  return out.join('');
}

function secureBytes(count) {
  if (typeof crypto === 'undefined' || typeof crypto.getRandomValues !== 'function') {
    throw new Error('This browser exposes no cryptographic random source, so nothing was generated.');
  }
  return crypto.getRandomValues(new Uint8Array(count));
}

async function digestBytes(algorithm, bytes) {
  if (algorithm === 'md5') return md5Bytes(bytes);
  const names = { sha256: 'SHA-256', sha384: 'SHA-384', sha512: 'SHA-512', sha1: 'SHA-1' };
  if (!(algorithm in names)) throw new Error('Unsupported algorithm "' + algorithm + '".');
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('This browser has no Web Crypto API (crypto.subtle). It is required for ' + names[algorithm] + ' and is only available on a secure (https) or localhost origin.');
  }
  const digest = await crypto.subtle.digest(names[algorithm], bytes);
  return new Uint8Array(digest);
}

function toBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

/* ---------------------------------------------------------------------------------------------- *
 * PNG encoding
 *
 * The QR symbol is drawn by hand into a PNG rather than through a <canvas>, because a canvas needs
 * a document. Drawing the pixels directly keeps the generator usable headless, keeps the output
 * byte-identical on every browser, and means the tool never depends on a DOM being present.
 * --------------------------------------------------------------------------------------------- */
let CRC32_TABLE = null;

function crc32(bytes) {
  if (!CRC32_TABLE) {
    CRC32_TABLE = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      CRC32_TABLE[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  bytes.forEach((byte) => { crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8); });
  return (crc ^ 0xffffffff) >>> 0;
}

function adler32(bytes) {
  let a = 1;
  let b = 0;
  bytes.forEach((byte) => { a = (a + byte) % 65521; b = (b + a) % 65521; });
  return ((b << 16) | a) >>> 0;
}

/** A zlib stream of stored (uncompressed) blocks, used when CompressionStream is unavailable. */
function storeDeflate(raw) {
  const chunks = [];
  const header = new Uint8Array([0x78, 0x01]);
  chunks.push(header);
  for (let offset = 0; offset < raw.length; offset += 65535) {
    const block = raw.subarray(offset, offset + 65535);
    const last = offset + 65535 >= raw.length;
    const head = new Uint8Array(5);
    head[0] = last ? 0x01 : 0x00;
    head[1] = block.length & 0xff;
    head[2] = (block.length >>> 8) & 0xff;
    head[3] = ~block.length & 0xff;
    head[4] = (~block.length >>> 8) & 0xff;
    chunks.push(head, block);
  }
  if (!raw.length) chunks.push(new Uint8Array([0x01, 0x00, 0x00, 0xff, 0xff]));
  const tail = new Uint8Array(4);
  new DataView(tail.buffer).setUint32(0, adler32(raw), false);
  chunks.push(tail);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  chunks.forEach((chunk) => { out.set(chunk, at); at += chunk.length; });
  return out;
}

async function zlibCompress(raw) {
  if (typeof CompressionStream !== 'undefined') {
    const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return storeDeflate(raw);
}

function pngChunk(type, payload) {
  const length = new Uint8Array(4);
  new DataView(length.buffer).setUint32(0, payload.length, false);
  // 4 bytes of length, 4 of type, the payload, 4 of CRC.
  const body = new Uint8Array(12 + payload.length);
  body.set(length, 0);
  for (let i = 0; i < 4; i += 1) body[4 + i] = type.charCodeAt(i);
  body.set(payload, 8);
  const crc = crc32(body.subarray(4, 8 + payload.length));
  new DataView(body.buffer).setUint32(8 + payload.length, crc, false);
  return body;
}

/**
 * Render a square module matrix as a greyscale PNG. Each module becomes `scale` device pixels and
 * `margin` modules of quiet zone are added on every side, which is what a scanner needs.
 */
async function pngFromMatrix(matrix, scale, margin) {
  const size = matrix.size;
  const total = (size + margin * 2) * scale;
  // One filter byte per scanline, then one byte per pixel (8-bit greyscale, colour type 0).
  const raw = new Uint8Array((total + 1) * total);
  for (let y = 0; y < total; y += 1) {
    const rowStart = y * (total + 1);
    raw[rowStart] = 0;
    const moduleRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < total; x += 1) {
      const moduleColumn = Math.floor(x / scale) - margin;
      const dark = moduleRow >= 0 && moduleRow < size && moduleColumn >= 0 && moduleColumn < size
        && matrix.data[moduleRow * size + moduleColumn] === 1;
      raw[rowStart + 1 + x] = dark ? 0x00 : 0xff;
    }
  }
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, total, false);
  view.setUint32(4, total, false);
  ihdr[8] = 8;   // bit depth
  ihdr[9] = 0;   // colour type: greyscale
  ihdr[10] = 0;  // compression
  ihdr[11] = 0;  // filter
  ihdr[12] = 0;  // interlace
  const idat = await zlibCompress(raw);
  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', idat),
    pngChunk('IEND', new Uint8Array(0)),
  ];
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  parts.forEach((part) => { out.set(part, at); at += part.length; });
  return out;
}

/**
 * Locate the first structural error in a JSON document.
 *
 * `JSON.parse` only says "Unexpected token". A formatter has to say where, so this walks the
 * grammar and reports the offset. It is only used to explain a document that JSON.parse has
 * already rejected — the parsed value always comes from JSON.parse, never from here.
 */
function jsonScan(value) {
  let index = 0;
  const skipWhitespace = () => { while (index < value.length && ' \t\n\r'.includes(value[index])) index += 1; };
  const at = (offset = 0) => value[index + offset];
  const error = (message) => ({ ok: false, index, message });
  const keyword = (word) => {
    if (value.startsWith(word, index)) { index += word.length; return null; }
    return error('expected "' + word + '"');
  };
  const string = () => {
    if (at() === "'") return error('JSON uses double quotes for strings, not single quotes');
    if (at() !== '"') return error('expected a string');
    index += 1;
    while (index < value.length) {
      const char = value[index];
      if (char === '"') { index += 1; return null; }
      if (char === '\\') {
        const escape = at(1);
        if ('"\\/bfnrt'.includes(escape)) { index += 2; continue; }
        if (escape === 'u') {
          if (!/^[0-9a-fA-F]{4}$/.test(value.slice(index + 2, index + 6))) return error('a \\u escape needs exactly four hexadecimal digits');
          index += 6;
          continue;
        }
        return error('"' + String(escape) + '" is not a valid escape after a backslash');
      }
      if (char.charCodeAt(0) < 0x20) return error('a control character cannot appear inside a string');
      index += 1;
    }
    return error('the string is not closed');
  };
  const number = () => {
    const start = index;
    if (at() === '-') index += 1;
    if (at() === '0') index += 1;
    else if (at() >= '1' && at() <= '9') { while (at() >= '0' && at() <= '9') index += 1; }
    else return error('expected a number');
    if (at() === '.') {
      index += 1;
      if (!(at() >= '0' && at() <= '9')) return error('a decimal point must be followed by a digit');
      while (at() >= '0' && at() <= '9') index += 1;
    }
    if (at() === 'e' || at() === 'E') {
      index += 1;
      if (at() === '+' || at() === '-') index += 1;
      if (!(at() >= '0' && at() <= '9')) return error('an exponent must be followed by a digit');
      while (at() >= '0' && at() <= '9') index += 1;
    }
    return index > start ? null : error('expected a number');
  };
  const read = () => {
    skipWhitespace();
    const char = at();
    if (char === undefined) return error('the document ends where a value was expected');
    if (char === '"') return string();
    if (char === '{') {
      index += 1;
      skipWhitespace();
      if (at() === '}') { index += 1; return null; }
      for (;;) {
        skipWhitespace();
        const key = string();
        if (key) return key;
        skipWhitespace();
        if (at() !== ':') return error('expected ":" after the property name');
        index += 1;
        const found = read();
        if (found) return found;
        skipWhitespace();
        if (at() === ',') { index += 1; continue; }
        if (at() === '}') { index += 1; return null; }
        return error(at() === undefined ? 'the object is not closed' : 'expected "," or "}" between properties');
      }
    }
    if (char === '[') {
      index += 1;
      skipWhitespace();
      if (at() === ']') { index += 1; return null; }
      for (;;) {
        const found = read();
        if (found) return found;
        skipWhitespace();
        if (at() === ',') { index += 1; continue; }
        if (at() === ']') { index += 1; return null; }
        return error(at() === undefined ? 'the array is not closed' : 'expected "," or "]" between items');
      }
    }
    if (char === 't') return keyword('true');
    if (char === 'f') return keyword('false');
    if (char === 'n') return keyword('null');
    if (char === '-' || (char >= '0' && char <= '9')) return number();
    if (char === "'") return error("JSON strings use double quotes, not single quotes");
    return error('"' + char + '" cannot start a JSON value');
  };
  const found = read();
  if (found) return found;
  skipWhitespace();
  if (index < value.length) return error('nothing may follow the top-level value');
  return { ok: true, index: value.length, message: '' };
}

/**
 * Turn a rejected document into "Invalid JSON (line 4, column 8): ...".
 * The scanner supplies the position and the reason; JSON.parse has already decided the document is
 * invalid, so nothing here can accept a document the engine rejects.
 */
function jsonErrorMessage(value) {
  const scan = jsonScan(value);
  const before = value.slice(0, scan.index);
  const line = before.split('\n').length;
  const lineStart = before.lastIndexOf('\n') + 1;
  const column = scan.index - lineStart + 1;
  const fragment = value.slice(Math.max(0, scan.index - 24), scan.index + 24).replace(/\s+/g, ' ').trim();
  return 'Invalid JSON (line ' + line + ', column ' + column + '): ' + scan.message
    + (fragment ? '. Near "' + fragment + '".' : '.')
    + ' Fix that and run it again — nothing is changed automatically.';
}

function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array (' + value.length + ' items)';
  return typeof value;
}

/**
 * JSON.parse silently loses precision on integers beyond Number.MAX_SAFE_INTEGER. The formatted
 * output would then differ from the input, so the tool says so instead of pretending the round trip
 * was exact.
 */
function jsonPrecisionWarnings(value) {
  const warnings = [];
  const pattern = /:\s*(-?\d{16,})(?=[\s,}\]])/g;
  let match;
  let count = 0;
  while ((match = pattern.exec(value)) !== null && count < 3) {
    const digits = match[1].replace('-', '');
    if (Number(digits) > Number.MAX_SAFE_INTEGER) {
      warnings.push('The number ' + match[1] + ' exceeds 2^53-1. JSON.parse reads it as a double, so the formatted output may differ from the input in its last digits.');
      count += 1;
    }
  }
  return warnings;
}

// --- Security-header, password-policy and DNS configuration writers ------------------------------
//
// These produce configuration text from values the visitor supplied. They never invent a value: an
// empty input produces no directive, and a malformed one is reported instead of being repaired
// silently.

function buildSecurityHeaders(input) {
  const headers = [];
  const csp = String(input.csp || 'strict');
  if (csp === 'strict') {
    headers.push({
      name: 'Content-Security-Policy',
      value: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'; upgrade-insecure-requests",
      note: 'Blocks inline script and inline style. Test on staging; start with Content-Security-Policy-Report-Only if you are unsure.',
    });
  } else if (csp === 'balanced') {
    headers.push({
      name: 'Content-Security-Policy',
      value: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
      note: "Allows inline style attributes, which most themes still emit. 'unsafe-inline' on style-src is a known weakening; remove it once the stylesheet is external.",
    });
  }
  const hsts = String(input.hsts || 'oneyear');
  if (hsts === 'oneyear') {
    headers.push({ name: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload', note: 'Preload submission is effectively irreversible for months.' });
  } else if (hsts === 'sixmonths') {
    headers.push({ name: 'Strict-Transport-Security', value: 'max-age=15552000; includeSubDomains', note: 'A safer first step before preload.' });
  }
  headers.push({ name: 'X-Content-Type-Options', value: 'nosniff', note: 'Stops MIME-type sniffing. There is no reason to omit it.' });
  const frame = String(input.frame || 'deny');
  if (frame === 'deny') {
    headers.push({ name: 'X-Frame-Options', value: 'DENY', note: 'Legacy framing protection for clients that ignore CSP frame-ancestors.' });
  } else if (frame === 'sameorigin') {
    headers.push({ name: 'X-Frame-Options', value: 'SAMEORIGIN', note: 'Allows your own pages to embed this one.' });
  }
  headers.push({
    name: 'Referrer-Policy',
    value: ['no-referrer', 'strict-origin-when-cross-origin', 'same-origin'].includes(String(input.referrerpolicy)) ? String(input.referrerpolicy) : 'strict-origin-when-cross-origin',
    note: 'Limits how much URL detail leaves your origin.',
  });
  if (String(input.permissions) !== 'off') {
    headers.push({
      name: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()',
      note: 'Denies sensitive browser features to this page and its embeds. Add a self origin, e.g. camera=(self), if the application needs one.',
    });
  }
  headers.push({ name: 'Cross-Origin-Opener-Policy', value: 'same-origin', note: 'Isolates the browsing context group.' });
  headers.push({ name: 'Cross-Origin-Resource-Policy', value: 'same-origin', note: 'Set to cross-origin for assets you intend other origins to load.' });
  headers.push({ name: 'Cross-Origin-Embedder-Policy', value: 'unsafe-none', note: 'Left permissive on purpose: require-corp breaks third-party embeds unless every resource opts in.' });
  if (String(input.cookies) !== 'no') {
    headers.push({ name: 'Set-Cookie (guidance, not a header to paste)', value: 'Secure; HttpOnly; SameSite=Lax; Path=/', note: 'Apply these attributes where your application sets cookies. SameSite=Strict breaks links in from email; None requires Secure.' });
  }
  return headers;
}

function renderSecurityHeaders(headers, format) {
  const real = headers.filter((header) => !header.name.includes('(guidance'));
  if (format === 'nginx') {
    return real.map((header) => 'add_header ' + header.name + ' "' + header.value + '" always;').join('\n')
      + '\n\n# Review before deploying. `always` sends the header on error responses too.\n'
      + real.map((header) => '# ' + header.name + ': ' + header.note).join('\n');
  }
  if (format === 'apache') {
    return '<IfModule mod_headers.c>\n'
      + real.map((header) => '    Header always set ' + header.name + ' "' + header.value + '"').join('\n')
      + '\n</IfModule>\n\n# Review before deploying.\n'
      + real.map((header) => '# ' + header.name + ': ' + header.note).join('\n');
  }
  if (format === 'caddy') {
    return 'header {\n'
      + real.map((header) => '    ' + header.name + ' "' + header.value + '"').join('\n')
      + '\n}\n\n# Review before deploying.\n'
      + real.map((header) => '# ' + header.name + ': ' + header.note).join('\n');
  }
  if (format === 'cloudflare') {
    return real.map((header) => 'http.response.headers["' + header.name + '"] = "' + header.value + '"').join('\n')
      + '\n\n# Transform Rule → Modify response header. One expression per header, or combine with commas.\n'
      + real.map((header) => '# ' + header.name + ': ' + header.note).join('\n');
  }
  return real.map((header) => header.name + ': ' + header.value).join('\n')
    + '\n\n' + real.map((header) => '# ' + header.name + ': ' + header.note).join('\n');
}

function buildPasswordPolicy(input) {
  // The fourth argument is the documented default, so an omitted control falls back to it instead
  // of producing an out-of-range error about a field the visitor never touched.
  const minLength = num(input.minLength, 6, 128, 14);
  const mfa = ['required', 'privileged', 'optional'].includes(String(input.mfa)) ? String(input.mfa) : 'required';
  const lockoutThreshold = num(input.lockoutThreshold, 0, 100, 5);
  const lockoutMinutes = num(input.lockoutMinutes, 1, 10080, 15);
  const history = num(input.history, 0, 24, 5);
  const maxAgeDays = num(input.maxAgeDays, 0, 3650, 0);
  const sessionMinutes = num(input.sessionMinutes, 1, 1440, 30);
  const breachCheck = String(input.breachCheck) !== 'no';
  const complexity = String(input.complexity) === 'classes' ? 'classes' : 'length';
  const storage = ['argon2', 'scrypt', 'pbkdf2'].includes(String(input.storage)) ? String(input.storage) : 'argon2';

  const mfaLabel = mfa === 'required' ? 'Required for every account' : mfa === 'privileged' ? 'Required for privileged accounts only' : 'Recommended, not enforced';
  const lockoutLabel = lockoutThreshold === 0
    ? 'No lockout. Rate limiting at the authentication endpoint is the control instead.'
    : lockoutThreshold + ' consecutive failures, then ' + lockoutMinutes + ' minutes locked';
  const historyLabel = history === 0 ? 'No reuse history kept' : 'The last ' + history + ' password' + (history === 1 ? '' : 's') + ' cannot be reused';
  const maxAgeLabel = maxAgeDays === 0 ? 'No scheduled expiry' : maxAgeDays + ' days';
  const storageLabel = storage === 'argon2' ? 'Argon2id (memory-hard)' : storage === 'scrypt' ? 'scrypt (memory-hard)' : 'PBKDF2-SHA-256 with a high iteration count';

  const composition = complexity === 'length'
    ? 'Length is the primary requirement. Forced upper/lower/digit/symbol composition is not required, because it pushes people towards predictable substitutions (Password1!). A screened, long passphrase is stronger than a short composed one.'
    : 'At least one uppercase letter, one lowercase letter, one digit and one symbol are required in addition to the minimum length.';

  const document = [
    '# Password and Authentication Policy',
    '',
    'Status: draft for review. Generated by the CloudHost247 Password Policy Generator from the controls selected by the author. This document records intent; it does not configure any system and does not evidence enforcement.',
    '',
    '## 1. Password construction',
    '- Minimum length: ' + minLength + ' characters.',
    '- Maximum length: at least 128 characters must be accepted. Rejecting long passphrases is a defect, not a control.',
    '- Composition: ' + composition,
    '- Screened passwords: ' + (breachCheck
      ? 'new passwords are checked against known breached-password lists and rejected on a match.'
      : 'not screened. Without screening, length is the only barrier against a guessed or leaked password.'),
    '- No password hints, security questions or knowledge-based answers.',
    '',
    '## 2. Multi-factor authentication',
    '- ' + mfaLabel + '.',
    '- Phishing-resistant factors (WebAuthn/passkeys or FIDO2 security keys) are preferred over SMS one-time codes, which are redirectable.',
    '- Recovery paths are rate limited and logged. A recovery flow that bypasses MFA is an MFA bypass.',
    '',
    '## 3. Lockout and rate limiting',
    '- ' + lockoutLabel + '.',
    '- Authentication endpoints are rate limited per account and per source address, so a distributed attempt against one account is still throttled.',
    '- Lockout events are logged with the account, the time and the source, and are alertable.',
    '',
    '## 4. Reuse and rotation',
    '- Password history: ' + historyLabel + '.',
    '- Maximum password age: ' + maxAgeLabel + (maxAgeDays === 0
      ? '. Scheduled expiry is not required when passwords are long and screened; forced rotation produces weaker, patterned passwords.'
      : '. Rotation is scheduled.'),
    '- Immediate reset is required on evidence of compromise, on a breached-password match, and on any suspected credential leak.',
    '',
    '## 5. Sessions',
    '- Idle session timeout: ' + sessionMinutes + ' minutes.',
    '- Session identifiers come from a cryptographic random source, are at least 128 bits, and are rotated on privilege change and on login.',
    '- Session cookies are Secure, HttpOnly and SameSite=Lax at minimum.',
    '- Users can list and revoke their own active sessions.',
    '',
    '## 6. Storage',
    '- Passwords are stored with ' + storageLabel + ', per user, with a unique salt.',
    '- Plaintext and reversibly encrypted passwords are prohibited. So are unsalted fast hashes (MD5, SHA-1, SHA-256 without a KDF).',
    '- Verifiers are never written to logs, error messages, analytics or URLs.',
    '',
    '## 7. Verification',
    '- Enforcement is tested, not assumed: the controls above are exercised by an automated check in the release pipeline.',
    '- This policy is reviewed at least annually, and after any authentication change or incident.',
    '',
    'Scope: generation of a policy document. It is not a certification, not a security assessment, and not evidence that any control is in force.',
  ].join('\n');

  return { minLength, mfaLabel, lockoutLabel, historyLabel, maxAgeLabel, sessionMinutes, storageLabel, document };
}

const DNS_NAME = /^(?=.{1,253}$)@?$|^(?=.{1,253}$)(?:[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.?)+$/;

function isIpv4(value) {
  const parts = String(value).split('.');
  if (parts.length !== 4) return false;
  return parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && String(Number(part)) === part);
}

function isIpv6(value) {
  // A real RFC 4291 parser rather than a shape test: a wrong "valid" publishes a record that will
  // not resolve, and a wrong "invalid" refuses an address the operator knows is correct.
  const text = String(value || '').trim();
  if (!text || text.length > 45) return false;
  if (!/^[0-9A-Fa-f:.]+$/.test(text)) return false;
  if (!text.includes(':')) return false;
  const halves = text.split('::');
  if (halves.length > 2) return false;
  const parseGroup = (group) => {
    if (!/^[0-9A-Fa-f]{1,4}$/.test(group)) return -1;
    return Number.parseInt(group, 16);
  };
  const expand = (side) => {
    if (!side) return [];
    const groups = side.split(':');
    // A trailing IPv4 literal stands in for the last two 16-bit groups.
    if (groups[groups.length - 1].includes('.')) {
      const v4 = groups.pop();
      if (!isIpv4(v4)) return null;
      const parts = v4.split('.').map(Number);
      groups.push(((parts[0] << 8) | parts[1]).toString(16), ((parts[2] << 8) | parts[3]).toString(16));
    }
    return groups.every((group) => /^[0-9A-Fa-f]{1,4}$/.test(group)) ? groups : null;
  };
  if (halves.length === 2) {
    const head = expand(halves[0]);
    const tail = expand(halves[1]);
    if (!head || !tail) return false;
    if (head.length + tail.length > 7) return false; // "::" must stand for at least one group
    return true;
  }
  const groups = expand(text);
  return groups !== null && groups.length === 8;
}

function dnsHostname(value, label) {
  const name = String(value || '').trim().replace(/\.$/, '');
  if (!name) throw new Error('Enter the ' + label + '.');
  if (isIpv4(name) || isIpv6(name)) throw new Error('The ' + label + ' "' + name + '" is an address. It must be a hostname.');
  if (!/^(?=.{1,253}$)([A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?\.)+[A-Za-z]{2,}$/.test(name + (name.includes('.') ? '' : '.invalid'))) {
    if (!/^[A-Za-z0-9_](?:[A-Za-z0-9_-]{0,61}[A-Za-z0-9_])?$/.test(name)) {
      throw new Error('The ' + label + ' "' + name + '" is not a valid hostname. Use letters, digits, hyphens and underscores in dot-separated labels.');
    }
  }
  return name;
}

function buildDnsRecords(input) {
  const domain = dnsHostname(must(input.domain, 'domain'), 'domain').toLowerCase();
  const ttl = num(input.defaultTtl, 60, 86400);
  const records = [];
  const warnings = [];

  const lines = (value) => String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const names = new Set();
  const addRecord = (name, type, value, extra) => {
    if (type === 'CNAME' && names.has(name)) {
      warnings.push('Skipped the CNAME at "' + name + '": a CNAME cannot coexist with another record at the same name.');
      return;
    }
    if (type !== 'CNAME') names.add(name);
    records.push(Object.assign({ name, type, ttl, value }, extra || {}));
  };

  lines(input.aRecords).forEach((line) => {
    const [name, value] = splitPair(line, 'A');
    if (!isIpv4(value)) throw new Error('A record "' + line + '": "' + value + '" is not an IPv4 address.');
    addRecord(name, 'A', value);
  });
  lines(input.aaaaRecords).forEach((line) => {
    const [name, value] = splitPair(line, 'AAAA');
    if (!isIpv6(value)) throw new Error('AAAA record "' + line + '": "' + value + '" is not an IPv6 address in a form this tool will publish. Use a plain colon-hex address.');
    addRecord(name, 'AAAA', value.toLowerCase());
  });
  lines(input.cnameRecords).forEach((line) => {
    const [name, value] = splitPair(line, 'CNAME');
    addRecord(name, 'CNAME', dnsHostname(value, 'CNAME target') + '.');
  });
  lines(input.mxRecords).forEach((line) => {
    const match = line.match(/^(\d{1,5})\s+(.+)$/);
    if (!match) throw new Error('MX record "' + line + '": use "priority hostname", for example "10 mail.example.com.".');
    const priority = Number(match[1]);
    if (priority > 65535) throw new Error('MX record "' + line + '": the priority must be 0 to 65535.');
    const host = match[2].trim();
    if (isIpv4(host) || isIpv6(host)) throw new Error('MX record "' + line + '": the target must be a hostname, not an address literal.');
    addRecord('@', 'MX', priority + ' ' + dnsHostname(host, 'MX target') + '.', { priority });
  });
  lines(input.txtRecords).forEach((line) => {
    const [name, value] = splitPair(line, 'TXT');
    addRecord(name, 'TXT', '"' + value.replace(/"/g, '\\"') + '"');
  });

  const spfIncludes = String(input.spfIncludes || '').split(/[\s,]+/).filter(Boolean);
  const spfPolicy = ['-all', '~all', '?all'].includes(String(input.spfPolicy)) ? String(input.spfPolicy) : '-all';
  if (spfIncludes.length) {
    spfIncludes.forEach((host) => dnsHostname(host, 'SPF include host'));
    const dnsLookups = spfIncludes.length;
    const value = ['v=spf1'].concat(spfIncludes.map((host) => 'include:' + host), [spfPolicy]).join(' ');
    if (value.length > 255) warnings.push('The SPF record is ' + value.length + ' characters. A single TXT string is limited to 255; split it into adjacent quoted strings or move includes behind one flattening host.');
    if (dnsLookups > 10) warnings.push('SPF allows at most 10 DNS lookups per check. The includes listed here start at ' + dnsLookups + ', and nested includes add more — a policy that exceeds the limit returns permerror.');
    addRecord('@', 'TXT', '"' + value + '"');
  }

  const dmarcPolicy = ['none', 'quarantine', 'reject'].includes(String(input.dmarcPolicy)) ? String(input.dmarcPolicy) : 'none';
  if (input.dmarcRua || dmarcPolicy !== 'none') {
    let value = 'v=DMARC1; p=' + dmarcPolicy;
    if (input.dmarcRua) {
      const rua = String(input.dmarcRua).trim();
      if (!/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(rua)) throw new Error('The DMARC report address "' + rua + '" is not an email address.');
      value += '; rua=mailto:' + rua;
    }
    if (dmarcPolicy === 'none') warnings.push('p=none is monitoring only: it changes nothing about delivery. Move to quarantine or reject once the reports are clean.');
    addRecord('_dmarc', 'TXT', '"' + value + '"');
  }

  const dkimSelector = String(input.dkimSelector || '').trim();
  const dkimKey = String(input.dkimPublicKey || '').replace(/\s+/g, '');
  if (dkimSelector || dkimKey) {
    if (!dkimSelector) throw new Error('Enter the DKIM selector, or leave both DKIM fields empty. A selector cannot be guessed.');
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,62}$/.test(dkimSelector)) throw new Error('The DKIM selector "' + dkimSelector + '" is not valid. Use letters, digits, hyphens and underscores.');
    if (!dkimKey) throw new Error('Enter the DKIM public key (the p= value), or leave both DKIM fields empty. A key is never invented.');
    if (!/^[A-Za-z0-9+/=]+$/.test(dkimKey)) throw new Error('The DKIM public key must be base64. Characters outside A–Z a–z 0–9 + / = were found.');
    if (dkimKey.replace(/=+$/, '').length % 4 === 1) throw new Error('The DKIM public key is not a valid base64 length.');
    addRecord(dkimSelector + '._domainkey', 'TXT', '"v=DKIM1; k=rsa; p=' + dkimKey + '"');
  }

  if (!records.length) {
    warnings.push('No records were produced: every field was empty. Nothing was invented to fill the gap.');
  }
  return { domain, ttl, records, warnings };
}

function splitPair(line, type) {
  const parts = line.split('=');
  if (parts.length < 2) throw new Error(type + ' record "' + line + '": use "name = value".');
  const name = parts[0].trim() || '@';
  const value = parts.slice(1).join('=').trim();
  if (!value) throw new Error(type + ' record "' + line + '": the value is empty.');
  return [name.toLowerCase(), value];
}

function renderDnsRecords(records, format, domain, ttl) {
  if (!records.length) {
    return '; No records were generated. Every input field was empty and this tool does not invent DNS values.';
  }
  if (format === 'json') {
    return JSON.stringify({
      origin: domain + '.',
      defaultTtl: ttl,
      generatedBy: 'CloudHost247 DNS / Domain Configuration Generator',
      records: records.map((record) => ({
        name: record.name, type: record.type, ttl: record.ttl,
        value: record.value.replace(/^"|"$/g, ''),
        ...(record.priority === undefined ? {} : { priority: record.priority }),
      })),
    }, null, 2);
  }
  if (format === 'cloudflare') {
    const rows = ['name,type,content,ttl,proxied,priority'];
    records.forEach((record) => {
      const name = record.name === '@' ? domain + '.' : record.name + '.' + domain + '.';
      const content = record.type === 'MX' ? record.value.split(' ')[1] : record.value.replace(/^"|"$/g, '');
      const priority = record.priority === undefined ? '' : record.priority;
      rows.push([csvField(name), record.type, csvField(content), record.ttl, 'false', priority].join(','));
    });
    return rows.join('\n');
  }
  const header = [
    '$ORIGIN ' + domain + '.',
    '$TTL ' + ttl,
    '; Generated by the CloudHost247 DNS / Domain Configuration Generator.',
    '; Review before publishing. Nothing here was queried or verified against live DNS.',
    '',
  ];
  const width = Math.max(...records.map((record) => record.name.length), 8);
  return header.concat(records.map((record) => record.name.padEnd(width) + '  ' + record.ttl + '  IN  ' + record.type.padEnd(5) + '  ' + record.value)).join('\n');
}

function csvField(value) {
  return /[",\n]/.test(value) ? '"' + value.replace(/"/g, '""') + '"' : value;
}

/** Uniform index in [0, count) from the CSPRNG, with rejection so no index is favoured. */
function secureIndex(count) {
  if (count <= 0) throw new Error('Cannot pick from an empty set.');
  if (count === 1) return 0;
  const bytesNeeded = count > 65536 ? 4 : count > 256 ? 2 : 1;
  const limit = Math.floor((256 ** bytesNeeded) / count) * count;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const bytes = secureBytes(bytesNeeded);
    let value = 0;
    bytes.forEach((byte) => { value = value * 256 + byte; });
    if (value < limit) return value % count;
  }
  throw new Error('The cryptographic random source did not produce a usable index.');
}

/** Fisher-Yates with CSPRNG indices, so the guaranteed one-of-each-class characters are not positional. */
function shuffle(items) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = secureIndex(i + 1);
    const swap = out[i];
    out[i] = out[j];
    out[j] = swap;
  }
  return out;
}

const NIL_UUID = '00000000-0000-0000-0000-000000000000';

/** RFC 9562 v4: 122 random bits with the version and variant bits overwritten. */
function uuidv4() {
  const bytes = secureBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

/** RFC 9562 v7: 48-bit Unix millisecond timestamp, then random bits with the version and variant set. */
function uuidv7() {
  const bytes = secureBytes(16);
  const millis = Date.now();
  // 48-bit big-endian Unix milliseconds. Splitting on 2**8 per byte keeps every bit of a
  // timestamp that is already larger than 2**40, which a 16-bit split silently truncates.
  for (let index = 0; index < 6; index += 1) {
    bytes[index] = Math.floor(millis / 2 ** (8 * (5 - index))) % 256;
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

function uuidFromBytes(bytes) {
  const parts = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'));
  return parts.slice(0, 4).join('') + '-' + parts.slice(4, 6).join('') + '-' + parts.slice(6, 8).join('')
    + '-' + parts.slice(8, 10).join('') + '-' + parts.slice(10, 16).join('');
}

function formatUuid(value, format) {
  if (format === 'hex') return value.replace(/-/g, '');
  if (format === 'braces') return '{' + value + '}';
  if (format === 'urn') return 'urn:uuid:' + value;
  if (format === 'upper') return value.toUpperCase();
  return value;
}
