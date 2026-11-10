import { describe, expect, it } from 'vitest';
import {
  CARD_FIELDS,
  CARD_TEMPLATES,
  DEFAULT_CONTACT,
  buildCardDocument,
  buildCardPayload,
  buildMeCard,
  buildVCard,
  cardValues,
  contactDisplayName,
  escapeVCardText,
  findCardTemplate,
  foldVCardLine,
  validateContact,
  type CardContact,
} from '../../src/tools/design-studio/business-cards/model';
import { layoutLabelDocument } from '../../src/tools/design-studio/labels/layout';
import { renderDocumentSvg } from '../../src/tools/design-studio/shared/svg-renderer';
import { decodeSvg } from '../helpers/decode';

const CONTACT: CardContact = {
  ...DEFAULT_CONTACT,
  firstName: 'Ada',
  lastName: 'Obi',
  title: 'Logistics Manager',
  company: 'CloudHost247 Ltd',
  department: 'Operations',
  phone: '+234 800 000 0000',
  mobile: '+234 801 111 1111',
  email: 'ada@cloudhost247.com',
  website: 'https://cloudhost247.com',
  address: '24 Zaria Road',
  city: 'Jos',
  region: 'Plateau',
  postcode: '930101',
  country: 'Nigeria',
  note: 'Ask me about freight.',
};

describe('vCard payload', () => {
  it('is a vCard 3.0 with CRLF line endings', () => {
    const payload = buildVCard(CONTACT);
    expect(payload.value.startsWith('BEGIN:VCARD\r\nVERSION:3.0\r\n')).toBe(true);
    expect(payload.value.endsWith('END:VCARD')).toBe(true);
    expect(payload.value).not.toMatch(/[^\r]\n/);
  });

  it('splits the structured N field as last;first', () => {
    expect(buildVCard(CONTACT).value).toContain('N:Obi;Ada;;;');
    expect(buildVCard(CONTACT).value).toContain('FN:Ada Obi');
  });

  it('carries every value the contact supplied', () => {
    const value = buildVCard(CONTACT).value;
    for (const expected of ['ORG:CloudHost247 Ltd;Operations', 'TITLE:Logistics Manager', 'EMAIL;TYPE=WORK,INTERNET:ada@cloudhost247.com', 'URL:https://cloudhost247.com', 'TEL;TYPE=CELL:+234 801 111 1111', 'NOTE:Ask me about freight.']) {
      expect(value, expected).toContain(expected);
    }
  });

  it('omits blank fields instead of emitting an empty property', () => {
    const value = buildVCard({ ...CONTACT, phone: '', website: '' }).value;
    expect(value).not.toContain('TEL;TYPE=WORK');
    expect(value).not.toContain('URL:');
  });

  it('escapes the separators that would otherwise truncate a field', () => {
    expect(escapeVCardText('Obi, Ada; Ltd')).toBe('Obi\\, Ada\\; Ltd');
    expect(escapeVCardText('line one\nline two')).toBe('line one\\nline two');
    // A literal backslash must survive as a single escaped backslash.
    expect(escapeVCardText('C:\\temp')).toBe('C:\\\\temp');
    const value = buildVCard({ ...CONTACT, company: 'Obi, Ada & Co; Ltd' }).value;
    expect(value).toContain('ORG:Obi\\, Ada & Co\\; Ltd');
  });

  it('folds a long line at 75 characters with a leading space', () => {
    const line = `NOTE:${'x'.repeat(200)}`;
    const folded = foldVCardLine(line);
    const parts = folded.split('\r\n');
    expect(parts[0]).toHaveLength(75);
    for (const continuation of parts.slice(1)) {
      expect(continuation.startsWith(' ')).toBe(true);
      expect(continuation.length).toBeLessThanOrEqual(75);
    }
    // Unfolding removes the CRLF and the single leading space, per RFC 6350 §3.2.
    expect(parts.slice(1).map((part) => part.slice(1)).join('').length + parts[0].length).toBe(line.length);
    expect(parts[0] + parts.slice(1).map((part) => part.slice(1)).join('')).toBe(line);
  });
});

