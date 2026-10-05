#!/usr/bin/env node
/**
 * Password-hash migration tool — reports legacy hashes and invites those users to reset.
 *
 * There are two very different situations to report, and they get very different treatment:
 *
 *   legacy (bcrypt)      A hash from the old bcryptjs platform. This codebase cannot verify it
 *                        (see the note in src/lib/password.js) and cannot re-hash it either,
 *                        because re-hashing needs the plaintext password, which nobody has. The
 *                        only honest remedy is a password-reset invitation.
 *   stale scrypt params  A scrypt hash written with older parameters. It still verifies, and the
 *                        login route upgrades it in place on the next successful sign-in, so this
 *                        tool only reports it. It never touches the stored hash.
 *
 * Usage:
 *   node scripts/rehash-passwords.js                      # dry run (the default): report only
 *   node scripts/rehash-passwords.js --apply              # create reset invitations
 *   node scripts/rehash-passwords.js --apply --out f.txt  # write the tokens to a file (mode 0600)
 *   node scripts/rehash-passwords.js --email a@b.c        # a single account
 *   node scripts/rehash-passwords.js --json               # machine-readable summary
 *
 * Guarantees:
 *   - It never writes a password hash. It has no plaintext passwords and will not invent any.
 *   - `--apply` only inserts `auth_recovery` rows of kind `password_reset`, exactly like
 *     POST /api/v1/auth/password/forgot: `token_hash = sha256(random 32-byte token)`, expiring in
 *     one hour. The raw token is never stored.
 *   - Accounts that already have a live invitation are skipped unless `--force` is passed, so
 *     re-running the tool cannot pile up reset links.
 *   - Raw tokens are surfaced only where the platform itself would surface them: on stdout when
 *     NODE_ENV is not production, or in the `--out` file (written 0600). In production, `--apply`
 *     refuses to run without `--out`, so tokens cannot leak into a log or a CI transcript.
 *
 * Known gap, stated plainly: this build has no mail transport and no reset page, so the tool cannot
 * deliver anything by itself. It prepares invitations and hands the operator the tokens (or the
 * file) to deliver through a channel they trust. The token is consumed by
 * `POST /api/v1/auth/password/reset` with `{ "token": ..., "password": ... }`.
 */
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const { loadConfig } = require('../src/core/config');
const { createLogger } = require('../src/core/logger');
const { createStore } = require('../src/store');
const { uuidv7, randomToken } = require('../src/lib/ids');
const { isLegacyHash, needsRehash, DEFAULT_PARAMS } = require('../src/lib/password');

const INVITE_TTL_MS = 3600_000; // one hour, same as the HTTP flow

const USAGE = `Usage: node scripts/rehash-passwords.js [options]

  --apply          create password-reset invitations (default: dry run)
  --email <addr>   only consider this account
  --out <file>     write "${'email<TAB>token<TAB>expiresAt'}" lines to <file>, mode 0600
  --force          invite even when a live invitation already exists
  --limit <n>      stop after scanning n accounts
  --json           print a JSON summary instead of a table
  --help           this text`;

