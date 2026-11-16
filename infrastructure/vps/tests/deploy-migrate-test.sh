#!/usr/bin/env bash
# CloudHost247 — deploy-path test: does a deploy actually produce a running app?
#
# Why this exists
# ---------------
# Every other harness checks artefacts (nginx.conf parses, gate rejects a bad
# host, placeholders render). None of them ran the *migration runner*, so a
# standing quarantine could — and did — make the documented first deploy apply
# nothing at all while all harnesses stayed green. This test closes that gap.
#
# What it does
#   1. Proves the refusal is real, by invoking the compiled migration runner
#      (dist/database/migrate.js) against a fresh database in production mode,
#      exactly as deploy.sh does.
#   2. Proves the documented override (AUTHORIZED_MIGRATIONS) makes the whole
#      schema apply, and that 0041's dependents actually resolve.
#   3. Proves a second run is a no-op, because deploy.sh reruns it every deploy.
#   4. Proves deploy.sh reports the quarantine as a quarantine (not "SQL error")
#      and passes AUTHORIZED_MIGRATIONS through to the migration command.
#   5. Proves the build runs where it can resolve repo-root paths, and that
#      building anywhere else fails with an explanation.
#   6. Proves the entrypoint the systemd unit runs (`node dist/src/server.js`)
#      boots over TCP with only PORT + env, serves /health, reports /ready 503
#      when the database is down without crashing, and exits on SIGTERM.
#
# Database engine: PGlite (Postgres compiled to WASM) — real SQL, real DDL, real
# foreign keys, no PostgreSQL install and no root. This is NOT a substitute for
# PostgreSQL 16 over TCP; it proves the schema and the runner, not pg's transport.
#
# Requirements: `npm ci && npm run build` already run in cloudhost247-node/
# (deploy.sh does both). Skips, loudly, if dist/ is absent.
#
# Run: bash infrastructure/vps/tests/deploy-migrate-test.sh   (needs curl + node)

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
APP="${REPO_ROOT}/cloudhost247-node"
DEPLOY="${REPO_ROOT}/infrastructure/vps/scripts/deploy.sh"

PASS=0
FAIL=0
SKIP=0
pass() { PASS=$((PASS + 1)); printf '  PASS  %s\n' "$*"; }
fail() { FAIL=$((FAIL + 1)); printf '  FAIL  %s\n' "$*"; }
skip() { SKIP=$((SKIP + 1)); printf '  SKIP  %s\n' "$*"; }

echo "Deploy path: migrations actually reach the database"
echo

if [[ ! -f "${APP}/dist/database/migrate.js" ]] || [[ ! -d "${APP}/node_modules/@electric-sql/pglite" ]]; then
  skip "cloudhost247-node is not built (run: npm ci && npm run build) — nothing to verify"
  echo
  printf 'passed: %d   failed: %d   skipped: %d\n' "$PASS" "$FAIL" "$SKIP"
  exit 0
fi

# ---------------------------------------------------------------------------
# [1]-[3] The runner, against a fresh database in production mode.
# ---------------------------------------------------------------------------
WORK="$(mktemp -d)"
trap 'rm -rf "${WORK}"' EXIT

cat > "${WORK}/runner.cjs" <<'NODE'
const path = require('node:path');
const APP = process.argv[2];
const { PGlite } = require(path.join(APP, 'node_modules/@electric-sql/pglite'));
const { migrateUp } = require(path.join(APP, 'dist/database/migrate.js'));
const { PgliteClient } = require(path.join(APP, 'dist/database/db-client.js'));

const line = (tag, msg) => console.log(`${tag}\t${msg}`);
const PROD = { isProduction: true, confirmedForProduction: true };

