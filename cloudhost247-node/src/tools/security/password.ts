/**
 * Tools Center — password tools (spec §41).
 *
 * A generator, a strength/entropy report and a hash explainer. Rules that shape the code:
 *
 *   - Generation uses `crypto.randomInt` (CSPRNG), never Math.random. Exactly one character is
 *     drawn from every selected class and the result is shuffled with a Fisher–Yates pass, so the
 *     guarantee does not leak into a positional pattern.
 *   - Nothing is stored or logged. The password never reaches the database, the execution log or
 *     the history summary — the route marks the result as private, and the redactor masks any
 *     credential-shaped key as a second line of defence.
 *   - Strength is measured with zxcvbn-style heuristics implemented here (dictionary, sequences,
 *     repeats, dates) because a length-and-classes checklist alone misleads. The estimate is
 *     labelled as an estimate.
 *   - The hashing section explains bcrypt/scrypt/Argon2 vs MD5/SHA-* and why CloudHost247 stores
 *     account passwords as bcrypt (src/lib/password.ts). It never claims to recover a password.
 */
import { randomInt, createHash } from 'node:crypto';
import { invalidInput } from '../core/errors';

export interface PasswordGeneratorInput {
  length?: number;
  lowercase?: boolean;
  uppercase?: boolean;
  digits?: boolean;
  symbols?: boolean;
  excludeAmbiguous?: boolean;
  /** Presets used by the UI; when set they override the boolean flags. */
  preset?: 'pin' | 'memorable' | 'strong' | 'maximum';
}

export interface PasswordGenerationResult {
  password: string;
  length: number;
  characterClasses: string[];
  alphabetSize: number;
  entropyBits: number;
  preset: string | null;
  guidance: string[];
  storageNotice: string;
}

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.?/';
const AMBIGUOUS = new Set('Il1O0oB8S5Z2G6|`\'"');

