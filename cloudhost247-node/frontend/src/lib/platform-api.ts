/**
 * Types for the CLOUDHOST247 platform services API (navigation, packaged plans, builder, AI
 * builder, store, experts, marketing, logo maker, inbox).
 *
 * These mirror the server DTOs exactly. They intentionally do NOT include money fields the server
 * never sends (for example a client-chosen price, or order-line metadata, which is server-set), so
 * a page cannot accidentally render a number the platform did not authorise.
 */
import { apiFetch } from './api';

/* --------------------------------------------------------------------------------------------
 * Navigation
 * ------------------------------------------------------------------------------------------ */

export type NavBadge = 'NEW' | 'POPULAR' | 'TRENDING' | 'INCLUDED' | 'SALE';

export interface NavLink {
  label: string;
  to: string;
  description: string;
  badge?: NavBadge;
}

export interface NavGroup {
  title: string;
  links: NavLink[];
}

export interface NavSection {
  id: string;
  label: string;
  blurb: string;
  groups: NavGroup[];
  featured?: { title: string; body: string; to: string; ctaLabel: string };
}

/**
 * The mega-menu definition is a public document (it is also what the server-rendered sitemap is
 * built from), so it is fetched with a plain same-origin request: no bearer token is attached and
 * a failure can never be mistaken for "this session is dead". `apiFetch` deliberately clears the
 * local session on a 401 it caused, which would be wrong for an anonymous menu fetch rendered on
 * every page — including the public ones.
 */
export async function fetchNavigation(): Promise<{ sections: NavSection[]; validation: { ok: boolean; errors: string[] } }> {
  const response = await fetch('/api/v1/navigation', { headers: { Accept: 'application/json' } });
  if (!response.ok) {
    throw new Error(`Navigation is unavailable (HTTP ${response.status})`);
  }
  return (await response.json()) as { sections: NavSection[]; validation: { ok: boolean; errors: string[] } };
}

/* --------------------------------------------------------------------------------------------
 * Packaged platform plans (pricing authority for the new services)
 * ------------------------------------------------------------------------------------------ */

export interface PlatformPlan {
  id: string;
  service_kind: string;
  code: string;
  name: string;
  description: string | null;
  billing_period: string;
  price_amount: string;
  currency: string;
  features: string[];
  limits: Record<string, number>;
  status: 'draft' | 'published' | 'archived';
  sort_order: number;
}

export function fetchPublishedPlans(serviceKind?: string): Promise<{ plans: PlatformPlan[] }> {
  const query = serviceKind ? `?serviceKind=${encodeURIComponent(serviceKind)}` : '';
  return apiFetch(`/api/v1/platform-services/plans${query}`);
}

/* --------------------------------------------------------------------------------------------
 * Website builder
 * ------------------------------------------------------------------------------------------ */