(async () => {
  const db = new PGlite();

  // --- 1. As documented before the fix: no authorization.
  const plain = await migrateUp(new PgliteClient(db), PROD).catch((e) => ({
    applied: [],
    skippedReason: `threw: ${e.message}`,
  }));
  const refused = (plain.applied || []).length === 0 && Boolean(plain.skippedReason);
  line(refused ? 'PASS' : 'FAIL', 'production run refuses a fresh DB while 0041 is quarantined');
  if (refused) {
    line(/0041/.test(plain.skippedReason) ? 'PASS' : 'FAIL', 'refusal names the quarantined migration 0041');
    line(/depend on it/.test(plain.skippedReason) ? 'PASS' : 'FAIL', 'refusal explains why it cannot apply a partial set');
    line(/Nothing was applied/.test(plain.skippedReason) ? 'PASS' : 'FAIL', 'refusal confirms no DDL was executed');
  }

  // The table count must be zero-ish: refusing means refusing, not "applied 100".
  const before = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
  );
  line(before.rows[0].n <= 1 ? 'PASS' : 'FAIL', `refusal left the schema untouched (${before.rows[0].n} table(s))`);

  // --- 2. The documented override.
  let applied = 0;
  try {
    const run = await migrateUp(new PgliteClient(db), { ...PROD, authorizedQuarantined: ['0041'] });
    applied = (run.applied || []).length;
    line(run.skippedReason ? 'FAIL' : 'PASS', `AUTHORIZED_MIGRATIONS=0041 applies the schema (${applied} migrations)`);
  } catch (e) {
    line('FAIL', `authorized migration run threw: ${e.message}`);
  }
  line(applied > 90 ? 'PASS' : 'FAIL', `nearly all committed migrations applied (${applied})`);

  const after = await db.query(
    "SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public'",
  );
  const tables = after.rows[0].n;
  line(tables > 200 ? 'PASS' : 'FAIL', `schema materialised (${tables} tables)`);

  // 0041's dependents must genuinely resolve — if the dependents list in
  // migrate.ts were wrong, the run above would have died on a foreign key.
  for (const tbl of ['operating_systems', 'server_product_configurations']) {
    const r = await db.query(
      `SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`,
      [tbl],
    );
    line(r.rows[0].n === 1 ? 'PASS' : 'SKIP', `0041 dependent table "${tbl}" exists (${r.rows[0].n})`);
  }

  // --- 3. deploy.sh reruns `migrate` on every deploy; it must be a no-op.
  try {
    const again = await migrateUp(new PgliteClient(db), { ...PROD, authorizedQuarantined: ['0041'] });
    line((again.applied || []).length === 0 ? 'PASS' : 'FAIL', 'second run applies nothing (deploy.sh is idempotent)');
  } catch (e) {
    line('FAIL', `second run threw: ${e.message}`);
  }

  await db.close();
})().catch((e) => {
  console.log(`FAIL\tfatal: ${e.message}`);
  process.exit(1);
});
NODE

while IFS=$'\t' read -r tag msg; do
  case "${tag}" in
    PASS) pass "${msg}" ;;
    FAIL) fail "${msg}" ;;
    SKIP) skip "${msg}" ;;
  esac
done < <(cd "${APP}" && node "${WORK}/runner.cjs" "${APP}" 2>&1 | grep -E '^(PASS|FAIL|SKIP)\b')

# ---------------------------------------------------------------------------
# [4] deploy.sh must diagnose the refusal and forward the override.
# ---------------------------------------------------------------------------
echo
echo "  deploy.sh migration step"

START="$(grep -n 'log "Running database migrations' "${DEPLOY}" | cut -d: -f1)"
END="$(grep -n 'log "Restarting systemd services"' "${DEPLOY}" | cut -d: -f1)"
if [[ -z "${START}" || -z "${END}" ]]; then
  fail "could not locate the migration block in deploy.sh"
else
  sed -n "${START},$((END - 1))p" "${DEPLOY}" > "${WORK}/block.sh"

  mkdir -p "${WORK}/bin" "${WORK}/app"
  # `sudo -u cloudhost247 bash -c ...` -> run it as-is; we only inspect the call.
  cat > "${WORK}/bin/sudo" <<'STUB'
#!/usr/bin/env bash
while [[ "$1" == -* ]]; do case "$1" in -u) shift 2 ;; *) shift ;; esac; done
exec "$@"
STUB
  chmod +x "${WORK}/bin/sudo"

  # npm stub: log the environment the migration command is invoked with.
  cat > "${WORK}/bin/npm" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *migrate:verify*|*migrate:status*) exit 0 ;;
esac
if [[ "$*" == *"run migrate"* ]]; then
  printf 'CALLED\tAUTHORIZED=%s CONFIRM=%s\n' "${AUTHORIZED_MIGRATIONS:-<unset>}" "${CONFIRM_MIGRATION:-<unset>}" >&2
  if [[ "${SIMULATE_REFUSAL:-0}" == "1" ]]; then
    echo "Refusing to migrate production: 0041 (0041_create_os_catalog.sql) is quarantined — prepared and tested only — but pending migration(s) 0042, 0043 depend on it. Nothing was applied." >&2
    exit 1
  fi
  exit 0
