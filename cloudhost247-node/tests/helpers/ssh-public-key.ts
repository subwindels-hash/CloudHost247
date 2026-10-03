/**
 * Decodes an OpenSSH `ssh-rsa` public key line back into the values AWS would read, so a test can
 * prove that a pushed public key and a handed-over private key are the same pair.
 */
export interface SshRsaPublicKey {
  algorithm: string;
  exponent: Buffer;
  modulus: Buffer;
  comment: string;
}

export function decodeSshRsaPublicKey(line: string): SshRsaPublicKey {
  const [algorithm, base64, ...rest] = line.trim().split(' ');
  if (!algorithm || !base64) throw new Error(`not an SSH public key: ${line}`);
  const blob = Buffer.from(base64, 'base64');

  let offset = 0;
  const readString = (): Buffer => {
    const length = blob.readUInt32BE(offset);
    offset += 4;
    const value = blob.subarray(offset, offset + length);
    offset += length;
    return value;
  };
  const readMpint = (): Buffer => {
    const raw = readString();
    return raw[0] === 0 ? raw.subarray(1) : raw;
  };

  const name = readString().toString('utf8');
  const exponent = readMpint();
  const modulus = readMpint();
  return { algorithm: name, exponent, modulus, comment: rest.join(' ') };
}
