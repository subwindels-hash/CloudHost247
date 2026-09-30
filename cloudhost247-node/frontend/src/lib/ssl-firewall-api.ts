import { apiFetch } from './api';

export interface SslCertificate {
  id: string;
  domain_name: string;
  sans: string[];
  issuer: 'LETS_ENCRYPT' | 'ZERO_SSL' | 'CUSTOM' | 'SELF_SIGNED';
  status: 'PENDING' | 'VALIDATING' | 'ISSUED' | 'EXPIRED' | 'FAILED' | 'REVOKED';
  challenge_type: 'HTTP_01' | 'DNS_01' | 'MANUAL';
  auto_renew: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface FirewallRule {
  id: string;
  server_id: string;
  protocol: 'tcp' | 'udp' | 'icmp' | 'any';
  port_range_start: number;
  port_range_end: number;
  direction: 'INBOUND' | 'OUTBOUND';
  source_cidr: string;
  action: 'ALLOW' | 'DROP' | 'REJECT';
  description: string | null;
  status: 'ACTIVE' | 'DISABLED';
  created_at: string;
}

export function fetchSslCertificates() {
  return apiFetch<{ certificates: SslCertificate[] }>('/api/v1/ssl/certificates');
}

export function requestSslCertificate(input: {
  domainName: string;
  sans?: string[];
  issuer?: string;
  challengeType?: string;
  autoRenew?: boolean;
}) {
  return apiFetch<{ certificate: SslCertificate }>('/api/v1/ssl/certificates', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function deleteSslCertificate(id: string) {
  return apiFetch<void>(`/api/v1/ssl/certificates/${id}`, {
    method: 'DELETE',
  });
}

export function fetchServerFirewall(serverId: string) {
  return apiFetch<{ rules: FirewallRule[] }>(`/api/v1/servers/${serverId}/firewall`);
}

export function addServerFirewallRule(
  serverId: string,
  rule: {
    protocol?: string;
    portRangeStart: number;
    portRangeEnd?: number;
    direction?: string;
    sourceCidr?: string;
    description?: string;
  }
) {
  return apiFetch<{ rule: FirewallRule }>(`/api/v1/servers/${serverId}/firewall`, {
    method: 'POST',
    body: JSON.stringify(rule),
  });
}

export function deleteServerFirewallRule(serverId: string, ruleId: string) {
  return apiFetch<void>(`/api/v1/servers/${serverId}/firewall/${ruleId}`, {
    method: 'DELETE',
  });
}

export function applyBaselineFirewall(serverId: string) {
  return apiFetch<{ rules: FirewallRule[] }>(`/api/v1/servers/${serverId}/firewall/baseline`, {
    method: 'POST',
  });
}
