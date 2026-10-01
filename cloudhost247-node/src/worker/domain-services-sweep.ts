/**
 * Domain Services worker sweep — the only place registrar/appraisal API calls are made for
 * order-fulfilment. Each step is compare-and-swap safe, so overlapping worker cycles, cron
 * `worker:once` runs, and crash recovery are all idempotent.
 *
 *   1. Paid registrations → registrar registration request → provider confirmation → domain live.
 *   2. Pending provider confirmations → status polling.
 *   3. Paid/fee-free transfers → registrar transfer initiation; in-flight → registry polling.
 *   4. Paid appraisals → appraisal provider execution.
 *   5. Auction state machine (scheduled → live → ending_soon → ended) + winner notifications.
 *   6. Domain Club membership expiry.
 */
import type { Queryable } from '../db/types';
import { getKeyRing } from '../lib/keyring';
import { processPaidRegistrations, confirmPendingRegistrations } from '../domain-services/registration-service';
import { processDomainTransfers } from '../domain-services/transfer-service';
import { processPaidAppraisals } from '../domain-services/appraisal-service';
import { sweepAuctionStates } from '../domain-services/auction-service';
import { expireLapsedMemberships, sendMembershipRenewalReminders } from '../domain-services/club-service';

export interface DomainServicesSweepReport {
  registrations: { claimed: number; registered: number; pending: number; failed: number };
  registrationConfirmations: number;
  transfers: { claimed: number; initiated: number; progressed: number; completed: number; failed: number };
  appraisals: { executed: number; failed: number };
  auctions: { started: number; endingSoon: number; ended: number };
  membershipsExpired: number;
  membershipRenewalReminders: number;
}

/** Short interval: auction states and fulfilment are latency-sensitive for customers. */
export const DOMAIN_SERVICES_SWEEP_INTERVAL_MS = 60_000;

export async function sweepDomainServices(db: Queryable): Promise<DomainServicesSweepReport> {
  const ring = getKeyRing();

  const registrations = await processPaidRegistrations(db, ring);
  const registrationConfirmations = await confirmPendingRegistrations(db);
  const transfers = await processDomainTransfers(db, ring);
  const appraisals = await processPaidAppraisals(db);
  const auctions = await sweepAuctionStates(db);
  const membershipsExpired = await expireLapsedMemberships(db);
  const membershipRenewalReminders = await sendMembershipRenewalReminders(db);

  return {
    registrations,
    registrationConfirmations,
    transfers,
    appraisals,
    auctions,
    membershipsExpired,
    membershipRenewalReminders,
  };
}
