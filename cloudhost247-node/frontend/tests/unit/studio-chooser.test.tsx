// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import StudioChooser from '../../src/components/tools/StudioChooser';
import type { StudioField } from '../../../src/tools/design-studio/forms';

/**
 * The Design Studio type picker. It replaces a dropdown of eighty-odd barcode types, so what has to
 * hold is that nothing becomes unreachable: every option is rendered, search and the group filters
 * narrow without losing any, and choosing one is one click on a real radio button.
 */

const field: StudioField = {
  name: 'symbology',
  label: 'Barcode type',
  type: 'select',
  defaultValue: 'code128',
  chooser: true,
  popular: ['ean13', 'code128'],
  options: [
    { value: 'code128', label: 'Code 128', group: 'Linear codes', help: 'Full ASCII, the default for labels.' },
    { value: 'code39', label: 'Code 39', group: 'Linear codes', help: 'Capital letters and digits.' },
    { value: 'ean13', label: 'EAN-13', group: 'EAN / UPC', help: 'Retail products.' },
    { value: 'upca', label: 'UPC-A', group: 'EAN / UPC', help: 'Retail in the Americas.' },
    { value: 'gs1128', label: 'GS1-128', group: 'GS1', help: 'Logistic units.' },
    { value: 'databar', label: 'GS1 DataBar', group: 'GS1', help: 'Small retail items.' },
    { value: 'qrcode', label: 'QR Code', group: '2D codes', help: 'Links and contact details.' },
    { value: 'datamatrix', label: 'Data Matrix', group: '2D codes', help: 'Marks on small parts.' },
  ],
};

describe('StudioChooser', () => {
  afterEach(cleanup);

  it('renders every option as a described radio button and marks the selected one', () => {
    render(<StudioChooser field={field} value="code128" onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(field.options?.length ?? 0);
    expect(screen.getByText('Full ASCII, the default for labels.')).toBeTruthy();
    expect((screen.getByRole('radio', { name: /Code 128/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole('radio', { name: /QR Code/ }) as HTMLInputElement).checked).toBe(false);
  });

  it('reports the chosen option and offers the unselected shortcuts', async () => {
    const onChange = vi.fn();
    render(<StudioChooser field={field} value="code128" onChange={onChange} />);
    await userEvent.click(screen.getByRole('radio', { name: /QR Code/ }));
    expect(onChange).toHaveBeenCalledWith('qrcode');

    // The selected type is not offered again as a shortcut; the others stay one click away.
    expect(screen.queryByRole('button', { name: 'Code 128' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'EAN-13' }));
    expect(onChange).toHaveBeenCalledWith('ean13');
  });

  it('narrows by group and by search, and says how many options are left', async () => {
    render(<StudioChooser field={field} value="code128" onChange={() => {}} />);
    const filters = screen.getByRole('group', { name: 'Filter by group' });
    expect(within(filters).getByRole('button', { name: /All/ })).toBeTruthy();
    await userEvent.click(within(filters).getByRole('button', { name: /EAN \/ UPC/ }));
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('2 of 8 options')).toBeTruthy();

    await userEvent.click(within(filters).getByRole('button', { name: /All/ }));
    await userEvent.type(screen.getByRole('searchbox'), 'americas');
    expect(screen.getAllByRole('radio')).toHaveLength(1);
    expect(screen.getByRole('radio', { name: /UPC-A/ })).toBeTruthy();

    await userEvent.clear(screen.getByRole('searchbox'));
    expect(screen.getByText('8 options')).toBeTruthy();
  });

  it('says when nothing matches and offers the way back', async () => {
    render(<StudioChooser field={field} value="code128" onChange={() => {}} />);
    await userEvent.type(screen.getByRole('searchbox'), 'zzzz');
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Show every option' }));
    expect(screen.getAllByRole('radio')).toHaveLength(8);
  });

  it('keeps a short list simple: no search box, no group filters, every choice still shown', () => {
    const short: StudioField = {
      name: 'layout',
      label: 'Layout',
      type: 'select',
      defaultValue: 'classic',
      chooser: true,
      options: [
        { value: 'classic', label: 'Classic', help: 'Details on the left.' },
        { value: 'band', label: 'Colour band', help: 'Code on a coloured panel.' },
        { value: 'duplex', label: 'Two-sided', help: 'Code on the back.' },
      ],
    };
    render(<StudioChooser field={short} value="classic" onChange={() => {}} />);
    expect(screen.getAllByRole('radio')).toHaveLength(3);
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.getByText('3 options')).toBeTruthy();
  });
});
