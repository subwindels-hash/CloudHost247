/**
 * php-wasm runtime shim — a real PHP interpreter for hosts with no PHP installed.
 *
 * WHY THIS EXISTS
 * `scripts/release-candidate-check.sh` lints 785 PHP targets and runs 18 behavioural
 * suites. On a machine that cannot install PHP (no root, no distro mirror reachable)
 * the entire gate is unrunnable and every PHP claim in the build notes stays
 * unverifiable. Node is a much lighter dependency than a PHP toolchain, so this shim
 * boots PHP compiled to WebAssembly and runs the real interpreter on the real files.
 *
 * WHY NOT `php-wasm-cli`
 * The stock CLI swallows the exit status — its `.finally(() => process.exit(0))`
 * unconditionally reports success — so `php -l` could never fail a build. That is
 * disqualifying for a release gate. This shim propagates the true status: a parse
 * error under `-l` exits non-zero, exactly as php-cli does.
 *
 * VERSIONS
 * `PHP_WASM_VERSION` selects the runtime (default 8.2). php-wasm ships 8.5, 8.4, 8.3,
 * 8.2, 8.1, 8.0 and 7.4, so both legs of the CI matrix (7.4 and 8.2) can be reproduced
 * locally — that pairing is what catches PHP-8-only syntax such as named arguments and
 * `match` expressions before it reaches a server running 7.4.
 */
import { spawn } from 'node:child_process';
import { loadNodeRuntime, useHostFilesystem } from '@php-wasm/node';
import { PHP, FileLockManagerInMemory } from '@php-wasm/universal';

const version = process.env.PHP_WASM_VERSION || '8.2';
const argv = process.argv.slice(2);

// Environment is handed to the runtime at load time, as the stock CLI does.
const { TMPDIR, ...env } = process.env;

let runtimeId;
try {
	runtimeId = await loadNodeRuntime(version, {
		fileLockManager: new FileLockManagerInMemory(),
		emscriptenOptions: { processId: 1, ENV: { ...env, TERM: 'xterm' } },
	});
} catch (error) {
	process.stderr.write(`php (wasm): cannot load PHP ${version}: ${error?.message}\n`);
	process.exit(127);
}

const php = new PHP(runtimeId);
// Same wiring as the stock CLI: without a spawn handler, booting PHP aborts with
// "popen(), proc_open() are unsupported on this PHP instance".
php.setSpawnHandler((command, args) =>
	spawn(command, args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] })
);
useHostFilesystem(php);

let response;
try {
	response = await php.cli(['php', ...argv]);
} catch (error) {
	process.stderr.write(`php (wasm): ${error?.message}\n`);
	process.exit(127);
}

// Both streams must be drained to completion; a bare pipeTo() leaves the event loop
// alive with the output still buffered.
const drain = async (stream, out) => {
	const reader = stream.getReader();
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		if (value) out.write(Buffer.from(value));
	}
};
await Promise.all([
	drain(response.stdout, process.stdout),
	drain(response.stderr, process.stderr),
]);

const code = await response.exitCode;
// The wasm runtime outlives the script, so exit explicitly with the real status.
process.exit(Number.isInteger(code) && code >= 0 && code < 256 ? code : 1);
