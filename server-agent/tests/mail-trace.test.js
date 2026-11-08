/**
 * Server agent — read-only mail trace operation.
 *
 * These tests use a fake filesystem and a fake `execFile`: no Exim log exists on the test machine and
 * none is read here. What they pin down is the boundary — which paths may be read, that a slice is
 * line-aligned and bounded, that a rotated log is reported instead of misread, and that the queue
 * listing can never be anything but the read-only `exim -bp`.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_MAINLOG_PATHS,
  MAX_READ_BYTES,
  mailTrace,
  readLogSlice,
  readQueue,
  resolveMainlogPath,
} from '../src/mail-trace.js';

const LOG = [
  '2026-11-08 09:14:02 1xYzAb-000123-CD <= sender@example.com H=(mail.sender.example) [203.0.113.5] P=esmtpa S=4821 id=8f2c9a@example.com',
  '2026-11-08 09:14:03 1xYzAb-000123-CD => recipient@example.org R=dnslookup T=remote_smtp H=mx.example.org [198.51.100.9] C="250 2.0.0 Ok"',
  '2026-11-08 09:14:04 1xYzAb-000124-EF <= other@example.com P=esmtpa S=100 id=8f2c9b@example.com',
  '',
].join('\n');

const LOG_BUFFER = Buffer.from(LOG, 'utf8');

function fakeFs({ content = LOG_BUFFER, inode = 42, failWith = null, events = [] } = {}) {
  return {
    async open(path, flags) {
      if (failWith) {
        const err = new Error(failWith.code ?? 'EACCES');
        err.code = failWith.code;
        throw err;
      }
      events.push(`open:${path}:${flags}`);
      let closed = false;
      return {
        async stat() {
          return { size: content.length, ino: inode };
        },
        async read(buffer, bufferOffset, length, position) {
          const slice = content.subarray(position, position + length);
          slice.copy(buffer, bufferOffset);
          return { bytesRead: slice.length };
        },
        async close() {
          closed = true;
          events.push(`close:${path}`);
          assert.equal(closed, true);
        },
      };
    },
  };
}

test('reads only paths on the agent allowlist', () => {
  assert.deepEqual(resolveMainlogPath({ mainlogPaths: ['/var/log/exim_mainlog'] }, null), {
    path: null,
    allowed: ['/var/log/exim_mainlog'],
    refused: null,
  });
  assert.equal(resolveMainlogPath({ mainlogPaths: ['/var/log/exim_mainlog'] }, '/var/log/exim_mainlog').path, '/var/log/exim_mainlog');

  const traversal = resolveMainlogPath({ mainlogPaths: ['/var/log/exim_mainlog'] }, '/etc/shadow');
  assert.equal(traversal.path, null);
  assert.match(traversal.refused, /allowlist/);

  const sneaky = resolveMainlogPath({ mainlogPaths: ['/var/log/exim_mainlog'] }, '/var/log/exim_mainlog/../../etc/shadow');
  assert.equal(sneaky.path, null);
});

test('defaults to the standard Exim log locations when nothing is configured', () => {
  assert.deepEqual(resolveMainlogPath({}, null).allowed, DEFAULT_MAINLOG_PATHS);
});

test('reads from the checkpoint offset to the last complete line', async () => {
  const events = [];
  const slice = await readLogSlice({ path: '/var/log/exim_mainlog', offset: 0, maxBytes: 4096, fs: fakeFs({ events }) });

  assert.equal(slice.offset, 0);
  assert.equal(slice.fileSize, LOG_BUFFER.length);
  assert.equal(slice.nextOffset, LOG_BUFFER.length);
  assert.equal(slice.lines.length, 3);
  assert.equal(slice.inode, '42');
  assert.equal(slice.truncated, false);
  assert.match(slice.lines[1], /=> recipient@example\.org/);
  // The handle is always closed, even on the success path.
  assert.equal(events.filter((entry) => entry.startsWith('close:')).length, 1);
});

test('never returns a partial trailing line', async () => {
  const halfLine = Buffer.from('2026-11-08 09:14:05 1xYzAb-000125-GH <= partial@exam', 'utf8');
  const content = Buffer.concat([LOG_BUFFER, halfLine]);
  const slice = await readLogSlice({ path: '/var/log/exim_mainlog', offset: 0, maxBytes: 65536, fs: fakeFs({ content }) });

  assert.equal(slice.lines.length, 3);
  assert.equal(slice.nextOffset, LOG_BUFFER.length);
  assert.equal(slice.truncated, true, 'an unread partial line must be reported, not silently dropped');
});

test('resumes exactly where the previous read stopped', async () => {
  const first = await readLogSlice({ path: '/var/log/exim_mainlog', offset: 0, maxBytes: 100, fs: fakeFs() });
  assert.ok(first.nextOffset < LOG_BUFFER.length);
  assert.equal(first.truncated, true);

  const second = await readLogSlice({ path: '/var/log/exim_mainlog', offset: first.nextOffset, maxBytes: 65536, fs: fakeFs() });
  assert.equal(second.offset, first.nextOffset);
  assert.equal(second.nextOffset, LOG_BUFFER.length);
  // Together the two reads cover the whole file, with no duplicated or lost line.
  assert.deepEqual([...first.lines, ...second.lines], LOG.slice(0, -1).split('\n'));
});

test('caps the read regardless of what the control plane asks for', async () => {
  const big = Buffer.alloc(64, 0x61);
  for (let i = 0; i < big.length; i += 16) big[i] = 0x0a;
  const slice = await readLogSlice({ path: '/x', offset: 0, maxBytes: 999_999_999, fs: fakeFs({ content: big }) });
  assert.ok(slice.nextOffset <= MAX_READ_BYTES);
});

test('reports a rotated log instead of reading a stale offset', async () => {
  const slice = await readLogSlice({ path: '/var/log/exim_mainlog', offset: 10_000, maxBytes: 4096, fs: fakeFs() });
  assert.equal(slice.offset, 0);
  assert.equal(slice.reset, true);
  assert.equal(slice.lines.length, 3);
});

test('reports an unreadable log rather than throwing', async () => {
  const result = await mailTrace(
    { mainlogPath: null, offset: 0, includeQueue: false },
    { config: { mainlogPaths: ['/var/log/exim_mainlog'] }, deps: { fs: fakeFs({ failWith: { code: 'EACCES' } }) } }
  );
  assert.equal(result.supportsMailTrace, true);
  assert.equal(result.capability.mainlogReadable, false);
  assert.equal(result.mainlog, null);
  assert.ok(result.capability.notes.some((note) => /could not be read/.test(note)));
});

test('reports a missing log by trying the next configured candidate', async () => {
  const events = [];
  let call = 0;
  const fs = {
    async open(path) {
      call += 1;
      if (call === 1) {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      }
      events.push(path);
      return {
        async stat() {
          return { size: LOG_BUFFER.length, ino: 7 };
        },
        async read(buffer, offset, length, position) {
          const slice = LOG_BUFFER.subarray(position, position + length);
          slice.copy(buffer, offset);
          return { bytesRead: slice.length };
        },
        async close() {},
      };
    },
  };
  const result = await mailTrace(
    { mainlogPath: null, offset: 0, includeQueue: false },
    { config: { mainlogPaths: ['/var/log/exim_mainlog', '/var/log/exim/mainlog'] }, deps: { fs } }
  );
  assert.equal(result.capability.mainlogReadable, true);
  assert.equal(result.capability.mainlogPath, '/var/log/exim/mainlog');
  assert.ok(result.capability.notes.some((note) => /No Exim message log at \/var\/log\/exim_mainlog/.test(note)));
});

test('queue listing is read-only and reports its own unavailability', async () => {
  const calls = [];
  const execFile = async (file, args, options) => {
    calls.push({ file, args, options });
    return { stdout: ' 2d  1xYzQq-000456-EF  1.3K  sender@example.com\n' };
  };
  const ok = await readQueue({ execFile });
  assert.equal(ok.available, true);
  assert.deepEqual(calls, [{ file: 'exim', args: ['-bp'], options: { timeout: 15_000, maxBuffer: 4 * 1024 * 1024 } }]);
  // The only command the agent will run for mail trace is the plain listing.
  assert.deepEqual(calls[0].args, ['-bp']);

  const missing = await readQueue({
    execFile: async () => {
      const err = new Error('spawn exim ENOENT');
      err.code = 'ENOENT';
      throw err;
    },
  });
  assert.equal(missing.available, false);
  assert.match(missing.note, /exim binary/);
});

test('the full operation returns one consistent shape', async () => {
  const response = await mailTrace(
    { mainlogPath: '/var/log/exim_mainlog', offset: 0, maxBytes: 4096, includeQueue: true },
    {
      config: { mainlogPaths: ['/var/log/exim_mainlog'], version: '1.2.3' },
      deps: {
        fs: fakeFs(),
        execFile: async () => ({ stdout: '1 message found\n' }),
      },
    }
  );

  assert.equal(response.agentVersion, '1.2.3');
  assert.equal(response.supportsMailTrace, true);
  assert.deepEqual(Object.keys(response.capability).sort(), [
    'mainlogPath',
    'mainlogReadable',
    'notes',
    'queueListingAvailable',
  ]);
  assert.equal(response.capability.mainlogReadable, true);
  assert.equal(response.capability.queueListingAvailable, true);
  assert.equal(response.mainlog.nextOffset, LOG_BUFFER.length);
  assert.equal(response.queue.output, '1 message found\n');
});

test('an unknown requested path is refused and reported, not read', async () => {
  const events = [];
  const response = await mailTrace(
    { mainlogPath: '/etc/shadow', offset: 0, includeQueue: false },
    { config: { mainlogPaths: ['/var/log/exim_mainlog'] }, deps: { fs: fakeFs({ events }) } }
  );
  assert.equal(response.mainlog, null);
  assert.equal(response.capability.mainlogReadable, false);
  assert.ok(response.capability.notes.some((note) => /allowlist/.test(note)));
  assert.equal(events.filter((entry) => entry.includes('/etc/shadow')).length, 0);
});
