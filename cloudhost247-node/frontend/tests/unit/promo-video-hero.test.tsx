// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import PromoVideoHero from '../../src/components/marketing/PromoVideoHero';

/** Media playback is a browser capability, so each test supplies the exact play() contract it
 * exercises. The component must survive promise rejection, legacy undefined and synchronous
 * throws; none of those may replace the surrounding homepage with an error boundary. */
function renderHero() {
  return render(<MemoryRouter><PromoVideoHero /></MemoryRouter>);
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('promotional video playback resilience', () => {
  it('keeps the hero usable when autoplay is rejected by browser policy', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('Autoplay blocked', 'NotAllowedError'));
    renderHero();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.getByRole('heading', { name: 'Find a name for your next big idea.' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Play promotional videos' })).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('supports legacy media stacks whose play() returns undefined', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockImplementation(() => undefined as unknown as Promise<void>);
    const { container } = renderHero();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent.play(container.querySelector('video')!);
    expect(screen.getByRole('button', { name: 'Pause promotional videos' })).toBeTruthy();
    expect(screen.queryByText('Video unavailable')).toBeNull();
  });

  it('reports a synchronous playback throw only after an explicit play request', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
      throw new DOMException('No supported media source', 'NotSupportedError');
    });
    renderHero();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Play promotional videos' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Video unavailable'));
    expect(play).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('button', { name: 'Play promotional videos' })).toBeTruthy();
  });

  it('reports an explicitly requested playback that rejects asynchronously', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockRejectedValue(new DOMException('Playback failed', 'NotAllowedError'));
    renderHero();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Play promotional videos' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Video unavailable'));
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('uses media events for successful playback and pauses on request', async () => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.mocked(HTMLMediaElement.prototype.pause);
    const { container } = renderHero();
    const video = container.querySelector('video')!;

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent.play(video);
    fireEvent.click(screen.getByRole('button', { name: 'Pause promotional videos' }));
    expect(pause).toHaveBeenCalled();
    fireEvent.pause(video);
    expect(screen.getByRole('button', { name: 'Play promotional videos' })).toBeTruthy();
  });

  it('does not apply a stale manual-play failure to the next slide', async () => {
    let rejectManual!: (error: Error) => void;
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play')
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectManual = reject; }))
      .mockResolvedValue(undefined);
    renderHero();

    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Play promotional videos' }));
    await waitFor(() => expect(play).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Next slide' }));
    rejectManual(new DOMException('Old slide failed', 'NotAllowedError'));

    await waitFor(() => expect(screen.getByRole('heading', { name: 'A little idea can go a long way.' })).toBeTruthy());
    expect(screen.queryByText('Video unavailable')).toBeNull();
  });
});