export interface SiteRow {
  id: string;
  name: string;
  slug: string;
  status: string;
  theme: Record<string, unknown>;
  seo: Record<string, unknown>;
  domain_id: string | null;
  published_publication_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PageRow {
  id: string;
  site_id: string;
  title: string;
  path: string;
  is_home: boolean;
  status: string;
  content: Array<{ type: string; props: Record<string, unknown> }>;
  seo: Record<string, unknown>;
  revision: number;
}

export interface SiteTemplate {
  slug: string;
  name: string;
  description: string;
  category?: string;
  palette?: Record<string, unknown>;
  /** `first_party` templates ship with the platform; `custom` ones were published by an operator. */
  source?: 'first_party' | 'custom';
}

export interface SectionFieldSpec {
  key: string;
  label: string;
  kind: string;
  required?: boolean;
  options?: string[];
  maxLength?: number;
  /** Present for `list` fields: the shape of each item the field accepts. */
  itemFields?: Array<{ key: string; label: string; kind: string; required?: boolean; maxLength?: number }>;
}

export interface SectionDefinition {
  type: string;
  label: string;
  description: string;
  fields: SectionFieldSpec[];
}

export interface AiProject {
  id: string;
  name: string;
  status: string;
  brief: Record<string, unknown>;
  site_id: string | null;
  created_at: string;
}

export interface AiGeneration {
  id: string;
  project_id: string;
  engine: string;
  status: string;
  plan: {
    pages: Array<{ title: string; path: string; sections: Array<{ type: string }> }>;
    seo: Record<string, unknown>;
    brandNotes?: string[];
  } | null;
  error: { code: string; message: string } | null;
  created_at: string;
}

export interface AiEngine {
  engine: string;
  label: string;
  configured: boolean;
  reason: string | null;
}

/* --------------------------------------------------------------------------------------------
 * Online store
 * ------------------------------------------------------------------------------------------ */

export interface StoreRow {
  id: string;
  name: string;
  slug: string;
  description: string;
  status: string;
  currency: string;
  payment_mode: string;
  plan_code: string | null;
  theme: Record<string, unknown>;
}

export interface StoreProduct {
  id: string;
  kind: 'physical' | 'digital' | 'service';
  name: string;
  slug: string;
  description: string;
  status: string;
  sku: string | null;
  price_amount: string;
  compare_at_amount: string | null;
  currency: string;
  track_inventory: boolean;
  inventory_quantity: number;
  requires_shipping: boolean;
  weight_grams: number | null;
  download_filename: string | null;
  download_limit: number | null;
  download_expiry_days: number | null;
  variant_count?: number;
  order_count?: number;
}

export interface StoreOrderRow {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_amount: string;
  customer_name: string;
  customer_email: string;
  created_at: string;
  pending_fulfilments: number;
}

export interface PublicStoreProduct {
  id: string;
  kind: 'physical' | 'digital' | 'service';
  name: string;
  description: string;
  price_amount: string;
  currency: string;
  compare_at_amount: string | null;
  inventory_quantity: number;
  track_inventory: boolean;
  requires_shipping: boolean;
  is_downloadable: boolean;
  variants: Array<{ id: string; name: string; price: string; options: unknown }> | null;
}

export interface PublicStore {
  store: { name: string; slug: string; description: string; currency: string; paymentMode: string; theme: Record<string, unknown> };
  products: PublicStoreProduct[];
  shippingMethods: Array<{ id: string; name: string; description: string; priceAmount: string; currency: string; countries: string[]; minOrderAmount: string | null }>;
  configuredTaxCountries: string[];
}

/* --------------------------------------------------------------------------------------------
 * Expert services
 * ------------------------------------------------------------------------------------------ */

export interface ExpertOffering {
  id: string;
  code: string;
  name: string;
  category: string;
  summary: string;
  description: string;
  deliverables: string[] | null;
  starting_price_amount: string | null;
  currency: string;
  pricing_model: string;
  typical_delivery_days: number | null;
  status: string;
}

export interface ExpertRequestSummary {
  id: string;
  reference: string;
  title: string;
  status: string;
  priority: string;
  offering_code: string;
  offering_name: string | null;
  budget_amount: string | null;
  currency: string;
  live_quote_amount: string | null;
  message_count: number;
  order_id: string | null;
  invoice_id: string | null;
  created_at: string;
}

export interface ExpertQuote {
  id: string;
  amount: string;
  currency: string;
  scope: string;
  deliverables: string[] | null;
  delivery_days: number | null;
  valid_until: string | null;
  status: string;
  created_at: string;
}

/* --------------------------------------------------------------------------------------------
 * Digital marketing
 * ------------------------------------------------------------------------------------------ */

export interface MarketingOffering {
  id: string;
  code: string;
  name: string;
  channel: string;
  summary: string;
  deliverables: string[] | null;
  starting_price_amount: string | null;
  currency: string;
  billing_period: string;
  min_term_months: number;
  channelConnected?: boolean;
  channelNote?: string | null;
}

export interface MarketingCampaign {
  id: string;
  reference: string;
  name: string;
  channel: string;
  status: string;
  monthly_budget_amount: string | null;
  currency: string;
  offering_name?: string | null;
  created_at: string;
  published_report_count?: number;
}

export interface MarketingReportMetric {
  key: string;
  label?: string;
  value: string | number;
  unit: string;
  source: string;
  estimated?: boolean;
}

export interface MarketingReportPeriod {
  id: string;
  period_start: string;
  period_end: string;
  status: string;
  summary: string | null;
  published_at: string | null;
  metrics: MarketingReportMetric[];
}

/* --------------------------------------------------------------------------------------------
 * Logo maker
 * ------------------------------------------------------------------------------------------ */

export interface LogoPalette {
  slug: string;
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
}

export interface LogoFontPreset {
  slug: string;
  name: string;
  stack: string;
  letterSpacing?: number;
}

export interface LogoProject {
  id: string;
  company_name: string;
  tagline: string | null;
  industry: string | null;
  style: string;
  palette_slug: string;
  font_slug: string;
  status: string;
  selected_concept_id: string | null;
  created_at: string;
}

export interface LogoConcept {
  id: string;
  project_id: string;
  variant: number;
  layout: string;
  mark_style: string;
  palette_slug: string;
  font_slug: string;
  svg: string;
  is_selected: boolean;
  updated_at: string;
}

export interface LogoCatalogue {
  palettes: LogoPalette[];
  fonts: LogoFontPreset[];
  layouts: Array<{ slug: string; name: string; description: string }>;
  markStyles: Array<{ slug: string; name: string; description: string }>;
  styles: string[];
}

/* --------------------------------------------------------------------------------------------
 * Unified inbox
 * ------------------------------------------------------------------------------------------ */

export interface InboxChannel {
  id: string;
  kind: string;
  name: string;
  provider_key: string;
  status: string;
  last_health_check_at: string | null;
  last_error_message: string | null;
}

export interface InboxConversation {
  id: string;
  subject: string;
  status: string;
  priority: string;
  contact_name: string | null;
  contact_email: string | null;
  assignee_id: string | null;
  unread_for_staff: number;
  /** Present on the customer's own conversation list. */
  unread_for_customer?: number;
  is_starred: boolean;
  last_message_preview: string | null;
  last_message_at: string;
  channel_kind: string;
  channel_name: string;
  labels: string[];
  ticket_id?: string | null;
}

export interface InboxMessage {
  id: string;
  direction: 'inbound' | 'outbound';
  visibility: 'public' | 'internal';
  author_name: string | null;
  body: string;
  delivery_status: string;
  delivery_error: string | null;
  created_at: string;
}

/* --------------------------------------------------------------------------------------------
 * Cart and checkout
 * ------------------------------------------------------------------------------------------ */

export interface CartLine {
  id: string;
  planId: string;
  productName: string;
  planName: string;
  billingPeriod: string;
  quantity: number;
  unitPriceAmount: string | null;
  lineTotalAmount: string | null;
  currency: string;
  priceUnavailable: boolean;
  unavailableReason: string | null;
}

export interface CartServiceLine {
  id: string;
  serviceKind: string;
  serviceRef: string;
  serviceName: string;
  billingPeriod: string | null;
  quantity: number;
  unitPriceAmount: string | null;
  lineTotalAmount: string | null;
  currency: string;
  priceUnavailable: boolean;
  unavailableReason: string | null;
}

export interface CartSummary {
  items: CartLine[];
  serviceItems: CartServiceLine[];
  currency: string;
  subtotalAmount: string;
  itemCount: number;
  hasUnavailableItems: boolean;
}

export interface OrderSummary {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  currency: string;
  subtotalAmount: string;
  discountAmount: string;
  taxAmount: string;
  totalAmount: string;
  createdAt: string;
  invoiceId: string | null;
  invoiceNumber: string | null;
  items: Array<{ id: string; productName: string; planName: string; billingPeriod: string; quantity: number; unitPriceAmount: string; lineTotalAmount: string; currency: string }>;
}

/** Shared money formatting: the server always sends a decimal string, never a float. */
export function money(amount: string | null | undefined, currency = 'USD'): string {
  if (amount === null || amount === undefined) return '—';
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currency} ${amount}`;
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency }).format(value);
  } catch {
    return `${currency} ${value.toFixed(2)}`;
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleDateString();
}

export function titleCase(value: string): string {
  return value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

/* --------------------------------------------------------------------------------------------\
 * Detail payloads (customer views)
 * ------------------------------------------------------------------------------------------ */

export interface TimelineEntry {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  created_at: string;
}

export interface ServiceMessage {
  id: string;
  author_role: string;
  body: string;
  created_at: string;
}

export interface ExpertRequestDetail {
  request: ExpertRequestSummary & {
    description: string;
    goals: string[] | null;
    reference_url: string | null;
    desired_start_date: string | null;
    offering_category: string | null;
    offering_deliverables: string[] | null;
    typical_delivery_days: number | null;
  };
  quotes: ExpertQuote[];
  messages: ServiceMessage[];
  timeline: TimelineEntry[];
}

export interface MarketingCampaignDetail {
  campaign: MarketingCampaign & {
    goal: string;
    target_url: string | null;
    target_audience: string | null;
    offering_deliverables: string[] | null;
  };
  messages: ServiceMessage[];
  timeline: TimelineEntry[];
  reports: MarketingReportPeriod[];
}

export interface InboxConversationDetail {
  conversation: InboxConversation & { contact_phone: string | null; external_reference: string | null };
  messages: InboxMessage[];
  labels: Array<{ id: string; name: string; color: string | null }>;
  assignments: Array<{ id: string; from_assignee_id: string | null; to_assignee_id: string | null; note: string | null; created_at: string }>;
}

/* --------------------------------------------------------------------------------------------\
 * Published websites (the visitor-facing render)
 * ------------------------------------------------------------------------------------------ */

export interface PublicForm {
  id: string;
  name: string;
  fields: Array<{ key: string; label: string; kind: string; required: boolean; options?: string[] }>;
  successMessage: string;
}

export interface PublishedPage {
  id: string;
  title: string;
  path: string;
  isHome: boolean;
  seo: { title?: string; description?: string; canonical?: string };
  content: Array<{ id: string; type: string; props: Record<string, unknown> }>;
}

export interface PublishedSite {
  site: { id: string; name: string; slug: string };
  publication: { version: number; publishedAt: string };
  snapshot: {
    siteId: string;
    version: number;
    publishedAt: string;
    name: string;
    theme: Record<string, unknown>;
    seo: { title?: string; description?: string };
    settings: Record<string, unknown>;
    forms: PublicForm[];
    pages: PublishedPage[];
  };
}

/* --------------------------------------------------------------------------------------------\
 * Storefront checkout
 * ------------------------------------------------------------------------------------------ */

export interface ShopperOrderResult {
  orderId: string;
  orderNumber: string;
  totalAmount: string;
  currency: string;
}

/**
 * One line of a merchant order as the merchant-facing order detail returns it: the stored line plus
 * the fulfilment row joined onto it (null until the line is fulfilled).
 */
export interface StoreOrderLine {
  id: string;
  order_id: string;
  product_id: string | null;
  variant_id: string | null;
  product_name_snapshot: string;
  variant_name_snapshot: string | null;
  kind: 'physical' | 'digital' | 'service';
  quantity: number;
  unit_price_amount: string;
  currency: string;
  line_total_amount: string;
  created_at: string;
  fulfilment_status: 'pending' | 'processing' | 'shipped' | 'delivered' | 'cancelled' | null;
  carrier: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  fulfilled_at: string | null;
}

export interface ShopperOrderStatus {
  order_number: string;
  status: string;
  payment_status: string;
  currency: string;
  total_amount: string;
  created_at: string;
  paid_at: string | null;
  items: Array<{
    product_name: string;
    kind: string;
    quantity: number;
    line_total_amount: string;
    fulfilment_status: string | null;
    carrier: string | null;
    tracking_number: string | null;
  }>;
  downloads?: Array<{ token: string; product_name: string; filename: string; expires_at: string; download_count: number; max_downloads: number }>;
  downloadDelivery?: { status: string; note: string } | null;
}
