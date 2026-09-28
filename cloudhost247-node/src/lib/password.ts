/**
 * Password hashing utilities.
 *
 * Uses bcryptjs (a pure-JS implementation) instead of native `bcrypt`/`argon2` bindings.
 * cPanel shared-hosting Node environments frequently lack a C/C++ toolchain (or forbid native
 * module compilation during npm install), so a pure-JS hashing library avoids deployment
 * failures while still providing a strong, industry-standard adaptive hash.
 */
import bcrypt from 'bcryptjs';

const SALT_ROUNDS = 12;

export async function hashPassword(plainText: string): Promise<string> {
  return bcrypt.hash(plainText, SALT_ROUNDS);
}

export async function verifyPassword(plainText: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plainText, hash);
}
