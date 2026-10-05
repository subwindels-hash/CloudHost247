/**
 * AWS Signature Version 4: known-answer tests against the published AWS test suite.
 *
 * The signer in `src/lib/providers/aws-sigv4.js` is this build's own implementation (the platform has
 * no dependencies, so the AWS SDK's signer is not available). Nothing in a loopback fake can tell a
 * correct signature from a plausible-looking wrong one — a signature AWS rejects comes back as
 * `SignatureDoesNotMatch`, which only a real AWS endpoint produces. The defence is the AWS SigV4 test
 * suite's own vectors, which pin the canonical request, the string to sign and the final signature
 * byte for byte.
 *
 * Source of the values below: the AWS SigV4 test suite, `get-vanilla` and
 * `post-x-www-form-urlencoded` (vendored copy: github.com/mongodb/libmongocrypt,
 * kms-message/aws-sig-v4-test-suite/). Credentials, timestamp and region are the suite's own:
 * AKIDEXAMPLE / wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY, 20150830T123600Z, us-east-1, service "service".
 *
 * Also covered here: the query-protocol serialisation (EC2 singular list members vs CloudWatch
 * `member`) and the XML reader, because both decide whether a real EC2 answer is understood.
 */
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sha256Hex, canonicalRequest, stringToSign, signAwsRequest, uriEncode, amzTimestamp,
} = require('../src/lib/providers/aws-sigv4');
const { serializeQuery } = require('../src/lib/providers/adapters/aws-client');
const { parseXml, childCI, childTextCI, wrappedItemsCI, wrappedItems, root, decodeEntities } = require('../src/lib/providers/aws-xml');

const CREDENTIALS = { accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
const DATE = new Date('2015-08-30T12:36:00Z');

test('sigv4: the AWS test-suite vectors', async (t) => {
  await t.test('get-vanilla (no body, no extra headers)', () => {
    const expectedCanonicalRequest = [
      'GET',
      '/',
      '',
      'host:example.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'host;x-amz-date',
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    ].join('\n');
    const expectedStringToSign = [
      'AWS4-HMAC-SHA256',
      '20150830T123600Z',
      '20150830/us-east-1/service/aws4_request',
      'bb579772317eb040ac9ed261061d46c1f17a8133879d6129b6e1c25292927e63',
    ].join('\n');
    const expectedSignature = '5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31';

    const signed = signAwsRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      body: '',
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 'service',
      date: DATE,
    });

    assert.strictEqual(signed.canonicalRequest, expectedCanonicalRequest, 'the canonical request matches the suite byte for byte');
    assert.strictEqual(sha256Hex(expectedCanonicalRequest), expectedStringToSign.split('\n')[3], 'and hashes to the suite string-to-sign hash');
    assert.strictEqual(signed.stringToSign, expectedStringToSign);
    assert.strictEqual(signed.signature, expectedSignature);
    assert.strictEqual(
      signed.headers.authorization,
      'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, '
        + 'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31',
    );
  });

  await t.test('post-x-www-form-urlencoded (a body, and content-type among the signed headers)', () => {
    const expectedCanonicalRequest = [
      'POST',
      '/',
      '',
      'content-type:application/x-www-form-urlencoded',
      'host:example.amazonaws.com',
      'x-amz-date:20150830T123600Z',
      '',
      'content-type;host;x-amz-date',
      '9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e',
    ].join('\n');
    const expectedStringToSign = [
      'AWS4-HMAC-SHA256',
      '20150830T123600Z',
      '20150830/us-east-1/service/aws4_request',
      '42a5e5bb34198acb3e84da4f085bb7927f2bc277ca766e6d19c73c2154021281',
    ].join('\n');
    const expectedSignature = 'ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a';

    const signed = signAwsRequest({
      method: 'POST',
      url: 'https://example.amazonaws.com/',
      body: 'Param1=value1',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      credentials: CREDENTIALS,
      region: 'us-east-1',
      service: 'service',
      date: DATE,
    });

    assert.strictEqual(signed.canonicalRequest, expectedCanonicalRequest);
    assert.strictEqual(sha256Hex('Param1=value1'), '9095672bbd1f56dfc5b65f3e153adc8731a4a654192329106275f4c7b24d0b6e');
    assert.strictEqual(signed.stringToSign, expectedStringToSign);
    assert.strictEqual(signed.signature, expectedSignature);
  });

  await t.test('signing rules the vectors do not reach', () => {
    // The X-Amz-Date form is UTC and drops milliseconds.
    assert.strictEqual(amzTimestamp(new Date('2026-10-05T09:08:07.123Z')), '20261005T090807Z');
    // SigV4 escapes the characters encodeURIComponent leaves alone.
    assert.strictEqual(uriEncode("a b!c'd(e)f*g~h"), 'a%20b%21c%27d%28e%29f%2Ag~h');
    // A temporary credential is carried in a signed header.
    const signed = signAwsRequest({
      method: 'POST',
      url: 'https://ec2.eu-west-1.amazonaws.com/',
      body: 'Action=DescribeRegions&Version=2016-11-15',
      credentials: { ...CREDENTIALS, sessionToken: 'FQoGZXIvYXdzENL//////////wEaD' },
      region: 'eu-west-1',
      service: 'ec2',
      date: DATE,
    });
    assert.strictEqual(signed.headers['x-amz-security-token'], 'FQoGZXIvYXdzENL//////////wEaD');
    assert.match(signed.headers.authorization, /SignedHeaders=host;x-amz-date;x-amz-security-token, /);
    // ... and the token is signed together with the body, so a change to either invalidates the signature.
    assert.notStrictEqual(signed.signature, signAwsRequest({
      method: 'POST', url: 'https://ec2.eu-west-1.amazonaws.com/',
      body: 'Action=DescribeRegions&Version=2016-11-15',
      credentials: CREDENTIALS, region: 'eu-west-1', service: 'ec2', date: DATE,
    }).signature);
    assert.match(signed.headers.authorization, /Credential=AKIDEXAMPLE\/20150830\/eu-west-1\/ec2\/aws4_request/);
    // Header names are lowercased, values trimmed, and runs of whitespace collapse.
    const messy = signAwsRequest({
      method: 'GET',
      url: 'https://example.amazonaws.com/',
      headers: { 'X-Amz-Meta-Note': '  two   spaces  ' },
      credentials: CREDENTIALS, region: 'us-east-1', service: 'service', date: DATE,
    });
    assert.strictEqual(messy.canonicalRequest.includes('x-amz-meta-note:two spaces\n'), true);
  });
});

