/**
 * EC2 Serial Console key material.
 *
 * Ported from cloudhost247-node/src/infrastructure/providers/aws-serial-console.ts.
 *
 * AWS's serial console is not a VNC session: EC2 Instance Connect accepts an SSH public key for the
 * instance's serial port, the customer connects with the matching private key, and AWS discards the
 * key after 60 seconds. The private key therefore exists only in the memory of the process that
 * answered the request, and only for that one response.
 */
'use strict';

const { generateKeyPairSync } = require('node:crypto');

/** AWS removes the pushed key after 60 seconds; the session says so rather than pretending otherwise. */
const SERIAL_CONSOLE_KEY_TTL_MS = 60_000;

/** SSH wire format: length-prefixed strings. */
function sshString(value) {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/** SSH mpint: big-endian, two's-complement, with a leading zero when the top bit is set. */
function sshMpint(bytes) {
  const body = (bytes[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

/** `ssh-rsa <base64> <comment>` — the OpenSSH public-key line EC2 Instance Connect expects. */
function encodeSshRsaPublicKey(modulus, exponent, comment) {
  const blob = Buffer.concat([sshString('ssh-rsa'), sshMpint(exponent), sshMpint(modulus)]);
  return `ssh-rsa ${blob.toString('base64')} ${comment}`;
}

function generateSerialConsoleKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' });
  if (!jwk.n || !jwk.e) {
    throw new Error('AWS serial console key generation produced no RSA modulus');
  }
  return {
    publicKey: encodeSshRsaPublicKey(
      Buffer.from(jwk.n, 'base64url'),
      Buffer.from(jwk.e, 'base64url'),
      'cloudhost247-serial-console',
    ),
    privateKey: String(privateKey.export({ type: 'pkcs1', format: 'pem' })),
  };
}

function serialConsoleEndpoint(region) {
  return `serial-console.ec2-instance-connect.${region}.aws`;
}

function serialConsoleCommand(instanceId, region) {
  return `ssh -i <saved-key-file> ${instanceId}.port0@${serialConsoleEndpoint(region)}`;
}

module.exports = {
  SERIAL_CONSOLE_KEY_TTL_MS,
  sshString,
  sshMpint,
  encodeSshRsaPublicKey,
  generateSerialConsoleKeyPair,
  serialConsoleEndpoint,
  serialConsoleCommand,
};