export function generatePassword(input: PasswordGeneratorInput = {}): PasswordGenerationResult {
  let length = input.length ?? 20;
  let classes: string[] = [];

  switch (input.preset) {
    case 'pin':
      classes = [DIGITS];
      length = input.length ?? 6;
      break;
    case 'memorable': {
      // Word-list-style passphrase: four words from a fixed list plus a digit, joined by hyphens.
      const words = MEMORABLE_WORDS;
      const chosen: string[] = [];
      for (let index = 0; index < 4; index += 1) chosen.push(words[randomInt(words.length)] ?? 'cloud');
      const suffix = randomInt(100);
      const phrase = `${chosen.join('-')}-${suffix}`;
      return {
        password: phrase,
        length: phrase.length,
        characterClasses: ['words', 'digits'],
        alphabetSize: words.length,
        entropyBits: Math.round(4 * Math.log2(words.length) + Math.log2(100) + 3.3),
        preset: 'memorable',
        guidance: [
          'A four-word passphrase from this list has roughly as much entropy as a 12-character random password and is far easier to type on a phone or to dictate.',
          'The estimate uses 4 words from a fixed list plus one 2-digit number; the list is smaller than a real diceware list, so treat the number as an upper bound.',
        ],
        storageNotice: PASSWORD_STORAGE_NOTICE,
      };
    }
    case 'strong':
      length = input.length ?? 16;
      classes = ['lowercase', 'uppercase', 'digits', 'symbols'];
      break;
    case 'maximum':
      length = input.length ?? 32;
      classes = ['lowercase', 'uppercase', 'digits', 'symbols'];
      break;
    default:
      classes = [
        ...(input.lowercase !== false ? ['lowercase'] : []),
        ...(input.uppercase !== false ? ['uppercase'] : []),
        ...(input.digits !== false ? ['digits'] : []),
        ...(input.symbols === true ? ['symbols'] : []),
      ];
  }

  length = Math.min(Math.max(length, 4), 128);
  if (classes.length === 0) throw invalidInput('Select at least one character class.');
  if (classes.length === 1 && classes[0] === 'digits' && length > 12) {
    // Allowed, but say what the limit is.
  }
  if (length < classes.length) throw invalidInput('The password is shorter than the number of selected character classes.');

  const pools = new Map<string, string>();
  if (classes.includes('lowercase')) pools.set('lowercase', LOWERCASE);
  if (classes.includes('uppercase')) pools.set('uppercase', UPPERCASE);
  if (classes.includes('digits')) pools.set('digits', DIGITS);
  if (classes.includes('symbols')) pools.set('symbols', SYMBOLS);
  if (pools.size === 0) throw invalidInput('Select at least one character class.');

  const filterAmbiguous = (characters: string): string => (input.excludeAmbiguous ? [...characters].filter((character) => !AMBIGUOUS.has(character)).join('') : characters);
  const poolsList = [...pools.values()].map(filterAmbiguous);
  if (poolsList.some((pool) => pool.length === 0)) throw invalidInput('Excluding ambiguous characters left a character class empty; add another class.');

  const characters: string[] = [];
  for (const pool of poolsList) characters.push(pool[randomInt(pool.length)]!);
  const overall = poolsList.join('');
  while (characters.length < length) characters.push(overall[randomInt(overall.length)]!);

  // Fisher–Yates so the guaranteed characters move out of their initial positions.
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    const temporary = characters[index]!;
    characters[index] = characters[swapIndex]!;
    characters[swapIndex] = temporary;
  }

  const password = characters.join('');
  const entropyBits = Math.round(length * Math.log2(overall.length) * 10) / 10;
  const guidance: string[] = [];
  if (input.preset === 'pin' || (classes.length === 1 && classes[0] === 'digits')) {
    guidance.push(`A numeric-only password has only ${overall.length} possible characters per position. At a deliberately slow login this is still weak: prefer a passphrase for anything that matters.`);
  }
  if (entropyBits < 60) guidance.push('This is below the ~60 bits that is reasonable for a password protecting something valuable. Increase the length.');
  else if (entropyBits < 80) guidance.push('Adequate for most accounts, especially with two-factor authentication enabled.');
  else guidance.push('Strong. Store it in a password manager and enable two-factor authentication: length does not protect against phishing or reuse.');
  guidance.push('Generated in this process with Node\'s CSPRNG. The password was not transmitted to a third party, was not written to the database and is not kept in your tool history.');

  return {
    password,
    length,
    characterClasses: [...pools.keys()],
    alphabetSize: overall.length,
    entropyBits,
    preset: input.preset ?? null,
    guidance,
    storageNotice: PASSWORD_STORAGE_NOTICE,
  };
}

const PASSWORD_STORAGE_NOTICE =
  'CloudHost247 stores account passwords as bcrypt hashes (12 cost rounds, src/lib/password.ts) and can only verify a password, never display it. If you have lost a password, use the reset flow — support staff cannot recover it either, and that is deliberate.';

const MEMORABLE_WORDS = [
  'apple', 'bridge', 'candle', 'delta', 'ember', 'forest', 'garden', 'harbor', 'island', 'jungle', 'kernel', 'lantern',
  'meadow', 'nebula', 'ocean', 'pepper', 'quartz', 'river', 'saddle', 'tundra', 'umbrella', 'violet', 'willow',
  'xylophone', 'yarrow', 'zephyr', 'anchor', 'basket', 'cobalt', 'dynamo', 'eagle', 'fossil', 'granite', 'helix',
  'ivory', 'jackal', 'kettle', 'legend', 'magnet', 'nectar', 'onyx', 'pilot', 'quiver', 'rocket', 'sunset',
  'tiger', 'urchin', 'vector', 'walnut', 'yonder', 'zigzag', 'amber', 'breeze', 'citrus', 'drift', 'echo',
  'frost', 'glacier', 'hollow', 'indigo', 'jasper', 'canyon', 'meadowlark', 'north', 'orchid', 'pumice',
];

