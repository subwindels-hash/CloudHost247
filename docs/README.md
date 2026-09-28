# Documentation Index

| Path | Contents |
|---|---|
| `RESTRUCTURING.md` | Complete old→new mapping, removals, fixes, and verification record of the repository restructuring |
| `pre-restructuring-audit.md` | Package-by-package audit inventory taken before any changes |
| `policies/` | Source PDFs of the 19 CloudHost247 legal policies + original installation notes |
| `announcement-bar/` | Announcement Bar build brief, usage examples, and the (not installed) CloudHost247-branded template variant |
| `independent-rebuild/` | Independent rebuild programme: security review, installation/upgrade, staging matrices, per-system documentation, and the proprietary-file integrity manifest |
| `independent-rebuild/API-INTEGRATIONS.md` | **Central API & Integrations centre** — every supported provider, required credentials, where to obtain them, scopes, endpoint requirements, test vs production, rotation, connection testing, failure handling and the security model |
| `independent-rebuild/MODULE-MANAGER.md` | **Super Admin Module Manager** — the upload/validate/inspect/install/rollback pipeline, the `module.json` specification, archive-security controls, permissions, audit logging and packaging rules |
| `independent-rebuild/MODULE-MANAGER-COMPLIANCE.md` | **Module Manager traceability matrix** — every specification clause mapped to the code that implements it and the named test assertion that proves it |
| `independent-rebuild/API-INVENTORY-AUDIT.md` | Repository-wide audit of every outbound API, hard-coded credential findings and their remediation status |
| `build-notes/` | Build/install provenance notes per module (cloudhost247-tools-platform, cloudhost247-domain-lookup, dnschecker, customaffiliate, digitalproducts, cloudhost247-email, phoneservices, smm) |

Module-specific README/INSTALL files live with their modules:
- `modules/addons/tools_center/` (README.md, INSTALL.md, API.md)
- `modules/addons/cloudhost247_domain_lookup/README.md` (includes the rename provenance note)
- `modules/addons/digitalproducts/README.md`
- `modules/addons/smmaddon/README.md`
- `modules/addons/dnschecker/README.txt`
- `modules/servers/cloudhost247_lteproxy/README.md`
- `templates/cloudhost247_legacy/README.md` (original theme note)
- `modules/addons/cloudhost247_integrations/` (central API & Integrations centre — see `docs/independent-rebuild/API-INTEGRATIONS.md`)
- `modules/addons/cloudhost247_modules/` (Super Admin Module Manager — see `docs/independent-rebuild/MODULE-MANAGER.md`)