test('aws query protocol: parameter serialisation', async (t) => {
  await t.test('EC2 singularises list members, including nested tag lists', () => {
    const body = serializeQuery({
      Action: 'RunInstances',
      Version: '2016-11-15',
      InstanceIds: ['i-1', 'i-2'],
      Filters: [{ Name: 'tag:Name', Values: ['a b'] }],
      TagSpecifications: [{ ResourceType: 'instance', Tags: [{ Key: 'Name', Value: 'web' }] }],
      BlockDeviceMappings: [{ DeviceName: '/dev/sda1', Ebs: { VolumeType: 'gp3' } }],
      MinCount: 1,
      DryRun: false,
      Unset: null,
      When: new Date('2015-08-30T12:36:00Z'),
    });
    const pairs = new URLSearchParams(body);
    assert.strictEqual(pairs.get('InstanceId.1'), 'i-1');
    assert.strictEqual(pairs.get('InstanceId.2'), 'i-2');
    assert.strictEqual(pairs.get('Filter.1.Name'), 'tag:Name');
    assert.strictEqual(pairs.get('Filter.1.Value.1'), 'a b', 'a space is %20-encoded, not a +');
    assert.strictEqual(body.includes('+'), false);
    assert.strictEqual(pairs.get('TagSpecification.1.ResourceType'), 'instance');
    assert.strictEqual(pairs.get('TagSpecification.1.Tag.1.Key'), 'Name');
    assert.strictEqual(pairs.get('TagSpecification.1.Tag.1.Value'), 'web');
    assert.strictEqual(pairs.get('BlockDeviceMapping.1.DeviceName'), '/dev/sda1');
    assert.strictEqual(pairs.get('BlockDeviceMapping.1.Ebs.VolumeType'), 'gp3');
    assert.strictEqual(pairs.get('MinCount'), '1');
    assert.strictEqual(pairs.get('DryRun'), 'false');
    assert.strictEqual(pairs.get('Unset'), null, 'undefined parameters are omitted rather than sent empty');
    assert.strictEqual(pairs.get('When'), '2015-08-30T12:36:00.000Z');
  });

  await t.test('CloudWatch uses member.N', () => {
    const body = serializeQuery({
      Action: 'GetMetricStatistics',
      Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }],
      Statistics: ['Average', 'Maximum'],
      Period: 300,
    }, { listMember: 'member' });
    const pairs = new URLSearchParams(body);
    assert.strictEqual(pairs.get('Dimensions.member.1.Name'), 'InstanceId');
    assert.strictEqual(pairs.get('Dimensions.member.1.Value'), 'i-1');
    assert.strictEqual(pairs.get('Statistics.member.1'), 'Average');
    assert.strictEqual(pairs.get('Statistics.member.2'), 'Maximum');
    assert.strictEqual(pairs.get('Period'), '300');
  });
});