describe('MeCard payload', () => {
  it('uses the MECARD form and terminates with a double semicolon', () => {
    const payload = buildMeCard(CONTACT);
    expect(payload.value.startsWith('MECARD:N:Ada Obi;')).toBe(true);
    expect(payload.value.endsWith(';;')).toBe(true);
  });

  it('reports the fields MeCard cannot carry instead of dropping them silently', () => {
    const payload = buildMeCard(CONTACT);
    expect(payload.unsupported.join(' ')).toContain('Job title');
    expect(payload.unsupported.join(' ')).toContain('Department');
  });

  it('escapes the MeCard separators', () => {
    const payload = buildMeCard({ ...CONTACT, company: 'A; B, C:' });
    expect(payload.value).toContain('ORG:A\\; B\\, C\\:');
  });

  it('is markedly smaller than the vCard', () => {
    expect(buildMeCard(CONTACT).bytes).toBeLessThan(buildVCard(CONTACT).bytes);
  });
});

describe('contact validation', () => {
  it('requires a name', () => {
    expect(validateContact(DEFAULT_CONTACT).some((issue) => issue.field === 'firstName')).toBe(true);
  });

  it('accepts a complete contact', () => {
    expect(validateContact(CONTACT)).toEqual([]);
  });

  it('rejects a malformed email, website and phone', () => {
    const issues = validateContact({ ...CONTACT, email: 'not-an-email', website: 'cloudhost247', phone: 'call me' });
    expect(issues.map((issue) => issue.field)).toEqual(expect.arrayContaining(['email', 'website', 'phone']));
  });

  it('warns about a payload too dense to scan comfortably', () => {
    // The note field caps at 160 characters, so the density warning has to come from the other
    // optional fields filling up — which is exactly the situation a user hits pasting a full address.
    const dense = validateContact({
      ...CONTACT,
      address: 'a'.repeat(120),
      city: 'b'.repeat(60),
      region: 'c'.repeat(60),
      country: 'd'.repeat(60),
      note: 'e'.repeat(160),
      title: 'f'.repeat(80),
    });
    expect(dense.some((issue) => issue.level === 'warn' && issue.field === 'payload')).toBe(true);
  });

  it('builds the display name from whichever half exists', () => {
    expect(contactDisplayName({ ...CONTACT, firstName: '' })).toBe('Obi');
    expect(contactDisplayName({ ...CONTACT, lastName: '' })).toBe('Ada');
  });
});

