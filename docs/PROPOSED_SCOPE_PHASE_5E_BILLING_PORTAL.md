# Phase 5E Proposal: Customer Billing Portal & Invoices UI

**Document Version:** 1.0.0  
**Date:** September 29, 2026  
**Status:** PROPOSED / SPECIFICATION ONLY (Zero code modifications made; awaiting explicit operator authorization)  
**Parent Phase:** Phase 5 — Commerce & Billing Architecture  
**Previous Milestone:** Phase 5D — Formally Accepted (Development Milestone Only). Production Frozen.

---

## 1. Executive Summary & Purpose

Phase 5E delivers the customer-facing frontend interface for the CloudHost247 billing platform. With the completion of Phase 5A (Carts & Orders), Phase 5B (Invoices & Billing Ledger), Phase 5C (Payment Initiation & Gateways), and Phase 5D (Cryptographic Webhook Ingestion Pipeline), Phase 5E connects customer users to their billing data via an intuitive, accessible, and responsive user interface.

Customers will be able to:
1. View all past and present invoices with authoritative payment statuses (`/invoices`).
2. Inspect full invoice breakdowns, including order line items, applied discounts, tax breakdowns, and payment attempt histories (`/invoices/:id`).
3. Initiate payment attempts directly from the invoice view using available gateways (`manual` bank transfer instructions or `sandbox` simulated gateway), with seamless real-time polling for webhook resolution.
4. Review their append-only financial transaction ledger and statement balance (`/billing`).
5. Print or export clean, professional invoice receipts for accounting and tax records.

---

## 2. Architecture & Backend API Contract Alignment

Phase 5E consumes existing, tested backend endpoints created in Phases 5A, 5B, and 5C without requiring breaking schema changes:

```
+---------------------------------------------------------------------------------+
|                                React 18 Frontend                                |
|                                                                                 |
|  +---------------------+   +---------------------+   +-----------------------+  |
|  |   /billing          |   |   /invoices         |   |   /invoices/:id       |  |
|  | - Account Balance   |   | - Invoices Table    |   | - Line Items Table    |  |
|  | - Outstanding Alert |   | - Status Filter     |   | - Payment History     |  |
|  | - Ledger History    |   | - Quick "Pay Now"   |   | - Payment Modal       |  |
|  +---------------------+   +---------------------+   +-----------------------+  |
+---------------------------------------------------------------------------------+
                                         |
                       [Authenticated REST API Requests]
                                         |
+---------------------------------------------------------------------------------+
|                                Fastify Backend                                  |
|                                                                                 |
|  GET  /api/v1/invoices               -> List caller's invoices (InvoiceSummary) |
|  GET  /api/v1/invoices/:id           -> Full detail, line items, attempts       |
|  GET  /api/v1/billing/ledger         -> Append-only customer billing ledger     |
|  POST /api/v1/invoices/:id/payments  -> Initiate payment ({gateway})            |
|  GET  /api/v1/payments/:id           -> Poll payment status                     |
+---------------------------------------------------------------------------------+
```

### Existing Endpoint Reference:
1. **`GET /api/v1/invoices`** (Implemented in Phase 5B):
   * Returns: `InvoiceSummaryDTO[]` (`id`, `orderId`, `orderNumber`, `invoiceNumber`, `status`, `currency`, `totalAmount`, `subtotalAmount`, `taxAmount`, `discountAmount`, `dueDate`, `paidAt`, `createdAt`).
2. **`GET /api/v1/invoices/:id`** (Implemented in Phase 5B / Extended in 5C):
   * Returns: `InvoiceDetailDTO` (all summary fields + `items` with plan names, billing periods, quantities, and `payments` array containing historical attempts with status, provider, method, and timestamps).
3. **`GET /api/v1/billing/ledger`** (Implemented in Phase 5B):
   * Returns: `BillingLedgerDTO[]` (`id`, `invoiceId`, `entryType`, `amount`, `currency`, `description`, `createdAt`).
4. **`POST /api/v1/invoices/:id/payments`** (Implemented in Phase 5C):
   * Body: `{ gateway: "manual" | "sandbox" }`.
   * Returns: `PaymentInitiationDTO` (`paymentId`, `providerReference`, `method`, `instructions`, `amount`, `currency`, `status`).
5. **`GET /api/v1/payments/:id`** (Implemented in Phase 5C):
   * Returns: `PaymentStatusDTO` (`id`, `invoiceId`, `status`, `provider`, `amount`, `currency`, `failureReason`, `completedAt`).

---

## 3. Frontend Component & Page Specifications

### A. Customer Invoices List (`src/pages/InvoicesPage.tsx`)
* **Route:** `/invoices` (Protected by `RequireAuth`).
* **Visual Elements:**
  * Summary Cards: Total Unpaid Invoices, Total Outstanding Balance, Paid Invoices Count.
  * Invoices Table: Invoice #, Order #, Issue Date, Due Date, Total Amount, Status Badge (`paid` green, `unpaid` amber, `cancelled` gray), Action (`View Details` / `Pay Now`).
  * Empty State: Clean illustration with "No invoices yet" message and link to product catalog.