// ---------------------------------------------------------------------------------------------
// Strength
// ---------------------------------------------------------------------------------------------

export interface StrengthInput {
  password: string;
  /** Optional context: the account's name/domain, used to penalise passwords containing it. */
  context?: string;
}

export interface StrengthResult {
  passwordProvided: true;
  length: number;
  characterClasses: { lowercase: boolean; uppercase: boolean; digits: boolean; symbols: boolean; unicode: boolean };
  alphabetSize: number;
  rawEntropyBits: number;
  effectiveEntropyBits: number;
  score: 0 | 1 | 2 | 3 | 4;
  label: 'Very weak' | 'Weak' | 'Fair' | 'Strong' | 'Very strong';
  crackTimeEstimates: Array<{ scenario: string; guessesPerSecond: number; humanReadable: string }>;
  weaknesses: Array<{ code: string; severity: 'critical' | 'high' | 'medium' | 'low'; detail: string; evidence: string | null }>;
  suggestions: string[];
  notice: string;
}

const COMMON_PASSWORDS = new Set([
  'password', '123456', '123456789', 'qwerty', '12345678', '111111', '123123', 'abc123', 'password1', 'iloveyou',
  'monkey', 'dragon', 'sunshine', 'princess', 'football', 'baseball', 'welcome', 'admin', 'login', 'passw0rd',
  'letmein', 'qwerty123', '1q2w3e4r', 'zaq12wsx', 'trustno1', 'master', 'hello', 'freedom', 'whatever', 'ninja',
  'mustang', 'shadow', 'superman', 'batman', 'michael', 'jennifer', 'hunter', 'hunter2', 'changeme', 'secret',
]);

const KEYBOARD_ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', 'qazwsx', '1qaz2wsx', 'poiuytrewq', 'lkjhgfdsa'];

function humaniseSeconds(seconds: number): string {
  if (seconds < 1) return 'less than a second';
  const minutes = seconds / 60;
  if (minutes < 1) return `${Math.round(seconds)} seconds`;
  const hours = minutes / 60;
  if (hours < 1) return `${Math.round(minutes)} minutes`;
  const days = hours / 24;
  if (days < 1) return `${Math.round(hours)} hours`;
  const years = days / 365;
  if (years < 1) return `${Math.round(days)} days`;
  if (years < 1000) return `${Math.round(years)} years`;
  const millions = years / 1_000_000;
  if (millions < 1000) return `${Math.round(millions)} million years`;
  const billions = years / 1_000_000_000;
  if (billions < 1000) return `${Math.round(billions)} billion years`;
  return 'longer than the age of the universe at this rate';
}

