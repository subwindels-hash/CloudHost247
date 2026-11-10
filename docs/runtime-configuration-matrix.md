# Runtime Configuration Matrix (.env.example reference)

| name | group | required | storage location | primary consumer | fail-closed workstream |
|---|---|---|---|---|---|
| AI_LLM_API_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| AI_LLM_API_STYLE | provider-bridge/service | no | config | runtime | — |
| AI_LLM_BASE_URL | provider-bridge/service | no | config | runtime | — |
| AI_LLM_MODEL | provider-bridge/service | no | config | runtime | — |
| AI_LLM_TIMEOUT_MS | provider-bridge/service | no | config | runtime | — |
| APP_URL | provider-bridge/service | no | config | runtime | — |
| AWS_ACCESS_KEY_ID | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| AWS_REGION | provider-bridge/service | conditional | config | runtime | — |
| AWS_SECRET_ACCESS_KEY | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| BACKUP_S3_ACCESS_KEY_ID | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| BACKUP_S3_BUCKET | provider-bridge/service | conditional | config | runtime | — |
| BACKUP_S3_ENDPOINT | provider-bridge/service | conditional | config | runtime | — |
| BACKUP_S3_REGION | provider-bridge/service | conditional | config | runtime | — |
| BACKUP_S3_SECRET_ACCESS_KEY | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| CONTABO_API_PASSWORD | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| CONTABO_API_URL | provider-bridge/service | conditional | config | runtime | — |
| CONTABO_API_USER | provider-bridge/service | conditional | config | runtime | — |
| CONTABO_CLIENT_ID | provider-bridge/service | conditional | config | runtime | — |
| CONTABO_CLIENT_SECRET | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| CREDENTIAL_ENCRYPTION_KEY | Crypto | no | secret (secure config, never logged/committed) | runtime | — |
| CREDENTIAL_ENCRYPTION_KEYS | Crypto | no | secret (secure config, never logged/committed) | runtime | — |
| CRON_JOB_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| DATABASE_POOL_MAX | Database | no | config | runtime | — |
| DIGITALOCEAN_API_TOKEN | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| DIGITALOCEAN_API_URL | provider-bridge/service | conditional | config | runtime | — |
| EMAIL_TRACE_COLLECTION_RUN_RETENTION_DAYS | provider-bridge/service | no | config | runtime | — |
| EMAIL_TRACE_RETENTION_DAYS | provider-bridge/service | no | config | runtime | — |
| EMAIL_TRACE_SWEEP_INTERVAL_MS | provider-bridge/service | no | config | runtime | — |
| FX_FEED_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| FX_FEED_URL | provider-bridge/service | no | config | runtime | — |
| FX_MAX_AGE_HOURS | provider-bridge/service | no | config | runtime | — |
| HETZNER_API_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| HETZNER_API_URL | provider-bridge/service | no | config | runtime | — |
| INBOX_INBOUND_WEBHOOK_SECRET | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| JWT_EXPIRES_IN | Auth/JWT | no | config | runtime | — |
| JWT_SECRET | Auth/JWT | YES (crash-loop guard) | secret (secure config, never logged/committed) | runtime | — |
| LOG_LEVEL | provider-bridge/service | no | config | runtime | — |
| MANUAL_PAYMENT_INSTRUCTIONS | provider-bridge/service | no | config | runtime | — |
| MARKETING_CONSENT_SECRET | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_AHREFS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_BING_ADS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_GOOGLE_ADS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_GOOGLE_ANALYTICS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_GOOGLE_SEARCH_CONSOLE_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_GOOGLE_TAG_MANAGER_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_LINKEDIN_ADS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_META_BUSINESS_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_PLAUSIBLE_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETING_PROVIDER_SEMRUSH_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| MARKETPLACE_MANIFESTS_DIR | provider-bridge/service | no | config | runtime | — |
| NODE_ENV | provider-bridge/service | no | config | runtime | — |
| NOTIFICATION_EMAIL_WEBHOOK_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| NOTIFICATION_EMAIL_WEBHOOK_URL | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_API_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| OPENSTACK_API_URL | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_AUTH_URL | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_IMAGE_URL | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_PASSWORD | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| OPENSTACK_PROJECT_DOMAIN_NAME | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_PROJECT_ID | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_PROJECT_NAME | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_REGION | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_USERNAME | provider-bridge/service | no | config | runtime | — |
| OPENSTACK_USER_DOMAIN_NAME | provider-bridge/service | no | config | runtime | — |
| OVH_API_ENDPOINT | provider-bridge/service | no | config | runtime | — |
| OVH_APPLICATION_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| OVH_APPLICATION_SECRET | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| OVH_CLOUD_PROJECT_ID | provider-bridge/service | no | config | runtime | — |
| OVH_CONSUMER_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| PAYPAL_WEBHOOK_ID | provider-bridge/service | conditional | config | runtime | — |
| PAYSTACK_SECRET_KEY | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| PORT | provider-bridge/service | no | config | runtime | — |
| PROVISIONING_HEALTH_TIMEOUT_MS | provider-bridge/service | no | config | runtime | — |
| PROXMOX_API_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| PROXMOX_API_URL | provider-bridge/service | no | config | runtime | — |
| SANDBOX_GATEWAY_WEBHOOK_SECRET | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| SECURITY_PIN_HMAC_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| SERVER_AGENT_INSTALL_URL | provider-bridge/service | no | config | runtime | — |
| SOCKET_PATH | provider-bridge/service | no | config | runtime | — |
| SOLUSVM_API_ID | provider-bridge/service | no | config | runtime | — |
| SOLUSVM_API_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| SOLUSVM_API_TOKEN | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| SOLUSVM_API_URL | provider-bridge/service | no | config | runtime | — |
| STRIPE_WEBHOOK_SECRET | provider-bridge/service | conditional | secret (secure config, never logged/committed) | runtime | — |
| VIRTUALIZOR_API_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| VIRTUALIZOR_API_SECRET | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| VIRTUALIZOR_API_URL | provider-bridge/service | no | config | runtime | — |
| VISITOR_IP_MODE | provider-bridge/service | no | config | runtime | — |
| VISITOR_IP_TRUSTED_PROXIES | provider-bridge/service | no | config | runtime | — |
| VULTR_API_KEY | provider-bridge/service | no | secret (secure config, never logged/committed) | runtime | — |
| VULTR_API_URL | provider-bridge/service | no | config | runtime | — |
| WORKER_CONCURRENCY | provider-bridge/service | no | config | runtime | — |
| WORKER_ID | provider-bridge/service | no | config | runtime | — |
| WORKER_LEASE_MS | provider-bridge/service | no | config | runtime | — |
| WORKER_ONCE_LEASE_MS | provider-bridge/service | no | config | runtime | — |
| WORKER_POLL_INTERVAL_MS | provider-bridge/service | no | config | runtime | — |