test('aws xml: the reader understands what AWS sends and refuses what it cannot parse', async (t) => {
  await t.test('EC2 DescribeInstances, in EC2 lowerCamel element names', () => {
    const xml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<DescribeInstancesResponse xmlns="http://ec2.amazonaws.com/doc/2016-11-15/">',
      '  <requestId>req-1</requestId>',
      '  <reservationSet>',
      '    <item>',
      '      <reservationId>r-1</reservationId>',
      '      <instancesSet>',
      '        <item>',
      '          <instanceId>i-1</instanceId>',
      '          <imageId>ami-1</imageId>',
      '          <instanceType>t3.micro</instanceType>',
      '          <publicIpAddress>203.0.113.5</publicIpAddress>',
      '          <instanceState><code>16</code><name>running</name></instanceState>',
      '          <placement><availabilityZone>us-east-1a</availabilityZone></placement>',
      '          <rootDeviceName>/dev/sda1</rootDeviceName>',
      '          <tagSet><item><key>Name</key><value>web &amp; api</value></item></tagSet>',
      '          <blockDeviceMapping><item><deviceName>/dev/sda1</deviceName><ebs><volumeId>vol-1</volumeId></ebs></item></blockDeviceMapping>',
      '          <groupSet><item><groupId>sg-1</groupId></item></groupSet>',
      '        </item>',
      '      </instancesSet>',
      '    </item>',
      '  </reservationSet>',
      '</DescribeInstancesResponse>',
    ].join('\n');
    const document = parseXml(xml);
    const instance = wrappedItems(wrappedItems(root(document), 'reservationSet')[0], 'instancesSet')[0];
    assert.strictEqual(childTextCI(instance, 'instanceId'), 'i-1');
    assert.strictEqual(childTextCI(childCI(instance, 'instanceState'), 'name'), 'running');
    assert.strictEqual(wrappedItems(instance, 'tagSet')[0].children.find((c) => c.name === 'value').text, 'web &amp; api'.replace('&amp;', '&'));
    assert.strictEqual(wrappedItems(instance, 'blockDeviceMapping')[0].children.length, 2);
  });

  await t.test('CloudWatch GetMetricStatistics, in the capitalised names CloudWatch uses', () => {
    const xml = [
      '<GetMetricStatisticsResponse xmlns="http://monitoring.amazonaws.com/doc/2010-08-01/">',
      '  <GetMetricStatisticsResult>',
      '    <Datapoints>',
      '      <member><Timestamp>2026-10-05T09:00:00Z</Timestamp><Average>12.5</Average><Maximum>30.0</Maximum><Unit>Percent</Unit></member>',
      '      <member><Timestamp>2026-10-05T09:05:00Z</Timestamp><Average>20.25</Average><Maximum>40.0</Maximum><Unit>Percent</Unit></member>',
      '    </Datapoints>',
      '    <Label>CPUUtilization</Label>',
      '  </GetMetricStatisticsResult>',
      '  <ResponseMetadata><RequestId>req-2</RequestId></ResponseMetadata>',
      '</GetMetricStatisticsResponse>',
    ].join('\n');
    const result = childCI(root(parseXml(xml)), 'GetMetricStatisticsResult');
    const points = wrappedItemsCI(result, 'Datapoints', 'member');
    assert.strictEqual(points.length, 2);
    assert.strictEqual(childTextCI(points[0], 'average'), '12.5');
    assert.strictEqual(childTextCI(points[1], 'unit'), 'Percent');
    assert.strictEqual(childCI(result, 'Label').text, 'CPUUtilization');
  });

  await t.test('the reader is strict about malformed documents and decodes entities', () => {
    assert.throws(() => parseXml('<a><b></a>'), /mismatched closing tag/);
    assert.throws(() => parseXml('<a>'), /unclosed element/);
    assert.throws(() => parseXml(''), /empty/);
    assert.strictEqual(decodeEntities('a &lt;b&gt; &#65; &#x42; &unknown;'), 'a <b> A B &unknown;');
    // A self-closing element has no children and no text.
    const document = parseXml('<a><b/><c>x</c></a>');
    assert.strictEqual(root(document).children.length, 2);
    assert.strictEqual(childTextCI(root(document), 'b'), null);
  });
});
