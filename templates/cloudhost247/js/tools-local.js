/** Browser-only tools. Nothing in this module contacts the network. */
import QRCode from './vendor/qrcode.mjs';

const TONES = [
  ['Harbor', 16, 30, 44], ['Mint Signal', 180, 242, 205], ['Kelp', 25, 105, 71], ['Fog', 244, 247, 247],
  ['Copper', 176, 122, 78], ['Slate', 85, 101, 112], ['Tide', 38, 103, 88], ['Paper', 255, 255, 255],
  ['Night', 8, 18, 26], ['Lagoon', 46, 140, 126], ['Sand', 232, 214, 184], ['Signal Red', 176, 64, 48],
  ['Amber', 214, 164, 64], ['Iris', 92, 104, 168], ['Graphite', 52, 64, 74], ['Foam', 214, 236, 226],
];

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
    if (input.op === 'decode') {
      const binary = atob(value.replace(/\s/g, ''));
      const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
      return ok('Decoded', [{ Text: new TextDecoder().decode(bytes) }], ['Invalid Base64 throws instead of returning a guess.']);
    }
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return ok('Encoded', [{ Base64: btoa(binary) }]);
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
    const length = num(input.length, 12, 64);
    const symbols = input.symbols !== 'no';
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789' + (symbols ? '!@$%*?-_' : '');
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    let password = '';
    bytes.forEach((byte) => { password += alphabet[byte % alphabet.length]; });
    return ok('Generated in this browser', [{ Password: password, Length: length }], ['Copy it now. It is not saved.']);
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
    const value = text(input).slice(0, 800);
    const dataUrl = await QRCode.toDataURL(value, { margin: 2, width: 280, errorCorrectionLevel: 'M' });
    return ok('QR code ready', [{ Preview: dataUrl, Characters: value.length }], ['Download from the preview. The text was not uploaded.']);
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
    const lines = ['User-agent: ' + (input.agent || '*')];
    String(input.disallow || '').split(/\n/).map((line) => line.trim()).filter(Boolean).forEach((line) => lines.push('Disallow: ' + line));
    if (input.sitemap) lines.push('Sitemap: ' + input.sitemap);
    return ok('robots.txt draft', [{ File: lines.join('\n') }], ['Publish the file yourself after review.']);
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
    const count = num(input.count, 1, 20);
    const rows = [];
    for (let i = 0; i < count; i++) rows.push({ UUID: crypto.randomUUID() });
    return ok(count + ' UUID' + (count > 1 ? 's' : ''), rows);
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
};

const OUI = {
  '00000C': 'Cisco (sample)', '001A11': 'Google (sample)', '3C22FB': 'Apple (sample)', 'F4F5E8': 'Apple (sample)',
  '00163E': 'Xensource (sample)', '525400': 'QEMU/KVM locally common (sample)', '000C29': 'VMware (sample)',
  'B827EB': 'Raspberry Pi (sample)', 'DCA632': 'Raspberry Pi (sample)', '001B63': 'Apple (sample)',
  '180373': 'Dell (sample)', '0026B9': 'Dell (sample)', '000D3A': 'Microsoft (sample)', '7C2F80': 'Intel (sample)',
};

function ok(summary, rows, notes = []) { return { ok: true, summary, rows, notes, error: null, checkedAt: new Date().toISOString() }; }
function fail(error) { return { ok: false, summary: '', rows: [], notes: [], error }; }
function text(input) { return String(input.text ?? input.target ?? ''); }
function must(value, label) { if (!value) throw new Error('Enter a ' + label + '.'); return String(value); }
function num(value, min, max) { const n = Number(value); if (!Number.isFinite(n) || n < min || n > max) throw new Error('Enter a number from ' + min + ' to ' + max + '.'); return Math.round(n); }
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

function md5(value) {
  const bytes = Array.from(new TextEncoder().encode(value));
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
  return [a0, b0, c0, d0].map((word) => { const buf = new ArrayBuffer(4); new DataView(buf).setUint32(0, word, true); return hex(new Uint8Array(buf)); }).join('');
}
