# Correct identity and artwork: Fasten Health / fazer.ai agents

## Evidence

https://www.hostinger.com/applications — extracted chunk 9 lists two separate
products, Fasten Health and fazer.ai agents, with separate application links and
image references. The existing CloudHost247 name concatenated those two names.
This is not a software bundle and must not receive an invented composite mark.

- Fasten Health: https://github.com/fastenhealth/fasten-onprem — repository README
  distinguishes the self-hosted personal health-record app from Fasten Connect.
  The description reflects manual/FHIR record entry, not hosted Connect services.
  Original 192px favicon retained unchanged; the site's index references the
  favicon manifest. GPL licence retained.
- fazer.ai agents: https://github.com/fazer-ai/agents — Logo.tsx explicitly selects
  `/assets/logo-mark.png` as the default mark. That original PNG is retained
  unchanged with Apache-2.0 licence. CSS dark background gives its white shapes
  contrast without recolouring or altering the file.

## Compatibility and scope

The user requested the right logo after being shown the merged-entry problem.
Fasten Health keeps `app-fasten-healthfazer-ai-agents` and
`fasten-healthfazer-ai-agents` as legacy identifiers. No IDs are deleted or
renamed. Only the shared catalogue name, description and official links change.
The additional product uses `app-fazerai-agents` / `fazerai-agents`.

No database migration, order mutation or deployment implementation was performed.
Existing custom database rows still take precedence under the existing API merge
rules; an independently edited database row is not overwritten by this patch.
The new entry follows the shared directory's existing generic listing defaults;
this change does not certify new resource requirements or provisioning readiness.

The total therefore changes from 1,091 to 1,092. One old unresolved entry is
corrected, and one separately listed product is added. Two artwork files do not
mean two previously missing catalogue entries, much less a completed batch of ten.

## Original-file preservation

Each file has a verified Git blob, pinned commit and SHA-256 in the original-logo
manifest. Public notices mirror the source and licence in docs. Neither image
was cropped, traced, generated or locally resampled. Trademark rights are not
assumed from software licensing; no endorsement or affiliation is implied.
