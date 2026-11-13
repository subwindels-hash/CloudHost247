/**
 * Tools Center — handlers for the Design Studio tools:
 *   barcode-generator, label-designer, vda-4902-label-generator, shipping-label-generator,
 *   qr-business-card-designer, qr-code-maker.
 *
 * Each tool is a pure function from a request to artwork: nothing is fetched, nothing is stored, and
 * the same input always produces the same files. The handlers therefore only route. Validation, the
 * drawing itself and the wording of every refusal live with the tool in `design-studio/tools/`.
 *
 * Targets are the history label for a signed-in caller. They name the kind of artwork that was made
 * (a barcode type, a template, a label size) and never its content, because the content of a
 * shipping label or a business card is an address or a phone number.
 */
import { symbologyById } from '../design-studio/barcode/symbologies';
import { CARD_LAYOUTS, SHIPPING_SIZES, STUDIO_SLUGS, VDA_FORMATS, labelTemplate } from '../design-studio/definitions';
import { runBarcodeGenerator } from '../design-studio/tools/barcode-generator';
import { runBusinessCard } from '../design-studio/tools/business-card';
import { runLabelDesigner } from '../design-studio/tools/label-designer';
import { qrCodeTarget, runQrCodeMaker } from '../design-studio/tools/qr-code-maker';
import { runShippingLabel } from '../design-studio/tools/shipping-label';
import { runVdaLabel } from '../design-studio/tools/vda-4902';
import type { ToolHandler } from './kit';

const text = (value: unknown): string => (typeof value === 'string' ? value.trim().toLowerCase() : '');

export const designStudioHandlers: Record<string, ToolHandler> = {
  [STUDIO_SLUGS.barcode]: async (input) => runBarcodeGenerator(input),
  [STUDIO_SLUGS.labels]: async (input) => runLabelDesigner(input),
  [STUDIO_SLUGS.vda]: async (input) => runVdaLabel(input),
  [STUDIO_SLUGS.shipping]: async (input) => runShippingLabel(input),
  [STUDIO_SLUGS.cards]: async (input) => runBusinessCard(input),
  [STUDIO_SLUGS.qr]: async (input) => runQrCodeMaker(input),
};

export const designStudioTargets: Record<string, (input: Record<string, unknown>) => string | null> = {
  [STUDIO_SLUGS.barcode]: (input) => symbologyById(text(input.symbology) || 'code128')?.name ?? null,
  [STUDIO_SLUGS.labels]: (input) => labelTemplate(text(input.template) || 'asset-tag')?.name ?? null,
  [STUDIO_SLUGS.vda]: (input) => `VDA 4902 ${VDA_FORMATS.find((entry) => entry.id === text(input.format))?.id === 'klt' ? 'KLT' : 'A5'}`,
  [STUDIO_SLUGS.shipping]: (input) => `Shipping label ${(SHIPPING_SIZES.find((entry) => entry.id === text(input.size)) ?? SHIPPING_SIZES[0]).id}`,
  [STUDIO_SLUGS.cards]: (input) => `Business card, ${(CARD_LAYOUTS.find((entry) => entry.id === text(input.layout)) ?? CARD_LAYOUTS[0]).id} layout`,
  [STUDIO_SLUGS.qr]: (input) => qrCodeTarget(input),
};
