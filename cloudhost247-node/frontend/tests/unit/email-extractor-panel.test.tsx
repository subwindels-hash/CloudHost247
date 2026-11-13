// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import EmailExtractorPanel from '../../src/components/tools/EmailExtractorPanel';
import { toolsApi } from '../../src/lib/tools-api';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('EmailExtractorPanel', () => {
  it('lays out the two windows, the options and the counter', () => {
    render(<EmailExtractorPanel unavailable={false} />);
    expect(screen.getByLabelText('Input Window')).toBeTruthy();
    expect(screen.getByLabelText('Output Window')).toBeTruthy();
    for (const name of ['Paste Input', 'Copy Output', 'Extract', 'Reset']) expect(screen.getByRole('button', { name })).toBeTruthy();
    expect(screen.getByText('Output Option')).toBeTruthy();
    expect(screen.getByText('Filter Option')).toBeTruthy();
    expect(screen.getByText('Counter:')).toBeTruthy();
  });

  it('sends the chosen options and shows the output and count', async () => {
    const run = vi.spyOn(toolsApi, 'run').mockResolvedValue({
      success: true,
      data: { count: 2, found: 3, duplicatesRemoved: 1, filteredOut: 0, output: 'a@x.io | b@x.io', notes: [] },
    } as never);
    render(<EmailExtractorPanel unavailable={false} />);
    fireEvent.change(screen.getByLabelText('Input Window'), { target: { value: 'b@x.io a@x.io a@x.io' } });
    fireEvent.change(screen.getByLabelText('Separator:'), { target: { value: 'pipe' } });
    fireEvent.click(screen.getByLabelText('Sort Alphabetically'));
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    await waitFor(() => expect((screen.getByLabelText('Output Window') as HTMLTextAreaElement).value).toBe('a@x.io | b@x.io'));
    expect(run.mock.calls[0]?.[0]).toBe('email-extractor');
    expect(run.mock.calls[0]?.[1]).toEqual({ text: 'b@x.io a@x.io a@x.io', type: 'email', separator: 'pipe', sort: true });
    expect(screen.getByText('Counter:').querySelector('output')?.textContent).toBe('2');
  });

  it('does not call the API with an empty input window', () => {
    const run = vi.spyOn(toolsApi, 'run');
    render(<EmailExtractorPanel unavailable={false} />);
    fireEvent.click(screen.getByRole('button', { name: 'Extract' }));
    expect(run).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toMatch(/Input Window/);
  });
});
