/**
 * Typed wrapper around the public status endpoint (`GET /api/v1/public/status`).
 *
 * The status page reports only what the deployment can verify about itself, and marks
 * everything else `unmonitored`. Incidents are operator-declared (never auto-detected),
 * so `monitored: false` is permanent.
 */
import { apiFetch } from './api';

export interface StatusComponent {
  id: string;
  name: string;
  state: 'operational' | 'degraded' | 'unmonitored';
  detail: string;
}

export interface StatusIncident {
  incident_number: string;
  title: string;
  status: string;
  severity: string;
  started_at: string;
}

export interface StatusResponse {
  monitored: boolean;
  checkedAt: string;
  latencyMs: number;
  incidents: StatusIncident[];
  components: StatusComponent[];
}

export function getStatus() {
  return apiFetch<StatusResponse>('/api/v1/public/status');
}