### B. Invoice Detail & Payment Screen (`src/pages/InvoiceDetailPage.tsx`)
* **Route:** `/invoices/:id` (Protected by `RequireAuth`).
* **Visual Elements:**
  * Invoice Header: CloudHost247 brand metadata, Invoice Number, Issue Date, Due Date, Status Badge, Download/Print Button (`window.print()`).
  * Customer & Order Summary: Customer Name, Email, Linked Order Number.
  * Line Items Table: Description (Product + Plan Name), Billing Period (Monthly/Annual), Unit Price, Quantity, Subtotal.
  * Financial Summary Box: Subtotal, Discount, Tax (0.00), Total Due, Total Paid, Balance Due.
  * Payment History Section: List of all payment attempts (`pending`, `successful`, `failed`, `cancelled`), provider, reference ID, completed date.
  * Action Bar: Prominent "Pay Invoice" button (visible only when `status === 'unpaid'`).

### C. Interactive Payment Modal (`src/components/PaymentModal.tsx`)
* **Trigger:** Click "Pay Invoice" on `/invoices/:id` or `/invoices`.
* **State 1 (Gateway Selection):**
  * Radio options for available gateways (`Manual Bank Transfer`, `Sandbox Demo Payment`).
  * Displays exact amount to be charged in invoice currency.
* **State 2A (Manual Bank Transfer Selected):**
  * Displays staff-configured bank instructions from backend (`MANUAL_PAYMENT_INSTRUCTIONS`) or generic fallback.
  * Clear notice: "Once transferred, our billing team will review and verify your payment."
* **State 2B (Sandbox Demo Selected):**
  * Demonstrates payment lifecycle in staging/dev.
  * "Simulate Payment" button trigger.
  * Real-time polling indicator with spinner while waiting for webhook confirmation.
* **State 3 (Resolution):**
  * Success message with checkmark and automatic refresh of invoice status upon confirmation.
  * Failure message with clear reason if rejected.

### D. Billing Ledger & Account Balance (`src/pages/BillingPage.tsx`)
* **Route:** `/billing` (Protected by `RequireAuth`).
* **Visual Elements:**
  * Current Account Standing card (Active Services count, Unpaid Invoices alert).
  * Append-Only Ledger Table: Date, Entry Type (`charge`, `payment`, `credit`, `refund`), Description, Reference Invoice #, Amount (`+` charge / `-` payment).
  * Direct navigation links to `/invoices` and `/services`.

---

## 4. Security, Invariant, and UX Guarantees

1. **Client-Side Non-Authoritative Principle:** The frontend never marks an invoice or payment as paid. All status updates are strictly driven by backend server state returned from `/api/v1/*`.
2. **Strict Ownership Boundary:** Endpoints return `404 Not Found` (never `403 Forbidden`) when accessing non-owned invoices, preventing resource enumeration across customer accounts.
3. **Integer Cent Money Representation:** All monetary displays utilize `formatMoneyCents` (integer cents / 100) to ensure zero JavaScript floating-point rounding errors.
4. **Print & Accounting Optimization:** Dedicated `@media print` CSS rules in `src/styles.css` ensuring invoice views render cleanly as formal receipts without header navigation, footers, or action buttons.
5. **No Live Credentials in Client Code:** Zero payment provider client-side SDKs or secrets bundled in the browser build.

---

## 5. Comprehensive Test & Verification Strategy

Upon authorization, Phase 5E implementation will be validated against a strict test matrix in jsdom:

| Test File | Target Component | Test Scenarios |
| :--- | :--- | :--- |
| `frontend/tests/unit/invoices-page.test.tsx` | `InvoicesPage` | 1. Renders empty state when 0 invoices.<br>2. Lists customer invoices with correct status badges.<br>3. Formats currency amounts correctly.<br>4. "Pay Now" button triggers payment modal for unpaid invoices. |
| `frontend/tests/unit/invoice-detail-page.test.tsx` | `InvoiceDetailPage` | 1. Renders full line item breakdown and subtotal/total.<br>2. Renders payment attempt history table.<br>3. Hides "Pay Invoice" button when invoice is paid.<br>4. Print receipt button triggers `window.print()`. |
| `frontend/tests/unit/billing-page.test.tsx` | `BillingPage` | 1. Renders transaction ledger with charges and payments.<br>2. Displays outstanding balance alert.<br>3. Links to invoice details from ledger rows. |
| `frontend/tests/unit/payment-modal.test.tsx` | `PaymentModal` | 1. Renders available gateway options.<br>2. Displays manual bank transfer instructions verbatim.<br>3. Handles payment initiation and polling states.<br>4. Displays error alert on initiation failure. |

---

## 6. Strict Scope Boundaries & Freezes

The following remain **strictly out of scope** for Phase 5E:
* **No Live Payment Gateway SDKs / Production Webhooks:** Stripe Elements, PayPal JS SDK, or Paystack Popup SDK are deferred until live gateway credentials are authorized.
* **No Admin Billing Dashboard / Refunds UI (Phase 5F):** Staff search, invoice editing, and refund issuance remain in Phase 5F.
* **No Database Migrations:** Uses existing Phase 5A-5D schemas.
* **No Production Deployment:** Staging/local development milestone only.

---

## 7. Acceptance & Authorization Request

This document is submitted for operator review. Implementation will **not** begin without explicit written authorization.

**Status:** Awaiting operator authorization to begin Phase 5E implementation.
