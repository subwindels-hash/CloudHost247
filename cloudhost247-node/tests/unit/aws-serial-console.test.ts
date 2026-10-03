import { createPrivateKey, createPublicKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SERIAL_CONSOLE_KEY_TTL_MS,
  encodeSshRsaPublicKey,
  generateSerialConsoleKeyPair,
  serialConsoleCommand,
  serialConsoleEndpoint,
} from '../../src/infrastructure/providers/aws-serial-console';
// eslint-disable-next-line import/first
import { decodeSshRsaPublicKey } from '../helpers/ssh-public-key';

/**
 * The EC2 serial console is reached over SSH: the platform pushes a public key through Instance
 * Connect and hands the matching private key to the customer, who has 60 seconds to use it. These
 * tests pin the part that is easy to get silently wrong — whether the public half AWS receives is
 * really the public half of the private key the customer is given.
 */

function publicJwk(privateKeyPem: string): { n?: string; e?: string } {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({ format: 'jwk' }) as { n?: string; e?: string };
}

describe('AWS serial console one-time key pair', () => {
  it('emits an OpenSSH public line and a PKCS#1 private key that are provably the same key', () => {
    const pair = generateSerialConsoleKeyPair();

    expect(pair.publicKey).toMatch(/^ssh-rsa [A-Za-z0-9+/=]+ cloudhost247-serial-console$/);
    expect(pair.privateKey).toMatch(/^-----BEGIN RSA PRIVATE KEY-----/);

    const parsed = decodeSshRsaPublicKey(pair.publicKey);
    const jwk = publicJwk(pair.privateKey);
    expect(parsed.algorithm).toBe('ssh-rsa');
    expect(parsed.exponent.toString('hex')).toBe(Buffer.from(jwk.e ?? '', 'base64url').toString('hex'));
    expect(parsed.modulus.toString('hex')).toBe(Buffer.from(jwk.n ?? '', 'base64url').toString('hex'));
    // RSA-2048: a key a customer's SSH client and EC2's own key requirements both accept.
    expect(parsed.modulus.length).toBe(256);
  });

  it('never reuses a key', () => {
    const first = generateSerialConsoleKeyPair();
    const second = generateSerialConsoleKeyPair();
    expect(first.publicKey).not.toBe(second.publicKey);
    expect(first.privateKey).not.toBe(second.privateKey);
  });

  it('encodes the documented endpoint, the customer command and the 60-second AWS key lifetime', () => {
    expect(serialConsoleEndpoint('eu-west-1')).toBe('serial-console.ec2-instance-connect.eu-west-1.aws');
    expect(serialConsoleCommand('i-0abc', 'eu-west-1'))
      .toBe('ssh -i <saved-key-file> i-0abc.port0@serial-console.ec2-instance-connect.eu-west-1.aws');
    expect(SERIAL_CONSOLE_KEY_TTL_MS).toBe(60_000);
  });

  it('marks the high bit of an mpint so SSH cannot read the modulus as negative', () => {
    const line = encodeSshRsaPublicKey(Buffer.from([0x80, 0x01]), Buffer.from([0x01, 0x00, 0x01]), 'test');
    expect(decodeSshRsaPublicKey(line).modulus.toString('hex')).toBe('8001');
    // ssh-rsa string (4+7) + exponent mpint (4+3) = 18, then the modulus mpint: length 3, then
    // the zero the encoder prepended, then 80 01.
    const blob = Buffer.from(line.split(' ')[1] ?? '', 'base64');
    expect(blob.subarray(18, 25).toString('hex')).toBe('00000003008001');
  });
});
