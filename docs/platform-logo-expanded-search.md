# Expanded source search: one verified addition

## Snac2 — new evidence overturns an earlier rejection

Primary author statement, 23 March 2024:
https://comam.es/snac/grunfink/p/1711176017.741099

The page identifies grunfink as snac's author. The author says "I miss Susie,
the logo of #snac...", and in the same thread says "Sorry, no SVG, just this
raster image." This is stronger evidence than the earlier default-avatar
interpretation. Both uses can coexist. The original statement was fetched,
not inferred solely from a search snippet or another site's description.

Archive that led to the primary statement:
https://jrollans.com/social/jrollans/h/2024-03.html (second extracted chunk).

Installed unchanged `doc/susie64.png` from the pinned Yonle/snac2 GitHub mirror,
whose README credits grunfink and links to the same account. The upstream MIT
licence credits grunfink. The small original raster is retained; no tracing,
redrawing, recolouring or local resampling was performed. Its notice documents
both identity and mirror provenance; the manifest holds both file hashes.

## Other repositories and catalogues searched

- YunoHost/apps logo directory: found a Snac image, then followed author evidence
  rather than relying on the distribution's label alone.
- selfhst/icons and homarr-labs/dashboard-icons: relevant matches were different
  budgeting products, crontab-guru and LittleLink variants, not replacements for
  the unresolved entries.
- getumbrel/umbrel-apps and umbrel-apps-gallery: found a standalone isometric F
  image for FossFLOW, unlike the React boilerplate in the project repository.
  Submission PR https://github.com/getumbrel/umbrel-apps/pull/3959 shows the image
  came through a distribution submission. The current app manifest says the
  old upstream repository is unavailable and the app has been removed.
  **Not admitted:** the distribution image's original authorship/project
  adoption remains unverified under the user's standalone-original requirement.
- ShinyProxy's official demo points to an Open Analytics-hosted logo, but no
  verified local original was obtained in this pass. No deployment-specific
  third-party logo was substituted.
- Snac merchandise search results were not used as artwork or rights evidence.

## Status

One new entry covered, not ten. 1,078 of 1,091 entries visually covered; 13 remain.
No placeholder was hidden and no unverified file was counted.

## Validation

26 unit tests passed, one existing coverage TODO. Frontend TypeScript, logo
generation/gap audit, served image SHA-256 and linked notice checks passed.
`git diff --check` passed. No browser screenshot test was run.

## Later issue-tracker and archive pass — no admissions

Hostinger's ShinyProxy application page was rechecked and confirms the Open
Analytics product identity, but its extracted illustration is the same generic
marketing asset used on other product pages, not a standalone ShinyProxy logo.

New evidence from project/distribution discussions:

- https://github.com/aetaric/checkrr/issues/138 ("Time for an Icon") contains a
  contributor's standalone PNG proposal and an explicit public-domain statement.
  The body says the contributor could not find an official icon. No comments
  or maintainer adoption were recorded in the retrieved issue. A permissive
  artwork grant alone does not establish official project-logo identity; held.
- https://github.com/calesthio/Crucix/issues/78 uses
  `https://jooinn.com/images/world-globe-logo-1.png` in a contributor's CasaOS
  configuration. This is a generic stock globe, not verified Crucix artwork;
  rejected rather than copied.
- https://github.com/getumbrel/umbrel-apps/pull/3959#issuecomment-3591986169
  identifies a participant as FossFLOW's project author, Stan. The later
  https://github.com/getumbrel/umbrel-apps/pull/3959#issuecomment-3618943641
  says "thanks for the images I'll use them" in response to app-store badges.
  This supports the distribution relationship but does not explicitly adopt
  the standalone F artwork as the project's original logo. The candidate remains
  held under the user's standalone-original-only constraint.

Issue searches also covered linuxserver/budge, AsyncFuncAI/deepwiki-open,
alseambusher/crontab-ui, LumePart/Explo, h2non/imaginary,
openanalytics/shinyproxy and NVIDIA/auto-ontology, without another verified
standalone product-logo file. The Littlelink-Server repository-scoped issue
search failed validation; it is not represented as a successful search.

No production assets, manifests or coverage totals changed in this later pass.
No new runtime test run is claimed for this documentation-only update.
