// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../../src/App';
import { setSession } from '../../src/lib/auth';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('ePassport MRZ Calculator, Validator, Parser & Admin UI', () => {
  const ICAO_LINE_1 = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<';
  const ICAO_LINE_2 = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';

  it('renders /tools/document/mrz, generates synthetic test data, and calculates valid ICAO TD3 MRZ lines', async () => {
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

    // Generate synthetic test data
    fireEvent.click(await screen.findByRole('button', { name: 'Generate Test Data' }));
    expect(await screen.findByText(/SYNTHETIC TEST DATA/i)).toBeTruthy();
    expect((await screen.findByTestId('mrz-line-1')).textContent).toHaveLength(44);
    expect((await screen.findByTestId('mrz-line-2')).textContent).toHaveLength(44);

    // Fill in canonical ICAO Doc 9303 test case
    fireEvent.change(await screen.findByLabelText('Issuing State'), { target: { value: 'UTO' } });
    fireEvent.change(await screen.findByLabelText('Surname'), { target: { value: 'Eriksson' } });
    fireEvent.change(await screen.findByLabelText('Given Names'), { target: { value: 'Anna Maria' } });
    fireEvent.change(await screen.findByLabelText('Nationality'), { target: { value: 'UTO' } });
    fireEvent.change(await screen.findByLabelText('Date of Birth (YYMMDD)'), { target: { value: '740812' } });
    fireEvent.change(await screen.findByLabelText('Sex'), { target: { value: 'F' } });
    fireEvent.change(await screen.findByLabelText('Document Number'), { target: { value: 'L898902C3' } });
    fireEvent.change(await screen.findByLabelText('Expiry Date (YYMMDD)'), { target: { value: '120415' } });
    fireEvent.change(await screen.findByLabelText('Optional Data'), { target: { value: 'ZE184226B' } });

    fireEvent.click(await screen.findByRole('button', { name: 'Generate MRZ' }));

    expect((await screen.findByTestId('mrz-line-1')).textContent).toBe(ICAO_LINE_1);
    expect((await screen.findByTestId('mrz-line-2')).textContent).toBe(ICAO_LINE_2);

    // Validate the generated MRZ
    fireEvent.click(await screen.findByRole('button', { name: 'Validate' }));
    expect(await screen.findByText('MRZ structure is valid.')).toBeTruthy();

    // Explain with CloudHost247 AI
    fireEvent.click(await screen.findByRole('button', { name: 'Explain with CloudHost247 AI' }));
    expect(await screen.findByText('CloudHost247 AI — MRZ Technical Explanation')).toBeTruthy();
  });

  it('renders /tools/document/mrz-parser and distinguishes Successfully parsed from Authenticity verified', async () => {
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
      <MemoryRouter initialEntries={['/tools/document/mrz-parser']}>
        <App />
      </MemoryRouter>
    );

    expect(await screen.findByRole('heading', { name: 'MRZ Parser' })).toBeTruthy();

    fireEvent.change(await screen.findByLabelText('Paste MRZ'), {
      target: { value: `${ICAO_LINE_1}\n${ICAO_LINE_2}` },
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Parse MRZ' }));

    expect(await screen.findByText('Successfully parsed')).toBeTruthy();
    expect(await screen.findByText('Not verified — MRZ format and check-digit validation only')).toBeTruthy();
    expect(await screen.findByText('ERIKSSON')).toBeTruthy();
    expect(await screen.findByText('ANNA MARIA')).toBeTruthy();
    expect(await screen.findByText('L898902C3')).toBeTruthy();
  });

  it('renders Super Admin → Settings → Tools → MRZ (/admin/settings/tools/mrz) with locked privacy controls', async () => {
    setSession('admin-token', {
      id: 'admin-1',
      email: 'super@cloudhost247.com',
      fullName: 'Super Admin',
      role: 'super_admin',
    });

    const fetchMock = vi.fn().mockImplementation((path: string, init?: RequestInit) => {
      if (path === '/api/v1/admin/tools/mrz/settings' && (!init?.method || init.method === 'GET')) {
        return Promise.resolve(
          jsonResponse(200, {
            settings: {
              calculatorEnabled: true,
              parserEnabled: true,
              testDataEnabled: true,
              rateLimitPerMinute: 60,
              loggingLevel: 'none',
              availability: 'public',
              privacyProtectionLocked: true,
              persistSubmittedData: false,
              logSensitiveMrzData: false,
            },
          })
        );
      }
      if (path === '/api/v1/admin/tools/mrz/settings' && init?.method === 'PUT') {
        return Promise.resolve(
          jsonResponse(200, {
            settings: {
              calculatorEnabled: true,
              parserEnabled: true,
              testDataEnabled: true,
              rateLimitPerMinute: 120,
              loggingLevel: 'errors_only',
              availability: 'authenticated',
              privacyProtectionLocked: true,
              persistSubmittedData: false,
              logSensitiveMrzData: false,
            },
          })
        );
      }
      return Promise.resolve(jsonResponse(200, {}));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/admin/settings/tools/mrz']}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Super Admin → Settings → Tools → MRZ' })).toBeTruthy()
    );
    expect(await screen.findByText('Mandatory Privacy Protections (Locked)')).toBeTruthy();

    fireEvent.click(await screen.findByRole('button', { name: 'Save MRZ Tool Settings' }));
    await waitFor(() => expect(screen.getByText('MRZ tool settings saved and audit-logged.')).toBeTruthy());
  });
});
