# `pages.zip` safe integration review

The archive was inspected and extracted to an isolated temporary directory before comparison. No archive file was blindly copied. All 38 files already have an established destination in the repository. Current hardened controllers were retained where archive copies were weaker; protected CloudHost247 templates were not modified. The archive is not referenced at runtime and can be removed after verification.

## PHP controllers

Destination for each `PHP/*` entry is the same filename at the WHMCS document root.

### Already identical — no write required

| Archive entry | Existing destination |
|---|---|
| `PHP/acceptable-use-policy.php` | `acceptable-use-policy.php` |
| `PHP/domain-agreement.php` | `domain-agreement.php` |
| `PHP/domain-renewal-policy.php` | `domain-renewal-policy.php` |
| `PHP/domainregistrationaddendum.php` | `domainregistrationaddendum.php` |
| `PHP/fair-usage-policy.php` | `fair-usage-policy.php` |
| `PHP/faqs.php` | `faqs.php` |
| `PHP/legal.php` | `legal.php` |
| `PHP/terms-of-service.php` | `terms-of-service.php` |

### Current hardened implementation retained

| Archive entry | Existing destination | Review decision |
|---|---|---|
| `PHP/backup-policy.php` | `backup-policy.php` | Keep current `__DIR__` initialization; reject archive `DOCUMENT_ROOT` and nonexistent `configadminioncontroller.php` dependency. |
| `PHP/cookie-policy.php` | `cookie-policy.php` | Keep current `__DIR__` initialization. |
| `PHP/cybercrime-policy.php` | `cybercrime-policy.php` | Keep current initialization; reject nonexistent dependency. |
| `PHP/data-deletion.php` | `data-deletion.php` | Keep current `__DIR__` initialization. |
| `PHP/data-privacy-notice-and-consent-form.php` | `data-privacy-notice-and-consent-form.php` | Keep current dedicated `dataprivacynoticeandconsentform` template assignment; reject archive assignment to `privacypolicy`. |
| `PHP/data-protection-standards.php` | `data-protection-standards.php` | Keep current `__DIR__` initialization. |
| `PHP/help-center.php` | `help-center.php` | Keep current `__DIR__` initialization. |
| `PHP/legal-notice.php` | `legal-notice.php` | Keep current `__DIR__` initialization. |
| `PHP/privacy-policy.php` | `privacy-policy.php` | Keep current `__DIR__` initialization. |
| `PHP/refund-policy.php` | `refund-policy.php` | Keep current initialization; reject nonexistent dependency. |
| `PHP/trademark-policy.php` | `trademark-policy.php` | Keep current initialization; reject nonexistent dependency. |

The comparison found no safe missing controller behavior requiring a merge.

## Protected CloudHost247 templates

Each `TPL/*` archive entry maps to the existing `templates/cloudhost247_legacy/<filename>` path. These files are protected by the proprietary checksum manifest and were left unchanged.

### Already identical — no write required

- `TPL/acceptableusepolicy.tpl` → `templates/cloudhost247_legacy/acceptableusepolicy.tpl`
- `TPL/dataprotectionstandards.tpl` → `templates/cloudhost247_legacy/dataprotectionstandards.tpl`
- `TPL/domainagreement.tpl` → `templates/cloudhost247_legacy/domainagreement.tpl`
- `TPL/domainregistrationaddendum.tpl` → `templates/cloudhost247_legacy/domainregistrationaddendum.tpl`
- `TPL/fairusagepolicy.tpl` → `templates/cloudhost247_legacy/fairusagepolicy.tpl`
- `TPL/faqs.tpl` → `templates/cloudhost247_legacy/faqs.tpl`
- `TPL/helpcenter.tpl` → `templates/cloudhost247_legacy/helpcenter.tpl`
- `TPL/legal.tpl` → `templates/cloudhost247_legacy/legal.tpl`
- `TPL/legalnotice.tpl` → `templates/cloudhost247_legacy/legalnotice.tpl`
- `TPL/privacypolicy.tpl` → `templates/cloudhost247_legacy/privacypolicy.tpl`
- `TPL/termsofservice.tpl` → `templates/cloudhost247_legacy/termsofservice.tpl`

### Differing protected files — existing version retained

- `TPL/backuppolicy.tpl` → `templates/cloudhost247_legacy/backuppolicy.tpl`
- `TPL/cookiepolicy.tpl` → `templates/cloudhost247_legacy/cookiepolicy.tpl`
- `TPL/cybercrimepolicy.tpl` → `templates/cloudhost247_legacy/cybercrimepolicy.tpl`
- `TPL/datadeletion.tpl` → `templates/cloudhost247_legacy/datadeletion.tpl`
- `TPL/dataprivacynoticeandconsentform.tpl` → `templates/cloudhost247_legacy/dataprivacynoticeandconsentform.tpl`
- `TPL/domainrenewalpolicy.tpl` → `templates/cloudhost247_legacy/domainrenewalpolicy.tpl`
- `TPL/refundpolicy.tpl` → `templates/cloudhost247_legacy/refundpolicy.tpl`
- `TPL/trademarkpolicy.tpl` → `templates/cloudhost247_legacy/trademarkpolicy.tpl`

No protected template was overwritten, merged, reformatted, or activated differently. This review does not grant redistribution or activation rights.