function parseArgs(argv) {
  const options = {
    apply: false, force: false, email: null, out: null, limit: null, json: false, help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) throw new Error(`${arg} needs a value`);
      return argv[i];
    };
    if (arg === '--apply') options.apply = true;
    else if (arg === '--dry-run') options.apply = false;
    else if (arg === '--force') options.force = true;
    else if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--email') options.email = String(next()).trim().toLowerCase();
    else if (arg === '--out') options.out = next();
    else if (arg === '--limit') {
      options.limit = Number(next());
      if (!Number.isInteger(options.limit) || options.limit <= 0) throw new Error('--limit must be a positive integer');
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fmt = (date) => new Date(date).toISOString();

const STATUS = {
  LEGACY: 'legacy-bcrypt',
  BLANK: 'blank-hash',
  STALE: 'stale-scrypt-params',
  CURRENT: 'current',
  INVITED: 'invited',
  SKIPPED: 'skipped-live-invite',
};

/** True when the account already has an unconsumed, unexpired password_reset invitation. */
async function hasLiveInvite(store, userId, now) {
  const { rows } = await store.table('auth_recovery').find({ user_id: userId, kind: 'password_reset' });
  return rows.some((row) => !row.consumed_at && new Date(row.expires_at).getTime() > now);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const { config, warnings } = loadConfig({ cwd: path.join(__dirname, '..') });
  // Diagnostics go to stderr, never stdout: stdout may be piped into `jq` via --json.
  const logger = createLogger({ level: 'error', base: { tool: 'rehash-passwords' } });
  for (const warning of warnings) process.stderr.write(`rehash-passwords: warning: ${warning}\n`);

  const isProduction = config.NODE_ENV === 'production';
  // Refuse before touching the database: an operator who asks for --apply in production must say
  // where the tokens may go.
  if (options.apply && isProduction && !options.out) {
    process.stderr.write(
      'Refusing to run --apply in production without --out: the raw tokens would have nowhere safe '
      + 'to go (this build has no mail transport). Re-run with --apply --out <file>.\n',
    );
    return 1;
  }

  const store = await createStore(config, logger);
  try {
    const users = store.table('users');
    const now = Date.now();

    let candidates;
    if (options.email) {
      const user = await users.findOneCi('email', options.email);
      candidates = user ? [user] : [];
    } else {
      const { rows } = await users.find({}, options.limit ? { limit: options.limit } : {});
      candidates = rows;
    }

    const report = [];
    for (const user of candidates) {
      const hash = user.password_hash;
      if (typeof hash !== 'string' || hash.length === 0) {
        // A blank hash cannot be a bcrypt hash and cannot be re-hashed either: it is a corrupted or
        // half-provisioned row. An audit is exactly where that should surface.
        report.push({
          userId: user.id, email: user.email, status: STATUS.BLANK, invited: false, expiresAt: null,
        });
        continue;
      }
      if (!isLegacyHash(hash) && !needsRehash(hash)) continue; // nothing to report

      const entry = {
        userId: user.id,
        email: user.email,
        status: isLegacyHash(hash) ? STATUS.LEGACY : STATUS.STALE,
        invited: false,
        expiresAt: null,
      };

      if (entry.status === STATUS.LEGACY && options.apply) {
        if (!options.force && await hasLiveInvite(store, user.id, now)) {
          entry.status = STATUS.SKIPPED;
        } else {
          const token = randomToken(32);
          const expiresAt = new Date(now + INVITE_TTL_MS).toISOString();
          await store.table('auth_recovery').insert({
            id: uuidv7(),
            user_id: user.id,
            kind: 'password_reset',
            token_hash: sha256(token),
            expires_at: expiresAt,
          });
          entry.status = STATUS.INVITED;
          entry.invited = true;
          entry.expiresAt = expiresAt;
          entry.token = token; // held in memory only; written below under the policy above
        }
      }

      report.push(entry);
    }

    const invited = report.filter((entry) => entry.invited);
    const legacy = report.filter((entry) => entry.status === STATUS.LEGACY);
    const stale = report.filter((entry) => entry.status === STATUS.STALE);
    const skipped = report.filter((entry) => entry.status === STATUS.SKIPPED);
    const blank = report.filter((entry) => entry.status === STATUS.BLANK);

    if (options.out && invited.length > 0) {
      const lines = [
        '# Password-reset invitations for accounts with legacy (bcrypt) password hashes.',
        '# Format: <email>\\t<reset token>\\t<expires at>',
        '# The token is consumed by POST /api/v1/auth/password/reset {"token": "...", "password": "..."}.',
        '# This build has no reset page and no mail transport: deliver each line to its owner yourself.',
        ...invited.map((entry) => `${entry.email}\t${entry.token}\t${entry.expiresAt}`),
      ];
      fs.writeFileSync(options.out, `${lines.join('\n')}\n`, { mode: 0o600 });
    }

    const summary = {
      scanned: candidates.length,
      legacyBcrypt: legacy.length + invited.length + skipped.length,
      staleScryptParams: stale.length,
      blankHashes: blank.length,
      invited: invited.length,
      skippedLiveInvites: skipped.length,
      applied: options.apply,
      outFile: options.out,
      staleThreshold: `N=${DEFAULT_PARAMS.N} r=${DEFAULT_PARAMS.r} p=${DEFAULT_PARAMS.p}`,
    };

    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        summary,
        accounts: report.map(({ token, ...rest }) => rest),
      }, null, 2)}\n`);
    } else {
      process.stdout.write(
        `Scanned ${summary.scanned} account(s): `
        + `${summary.legacyBcrypt} with a legacy bcrypt hash, `
        + `${summary.staleScryptParams} with stale scrypt parameters, `
        + `${summary.blankHashes} with a blank hash.\n`,
      );
      for (const entry of report) {
        process.stdout.write(`  ${entry.email ?? entry.userId}  ${entry.status}${entry.expiresAt ? `  until ${entry.expiresAt}` : ''}\n`);
      }
      if (!options.apply) {
        process.stdout.write(
          '\nDry run: nothing was written. Re-run with --apply to create reset invitations.\n'
          + 'Legacy bcrypt hashes cannot be re-hashed — they can only be reset.\n',
        );
      } else {
        process.stdout.write(
          `\nCreated ${invited.length} reset invitation(s); skipped ${skipped.length} account(s) with a live invite.\n`,
        );
        if (stale.length > 0) {
          process.stdout.write(
            `Left ${stale.length} stale scrypt hash(es) alone: they still verify, and the login route `
            + 'upgrades them on the next successful sign-in.\n',
          );
        }
        if (invited.length > 0 && !options.out && !isProduction) {
          process.stdout.write('\nReset tokens (development only — no mail transport is configured):\n');
          for (const entry of invited) process.stdout.write(`  ${entry.email}\t${entry.token}\n`);
        }
        if (invited.length > 0 && isProduction) {
          process.stdout.write(`Tokens were written to ${options.out} (mode 0600). Deliver them out of band.\n`);
        }
      }
    }

    return 0;
  } finally {
    await store.close();
  }
}

if (require.main === module) {
  main()
    .then((code) => { process.exitCode = code; })
    .catch((err) => {
      process.stderr.write(`rehash-passwords: ${err.message}\n`);
      process.exitCode = 1;
    });
}

module.exports = { parseArgs, main, STATUS, INVITE_TTL_MS };
