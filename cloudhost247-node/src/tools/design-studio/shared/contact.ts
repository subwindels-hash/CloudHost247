/**
 * Contact payloads for 2D codes: vCard 3.0 and MeCard.
 *
 * A phone that scans the code on a business card offers to save a contact only if the payload is a
 * format it recognises, so both builders follow their formats strictly: vCard lines end in CRLF and
 * structured values are escaped per RFC 2426; MeCard escapes its four reserved characters.
 *
 * The Business Tools card generator has a smaller vCard builder (`business/qr-svg.ts`) that takes a
 * single full-name and address string. This one takes the name and address in parts, because the
 * structured `N` and `ADR` properties are what let a phone file the contact under the right surname
 * and open the address in a map.
 */

export interface ContactFields {
  firstName: string;
  lastName: string;
  jobTitle: string;
  organization: string;
  email: string;
  phone: string;
  mobile: string;
  website: string;
  street: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
}

export function emptyContact(): ContactFields {
  return { firstName: '', lastName: '', jobTitle: '', organization: '', email: '', phone: '', mobile: '', website: '', street: '', city: '', region: '', postalCode: '', country: '' };
}

export function fullName(contact: ContactFields): string {
  return [contact.firstName, contact.lastName].filter((part) => part !== '').join(' ');
}

function hasAddress(contact: ContactFields): boolean {
  return [contact.street, contact.city, contact.region, contact.postalCode, contact.country].some((part) => part !== '');
}

/** Escape a vCard text value: backslash, semicolon, comma and line breaks. */
function vcardText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** A vCard 3.0 (RFC 2426). Only properties with a value are written. */
export function buildContactVCard(contact: ContactFields): string {
  const lines = ['BEGIN:VCARD', 'VERSION:3.0', `N:${vcardText(contact.lastName)};${vcardText(contact.firstName)};;;`, `FN:${vcardText(fullName(contact))}`];
  if (contact.organization !== '') lines.push(`ORG:${vcardText(contact.organization)}`);
  if (contact.jobTitle !== '') lines.push(`TITLE:${vcardText(contact.jobTitle)}`);
  if (contact.phone !== '') lines.push(`TEL;TYPE=WORK,VOICE:${vcardText(contact.phone)}`);
  if (contact.mobile !== '') lines.push(`TEL;TYPE=CELL,VOICE:${vcardText(contact.mobile)}`);
  if (contact.email !== '') lines.push(`EMAIL;TYPE=INTERNET:${vcardText(contact.email)}`);
  if (contact.website !== '') lines.push(`URL:${vcardText(contact.website)}`);
  if (hasAddress(contact)) {
    // ADR: post office box; extended address; street; locality; region; postal code; country.
    lines.push(`ADR;TYPE=WORK:;;${[contact.street, contact.city, contact.region, contact.postalCode, contact.country].map(vcardText).join(';')}`);
  }
  lines.push('END:VCARD');
  return lines.join('\r\n');
}

/** Escape a MeCard value: backslash, semicolon, comma and colon. */
function mecardText(value: string): string {
  return value.replace(/([\\;,:])/g, '\\$1').replace(/\r?\n/g, ' ');
}

/**
 * A MeCard. Shorter than a vCard, so the code is coarser and easier to scan, but it has no field
 * for a job title (it goes in the note) and its address is one unstructured line.
 */
export function buildMeCard(contact: ContactFields): string {
  const parts: string[] = [];
  const name = contact.lastName !== '' ? `${mecardText(contact.lastName)},${mecardText(contact.firstName)}` : mecardText(contact.firstName);
  parts.push(`N:${name}`);
  if (contact.organization !== '') parts.push(`ORG:${mecardText(contact.organization)}`);
  if (contact.phone !== '') parts.push(`TEL:${mecardText(contact.phone.replace(/[^\d+]/g, ''))}`);
  if (contact.mobile !== '') parts.push(`TEL:${mecardText(contact.mobile.replace(/[^\d+]/g, ''))}`);
  if (contact.email !== '') parts.push(`EMAIL:${mecardText(contact.email)}`);
  if (contact.website !== '') parts.push(`URL:${mecardText(contact.website)}`);
  if (hasAddress(contact)) {
    const address = [contact.street, contact.city, [contact.region, contact.postalCode].filter((part) => part !== '').join(' '), contact.country].filter((part) => part !== '').join(', ');
    parts.push(`ADR:${mecardText(address)}`);
  }
  if (contact.jobTitle !== '') parts.push(`NOTE:${mecardText(contact.jobTitle)}`);
  return `MECARD:${parts.join(';')};;`;
}

/** The lines a card prints for a contact, in the order a reader expects them. */
export function contactLines(contact: ContactFields): string[] {
  const lines: string[] = [];
  if (contact.phone !== '') lines.push(contact.mobile !== '' ? `T  ${contact.phone}` : contact.phone);
  if (contact.mobile !== '') lines.push(contact.phone !== '' ? `M  ${contact.mobile}` : contact.mobile);
  if (contact.email !== '') lines.push(contact.email);
  if (contact.website !== '') lines.push(contact.website.replace(/^https?:\/\//i, '').replace(/\/$/, ''));
  if (contact.street !== '') lines.push(contact.street);
  const locality = [contact.city, contact.region, contact.postalCode].filter((part) => part !== '').join(', ');
  const place = [locality, contact.country].filter((part) => part !== '').join(', ');
  if (place !== '') lines.push(place);
  return lines;
}
