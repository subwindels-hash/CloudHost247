// @vitest-environment jsdom
/**
 * Employee ID Card Generator — page tests.
 *
 * These run in jsdom, which has no drawing engine: `getContext('2d')` returns null unless the
 * optional `canvas` package is installed. The page's whole point is that the preview, the PNG/JPG
 * downloads and the PDF all come from the same canvas, so the tests install a recording 2D context
 * stub and a `toBlob` stub and then assert on what the page *asks the canvas to do* — which
 * template, which colours, which sides, which file type — rather than on pixels.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import EmployeeIdCardPage from '../../src/pages/tools/EmployeeIdCardPage';

/* ------------------------------------------------------------------ */
/* Canvas stubs                                                        */
/* ------------------------------------------------------------------ */

interface RecordedCall {
  method: string;
  args: unknown[];
}

const calls: RecordedCall[] = [];

/** A 2D context that records every call and returns plausible values for the measuring methods. */
function makeContext(): CanvasRenderingContext2D {
  const target: Record<string, unknown> = {
    canvas: { width: 1011, height: 638 },
    measureText: (text: string) => ({ width: String(text).length * 6 }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
  };
  return new Proxy(target, {
    get(object, property: string) {
      if (property in object) return object[property];
      const recorder = (...args: unknown[]) => {
        calls.push({ method: property, args });
        return undefined;
      };
      object[property] = recorder;
      return recorder;
    },
    set(object, property: string, value) {
      object[property] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
const originalToBlob = HTMLCanvasElement.prototype.toBlob;
const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  calls.length = 0;
  HTMLCanvasElement.prototype.getContext = function getContext() {
    return makeContext();
  } as unknown as HTMLCanvasElement['getContext'];
  HTMLCanvasElement.prototype.toBlob = function toBlob(callback: BlobCallback, type?: string) {
    // A one-byte body is enough: the page only ever hands this Blob to an object URL.
    callback(new Blob([new Uint8Array([0xff])], { type: type ?? 'image/png' }));
  };
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  HTMLCanvasElement.prototype.toBlob = originalToBlob;
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
  window.localStorage.clear();
});

/** Every live region on the page, joined — the page uses more than one `role="status"`. */
function statusText(): string {
  return screen
    .queryAllByRole('status')
    .map((element) => element.textContent ?? '')
    .join(' | ');
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tools/business-tools/employee-id-card-generator']}>
      <EmployeeIdCardPage />
    </MemoryRouter>
  );
}

function fill(label: RegExp | string, value: string) {
  const input = screen.getByLabelText(label, { selector: 'input' }) as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

/** The three fields the engine treats as blocking, so the page leaves its "not ready" state. */
function completeRequiredFields() {
  fill(/full name/i, 'Ada Obi');
  fill(/^employee id/i, 'CH247-OPS-2026-0001-8');
  fill(/company name/i, 'CloudHost247 Ltd');
}

/* ------------------------------------------------------------------ */
/* Tests                                                               */
/* ------------------------------------------------------------------ */

describe('Employee ID Card Generator — the workspace a visitor gets', () => {
  it('renders the heading, the template gallery, the presets and the colour controls', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Employee ID Card Generator' })).toBeTruthy();

    // Twelve templates, each a real button with its own description.
    for (const name of [
      'Corporate Split',
      'Modern Badge',
      'Minimal Centre',
      'Signature Wave',
      'Creative Panel',
      'Startup Frame',
      'Gradient Edge',
      'Portrait Pass',
      'Tech Diagonal',
      'Mono Stripe',
      'Executive Ribbon',
      'Soft Geometry',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name) }), name).toBeTruthy();
    }

    // Eight presets.
    for (const name of [
      'Salario Green',
      'Corporate Blue',
      'Midnight',
      'Royal Purple',
      'Bright Orange',
      'Crimson',
      'Elegant Teal',
      'Charcoal',
    ]) {
      expect(screen.getByRole('button', { name: new RegExp(name) }), name).toBeTruthy();
    }

    // Four custom colour pickers, each with a labelled hex field rather than a mystery swatch.
    for (const label of ['Primary accent', 'Card background', 'Text colour', 'Detail accent']) {
      expect(screen.getByLabelText(`${label} hex value`), label).toBeTruthy();
    }
  });

  it('draws the front and the back preview from the same layout, at ID-1 size', async () => {
    renderPage();
    const canvases = document.querySelectorAll('canvas.idc__canvas');
    expect(canvases.length).toBe(2);
    // ID-1 landscape at 300 dpi: 85.6 mm × 53.98 mm. The canvas is sized when the layout lands.
    return waitFor(() => {
      expect((canvases[0] as HTMLCanvasElement).width).toBe(1011);
      expect((canvases[0] as HTMLCanvasElement).height).toBe(638);
    });
    // Both faces were actually drawn into a 2D context.
    expect(calls.some((call) => call.method === 'fillRect')).toBe(true);
    expect(screen.getByRole('button', { name: 'Front' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('button', { name: 'Back' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('says what is missing and keeps every download disabled until the card is printable', () => {
    renderPage();
    expect(statusText()).toMatch(/still needed/i);
    for (const name of [/PNG — front/, /PNG — back/, /JPG — both sides/, /PDF — one side per page/, /PDF — both sides on one sheet/]) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled, String(name)).toBe(true);
    }
  });

  it('becomes downloadable once the required fields are filled, naming the employee and the company', async () => {
    renderPage();
    completeRequiredFields();
    await waitFor(() => {
      expect(screen.getByText(/Ada Obi · CH247-OPS-2026-0001-8 · CloudHost247 Ltd/)).toBeTruthy();
    });
    expect((screen.getByRole('button', { name: /PNG — front/ }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('reports the specific engine error for a malformed value instead of just refusing', async () => {
    renderPage();
    completeRequiredFields();
    fireEvent.change(screen.getByLabelText(/email address/i), { target: { value: 'not-an-address' } });
    await waitFor(() => {
      expect(statusText()).toMatch(/email/i);
    });
  });

  it('reports a rejected upload with the rule it broke, and does not show a preview', async () => {
    renderPage();
    const input = document.querySelector('input[accept="image/png,image/jpeg,image/webp"]') as HTMLInputElement;
    expect(input).toBeTruthy();
    const file = new File(['not an image at all'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toMatch(/PNG|JPEG|WebP|image/i);
    });
    expect(document.querySelector('.idc__thumb:not(.idc__thumb--empty)')).toBeNull();
  });

  it('downloads a PNG through an object URL and revokes it afterwards', async () => {
    renderPage();
    completeRequiredFields();
    await waitFor(() => expect((screen.getByRole('button', { name: /PNG — front/ }) as HTMLButtonElement).disabled).toBe(false));
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: /PNG — front/ }));
      await waitFor(() => expect(clicked.length).toBe(1));
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    expect(clicked[0]).toMatch(/^id-card-ch247-ops-2026-0001-8-front\.png$/);
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(statusText()).toMatch(/300 dpi/);
  });

  it('resets the form back to its defaults, including the colours and the template', async () => {
    renderPage();
    completeRequiredFields();
    fireEvent.click(screen.getByRole('button', { name: /Modern Badge/ }));
    fireEvent.click(screen.getByRole('button', { name: /Royal Purple/ }));
    await waitFor(() => expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('Ada Obi'));

    fireEvent.click(screen.getByRole('button', { name: 'Reset form' }));
    await waitFor(() => {
      expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('');
    });
    expect(screen.getByRole('button', { name: /Corporate Split/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText(/Active palette: accent #18bf63/)).toBeTruthy();
  });

  it('keeps the card details in this browser only, and erases them when asked', async () => {
    renderPage();
    fill(/full name/i, 'Ada Obi');
    // The page persists after a short debounce so a refresh does not lose the work.
    await waitFor(() => {
      expect(window.localStorage.getItem('ch247.employeeIdCard.form.v1') ?? '').toMatch(/Ada Obi/);
    });
    fireEvent.click(screen.getByRole('button', { name: /Clear everything stored in this browser/ }));
    expect(window.localStorage.getItem('ch247.employeeIdCard.form.v1')).toBeNull();
    expect(window.localStorage.getItem('ch247.employeeIdCard.images.v1')).toBeNull();
    expect((screen.getByLabelText(/full name/i) as HTMLInputElement).value).toBe('');
    expect(statusText()).toMatch(/erased/i);
  });

  it('promises nothing about verification and says where the data lives', () => {
    renderPage();
    expect(screen.getByText(/not\s+an employment verification service/i)).toBeTruthy();
    expect(screen.getByText(/stored locally in this browser/i)).toBeTruthy();
  });
});

describe('Employee ID Card Generator — bulk import', () => {
  // The template's own header row, so the test fails if the published template and the importer
  // ever drift apart.
  const csv = [
    'Full name,Employee ID,Job title,Department,Email,Phone,Blood group,Date of joining,Emergency contact,Valid from,Valid until,Photo URL',
    // Valid.
    'Bola Ade,EMP-0002,Analyst,Finance,bola.ade@example.com,+2348012345679,O+,2024-03-01,,2026-01-01,2027-12-31,',
    // A duplicate identifier: both this row and the first one are refused, because nobody can tell
    // which record is the real one.
    'Ada Obi,EMP-0001,Payroll Officer,Finance,ada.obi@example.com,+2348012345678,O+,2024-03-01,,2026-01-01,2027-12-31,',
    'Ada Obi,EMP-0001,Analyst,Finance,ada.obi@example.com,+2348012345678,O+,2024-03-01,,2026-01-01,2027-12-31,',
    // Everything wrong that has a specific message: email, blood group, date, insecure photo URL.
    'Chidi Okeke,EMP-0003,Analyst,Finance,not-an-email,,ZZ,2024-13-45,,2026-01-01,2027-12-31,http://insecure.example.com/x.png',
  ].join('\n');

  function chooseFile(name: string, body: string) {
    const input = document.querySelector('.idc__bulk-button input[type="file"]') as HTMLInputElement;
    const file = new File([body], name, { type: 'text/csv' });
    Object.defineProperty(file, 'text', { value: async () => body });
    fireEvent.change(input, { target: { files: [file] } });
  }

  it('publishes a downloadable template that the importer maps back without help', () => {
    renderPage();
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    try {
      fireEvent.click(screen.getByRole('button', { name: /Download the CSV template/ }));
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
    expect(clicked[0]).toBe('cloudhost247-employee-id-cards-template.csv');
  });

  it('imports the valid row, rejects the bad ones with a reason each, and never drops a row silently', async () => {
    renderPage();
    // A badge needs the company block, and the import deliberately inherits it from the form.
    fill(/company name/i, 'CloudHost247 Ltd');
    chooseFile('employees.csv', csv);
    await waitFor(() => {
      expect(screen.getByText(/Preview — 1 employee/)).toBeTruthy();
    });
    // The two duplicate-ID rows and the row with four separate faults are all reported.
    expect(screen.getByText(/Rejected rows — 3/)).toBeTruthy();
    const rejections = document.querySelector('.idc__rejections') as HTMLElement;
    const text = rejections.textContent ?? '';
    expect(text).toMatch(/EMP-0001/);
    expect(text).toMatch(/unique identifier/i);
    expect(text).toMatch(/email/i);
    expect(text).toMatch(/blood group/i);
    expect(text).toMatch(/https:\/\//);
    // The rejected-row report can be handed back to the HR team.
    expect(screen.getByRole('button', { name: /Download the rejected rows/ })).toBeTruthy();
    // Nothing has been generated yet, and the page says so.
    expect(screen.getByText(/Nothing has been generated yet/)).toBeTruthy();
  });

  it('generates a ZIP holding both sides of every accepted employee, with a manifest', async () => {
    renderPage();
    fill(/company name/i, 'CloudHost247 Ltd');
    chooseFile('employees.csv', csv);
    await waitFor(() => expect(screen.getByText(/Preview — 1 employee/)).toBeTruthy());
    const clicked: string[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this.download);
    };
    const fetched: string[] = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      fetched.push(String(input));
      return { ok: false, status: 403, blob: async () => new Blob([]) } as unknown as Response;
    }) as typeof fetch;
    try {
      fireEvent.click(screen.getByRole('button', { name: /Generate cards and download the ZIP/ }));
      await waitFor(() => expect(clicked.length).toBe(1), { timeout: 10000 });
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
      globalThis.fetch = originalFetch;
    }
    expect(clicked[0]).toMatch(/^employee-id-cards-\d{4}-\d{2}-\d{2}\.zip$/);
    expect(statusText()).toMatch(/ZIP saved with 2 PNG files/);
  });
});
