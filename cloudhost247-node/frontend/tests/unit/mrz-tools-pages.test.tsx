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

    expect(screen.getByRole('heading', { name: 'MRZ Calculator' })).toBeTruthy();

    // Generate synthetic test data
    fireEvent.click(screen.getByRole('button', { name: 'Generate Test Data' }));
    expect(screen.getByText(/SYNTHETIC TEST DATA/i)).toBeTruthy();
    expect(screen.getByTestId('mrz-line-1').textContent).toHaveLength(44);
    expect(screen.getByTestId('mrz-line-2').textContent).toHaveLength(44);

    // Fill in canonical ICAO Doc 9303 test case
    fireEvent.change(screen.getByLabelText('Issuing State'), { target: { value: 'UTO' } });
    fireEvent.change(screen.getByLabelText('Surname'), { target: { value: 'Eriksson' } });
    fireEvent.change(screen.getByLabelText('Given Names'), { target: { value: 'Anna Maria' } });
    fireEvent.change(screen.getByLabelText('Nationality'), { target: { value: 'UTO' } });
    fireEvent.change(screen.getByLabelText('Date of Birth (YYMMDD)'), { target: { value: '740812' } });
    fireEvent.change(screen.getByLabelText('Sex'), { target: { value: 'F' } });
    fireEvent.change(screen.getByLabelText('Document Number'), { target: { value: 'L898902C3' } });
    fireEvent.change(screen.getByLabelText('Expiry Date (YYMMDD)'), { target: { value: '120415' } });
    fireEvent.change(screen.getByLabelText('Optional Data'), { target: { value: 'ZE184226B' } });

    fireEvent.click(screen.getByRole('button', { name: 'Generate MRZ' }));

    expect(screen.getByTestId('mrz-line-1').textContent).toBe(ICAO_LINE_1);
    expect(screen.getByTestId('mrz-line-2').textContent).toBe(ICAO_LINE_2);

    // Validate the generated MRZ
    fireEvent.click(screen.getByRole('button', { name: 'Validate' }));
    expect(screen.getByText('MRZ structure is valid.')).toBeTruthy();

    // Explain with CloudHost247 AI
    fireEvent.click(screen.getByRole('button', { name: 'Explain with CloudHost247 AI' }));
    expect(screen.getByText('CloudHost247 AI — MRZ Technical Explanation')).toBeTruthy();
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

    expect(screen.getByRole('heading', { name: 'MRZ Parser' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Paste MRZ'), {
      target: { value: `${ICAO_LINE_1}\n${ICAO_LINE_2}` },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Parse MRZ' }));

    expect(screen.getByText('Successfully parsed')).toBeTruthy();
    expect(screen.getByText('Not verified — MRZ format and check-digit validation only')).toBeTruthy();
    expect(screen.getByText('ERIKSSON')).toBeTruthy();
    expect(screen.getByText('ANNA MARIA')).toBeTruthy();
    expect(screen.getByText('L898902C3')).toBeTruthy();
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
    expect(screen.getByText('Mandatory Privacy Protections (Locked)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save MRZ Tool Settings' }));
    await waitFor(() => expect(screen.getByText('MRZ tool settings saved and audit-logged.')).toBeTruthy());
  });
});