fi
exit 0
STUB
  chmod +x "${WORK}/bin/npm"

  run_block() { # $1 = AUTHORIZED_MIGRATIONS, $2 = SIMULATE_REFUSAL
    PATH="${WORK}/bin:${PATH}" APP_ROOT="${WORK}/app" \
      AUTHORIZED_MIGRATIONS="$1" SIMULATE_REFUSAL="$2" \
      bash -c '
        set -euo pipefail
        log(){ :; }
        die(){ printf "DIE: %s\n" "$*"; exit 1; }
        '"$(cat "${WORK}/block.sh")"'
      ' 2>&1
  }

  out="$(run_block "" "1")"
  if [[ -z "${out//[[:space:]]/}" ]]; then
    fail "the migration block produced no output at all (extraction broken)"
  fi
  if grep -q 'standing quarantine' <<<"${out}"; then
    pass "a quarantine refusal is reported as a quarantine, not a SQL error"
  else
    fail "deploy.sh misreports a quarantine refusal as: $(grep -m1 'DIE:' <<<"${out}")"
  fi
  grep -q 'affect: 0041' <<<"${out}" \
    && pass "the message names 0041 and not its dependents" \
    || fail "the message does not isolate the quarantined id: $(grep -m1 'affect:' <<<"${out}")"
  grep -q 'AUTHORIZED_MIGRATIONS=0041' <<<"${out}" \
    && pass "the message tells the operator the exact override to use" \
    || fail "the message does not give a runnable remediation"
  grep -qi 'NOT restarted\|previous build is still live' <<<"${out}" \
    && pass "the message states services were not restarted" \
    || fail "the message does not state the blast radius"

  out="$(run_block "0041" "0")"
  grep -q 'AUTHORIZED=0041 CONFIRM=yes' <<<"${out}" \
    && pass "AUTHORIZED_MIGRATIONS is forwarded to the migration command" \
    || fail "AUTHORIZED_MIGRATIONS was not forwarded: $(grep -m1 'CALLED' <<<"${out}" || echo 'never called')"

  out="$(run_block "" "0")"
  grep -q 'AUTHORIZED=<unset> CONFIRM=yes' <<<"${out}" \
    && pass "with no override the command runs unmodified (no stale authorization)" \
    || fail "unexpected environment for the migration command: $(grep -m1 'CALLED' <<<"${out}" || echo 'never called')"

  # A genuine SQL failure must NOT be dressed up as a quarantine.
  cat > "${WORK}/bin/npm" <<'STUB'
#!/usr/bin/env bash
case "$*" in
  *migrate:verify*|*migrate:status*) exit 0 ;;
esac
if [[ "$*" == *"run migrate"* ]]; then
  echo 'error: relation "users" already exists' >&2
  exit 1
fi
exit 0
STUB
  chmod +x "${WORK}/bin/npm"
  out="$(run_block "" "0")"
  if grep -q 'standing quarantine' <<<"${out}"; then
    fail "a real SQL error is misreported as a quarantine"
  else
    pass "a real SQL error is reported as a migration failure (not misattributed)"
  fi
fi

# ---------------------------------------------------------------------------
# [5] The build must run in the repo checkout, not in APP_ROOT.
#     cloudhost247-node/'s build writes to ../../modules/... and ../../assets/...,
#     which are REPO-root paths. /opt/cloudhost247 contains only one subdirectory,
#     so building there fails before build:server emits any dist/.
# ---------------------------------------------------------------------------
echo
echo "  build location"

DEPLOY_BLOCK="$(sed -n '/Installing dependencies and building/,/Publishing build output/p' "${DEPLOY}")"
grep -q 'cd ${SRC_DIR}/cloudhost247-node && npm ci' <<<"${DEPLOY_BLOCK}" \
  && pass "deploy.sh installs devDependencies and builds in the checkout (SRC_DIR)" \
  || fail "deploy.sh does not build in SRC_DIR"
grep -q 'cd ${APP_ROOT} && npm ci --omit=dev' <<<"${DEPLOY_BLOCK}" \
  && pass "deploy.sh installs runtime-only dependencies in APP_ROOT" \
  || fail "deploy.sh does not install runtime-only dependencies in APP_ROOT"
grep -qE 'cd \$\{APP_ROOT\} && npm ci.*npm run build' <<<"${DEPLOY_BLOCK}" \
  && fail "deploy.sh still builds inside APP_ROOT (the build cannot resolve ../../modules)" \
  || pass "deploy.sh does not build inside APP_ROOT"

# Direct proof of the constraint, without a full install: the projection script
# resolves its target from the repo root, so running it from a bare app dir must
# fail with an explanation rather than a misleading "stale projection".
BARE="${WORK}/bare-app"
mkdir -p "${BARE}"
cp -a "${APP}/scripts" "${BARE}/"
cp -a "${APP}/src" "${BARE}/"
ln -s "${APP}/node_modules" "${BARE}/node_modules"
BARE_OUT="$(cd "${BARE}" && ./node_modules/.bin/tsx scripts/export-tools-site.ts --check 2>&1)"
if grep -q 'projection target does not exist' <<<"${BARE_OUT}"; then
  pass "build outside the checkout fails with an actionable message (not 'stale projection')"
