/**
 * Read-only mail trace evidence (Exim).
 *
 * This module exists because the control plane must never be able to ask a server for "a file" or
 * "a command". It exposes exactly two capabilities:
 *
 *   1. Read the next slice of bytes from an Exim message log, starting at a checkpoint offset, from
 *      a path that is on the *agent's own* allowlist.
 *   2. Read the current queue listing (`exim -bp`), which prints text and changes nothing.
 *
 * Neither capability can delete a message, freeze it, force delivery, edit Exim configuration,
 * restart a service, run a shell, or read an arbitrary path. The log slice is bounded in size and
 * always ends on a line boundary, so the control plane's checkpoint can never land mid-line.
 *
 * The agent does not interpret the log — it returns lines verbatim. Parsing, normalisation and
 * status resolution all happen in the control plane, where they are tested and where the privacy
 * rules (no bodies, no subjects, no credentials) are enforced on the way into the database.
 */
import { execFile as nodeExecFile } from 'node:child_process';
import { open, stat } from 'node:fs/promises';

/** Where Exim keeps its message log on a cPanel host and on a distribution package. */
export const DEFAULT_MAINLOG_PATHS = ['/var/log/exim_mainlog', '/var/log/exim/mainlog'];

/** Hard ceiling per call, regardless of what the control plane asks for. */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/** The queue listing is informational; cap what we agree to return. */
export const MAX_QUEUE_BYTES = 4 * 1024 * 1024;

/**
 * Resolve the log path to read.
 *
 * `requested` is honoured only when it is byte-for-byte one of the configured allowlist entries.
 * Anything else — a traversal, a symlinked log for another host, `/etc/shadow` — is refused and
 * reported as "not readable", never attempted.
 */
export function resolveMainlogPath(config, requested) {
  const allowed = Array.isArray(config?.mainlogPaths) && config.mainlogPaths.length > 0
    ? config.mainlogPaths
    : DEFAULT_MAINLOG_PATHS;
  if (requested === null || requested === undefined) return { path: null, allowed, refused: null };
  if (typeof requested !== 'string' || !allowed.includes(requested)) {
    return { path: null, allowed, refused: 'The requested log path is not on the agent’s allowlist.' };
  }
  return { path: requested, allowed, refused: null };
}

/**
 * Read a bounded, line-aligned slice of a file.
 *
 * Returns `lines` without the trailing newline and `nextOffset` pointing just past the last complete
 * line, so the caller resumes exactly where reading stopped. A file shorter than the requested
 * offset is reported as a rotation (`reset: true`) instead of being read from a stale position.
 */
export async function readLogSlice({ path, offset = 0, maxBytes = 2 * 1024 * 1024, fs = { open, stat } }) {
  const limit = Math.max(1, Math.min(Number(maxBytes) || 0, MAX_READ_BYTES));
  const handle = await fs.open(path, 'r');
  try {
    const info = await handle.stat();
    const fileSize = Number(info.size ?? 0);
    const inode = info.ino === undefined ? null : String(info.ino);
    const reset = Number(offset) > fileSize;
    const start = reset ? 0 : Math.max(0, Number(offset) || 0);
    const want = Math.min(limit, Math.max(0, fileSize - start));
    const buffer = Buffer.alloc(want);
    const { bytesRead } = want === 0 ? { bytesRead: 0 } : await handle.read(buffer, 0, want, start);
    const slice = buffer.subarray(0, bytesRead);
    const lastNewline = slice.lastIndexOf(0x0a);
    const complete = lastNewline === -1 ? Buffer.alloc(0) : slice.subarray(0, lastNewline + 1);
    const lines = complete.toString('utf8').split('\n');
    if (lines.length > 0) lines.pop(); // the text ends with '\n', so the final element is empty
    const nextOffset = start + complete.length;
    return {
      path,
      offset: start,
      nextOffset,
      fileSize,
      inode,
      lines,
      reset,
      // More bytes remain unread: either we stopped at the byte ceiling or a partial line is waiting.
      truncated: nextOffset < fileSize,
    };
  } finally {
    await handle.close();
  }
}

/**
 * Read the queue listing read-only.
 *
 * `exim -bp` prints the queue. There is no flag here for `-Mrm`, `-Mf`, `-Mg`, `-qff` or anything
 * else that would change a message's fate, and the command is invoked without a shell.
 */
export async function readQueue({ execFile = nodeExecFile, timeoutMs = 15_000 } = {}) {
  try {
    const { stdout } = await execFile('exim', ['-bp'], { timeout: timeoutMs, maxBuffer: MAX_QUEUE_BYTES });
    return { available: true, output: String(stdout ?? ''), note: null };
  } catch (err) {
    const missing = err && err.code === 'ENOENT';
    return {
      available: false,
      output: null,
      note: missing
        ? 'The exim binary is not on the agent’s PATH, so the queue cannot be listed.'
        : 'The read-only queue listing command did not complete.',
    };
  }
}

/**
 * The whole `POST /v1/mail/trace` operation.
 *
 * Every branch returns the same shape, because the control plane turns it into a capability report:
 * "readable", "not readable but here is why", or "this agent is too old". It never throws for an
 * expected condition, and it never returns a partial line.
 */
export async function mailTrace(request, { config, deps = {} } = {}) {
  const fs = deps.fs ?? { open, stat };
  const execFile = deps.execFile ?? nodeExecFile;
  const notes = [];

  const resolution = resolveMainlogPath(config, request?.mainlogPath ?? null);
  if (resolution.refused) notes.push(resolution.refused);

  const offset = Number.isFinite(Number(request?.offset)) && Number(request.offset) >= 0 ? Number(request.offset) : 0;
  const maxBytes = Number.isFinite(Number(request?.maxBytes)) ? Number(request.maxBytes) : undefined;

  // An explicitly requested path that is not allowed is a refusal, not a hint: we do not fall back
  // to the default log, so a caller cannot probe the filesystem by observing which read happened.
  const candidates = resolution.refused ? [] : resolution.path ? [resolution.path] : resolution.allowed;
  let mainlog = null;
  let mainlogReadable = false;

  for (const candidate of candidates) {
    try {
      const slice = await readLogSlice({ path: candidate, offset, maxBytes, fs });
      mainlog = { ...slice, offset: resolution.path ? slice.offset : offset };
      mainlogReadable = true;
      break;
    } catch (err) {
      const missing = err && err.code === 'ENOENT';
      notes.push(
        missing
          ? `No Exim message log at ${candidate}.`
          : `The Exim message log at ${candidate} could not be read by the agent’s account (${err?.code ?? 'error'}).`
      );
    }
  }

  let queue = null;
  let queueListingAvailable = null;
  if (request?.includeQueue !== false) {
    const result = await readQueue({ execFile });
    queueListingAvailable = result.available;
    if (result.note) notes.push(result.note);
    if (result.available) queue = { output: result.output };
  }

  return {
    agentVersion: config?.version ?? null,
    supportsMailTrace: true,
    capability: {
      mainlogReadable,
      mainlogPath: mainlog ? mainlog.path : null,
      queueListingAvailable,
      notes,
    },
    mainlog,
    queue,
  };
}
