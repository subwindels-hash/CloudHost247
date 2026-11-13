// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ExtractorProPanel from '../../src/components/tools/ExtractorProPanel';
import { addToList, chunkTexts, EMPTY_LISTS, fileNameMatcher, isTopLevel, normalizeLists, wildcardToRegExp } from '../../src/components/tools/extractor-pro-lib';
import { toolsApi } from '../../src/lib/tools-api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const EMAILS = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/** Stands in for the server handler: returns the addresses in the text that was sent. */
function mockApi() {
  return vi.spyOn(toolsApi, 'run').mockImplementation(
    async (_slug, input) => ({ success: true, data: { addresses: [...new Set(String(input.text).match(EMAILS) ?? [])] } }) as never
  );
}
const options = (label: string) => Array.from((screen.getByLabelText(label) as HTMLSelectElement).options, (option) => option.value);
function file(name: string, text: string, relativePath = '') {
  const item = new File([text], name, { type: 'text/plain' });
  Object.defineProperty(item, 'webkitRelativePath', { value: relativePath });
  if (!item.text) Object.defineProperty(item, 'text', { value: async () => text });
  return item;
}

describe('extractor pro helpers', () => {
  it('matches file names and address patterns with wildcards', () => {
    const matches = fileNameMatcher('*.htm; *.txt');
    expect(matches('index.HTM')).toBe(true);
    expect(matches('notes.txt')).toBe(true);
    expect(matches('index.html')).toBe(false);
    expect(fileNameMatcher('')('anything.bin')).toBe(true);
    expect(wildcardToRegExp('*@spam.example').test('a.b@SPAM.example')).toBe(true);
    expect(wildcardToRegExp('*@spam.example').test('a@spam.example.org')).toBe(false);
    expect(isTopLevel('folder/a.htm')).toBe(true);
    expect(isTopLevel('folder/sub/a.htm')).toBe(false);
  });

  it('batches text without splitting an address', () => {
    const chunks = chunkTexts(['aaa@x.io bbb@x.io ccc@x.io', 'ddd@x.io'], 20);
    expect(chunks.every((chunk) => chunk.length <= 20)).toBe(true);
    expect(chunks.join(' ').match(EMAILS)).toEqual(['aaa@x.io', 'bbb@x.io', 'ccc@x.io', 'ddd@x.io']);
  });

  it('keeps unsubscribed and excluded addresses out of the subscription list', () => {
    const lists = normalizeLists({ subscription: ['a@x.io', 'A@x.io', 'b@y.io', 'c@z.io'], unsubscription: ['B@y.io'], excluding: ['*@z.io'] });
    expect(lists.subscription).toEqual(['a@x.io']);
    expect(addToList(EMPTY_LISTS, 'subscription', ['a@x.io', 'a@x.io']).added).toBe(1);
  });
});

describe('ExtractorProPanel', () => {
  it('extracts from chosen files that match the pattern into the subscription list', async () => {
    const run = mockApi();
    render(<ExtractorProPanel unavailable={false} />);
    fireEvent.change(screen.getByLabelText('Files to extract from'), {
      target: { files: [file('page.htm', 'mail ada@example.com and bob@example.com'), file('skip.bin', 'no@example.com')] },
    });
    await waitFor(() => expect(options('Subscription')).toEqual(['ada@example.com', 'bob@example.com']));
    expect(run).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('Subscription count').textContent).toBe('2');
  });

  it('respects “Go into sub-folders” for a chosen folder', async () => {
    mockApi();
    render(<ExtractorProPanel unavailable={false} />);
    const picked = [file('a.htm', 'top@example.com', 'site/a.htm'), file('b.htm', 'deep@example.com', 'site/sub/b.htm')];
    fireEvent.change(screen.getByLabelText('Folder to extract from'), { target: { files: picked } });
    await waitFor(() => expect(options('Subscription')).toEqual(['top@example.com']));
    expect((screen.getByLabelText('Chosen folder') as HTMLInputElement).value).toBe('site');
    fireEvent.click(screen.getByLabelText('Go into sub-folders'));
    fireEvent.change(screen.getByLabelText('Folder to extract from'), { target: { files: picked } });
    await waitFor(() => expect(options('Subscription')).toEqual(['top@example.com', 'deep@example.com']));
  });

  it('extracts the clipboard into the unsubscription list and removes those subscribers', async () => {
    mockApi();
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => 'please remove bob@example.com' } });
    render(<ExtractorProPanel unavailable={false} />);
    fireEvent.change(screen.getByLabelText('Add to Subscription'), { target: { value: 'ada@example.com, bob@example.com' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    expect(options('Subscription')).toEqual(['ada@example.com', 'bob@example.com']);
    fireEvent.change(screen.getByLabelText('List to extract into'), { target: { value: 'unsubscription' } });
    fireEvent.click(screen.getByRole('button', { name: 'Extract From Clipboard' }));
    await waitFor(() => expect(options('UnSubscription')).toEqual(['bob@example.com']));
    expect(options('Subscription')).toEqual(['ada@example.com']);
  });

  it('drops subscribers that match a newly added exclusion pattern', () => {
    render(<ExtractorProPanel unavailable={false} />);
    fireEvent.change(screen.getByLabelText('Add to Subscription'), { target: { value: 'a@keep.io b@spam.io' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[0]!);
    fireEvent.change(screen.getByLabelText('Add to Excluding Email Address Pattern'), { target: { value: '*@spam.io' } });
    fireEvent.click(screen.getAllByRole('button', { name: 'Add' })[2]!);
    expect(options('Subscription')).toEqual(['a@keep.io']);
    expect(screen.getByLabelText('Excluding Email Address Pattern count').textContent).toBe('1');
  });
});
