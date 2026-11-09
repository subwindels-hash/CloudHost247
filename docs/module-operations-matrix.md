# Module Operations Matrix

| Module | Operational owner | Failure dependency | Customer impact if dependency is down |
|---|---|---|---|
| Hosting lifecycle | `subwindels-hash` (Platform) | cPanel/WHM/Plesk provider API (CT-01/02) | New hosting accounts cannot be created/suspended; existing services keep serving; lifecycle actions queue as failed with audit trail |
| Domains | `subwindels-hash` (Domains) | Registrar APIs (CT-06) | Registration/renewal blocked; existing DNS continues per TTL; acidic rollback registry keeps balance correct |
| Email | `subwindels-hash` (Comms) | Email relay (CT-04) + TLS | Outbound queues in outbox (no loss); inbound to provider unaffected; failure is retried, never dropped silently |
| SSL | `subwindels-hash` (Security) | CA issuance path (CT-02/06) | Issuance/renewal deferred; existing certs remain until expiry |
| VPS/Dedicated | `subwindels-hash` (Compute) | soyoustart_vps/ovh (CT-06) | Provisioning fails CLOSED with audit; no canceled order is billed silently |
| RDP | `subwindels-hash` (Compute) | modules/servers/RDP provider (CT-06) | Order visible from checkout 201; provisioning deferred with truth status |
| Proxies (LTE) | `subwindels-hash` (Compute) | cloudhost247_lteproxy (CT-06) | COMING-SOON holds; only-one-active bindings hold |
| Virtual numbers | `subwindels-hash` (Comms) | phoneservices_* providers (CT-06) | Order lifecycle truthful; unmapped numbers not hostable in UI |
| SMM | `subwindels-hash` (Marketing ops) | smmprovisioning/cloudhost247_smm (CT-06) | Orders surface failure rather than absorbing into queue without record |
| Billing | `subwindels-hash` (Finance, dual control) | Payment providers (CT-05) + DB | Ledger remains append-only; refunds idempotent; reconciliation pending CT-05 |
| Administration | `subwindels-hash` (Security) | DB + auth ring | Admin actions audit-logged; lockouts deferred can never silently remove control |
| Support | `subwindels-hash` (CX) | DB only | Tickets append-only; support quarantine mode fails closed to create-deny |