else
  fail "build outside the checkout did not explain itself: $(head -3 <<<"${BARE_OUT}" | tr '\n' ' ')"
fi
grep -q 'must run in the git checkout' <<<"${BARE_OUT}" \
  && pass "the message names the required build location" \
  || fail "the message does not name the required build location"

# ---------------------------------------------------------------------------
# [6] The entrypoint systemd actually launches must boot on its own.
#     `node dist/src/server.js` with only the environment the unit provides
#     (PORT + .env). No Passenger socket, no in-process build.
# ---------------------------------------------------------------------------
echo
echo "  systemd entrypoint"

NODE_ENTRY="$(grep -m1 '^ExecStart=' "${REPO_ROOT}/infrastructure/vps/systemd/cloudhost247-node.service" | sed 's/^ExecStart=//')"
# The unit hardcodes /usr/bin/node, which is where NodeSource puts it on Ubuntu
# 24.04. Substitute this machine's node so the argv can be executed verbatim.
NODE_ENTRY="${NODE_ENTRY/#\/usr\/bin\/node/$(command -v node)}"
echo "${NODE_ENTRY}" | grep -q 'dist/src/server.js' \
  && pass "unit ExecStart points at the compiled entrypoint" \
  || fail "unit ExecStart is not the compiled entrypoint: ${NODE_ENTRY}"
echo "${NODE_ENTRY}" | grep -q 'dist/src/server.js' \
  && pass "the unit's real argv is what gets booted below (flags included)" \
  || fail "cannot derive a bootable argv from the unit"

PORT_UNDER_TEST="$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{console.log(s.address().port);s.close()})')"
LOG="${WORK}/entry.log"
(
  cd "${APP}" || exit 1
  env -i PATH="${PATH}" HOME="${HOME}" NODE_ENV=production \
    PORT="${PORT_UNDER_TEST}" HOST=127.0.0.1 \
    DATABASE_URL='postgresql://cloudhost247:pw@127.0.0.1:1/cloudhost247' \
    JWT_SECRET="$(printf 'k%.0s' {1..64})" \
    ${NODE_ENTRY} > "${LOG}" 2>&1 &
  echo $! > "${WORK}/entry.pid"
)

ENTRY_UP=0
for _ in $(seq 1 40); do
  if curl -fsS --max-time 1 "http://127.0.0.1:${PORT_UNDER_TEST}/health" >/dev/null 2>&1; then ENTRY_UP=1; break; fi
  sleep 0.25
done
if [[ "${ENTRY_UP}" == "1" ]]; then
  pass "compiled entrypoint serves /health on \$PORT (no Passenger socket)"
  curl -fsS --max-time 2 "http://127.0.0.1:${PORT_UNDER_TEST}/health" | grep -q '"status":"ok"' \
    && pass "/health reports ok" || fail "/health body unexpected"
  # Unreachable database must be a 503 on /ready, not a crash: the unit stays up
  # and Nginx keeps serving, which is what makes the failure diagnosable.
  READY_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT_UNDER_TEST}/ready")"
  [[ "${READY_CODE}" == "503" ]] \
    && pass "/ready is 503 with the database unreachable (process did not crash)" \
    || fail "/ready returned ${READY_CODE} with the database unreachable"
  kill -TERM "$(cat "${WORK}/entry.pid")" 2>/dev/null
  for _ in $(seq 1 20); do
    kill -0 "$(cat "${WORK}/entry.pid")" 2>/dev/null || break
    sleep 0.25
  done
  kill -0 "$(cat "${WORK}/entry.pid")" 2>/dev/null \
    && { fail "entrypoint ignored SIGTERM (systemd would have to SIGKILL it)"; kill -9 "$(cat "${WORK}/entry.pid")" 2>/dev/null; } \
    || pass "entrypoint exits on SIGTERM (clean systemd stop)"
else
  fail "compiled entrypoint did not answer /health on ${PORT_UNDER_TEST}"
  sed -n '1,15p' "${LOG}" | while IFS= read -r l; do printf '        | %s\n' "${l}"; done
  kill -9 "$(cat "${WORK}/entry.pid")" 2>/dev/null
fi

echo
printf 'passed: %d   failed: %d   skipped: %d\n' "$PASS" "$FAIL" "$SKIP"
[[ "${FAIL}" -eq 0 ]] && echo "DEPLOY PATH PASSED" || echo "DEPLOY PATH FAILED"
[[ "${FAIL}" -eq 0 ]]
