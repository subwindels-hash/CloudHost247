import { generateKeyPairSync } from 'node:crypto';

/**
 * The EC2 serial console is a real interactive console, and AWS reaches it over SSH rather than
 * through a console URL. Instance Connect's `SendSerialConsoleSSHPublicKey` pushes the *public* half
 * of a key pair to the serial console service; the key lives for **60 seconds** and only one serial
 * console session can be open on an instance at a time. The matching private half is then used by
 * the customer's own SSH client:
 *
 *   ssh -i <saved key> <instance-id>.port0@serial-console.ec2-instance-connect.<region>.aws
 *
 * The platform therefore generates the pair at call time, pushes the public half through the AWS
 * API and hands the private half to the requester exactly once — the same request-scope credential
 * rule as a rescue password. Nothing derived from it is stored.
 *
 * The key is RSA because that is the one key format EC2's own key-pair requirements and every
 * OpenSSH client agree on; the public half is encoded in the OpenSSH wire format AWS expects
 * (`ssh-rsa <base64> <comment>`) and the private half is written as a PKCS#1 PEM, which OpenSSH
 * reads directly.
 */

/** Instance Connect removes the pushed public key after 60 seconds (`SendSerialConsoleSSHPublicKey`). */
export const SERIAL_CONSOLE_KEY_TTL_MS = 60_000;

export interface SerialConsoleKeyPair {
  /** OpenSSH one-line public key, exactly the `SSHPublicKey` value the AWS API expects. */
  publicKey: string;
  /** PKCS#1 PEM private key: handed to the customer, never stored. */
  privateKey: string;
}

/** An SSH string: 4-byte length prefix followed by the UTF-8 bytes. */
function sshString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);
  return Buffer.concat([length, bytes]);
}

/** An SSH mpint: 4-byte length prefix, with a leading zero when the high bit would read as negative. */
function sshMpint(bytes: Buffer): Buffer {
  const body = (bytes[0] ?? 0) & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes;
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body]);
}

/** Encodes an RSA key as the OpenSSH `ssh-rsa` public-key line (`blob = string "ssh-rsa" | mpint e | mpint n`). */
export function encodeSshRsaPublicKey(modulus: Buffer, exponent: Buffer, comment: string): string {
  const blob = Buffer.concat([sshString('ssh-rsa'), sshMpint(exponent), sshMpint(modulus)]);
  return `ssh-rsa ${blob.toString('base64')} ${comment}`;
}

/** Generates the one-time key pair for a serial console session. */
export function generateSerialConsoleKeyPair(): SerialConsoleKeyPair {
  const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = publicKey.export({ format: 'jwk' }) as { n?: string; e?: string };
  if (!jwk.n || !jwk.e) {
    // generateKeyPairSync with an RSA modulus always yields both parts; failing closed beats sending
    // AWS a public key the customer's private key cannot match.
    throw new Error('AWS serial console key generation produced no RSA modulus');
  }
  return {
    publicKey: encodeSshRsaPublicKey(
      Buffer.from(jwk.n, 'base64url'),
      Buffer.from(jwk.e, 'base64url'),
      'cloudhost247-serial-console'
    ),
    privateKey: String(privateKey.export({ type: 'pkcs1', format: 'pem' })),
  };
}

/** The per-region serial console SSH endpoint documented for EC2 Instance Connect. */
export function serialConsoleEndpoint(region: string): string {
  return `serial-console.ec2-instance-connect.${region}.aws`;
}

/** The exact command the customer runs, with the key file name left to them. */
export function serialConsoleCommand(instanceId: string, region: string): string {
  return `ssh -i <saved-key-file> ${instanceId}.port0@${serialConsoleEndpoint(region)}`;
}