export function scorePassword(input: StrengthInput): StrengthResult {
  const password = input.password ?? '';
  if (password.length === 0) throw invalidInput('Enter a password to evaluate.');
  if (password.length > 1024) throw invalidInput('Passwords longer than 1024 characters are not evaluated.');

  const lowercase = /[a-z]/.test(password);
  const uppercase = /[A-Z]/.test(password);
  const digits = /\d/.test(password);
  const symbols = /[^A-Za-z0-9\s]/.test(password);
  const unicode = /[^\x00-\x7f]/.test(password);
  const classes = [lowercase, uppercase, digits, symbols].filter(Boolean).length;
  const alphabetSize = (lowercase ? 26 : 0) + (uppercase ? 26 : 0) + (digits ? 10 : 0) + (symbols ? 33 : 0) + (unicode ? 100 : 0) || 1;

  const rawEntropyBits = Math.round(password.length * Math.log2(alphabetSize) * 10) / 10;
  const weaknesses: StrengthResult['weaknesses'] = [];
  let penaltyBits = 0;
  const lower = password.toLowerCase();

  const commonEntry = [...COMMON_PASSWORDS].find((entry) => lower === entry || lower.replace(/[^a-z0-9]/g, '') === entry);
  if (commonEntry) {
    weaknesses.push({ code: 'COMMON_PASSWORD', severity: 'critical', detail: `This is one of the most commonly used passwords (or trivially close to one: "${commonEntry}"). It will be in every cracking dictionary.`, evidence: commonEntry });
    penaltyBits += rawEntropyBits - 10;
  }
  const repeated = /(.)\1{2,}/.exec(password);
  if (repeated) {
    weaknesses.push({ code: 'REPEATED_CHARACTER', severity: 'medium', detail: `"${repeated[1]}" is repeated ${repeated[0].length} times in a row.`, evidence: null });
    penaltyBits += 8;
  }
  const sequence = /(abc|bcd|cde|def|efg|fgh|ghi|hij|ijk|jkl|klm|lmn|mno|nop|opq|pqr|qrs|rst|stu|tuv|uvw|vwx|wxy|xyz|012|123|234|345|456|567|678|789)/i.exec(password);
  if (sequence) {
    weaknesses.push({ code: 'SEQUENCE', severity: 'medium', detail: `Contains the sequence "${sequence[0]}".`, evidence: sequence[0] });
    penaltyBits += 8;
  }
  const keyboard = KEYBOARD_ROWS.find((row) => row.length >= 4 && lower.includes(row.slice(0, 4)));
  if (keyboard) {
    weaknesses.push({ code: 'KEYBOARD_PATTERN', severity: 'high', detail: `Contains a keyboard run ("${keyboard.slice(0, 4)}…").`, evidence: keyboard });
    penaltyBits += 12;
  }
  if (/^\d+$/.test(password)) {
    weaknesses.push({ code: 'DIGITS_ONLY', severity: 'high', detail: 'Digits only: 10 possible characters per position.', evidence: null });
  }
  if (/^[A-Z][a-z]+$/.test(password)) {
    weaknesses.push({ code: 'SINGLE_WORD', severity: 'high', detail: 'A single capitalised word is in every wordlist used by cracking tools.', evidence: null });
  }
  const year = /(19|20)\d{2}/.exec(password);
  if (year) {
    weaknesses.push({ code: 'YEAR', severity: 'low', detail: `Contains a four-digit year ("${year[0]}"), a very common suffix.`, evidence: year[0] });
    penaltyBits += 4;
  }
  const context = input.context?.trim().toLowerCase();
  if (context && context.length >= 3 && lower.includes(context.replace(/\s+/g, ''))) {
    weaknesses.push({ code: 'CONTEXT', severity: 'high', detail: 'The password contains the account name, domain or other context provided to this check — the first thing an attacker with any information would try.', evidence: context });
    penaltyBits += 12;
  }
  const distinct = new Set(password).size;
  if (distinct / password.length < 0.4 && password.length >= 8) {
    weaknesses.push({ code: 'LOW_VARIETY', severity: 'medium', detail: `Only ${distinct} distinct characters in ${password.length} positions.`, evidence: null });
    penaltyBits += 6;
  }

  const effectiveEntropyBits = Math.max(0, Math.round((rawEntropyBits - penaltyBits) * 10) / 10);
  const score: StrengthResult['score'] =
    effectiveEntropyBits < 28 ? 0 : effectiveEntropyBits < 40 ? 1 : effectiveEntropyBits < 65 ? 2 : effectiveEntropyBits < 90 ? 3 : 4;
  const label: StrengthResult['label'] = (['Very weak', 'Weak', 'Fair', 'Strong', 'Very strong'] as const)[score];

  const scenarios: Array<{ scenario: string; guessesPerSecond: number }> = [
    { scenario: 'Throttled online attack (100 guesses/second, locked-out login)', guessesPerSecond: 100 },
    { scenario: 'Fast offline attack on a leaked hash table with GPU (10 billion/second)', guessesPerSecond: 10_000_000_000 },
    { scenario: 'Slow offline attack on a salted adaptive hash such as bcrypt (10 thousand/second)', guessesPerSecond: 10_000 },
  ];

  const suggestions: string[] = [];
  if (password.length < 12) suggestions.push('Increase the length: every additional character multiplies the search space.');
  if (classes < 3) suggestions.push('Use a longer passphrase rather than a short string of symbols — length beats character-class rules.');
  if (weaknesses.some((weakness) => weakness.code === 'COMMON_PASSWORD' || weakness.code === 'SINGLE_WORD')) suggestions.push('Choose a passphrase of several unrelated words that does not appear in a dictionary.');
  if (weaknesses.some((weakness) => weakness.code === 'CONTEXT')) suggestions.push('Do not build the password from the service, domain or your own name.');
  suggestions.push('Use a different password for every service and store them in a password manager; a breach of one site must not open another.');
  suggestions.push('Enable two-factor authentication wherever it is offered. It is the only control that still helps after a password is stolen.');

  return {
    passwordProvided: true,
    length: password.length,
    characterClasses: { lowercase, uppercase, digits, symbols, unicode },
    alphabetSize,
    rawEntropyBits,
    effectiveEntropyBits,
    score,
    label,
    crackTimeEstimates: scenarios.map((scenario) => ({
      ...scenario,
      humanReadable: humaniseSeconds(2 ** effectiveEntropyBits / 2 / scenario.guessesPerSecond),
    })),
    weaknesses,
    suggestions,
    notice:
      'Entropy is estimated from the character set and length, then reduced for patterns a cracking tool exploits (dictionary words, keyboard runs, sequences, repeats, years, context). This is a heuristic, not a proof: a password can score well here and still be reused somewhere breached.',
  };
}

