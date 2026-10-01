import { describe, expect, it, vi } from 'vitest';
import { parseWorkerOnceMode, runWorkerLoop } from '../../src/worker/runtime';

describe('worker runtime mode', () => {
  it('enables one-shot mode from the CLI flag or an explicit environment setting', () => {
    expect(parseWorkerOnceMode(['node', 'worker.js', '--once'])).toBe(true);
    expect(parseWorkerOnceMode(['node', 'worker.js'], true)).toBe(true);
    expect(parseWorkerOnceMode(['node', 'worker.js'])).toBe(false);
  });

  it('rejects unrecognised CLI options instead of silently changing worker behaviour', () => {
    expect(() => parseWorkerOnceMode(['node', 'worker.js', '--dangerous'])).toThrow(/Unknown worker option/);
  });

  it('runs exactly one cycle in cPanel one-shot mode, even when work was claimed', async () => {
    const cycle = vi.fn(async () => ({ didWork: true }));
    const sleep = vi.fn(async () => undefined);

    const result = await runWorkerLoop(cycle, {
      once: true,
      pollIntervalMs: 1,
      isRunning: () => true,
      sleep,
    });

    expect(result.cycles).toBe(1);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('sleeps only after an idle persistent cycle', async () => {
    let running = true;
    const cycle = vi.fn(async () => ({ didWork: false }));
    const sleep = vi.fn(async () => {
      running = false;
    });

    const result = await runWorkerLoop(cycle, {
      once: false,
      pollIntervalMs: 123,
      isRunning: () => running,
      sleep,
    });

    expect(result.cycles).toBe(1);
    expect(cycle).toHaveBeenCalledTimes(1);
    expect(sleep).toHaveBeenCalledWith(123);
  });

  it('fails a one-shot invocation when its cycle fails so Cron can alert the operator', async () => {
    await expect(
      runWorkerLoop(
        async () => {
          throw new Error('database unavailable');
        },
        { once: true, pollIntervalMs: 1, isRunning: () => true }
      )
    ).rejects.toThrow('database unavailable');
  });
});