describe('card templates and layout', () => {
  it('ships eight named templates with real card sizes', () => {
    expect(CARD_TEMPLATES.length).toBeGreaterThanOrEqual(8);
    for (const template of CARD_TEMPLATES) {
      expect(template.sizeMm.width).toBeGreaterThan(40);
      expect(template.sizeMm.height).toBeGreaterThan(40);
      expect(findCardTemplate(template.id)?.id).toBe(template.id);
    }
  });

  /**
   * Both sides of all eight templates must lay out with *no issues at all* — not merely no errors.
   *
   * This test previously asserted errors only, and that is exactly how the classic-white front shipped
   * with its company line hanging 3.5 mm below the page edge: an element that overruns the label is a
   * warning (the overhanging part simply does not print), so "no errors" was true while the printed
   * card cut the bottom off "CloudHost247 Ltd". A template that clips its own text is not shippable,
   * so the assertion is on the whole issue list.
   */
  it('lays out every template and side with no issues at all', () => {
    for (const template of CARD_TEMPLATES) {
      for (const side of ['front', 'back'] as const) {
        const layout = layoutLabelDocument(buildCardDocument(template.id, side, CONTACT)!);
        const issues = layout.issues.filter((issue) => issue.level !== 'info').map((issue) => `${issue.level}: ${issue.message}`);
        expect(issues, `${template.id}/${side}: ${issues.join(' / ')}`).toEqual([]);
      }
    }
  });

  it('keeps every card element inside the page, padding included', () => {
    // Independent of the layout engine's own bounds check: measure the raw element boxes against the
    // card size, so a future template cannot rely on the warning being ignored.
    for (const template of CARD_TEMPLATES) {
      for (const side of ['front', 'back'] as const) {
        const document = buildCardDocument(template.id, side, CONTACT)!;
        const padding = document.style.paddingMm ?? 0;
        for (const element of document.elements) {
          if (element.kind === 'rect' || element.kind === 'line') continue; // decorative full-bleed
          const right = element.x + element.width + padding;
          const bottom = element.y + element.height + padding;
          expect(right, `${template.id}/${side}/${element.id} runs off the right edge`).toBeLessThanOrEqual(document.widthMm + 0.01);
          expect(bottom, `${template.id}/${side}/${element.id} runs off the bottom edge`).toBeLessThanOrEqual(document.heightMm + 0.01);
          expect(element.x, `${template.id}/${side}/${element.id} starts left of the page`).toBeGreaterThanOrEqual(-0.01);
          expect(element.y, `${template.id}/${side}/${element.id} starts above the page`).toBeGreaterThanOrEqual(-0.01);
        }
      }
    }
  });

  it('builds the standard 85 × 55 mm card in the international template', () => {
    const document = buildCardDocument('classic-white', 'front', CONTACT)!;
    expect(document.widthMm).toBe(85);
    expect(document.heightMm).toBe(55);
  });

  it('prints the QR on a white panel even on a dark card', () => {
    const back = buildCardDocument('dark-slate', 'back', CONTACT)!;
    const panel = back.elements.find((element) => element.id === 'qr-panel');
    expect(panel && 'fill' in panel ? panel.fill : undefined).toBe('#ffffff');
  });

  it('returns null for an unknown template', () => {
    expect(buildCardDocument('nope', 'front', CONTACT)).toBeNull();
  });

  it('precomputes the QR payload in the document values', () => {
    const values = cardValues(CONTACT);
    expect(values.qr).toContain('BEGIN:VCARD');
  });

  it('only offers fields with a sane maximum length', () => {
    for (const field of CARD_FIELDS) {
      expect(field.maxLength).toBeGreaterThan(0);
      expect(field.label.length).toBeGreaterThan(2);
    }
  });
});

describe('a printed card QR verifies by decoding', () => {
  it('decodes the back of every template to a valid vCard', async () => {
    for (const template of CARD_TEMPLATES) {
      const document = buildCardDocument(template.id, 'back', CONTACT)!;
      const layout = layoutLabelDocument(document);
      const decoded = await decodeSvg(renderDocumentSvg(layout.document), 2400);
      expect(decoded, template.id).not.toBeNull();
      expect(decoded?.format, template.id).toBe('QRCode');
      // The decoded payload must be a parseable vCard, not just "some text".
      expect(decoded?.text, template.id).toContain('BEGIN:VCARD');
      expect(decoded?.text, template.id).toContain('FN:Ada Obi');
      expect(decoded?.text, template.id).toContain('EMAIL;TYPE=WORK,INTERNET:ada@cloudhost247.com');
      expect(decoded?.text, template.id).toContain('END:VCARD');
    }
  }, 60_000);

  it('decodes a MeCard payload from a card back', async () => {
    const document = buildCardDocument('classic-white', 'back', CONTACT)!;
    document.values.qr = buildMeCard(CONTACT).value;
    const layout = layoutLabelDocument(document);
    const decoded = await decodeSvg(renderDocumentSvg(layout.document), 2400);
    expect(decoded?.text.startsWith('MECARD:N:Ada Obi;')).toBe(true);
  });
});
