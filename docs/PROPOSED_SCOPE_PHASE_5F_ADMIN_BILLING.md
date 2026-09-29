# Phase 5F Proposal: Staff & Admin Billing Management & Financial Operations

**Target Milestone:** Phase 5F — Staff & Admin Billing Management  
**Parent Phase:** Phase 5 — Commerce & Billing Architecture  
**Prerequisites:** Phase 5A (Accepted), Phase 5B (Accepted), Phase 5C (Accepted), Phase 5D (Development Accepted), Phase 5E (Implemented & Tested)  
**Working Branch:** `arena/01a0eb6e-cloudhost247`

---

## 1. Executive Summary

Phase 5F delivers the staff-facing administrative billing management and financial operations suite. While Phase 5E provided customer self-service capabilities for viewing their own invoices and paying balances, Phase 5F equips CloudHost247 support agents and administrators with comprehensive tools to inspect all customer invoices, search and filter the global billing ledger, investigate payment attempt records, execute authorized refunds, and cancel abandoned unpaid invoices.

All administrative financial mutations in Phase 5F strictly adhere to the append-only ledger architecture, immutable double-entry style accounting principles, strict RBAC enforcement, and comprehensive audit trail logging.

---

## 2. Architecture & Data Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                           Admin Billing Surface                                 │
│  ┌────────────────────────┐  ┌────────────────────────┐  ┌────────────────────┐ │
│  │   /admin/invoices      │  │  /admin/invoices/:id   │  │   /admin/ledger    │ │
│  │ (Search, Filter, List) │  │ (Detail, Refund, Void) │  │ (Audit Trail Logs) │ │
│  └───────────┬────────────┘  └───────────┬────────────┘  └─────────┬──────────┘ │
└──────────────┼───────────────────────────┼─────────────────────────┼────────────┘
               │                           │                         │
               ▼                           ▼                         ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│               Admin Billing API Router (`/api/v1/admin/billing/*`)              │
│       • RBAC Guard: `admin` | `super_admin` required (403 for `customer`)       │
│       • Rate-limited & Structured PINOM JSON Audit Logging                      │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              Billing Service Layer                              │
│       • Search & Pagination across Invoices & Ledger Entries                    │
│       • Refund Invariant Validator: SUM(refunds) <= SUM(payments)               │
│       • Atomic Multi-Row Operations inside DB Transactions                      │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     PostgreSQL Database & Financial Tables                      │
│       • `invoices` (Status transitions: paid -> refunded / partially_refunded)  │
│       • `billing_ledger` (Append-only insert of 'refund' entry types)           │
│       • `payments` & `orders` (Payment status synchronization)                  │
│       • `auth_audit_log` (actor_user_id, event_type, metadata)                  │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Detailed Scope & Capabilities

### 3.1 Backend Administrative Billing Endpoints
1. **`GET /api/v1/admin/invoices`**:
   - Query Parameters: `page`, `limit`, `status` (`paid` | `unpaid` | `cancelled` | `refunded`), `search` (invoice number or customer email).
   - Returns paginated list of invoices with joined customer name/email and order details.
2. **`GET /api/v1/admin/invoices/:id`**:
   - Returns deep invoice detail: invoice metadata, customer details, parent order snapshot & line items, complete payment attempt history, and invoice-specific ledger transactions.
3. **`GET /api/v1/admin/billing/ledger`**:
   - Global administrative financial audit ledger queryable by `userId`, `invoiceId`, `entryType` (`charge`, `payment`, `refund`, `credit`), `fromDate`, and `toDate`.
4. **`POST /api/v1/admin/invoices/:id/refund`**:
   - Body: `{ amountCents: number, reason: string }`
   - Authorization: `admin` and `super_admin`.
   - Financial Invariant Checks:
     - Invoice must be in `paid` or `partially_refunded` status.
     - `amountCents` must be positive integer cents ($> 0$).
     - Cumulative refunded amount ($ExistingRefunds + amountCents$) cannot exceed the total settled payments for the invoice.
   - State Transitions (Atomic DB Transaction):
     - Inserts an append-only `refund` row in `billing_ledger`.
     - Updates invoice status to `refunded` (if total refund == total paid) or `partially_refunded`.
     - Updates parent order's `payment_status` to `refunded` or `partially_refunded`.
     - Records `invoice_refunded` audit event with `actor_user_id`, refund amount, and reason.
