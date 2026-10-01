/** Small, dependency-free runtime control for the worker CLI. */
export interface WorkerCycleOutcome {
  /** True when the cycle claimed or scheduled meaningful work. */
  didWork: boolean;
}

export interface WorkerLoopOptions {
  once: boolean;
  pollIntervalMs: number;
  isRunning: () => boolean;
  sleep?: (milliseconds: number) => Promise<void>;
  onError?: (error: Error) => void;
}

export interface WorkerLoopResult {
  cycles: number;
}

/**
 * Parses the only supported worker CLI option. Keeping this narrow makes a cron command
 * auditable: `npm run worker:once` performs exactly one leased cycle and exits.
 */
export function parseWorkerOnceMode(argv: readonly string[], environmentOnce = false): boolean {
  const args = argv.slice(2);
  const unsupported = args.filter((arg) => arg !== '--once');
  if (unsupported.length > 0) {
    throw new Error(`Unknown worker option(s): ${unsupported.join(', ')}. Supported option: --once`);
  }
  return environmentOnce || args.includes('--once');
}

/**
 * Repeatedly runs a cycle for supervised deployments, or exactly once for cPanel Cron.
 * An error in one-shot mode is re-thrown so Cron records a non-zero failure; a persistent worker
 * logs it and retries on the next polling interval instead of dying permanently.
 */
export async function runWorkerLoop(
  runCycle: () => Promise<WorkerCycleOutcome>,
  options: WorkerLoopOptions
): Promise<WorkerLoopResult> {
  const sleep = options.sleep ?? ((milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let cycles = 0;

  while (options.isRunning()) {
    let outcome: WorkerCycleOutcome;
    try {
      outcome = await runCycle();
      cycles += 1;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      options.onError?.(normalized);
      if (options.once) throw normalized;
      outcome = { didWork: false };
    }

    if (options.once || !options.isRunning()) break;
    if (!outcome.didWork) await sleep(options.pollIntervalMs);
  }

  return { cycles };
}