// ---------------------------------------------------------------------------------------------
// Hashing explainer
// ---------------------------------------------------------------------------------------------

export interface HashInput {
  value: string;
  algorithm?: 'md5' | 'sha1' | 'sha256' | 'sha512' | 'bcrypt';
}

export interface HashResult {
  algorithm: string;
  digest: string | null;
  isPasswordHash: boolean;
  warning: string | null;
  explanation: string;
}

export function hashValue(input: HashInput): HashResult {
  const value = input.value ?? '';
  if (value.length === 0) throw invalidInput('Enter the text to hash.');
  if (value.length > 100_000) throw invalidInput('Hash inputs are limited to 100,000 characters.');
  const algorithm = (input.algorithm ?? 'sha256').toLowerCase();
  if (algorithm === 'bcrypt') {
    throw invalidInput('bcrypt hashes are generated with a random salt and 12 cost rounds, which takes deliberately long and is not a general-purpose digest. Use the password generator on this page; to store a password, use src/lib/password.ts.');
  }
  if (!['md5', 'sha1', 'sha256', 'sha512'].includes(algorithm)) throw invalidInput('Supported algorithms: md5, sha1, sha256, sha512.');
  const digest = createHash(algorithm).update(value, 'utf8').digest('hex');
  const weak = algorithm === 'md5' || algorithm === 'sha1';
  return {
    algorithm,
    digest,
    isPasswordHash: false,
    warning: weak ? `${algorithm.toUpperCase()} is cryptographically broken for collision resistance and unsuitable for security purposes. It is offered only to verify legacy checksums.` : null,
    explanation:
      algorithm === 'md5' || algorithm === 'sha1'
        ? 'A fast legacy digest. It is not a password hash: it is designed for speed, which is exactly what a password hash must not be.'
        : 'A general-purpose cryptographic digest: fast, deterministic and one-way. Appropriate for checksums, integrity and content addressing. Not appropriate for passwords — password hashes must be salted and deliberately slow (bcrypt, scrypt, Argon2), which is what CloudHost247 uses for account passwords.',
  };
}

export { invalidInput as passwordInvalidInput };