5. **`POST /api/v1/admin/invoices/:id/cancel`**:
   - Body: `{ reason: string }`
   - Cancels an `unpaid` invoice and cancels any still-pending payment attempts.
   - Records `invoice_cancelled` audit event.

### 3.2 Frontend Administrative Billing Portal
1. **Admin Invoices Directory (`/admin/invoices`)**:
   - Search bar for quick lookup by invoice number (`INV-000001`) or customer email.
   - Status filters (`All`, `Paid`, `Unpaid`, `Refunded`, `Cancelled`).
   - Summary statistics cards: Total Billed, Total Collected, Total Outstanding, Total Refunded.
2. **Admin Invoice Management Detail (`/admin/invoices/:id`)**:
   - Customer profile badge and contact summary.
   - Full line item breakdown with unit prices and totals.
   - Payment attempt timeline showing gateway references, timestamps, and provider details.
   - Invoice ledger transaction history.
   - Action buttons: "Issue Refund" (for paid invoices) and "Cancel Invoice" (for unpaid invoices).
3. **Refund Modal (`AdminRefundModal.tsx`)**:
   - Displays paid amount, previously refunded amount, and maximum refundable balance.
   - Integer cent input with formatted currency display.
   - Mandatory reason text field for audit compliance.
4. **Admin Global Financial Ledger (`/admin/ledger`)**:
   - Complete searchable financial ledger displaying chronological double-entry flow across all system transactions.

---

## 4. Financial Safety & Security Invariants

1. **Strict Append-Only Guarantee:** The `billing_ledger` table trigger (`check_billing_ledger_append_only`) prevents any `UPDATE` or `DELETE` statements. Refunds are recorded solely by inserting new `refund` entries.
2. **Refund Cap Invariant:** The system computes $\sum \text{payments} - \sum \text{refunds}$ in integer cents before executing a refund. Over-refunding is strictly blocked with HTTP 400 `INVALID_REFUND_AMOUNT`.
3. **Role-Based Access Control (RBAC):**
   - Unauthenticated requests $\to$ `401 Unauthorized`.
   - Customer-role users $\to$ `403 Forbidden`.
   - Both `admin` and `super_admin` can view records and execute routine refunds/cancellations.
4. **Audit Trail Attribution:** Every state change logs the executing staff user ID (`req.user.id`), IP address, action timestamp, and rationale to `auth_audit_log`.
5. **Integer Cent Arithmetic:** All refund calculations use `centsToMajorUnits` / integer cents without floating point rounding errors.

---

## 5. Verification & Testing Plan

1. **Integration Tests (`tests/integration/admin-billing-api.test.ts`)**:
   - RBAC matrix: 401 for unauthenticated, 403 for customers, 200 for admin and super_admin.
   - Full refund lifecycle: paid invoice $\to$ partial refund $\to$ full refund $\to$ rejection of over-refund.
   - Ledger integrity: verifying new `refund` ledger rows with correct negative/positive attribution.
   - Invoice cancellation: unpaid invoice cancelled $\to$ rejection of payment initiation on cancelled invoice.
   - Audit trail verification: checking `auth_audit_log` rows for actor attribution.
2. **Frontend Unit Tests (`frontend/tests/unit/admin-billing-*.test.tsx`)**:
   - Admin invoices page render, search filtering, and pagination.
   - Admin invoice detail page render, line items, and action triggers.
   - Admin refund modal validation and submission.
3. **Regression Testing**:
   - Full test suite execution across all existing 41 test files to guarantee zero regression.

---

## 6. Out of Scope for Phase 5F
- Production migrations / live deployments.
- Live credit card processor chargeback webhooks (handled via Phase 5D pipeline).
- Automated provisioning of cPanel/VPS servers upon payment (deferred to Phase 6).
