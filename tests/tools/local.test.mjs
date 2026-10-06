import assert from 'node:assert/strict';
import { runLocal } from '../../templates/cloudhost247/js/tools-local.js';

const empty = await runLocal('md5', { text: '' });
assert.equal(empty.rows[0].MD5, 'd41d8cd98f00b204e9800998ecf8427e');
const abc = await runLocal('md5', { text: 'abc' });
assert.equal(abc.rows[0].MD5, '900150983cd24fb0d6963f7d28e17f72');

const encoded = await runLocal('base64', { text: 'CloudHost247' });
const decoded = await runLocal('base64', { text: encoded.rows[0].Base64, op: 'decode' });
assert.equal(decoded.rows[0].Text, 'CloudHost247');

const puny = await runLocal('punycode', { text: 'münchen.de' });
assert.equal(puny.rows[0].Punycode, 'xn--mnchen-3ya.de');

const valid = await runLocal('card', { number: '4111111111111111' });
assert.equal(valid.rows[0].Luhn, 'Valid');
assert.match(valid.rows[0].Masked, /1111/);
assert.equal(JSON.stringify(valid).includes('4111111111111111'), false);
const invalid = await runLocal('card', { number: '4111111111111112' });
assert.equal(invalid.ok, true);
assert.match(invalid.summary, /does not match/i);

const expanded = await runLocal('ipv6_expand', { target: '2001:db8::1' });
assert.equal(expanded.rows[0].Address, '2001:0db8:0000:0000:0000:0000:0000:0001');
const compressed = await runLocal('ipv6_compress', { target: '2001:0db8:0000:0000:0000:0000:0000:0001' });
assert.equal(compressed.rows[0].Address, '2001:db8::1');

const subnet = await runLocal('subnet', { target: '203.0.113.10/24' });
assert.equal(subnet.rows[0].Network, '203.0.113.0');
assert.equal(subnet.rows[0].Broadcast, '203.0.113.255');

const json = await runLocal('json_beautify', { text: '{"a":1}' });
assert.equal(json.ok, true);
const broken = await runLocal('json_minify', { text: '{oops' });
assert.equal(broken.ok, false);

const serp = await runLocal('serp', { title: 'Example', description: 'A snippet', url: 'https://example.com/' });
assert.match(JSON.stringify(serp.notes), /not a Google ranking/i);

console.log('local tools ok');
