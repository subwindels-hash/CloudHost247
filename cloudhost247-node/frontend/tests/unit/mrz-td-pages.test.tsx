// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('MRZ calculator TD1 and TD2 formats', () => {
  it('generates the ICAO TD1 specimen lines when TD1 is selected, and states the authenticity limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          calculatorEnabled: true,
          parserEnabled: true,
          testDataEnabled: true,
          availability: 'public',
        })
      )
    );

    render(
      <MemoryRouter initialEntries={['/tools/document/mrz']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'MRZ Calculator' })).toBeTruthy();

    fireEvent.change(await screen.findByLabelText('MRZ format'), { target: { value: 'TD1' } });
    fireEvent.change(await screen.findByLabelText('Document Type'), { target: { value: 'I<' } });
    fireEvent.change(await screen.findByLabelText('Issuing State'), { target: { value: 'UTO' } });
    fireEvent.change(await screen.findByLabelText('Surname'), { target: { value: 'Eriksson' } });
    fireEvent.change(await screen.findByLabelText('Given Names'), { target: { value: 'Anna Maria' } });
    fireEvent.change(await screen.findByLabelText('Nationality'), { target: { value: 'UTO' } });
    fireEvent.change(await screen.findByLabelText('Date of Birth (YYMMDD)'), { target: { value: '740812' } });
    fireEvent.change(await screen.findByLabelText('Sex'), { target: { value: 'F' } });
    fireEvent.change(await screen.findByLabelText('Document Number'), { target: { value: 'D23145890' } });
    fireEvent.change(await screen.findByLabelText('Expiry Date (YYMMDD)'), { target: { value: '120415' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Generate MRZ' }));

    expect((await screen.findByTestId('mrz-td-line-1')).textContent).toBe(
      'I<UTOD231458907<<<<<<<<<<<<<<<'
    );
    expect((await screen.findByTestId('mrz-td-line-2')).textContent).toBe(
      '7408122F1204159UTO<<<<<<<<<<<6'
    );
    expect((await screen.findByTestId('mrz-td-line-3')).textContent).toBe(
      'ERIKSSON<<ANNA<MARIA<<<<<<<<<<'
    );
    expect(screen.getAllByText(/does NOT verify/).length).toBeGreaterThan(0);
  });

  it('shows field errors instead of an MRZ when TD2 input cannot be encoded', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          calculatorEnabled: true,
          parserEnabled: true,
          testDataEnabled: false,
          availability: 'public',
        })
      )
    );

    render(
      <MemoryRouter initialEntries={['/tools/document/mrz']}>
        <App />
      </MemoryRouter>
    );

    fireEvent.change(await screen.findByLabelText('MRZ format'), { target: { value: 'TD2' } });
    fireEvent.change(await screen.findByLabelText('Issuing State'), { target: { value: 'NIGERIA' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Generate MRZ' }));

    expect(screen.queryByTestId('mrz-td-line-1')).toBeNull();
    expect(await screen.findByText(/Issuing state must be a three-letter code/)).toBeTruthy();
  });
});
