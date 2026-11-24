# Control Panels & Application Platforms — inline-logo audit

## Status: original artwork incomplete — letter fallbacks approved

**Current total: 1,080/1,092 visually covered; 12 missing.** (1,066 individual marks plus 14 approved component-mark groups.) **Coverage is not rights clearance: open artwork-permission questions are recorded in each applicable manifest entry and linked source notice.** The user approved unchanged
local original PNG/WebP artwork, superseding the inline-only requirement.
The user now approves first-two-letter badges for unresolved entries. These replace the visible “SVG pending” text, but are not official logos and do not increase sourced-artwork coverage.
Historical counts and trace blockers below describe earlier passes. Identity
and reuse checks still apply; existing inline vectors remain supported.

Added SQLChat's original `public/chat-logo.webp` from
`sqlchat/sqlchat@85af0b4733d91d5c97a2ad89660cbfc515898676`, referenced by its
frontend ConnectionSidebar and settings. Visually inspected the original
wordmark. Stored unchanged at `frontend/public/platform-originals/sqlchat.webp`;
Git blob and SHA-256 are recorded in `platform-original-logos.json`.
Retained [SQLChat's MIT notice](platform-logo-licenses/SQLChat-LICENSE.txt).
The shared renderer accepts only these local manifest paths, never arbitrary
API image URLs. The gap audit checks original-file hashes. Validation passed:
logo audit, 16 unit tests (1 todo), and frontend TypeScript.

### Hiccup original PNG

Added unchanged `ashwin-pc/hiccup` `public/logo512.png` from revision
`e290862229e92860b1bcc97339d4f0dd2764280e`. Its web application manifest names
Hiccup and explicitly selects this 512px icon. Inspected the original: the blue
gradient and dark background are preserved rather than converted into paths.
Pinned Git blob and SHA-256 in the local-original manifest; retained
[Hiccup's MIT notice](platform-logo-licenses/Hiccup-LICENSE.txt).
The earlier trace-fidelity blocker is superseded by direct original rendering.

### ZNC original PNG

Added unchanged `znc/znc` `logo.png` from revision
`edeab9c1c158d27f9379c2c707b1dc670608782d`. The README explicitly displays
this file as ZNC's header logo linking to znc.in. Inspected the original;
metallic shading and outlined lettering remain intact without tracing.
Pinned original Git blob and SHA-256 in `platform-original-logos.json` and
retained [the Apache-2.0 notice](platform-logo-licenses/ZNC-LICENSE.txt).
This supersedes the earlier trace-only blocker, not the historical findings.

### Spacedrive original PNG

Added unchanged `spacedriveapp/spacedrive` `.github/logo.png` at
`30576ad1e5567b26dacdd0a68083ad77f714e960`. README explicitly selects it with Spacedrive
alt text. Visually inspected the blue sphere; original shading is retained,
not approximated by paths. Local original manifest records Git blob and SHA-256.
Retained [the Apache-2.0 notice](platform-logo-licenses/Spacedrive-LICENSE.txt).
The historical trace-fidelity rejection is superseded by original rendering.
A combined repository search initially led to attributing this path to GOWA;
the failed fetch corrected that attribution before any admission. No GOWA logo
was added.

### MeshCentral and WebCord originals

Added two unchanged upstream PNGs, visually inspected before admission:

- **MeshCentral**: `Ylianst/MeshCentral@6da4680a61cda2b610ceff28a3e4f0454b0e583c`, `public/favicon-303x303.png`. [Apache-2.0 notice](platform-logo-licenses/MeshCentral-LICENSE.txt).
- **WebCord**: `SpacingBat3/WebCord@c00f4bbc4dd1b0aa7185b3da5d26444e05874ac5`, `sources/assets/icons/app.png`. [MIT notice](platform-logo-licenses/WebCord-LICENSE.txt).

MeshCentral's login template explicitly selects its 303px Apple touch icon.
WebCord's documentation header explicitly selects its app PNG with `WebCord
Logo` alt text. WebCord's artwork resembles Discord branding because it is
its upstream-selected client mark; do not describe it as independently designed
or as trademark clearance. Original hashes and Git blobs are pinned in the
local-original manifest. Clouds, lettering, gradients and shading are preserved
without the trace losses previously recorded. Historical fidelity rejections
are superseded only for these unchanged originals.

### Plandex original documentation wordmark

Added unchanged `plandex-ai/plandex` `docs/static/img/plandex-logo-light.png`
at `e2d772072efadbe41d2946d97d79be55532dbab5`. `docs/docusaurus.config.ts` explicitly
selects it as the light-theme navbar logo with Plandex alt text. Inspected
original lettering and gradients. The README selects separate v2 variants;
this entry is specifically the documentation's selected wordmark, not a claim
that all upstream branding is identical. Local Git blob and SHA-256 are pinned;
[MIT notice retained](platform-logo-licenses/Plandex-LICENSE.txt).
No tracing, replacement font, or cropping was applied.

### TaxHacker original PNG

Added unchanged `vas3k/TaxHacker` `public/logo/512.png`, revision
`97f8a59af4361b8e772752204617098e17f299e2`. README explicitly displays this
file, and repository code search finds it in the entry and self-hosted pages.
Inspected the original cat/laptop artwork. Its texture and shading remain
unchanged; no raster-to-path conversion or embedded-image SVG is used.
Git blob and SHA-256 are pinned in the local-original manifest, with
[MIT notice retained](platform-logo-licenses/TaxHacker-LICENSE.txt).
The previous trace-fidelity blocker is superseded by this original file.

### Screego original PNG

Added unchanged `screego/server` `ui/src/logo.png` at
`324e98abbd9c61cfa01c94e7df904fa834e41925`. The README explicitly displays `docs/logo.png`,
which has the identical Git blob `18d0cab5595bb67e181aec312f20eb6be1c9f259`.
Inspected original gophers and translucent glow. No tracing or halo-generating
conversion was applied. The local manifest pins source revision, Git blob and
SHA-256. Retained [the repository GPL-3.0 text](platform-logo-licenses/Screego-LICENSE.txt)
and the original PNG as source; no artwork-specific licence was separately
stated in the inspected README or licence listing. This is a repository-licence
record, not a blanket trademark/third-party-artwork clearance. Review gopher
attribution requirements before commercial deployment. Earlier rendition
rejections are superseded only by direct display of the unchanged PNG.

### Ten-original batch requested by the user

Added ten unchanged PNG originals after inspecting the artwork together. Each
source revision and Git blob is pinned; local file SHA-256 is audited. The
manifest's `identityFile` records the pinned application/README/config reference.
Dkron's application imports `ui/src/images/dkron-logo.png`, byte-identical by
Git blob to the selected public asset. Its pale wordmark receives a dark CSS
background; the original bytes are not changed. CoAI's 512px desktop icon is
itself soft-edged; no claim of added sharpness is made. Atlas's default logo is
only 100px; it is preserved at original resolution, not AI-upscaled.

| Catalogue slug | Repository and revision | Original file | Repository licence |
| --- | --- | --- | --- |
| `classquiz` | `mawoka-myblock/ClassQuiz@f99e0105430b86099f819b76b9c3d6d720bac820` | `logo.png` | [MPL-2.0](platform-logo-licenses/classquiz-LICENSE.txt) |
| `coai` | `coaidev/coai@3048a493eedcfe75de4d59afd5139847ad3195ed` | `app/src-tauri/icons/icon.png` | [Apache-2.0](platform-logo-licenses/coai-LICENSE.txt) |
| `dkron` | `dkron-io/dkron@8952bde62f7483d83b06d68d7bbaeeaa0fa8a948` | `ui/public/dkron-logo.png` | [LGPL-3.0](platform-logo-licenses/dkron-LICENSE.txt) |
| `trip` | `itskovacs/trip@856b1edfe81a735fce4b544c2e16a6518cebf164` | `src/public/icons/TRIP_512.png` | [MIT](platform-logo-licenses/trip-LICENSE.txt) |
| `soulsync` | `Nezreka/SoulSync@6fdd64e9e94f85e4b2409e66b0b5449c7c3a4e3a` | `webui/static/pwa-icon-512.png` | [MIT](platform-logo-licenses/soulsync-LICENSE.txt) |
| `karaoke-eternal` | `bhj/KaraokeEternal@5d46aca8cdea867d6a3c6933e63e480adba525b5` | `docs/assets/images/logo_mic.png` | [ISC](platform-logo-licenses/karaoke-eternal-LICENSE.txt) |
| `jelly-clipper` | `arnolicious/jelly-clipper@134b70264ea662edaacd5e219dca1bc0a5df97c9` | `static/apple-touch-icon.png` | [MIT](platform-logo-licenses/jelly-clipper-LICENSE.txt) |
| `atlas-cmms` | `Grashjs/cmms@a3c7ce38adedeb90ac13c280e8ccad6622ff2a42` | `frontend/public/static/images/logo/logo.png` | [AGPL-3.0](platform-logo-licenses/atlas-cmms-LICENSE.txt) |
| `local-deep-research` | `LearningCircuit/local-deep-research@8669e980f5f7565bcd96907d3184505506239178` | `src/local_deep_research/web/static/favicon.png` | [MIT](platform-logo-licenses/local-deep-research-LICENSE.txt) |
| `topola-genealogy-viewer` | `Pewu/topola-viewer@3e2fe29753b19c044519714fec116f4fb8f23be6` | `public/favicon.png` | [Apache-2.0](platform-logo-licenses/topola-genealogy-viewer-LICENSE.txt) |

Licence texts are retained alongside source provenance. Unchanged PNGs are
included as the original artwork source; no derivative traces were made.
Repository licences are not blanket trademark clearance. Existing production
licensing review requirements still apply, particularly for copyleft material.
Earlier trace-fidelity blockers for these ten are superseded by direct original
rendering. No project names, generic fallback marks or third-party sponsor logos
were substituted to reach the requested count.

### Fifty-project source pass — six additions, not fifty completed logos

The requested 50-project sourcing pass produced six admitted originals. The
other 44 remain unresolved; this is not a claim to have delivered 50 logos.
See the [per-project result ledger](platform-logo-batch-50.md) for revisions,
source paths, lookup failures, identity rejections and rights blockers.

Added Gotenberg's selected navbar PNG, Open Archiver's selected favicon,
Skyvern's frontend wordmark, Text Generation Web UI's Gradio favicon, Gemini
CLI's official IDE companion icon, and Apache Kvrocks' project mark. Five PNGs
are stored unchanged from upstream PNG files. Kvrocks' official SVG contains
one PNG at full canvas dimensions: extracted those exact original PNG bytes,
without resampling, tracing or cropping. Its container hash, Git blob and
extraction description are recorded separately from the extracted PNG hash.

Skyvern's pale lettering uses a dark CSS ground without changing pixels.
Gemini CLI's entry is specifically its official companion icon, not a claim
that the terminal's ASCII header is a bitmap. Open Archiver's 60px source is
not artificially sharpened. Kvrocks links to its official project website;
the [ASF policy](https://www.apache.org/foundation/marks/) explicitly covers
project graphics under the Apache licence and permits graphic website links.
This does not authorise use as an endorsed CloudHost247 brand. Repository
licence texts and original-image source provenance are retained for all six.

### Ten-original update: two new entries and eight trace replacements

This batch changes ten catalogue logos, **not ten previously missing entries**.
Added Zen and DeskRPG from their own web-app manifests. Replaced eight traced
renditions with the exact original PNG bytes already pinned by those trace
records: Big-AGI, Cap CAPTCHA, Casibase, ChiefOnboarding, Coral Talk, Dialoqbase,
Dograh and Domoticz. Each original hash was checked against the prior
`originSha256` before migration. The removed trace hash is preserved in the
original-file manifest; generated SVG entries were removed, not double-counted.
All ten originals were visually inspected. ChiefOnboarding and Dograh retain
wide wordmark layout. Current split: 14 handwritten + 959 generated + 35 local
originals = 1,008 sourced.

Zen identity was resolved against Hostinger's note-taking application page,
then matched to `sheshbabu/zen` and its explicit `assets/site.webmanifest`.
The upstream 512px original retains its orange gradients. AGPL text is retained
in [zen-LICENSE.txt](platform-logo-licenses/zen-LICENSE.txt).

DeskRPG's pinned current licence explicitly adds **Infrastructure Provider
Permission** for unmodified one-click deployments to customer-controlled
infrastructure. That changes the earlier blanket Sustainable Use blocker for
that narrow deployment model. Fees must be for infrastructure, not the software;
all notices must remain; customer use stays subject to the licence; operating
it on behalf of customers as a managed service is excluded. This logo change
does not validate or alter deployment/pricing compliance. The exact PWA image
selected by `public/manifest.json` is used, not the separate employee-avatar
Apple icon or a guessed variant. See
[deskrpg-LICENSE.txt](platform-logo-licenses/deskrpg-LICENSE.txt).

Other research in this pass remains unresolved: JobOps has Commons Clause
terms; Evolution Go adds notification/logo conditions; .NET brand files are
not automatically ASP.NET-specific branding; Drizzle ORM art is not assumed to
be Gateway's logo; Anki Enhanced, Explo and Crucix searches found screenshots,
provider icons or text rather than a verified standalone brand asset. GoWA's
separate dashboard/reuse terms need further review. No such asset was silently
substituted to reach ten additions.

### Ten more original-file replacements (coverage unchanged)

Replaced ten existing traces with their unchanged original PNGs. This does
**not** resolve any of the 83 remaining gaps and is not counted as ten new
sourced entries. Every fetched file matched its existing `originSha256` and
Git blob before migration. Original revision and file hashes are preserved;
the prior trace digest remains as `replacesTraceSha256`. Existing licence
notices and source-identity reviews continue to apply.

| Catalogue slug | Pinned repository revision | Original file |
| --- | --- | --- |
| `eclipse-kura` | `eclipse-kura/kura-management-ui@79659e4b7381dfd1f21747b545e157cb2a098d19` | `org.eclipse.kura.web2/src/main/webapp/eclipse/kura/icons/kura_login_logo.png` |
| `embystat` | `mregni/EmbyStat@be617783dafaaa27d3a1b3524fbbc9fc9470795f` | `branding/logo-color.png` |
| `errbit` | `errbit/errbit@14655aef50e53ebb4e4d30b3be627a4a0d52740f` | `docs/notifications/slack/errbit.png` |
| `expensave` | `algirdasc/expensave@5305cee55487e058e5a80ad7e719d11f1ef89a5e` | `frontend/src/assets/favicon/android-chrome-256x256.png` |
| `fusiondirectory` | `fusiondirectory/fusiondirectory@1efe63dab1b99ba57f553cae6d529021cf1e4c52` | `html/themes/breezy/icons/scalable/apps/fusiondirectory.png` |
| `gpt-researcher` | `assafelovic/gpt-researcher@8b474fe7d92aca112601cb87e1ec0999103bc01a` | `docs/static/img/gptr-logo-tile.png` |
| `hollama` | `fmaclen/hollama@a6614a2e0c6f0634f75e6b1605dcae28b8628bb1` | `electron/resources/icons/png/1024x1024.png` |
| `dspace` | `DSpace/DSpace@7ad52048c3143f161f6cb8ad93b15243aad3913f` | `dspace-api/src/main/resources/dspace_logo.png` |
| `cops` | `seblucas/cops@7828cc600e904941583227071b8f4efd3b9385fb` | `images/icons/icon144.png` |
| `codimd` | `hackmdio/codimd@b1188a5648a23d970b9ad58612376e6602431f6f` | `public/favicon.png` |

Inspected all ten originals visually. Eclipse Kura's white wordmark receives
the shared dark CSS ground, without changing its pixels. Kura, EmbyStat and
FusionDirectory use wide layout. No resampling, tracing, invented lettering,
or replacement vendor symbol was used. Hollama's original has more texture
than the traced rendition. All generated entries for these ten were removed
rather than leaving overlapping registries.

Current split: **14 handwritten + 949 generated + 45 local originals = 1,008**.
The historical inline-only totals below are not the current count.

### Nine-original update (no missing entries resolved)

Replaced nine traced logos with unchanged upstream PNG files. All downloads
matched both the previously pinned Git blob and original SHA-256. Existing
licence notices remain in place; each new original manifest record preserves
the removed trace digest. These are **nine fidelity updates, not nine newly
resolved gaps**. Coverage stays 1,008 sourced and 83 pending.

| Catalogue slug | Pinned repository revision | Original file |
| --- | --- | --- |
| `kill-bill` | `killbill/killbill@8881b6617a7ef2d0bd5e1dd354d37405eb1362d6` | `profiles/killbill/src/main/webapp/images/KillBillLogo400x400.png` |
| `m3db` | `m3db/m3@ea708d3a685f613af7dd0a39571f98d0802c4105` | `site/static/images/logo-square.png` |
| `mailtrain` | `Mailtrain-org/mailtrain@89b189d0f5fcb3bb069dde7c2da72d5acd071dd5` | `client/static/mailtrain-notext.png` |
| `mapstore` | `geosolutions-it/MapStore2@cacb8452dbe145267ad3b67b692ff24a8c3feb4b` | `web/client/product/assets/img/favicon.png` |
| `maputnik` | `maplibre/maputnik@b6db2ff9e823f4f2156d54c73dcf469c844e57c4` | `src/img/maputnik.png` |
| `mediago` | `mediago-dev/mediago@c4a1cac40800b9754cf4305283442031ea835ba0` | `apps/ui/public/icon-512.png` |
| `mirofish` | `666ghj/MiroFish@7657031ac01184afe2cb220f5ee3545573b5e843` | `frontend/public/icon.png` |
| `mopidy` | `mopidy/mopidy@ceb96aaf653473061db09cef2382e5ce758a62e3` | `docs/images/logo.png` |
| `nsq` | `nsqio/nsq@85cf10c09c6c3c86160d6f0eb156f62d0efc1648` | `nsqadmin/static/img/favicon.png` |

Visually inspected all nine originals. MapStore's faded lower globe is present
in the source, not a missing piece; MiroFish's pixel styling is upstream artwork.
Mailtrain's small 61×72 source is not artificially enhanced. None was traced,
resampled, cropped or replaced with a similar-looking vendor logo. Generated
entries were removed, keeping the source registries disjoint.

Current split: **14 handwritten + 940 generated + 54 local originals = 1,008**.

### Missing-logo research follow-up: Automatisch

One previously missing entry resolved; the requested ten-new-logo batch is
**not complete**. Automatisch uses its own v0.9.3 favicon from
`automatisch/automatisch@8156b8b356b641c1acb5672226a7598b5b3cfbe2`, explicitly
selected in `packages/web/public/index.html` and the application manifest.
This is the upstream dark-blue stylised a, not an initial we generated.
The historical release avoids substituting the newer Mation rebrand for the
Automatisch catalogue identity. Hostinger's Automatisch page confirms the
workflow-automation product. The root licence assigns non-enterprise files
(including this favicon) to AGPL-3.0; both scope text and full licence are retained.

The browser serves the **unchanged original ICO**, preserving all embedded
sizes; no tracing or PNG conversion is used. Local-path validation now accepts
ICO as well as PNG/WebP and still verifies the file hash. Visual review used a
scratch decoded preview only, never installed as the production asset.

Current split: 14 handwritten + 940 generated + 55 originals = 1,009 sourced.
See [missing-logo research findings](platform-logo-missing-ten.md) for the
unresolved candidates. No existing trace replacement is counted as a new logo.

### Official-forge follow-up: Iceshrimp

One new missing entry resolved, **not the requested ten**. Iceshrimp's official
source is on iceshrimp.dev, not the previously attempted GitHub repository.
The original `assets/logo.png` was retrieved by image search from the official
project page. It was admitted only after its 55,577-byte payload matched the
Git LFS SHA-256 published by the official forge, exactly:
`30413bc6a5284ad4bf68f973b5787511130a83cb53003c686ba88f41935df3b2`.
The manifest's Git blob identifies the **LFS pointer**, not the image payload.

Visually inspected the full Iceshrimp wordmark and preserved its background,
proportions and pixels. It uses the wide-logo layout. The separate official
branding repository explicitly licenses artwork © 2023 Laura Hausmann (Kilcat)
under CC BY-SA 4.0. Attribution and the licence link are retained in
[iceshrimp-LICENSE.txt](platform-logo-licenses/iceshrimp-LICENSE.txt), also served
beside the image and linked from it in the UI. No endorsement is implied.

Current split: 14 handwritten + 940 generated + 56 originals = 1,010 sourced.

Further research this pass: Sharkey GitHub search located forks, not a verified
current upstream asset; the official GitLab page fetch failed. Komari's public
repository contains sponsors and themes, not proof of its own logo. Letta Code
contains screenshots rather than established Letta-server branding. Snac2,
Conduit and FMD attempted GitHub mappings failed; no wrong repository was
silently substituted. ShinyProxy's assumed site repository was absent. GoWA
still needs a documented artwork grant. Manticore's separate artwork source
remains unresolved. .NET's actual guidelines were downloaded and reviewed:
its primary square logo requires at least 50px and clear space; it was not
inserted into the smaller catalogue icons or assumed to be an ASP.NET-specific
mark. These are open findings, not evidence that those projects lack logos.

### Ten newly sourced catalogue entries

Added ten unchanged upstream originals: ASP.NET (the shared official .NET
mark), Evolution API, Evolution Go, JobOps, Koffan, Nango, Open Source POS,
Redpanda Console, SpacetimeDB and YaCy. No traced-logo replacements are counted
in this batch. Current split: 14 handwritten + 940 generated + 66 originals =
**1,020 sourced; 71 unresolved**.

See [the ten-entry admission ledger](platform-logo-ten-admissions.md) for exact
pins, identity evidence and retained terms. Earlier blanket software-licence
blockers are narrowed to distinguish catalogue artwork from operating the
software. This is not commercial-hosting clearance: the restrictions remain
recorded and no deployment permissions, licence enforcement or product code
were changed. Every new image links to its source/copyright/licence notice.

### Ten approved bundle entries

The user explicitly approved **separate, labelled original component logos**
for bundles with no verified single vendor logo. Ten previously pending entries
now use this presentation: Docker and Traefik; six OpenLiteSpeed bundles
(Django, Drupal, Joomla, Node.js, Rails, WordPress); LAMP; LEMP; and MERN.
No invented combined brand, initials or traced substitute is used. Each image
has its component name visible beneath it, an accessible name, and a source/
licence link for the group. This is **not ten newly discovered composite logos**.

Sources: 15 vector marks from the already-used SVG Logos collection, pinned to
`@iconify-json/logos@1.2.20`, plus the unchanged OpenLiteSpeed PNG selected from
its official example site. Geometry and colours were not redrawn; vector body
and resulting SVG hashes, package archive hash, and OpenLiteSpeed Git revision,
blob and SHA-256 are recorded in `platform-bundle-logos.json`. Original vector
view boxes are preserved. All 16 component marks were visually inspected.
OpenLiteSpeed's light lettering receives a dark CSS background, not pixel edits.

The bundle audit validates local paths, every asset hash, SVG safety, component
references and disjoint coverage. It rejects unknown/duplicate components and
bundles overlapping individual marks. Component groups have their own registry
rather than being miscounted as single vendor logos. Two other named stack
entries (MEAN and MEVN) remain pending; they were not silently added beyond ten.

Current split: **14 handwritten + 940 generated + 66 original-file marks +
10 approved component groups = 1,030 covered**. There are still 61 unresolved
catalogue entries. This count measures catalogue coverage, not unique artwork.

Validation: logo audit, 18 unit tests (one remaining coverage TODO), frontend
TypeScript, and HTTP loading of each component asset and notices passed.

### Next ten catalogue entries: eight images and two stacks

Added aaPanel, Multica, nopCommerce, FMD, Foundry VTT, Sharkey, MCP Server,
Ant Media Server CE, MEAN and MEVN. See
[next-ten source and limitations ledger](platform-logo-next-ten.md).
Eight files are unchanged pinned PNGs; two stack groups extend the explicitly
approved separately-labelled component approach. MEAN uses **AngularJS**, not
modern Angular; MEVN uses Vue.js. There are now 1,040 visually covered entries
and 51 missing entries. This metric is not a count of legally cleared marks.

The Ant Media source is authoritative and the image is original, but a separate
artwork licence was not established. The manifest and publicly linked notice
explicitly retain that review issue; no general licence was inferred from its
server code or dashboard template. Originality and rights clearance are not
the same claim. The remaining software licence restrictions also still apply.

### Ten further originals, not trace replacements

Added Matrix Conduit, Twingate Connector, Ubooquity, Komari, Zenfeed, GoWA,
Yucca, Yao, EmailEngine and MetaTrader 5. See
[the source-format and review ledger](platform-logo-further-ten.md).
Current split: 14 handwritten + 940 generated + 84 original files + 12
component groups = **1,050 visually covered; 41 missing**.

Nine files have pinned upstream Git blobs. MetaTrader 5 comes directly from
its official product website via image retrieval, pinned by captured-file
SHA-256, not an invented Git revision. Yao's website publishes its artwork
under MIT, independently of its engine's custom software licence. GoWA's SVG
already embeds PNGs; the original source is retained, not a newly generated
wrapper. Local original SVG/JPEG support preserves these files without tracing
or conversion. The audit checks SVG references and rejects active/external
content while allowing the specifically reviewed embedded PNGs in GoWA.

Identity was not inferred from filenames alone: Conduit's official site shows
the yellow lightning bolt; Komari's main README pins the chosen frontend icon;
Zenfeed's app.html selects its icon; GoWA's README displays its logo; Yucca's
own site supplies the plant artwork; Yao uses its own website brand asset.
Snac2's default avatar was rejected as insufficient project-logo evidence.
LittleLink's mark was not substituted for the separately named server fork.
Svix's explicit permission requirement remains unresolved; no mark was added.

Six of this batch retain explicit artwork-rights review flags (Komari, Zenfeed,
GoWA, Yucca, EmailEngine and MetaTrader 5). Their source identity is verified,
but this is not a blanket copyright/trademark clearance. Original notices are
publicly linked and retained in docs; no software hosting licence is implied.

### Ten web/repository sourcing additions

Added Apache JSPWiki, ClusterControl, Drizzle Gateway, Euro-Office DocumentServer,
KUSANAGI, Letta, Manticore Search, Perplexica, R2R and TinyCP. Four files are
unchanged pinned Git assets; six are image-search captures with source-page
references and local SHA-256 pins, not invented Git hashes. See
[web/repository batch ledger](platform-logo-web-ten.md) for source limitations.

Current split: **14 handwritten + 940 generated + 94 local artwork files +
12 approved component groups = 1,060 visually covered; 31 missing**.
Only Apache JSPWiki and Perplexica have the specific reusable terms documented
for this batch; eight other artwork-permission reviews remain explicit. Coverage
is not rights clearance. Letta uses its official branded announcement artwork;
TinyCP is a directory-provided wordmark; R2R is a PNG retrieval of its official
SVG wordmark. These distinctions are not hidden as first-party original bytes.

### UI-source follow-up: one addition, not ten

The requested ten-entry batch was **not completed**. MicroRealEstate is newly
covered by the actual static favicon at its current upstream revision. Reading
`AppLogo.tsx` revealed the distinctive blue house/face geometry; `styles/brand.ts`
then pointed to the matching static favicon. This avoids both the older generic
building icon and any need to reconstruct a logo from JSX. The upstream SVG
bytes are unchanged and checked against both SHA-256 and the Git blob.

Retain its Sustainable Use licence and explicit artwork-permission review flag.
No separate promotional-artwork grant was established. This is visual source
coverage, not commercial-hosting or trademark clearance.

Other searches this pass did not establish nine more logos: Codex results were
screenshots and architecture diagrams; the purported FossFLOW logo was a
network diagram; Crucix results included a website badge; DeepWiki Open results
were cropped screenshots. Filename/UI-code searches for Checkrr, Crontab UI,
Explo, Plik and Tiny File Manager were inconclusive. This does not prove those
projects have no logos, and none was replaced by an invented mark. Explicit
permission blockers on other remaining entries were not waived to reach ten.

Current split: **14 handwritten + 940 generated + 95 local artwork files +
12 approved component groups = 1,061 visually covered; 30 missing**.

### Ten identified artwork additions — commercial clearance remains open

Added Atomic Server, Canarytokens, Firefly, FASTPANEL, Geneac, Open Agent,
OpenAI Codex, Plik, Plone and Svix. See [batch ledger](platform-logo-verified-ten.md).
Seven files are unchanged pinned Git assets; Codex is an unchanged original app
icon redistributed in a pinned npm package with a matching documented hash;
two are official-site image captures. Geneac is its original branded website
banner, not an isolated logo. Plik is a third-party catalogue copy.

**This revises the earlier decision to keep identity-verified but legally
uncleared artwork out of the preview. It does NOT resolve the legal blockers.**
Restrictive terms for Firefly, Atomic Server, Canarytokens, Plone and Svix remain
open production-publication gates. All ten carry explicit rights-review notices;
no commercial permission or endorsement is claimed. Obtain appropriate review
and permissions before production use.

Current split: **14 handwritten + 940 generated + 105 local artwork files +
12 approved component groups = 1,071 visually covered; 20 missing**.

### Remaining-entry research: six additions, not ten

This requested ten-entry batch was **not fully completed**. Added Juxtapose,
DeepSeek Harness, Grok Build and Tiny File Manager source artwork, plus labelled
Anki + Docker and OpenShell + OpenClaw component groups for Anki Sync Server
Enhanced and NemoClaw. See [research ledger](platform-logo-remaining-six.md).
The existing OpenLiteSpeed and Node.js group was rechecked, not counted anew.

Current split: **14 handwritten + 940 generated + 109 local artwork files +
14 approved component groups = 1,077 visually covered; 14 missing**.

### Expanded archive search: Snac2 identity correction

The broader search found direct author evidence that Susie **is** snac's logo,
not merely a default avatar. Added the unchanged upstream 64px PNG with MIT
notice, pinned Git blob and SHA-256. See [expanded-search record](platform-logo-expanded-search.md).
This is one new addition, not a completed ten-entry batch.

Current split: **14 handwritten + 940 generated + 110 local artwork files +
14 approved component groups = 1,078 visually covered; 13 missing**.

### Corrected merged catalogue identity: Fasten Health / fazer.ai agents

Hostinger lists these as two separate products. The accidentally concatenated
entry now displays Fasten Health and its original OnPrem favicon. Its old ID
and slug are deliberately retained to avoid breaking existing references.
fazer.ai agents is a separate entry with its own original project PNG.
No combined logo was invented. See [correction ledger](platform-logo-fasten-fazer.md).

**One previous gap resolved, one separate product added, two original artwork
files installed. This is not ten missing-logo additions.** Catalogue size rises
by one to 1,092. Current split: **14 handwritten + 940 generated + 112 original
files + 14 component groups = 1,080 covered; 12 unresolved**.

### Previous inline-only baseline

The catalogue has **1,091 distinct projects**. **981 entries** currently render a source-matched, code-defined inline SVG: 14 pre-existing hand-written panel marks and **967 pinned generated marks** (827 from vector originals, 140 from visually reviewed raster-to-path traces (139 PNG, 1 ICO)). **110 still say “SVG pending”**; see [the exact, generated work queue](platform-logo-gaps.md). This is not all-1,091 coverage. No initials, invented vendor symbols, remote `<img>` elements or PNGs embedded in SVGs are shown for gaps. The shared renderer is used by the public catalogue, detail pages, marketplace cards, OS selector, server views and admin listings.

A matching filename in a collection is evidence of an identity, **not** a vendor's verification or a trademark licence. Some of the 967 sourced marks still merit one-by-one comparison with the current project brand and legal review before commercial deployment. Do not describe the entire catalogue as verified or fully licensed on the strength of the counts below. Legacy `logo_url` fields in API records are deliberately ignored by these browser views. The previously attempted public `panel-logos/` image directory was removed.

## Sources, reproducibility and attribution

The manifest [`platform-logo-sources.json`](../cloudhost247-node/frontend/src/data/platform-logo-sources.json) records each generated slug's source collection, asset ID, immutable revision/version and SHA-256. First-party sources additionally identify the upstream repository, exact file, project URL and licence/terms; raster sources record the **original PNG git blob and SHA-256** *and* the reviewed output SVG SHA-256. Each generated TSX component has an origin comment. Rebuilding compares all hashes before SVGO + SVGR produce React `<svg>` elements with path/shape code. The earlier 14 inline marks in `PlatformLogo.tsx` predate this pipeline and are not represented by a pinned entry in this manifest. Four previous approximations (aaPanel, FASTPANEL, TinyCP and KUSANAGI) were removed after comparison with the projects' own branding; they now remain honest pending entries instead of generic initials/terminal imagery. aaPanel's first-party app repository contains a green landscape symbol but no vector form under reviewed licence terms. KUSANAGI publishes a brand guideline with restrictions (including minimum sizes on some marks); its former italic text was not the published artwork.

| Source | Marks | Source licence / provenance | Pinned origin |
| --- | ---: | --- | --- |
| [selfh.st/icons SVG](https://github.com/selfhst/icons) | 554 | [CC BY 4.0](platform-logo-licenses/CC-BY-4.0.txt) | `995fdddffce4078b2670319133c8ca1983a2c508` |
| [selfh.st/icons PNG traced into paths](https://github.com/selfhst/icons) | 51 | [CC BY 4.0](platform-logo-licenses/CC-BY-4.0.txt) | Same revision; `vtracer==0.6.15` |
| [Homarr Dashboard Icons](https://github.com/homarr-labs/dashboard-icons) | 67 | [Apache 2.0](platform-logo-licenses/Apache-2.0.txt) | `d4b500dc40a8e1043b1581cabb7208892cf35472` |
| [JabberLabs Awesome Dashboard Icons](https://github.com/JabberLabs/awesome-dashboard-icons) | 3 | [Apache 2.0](platform-logo-licenses/Apache-2.0-JabberLabs.txt) | `154613183d12e0e68263c92b17c125f1d90a4f1d` |
| [Simple Icons / Iconify JSON](https://www.npmjs.com/package/@iconify-json/simple-icons) | 20 | [CC0](https://github.com/simple-icons/simple-icons/blob/develop/LICENSE.md) | `@iconify-json/simple-icons@1.2.103` |
| [SVG Logos / Iconify JSON](https://www.npmjs.com/package/@iconify-json/logos) | 18 | [CC0](https://github.com/gilbarbara/logos/blob/master/LICENSE.txt) | `@iconify-json/logos@1.2.20` |
| [Devicon / Iconify JSON](https://www.npmjs.com/package/@iconify-json/devicon) | 1 | [MIT](platform-logo-licenses/MIT-devicon.txt) | `@iconify-json/devicon@1.2.84` |
| [TheSVG, individually checked variants](https://github.com/glincker/thesvg) | 21 | Per-project terms in the manifest; [collection guide](https://github.com/glincker/thesvg/blob/551229c188b4ab6e2d8b5763b9633ec91206d04c/LICENSING.md) | `551229c188b4ab6e2d8b5763b9633ec91206d04c` |
| First-party repository vectors (SVG / reviewed JSX) | 143 | Individual upstream licence/terms in the manifest; e.g. [Apache 2.0](platform-logo-licenses/Apache-2.0.txt), [Lightdash](platform-logo-licenses/Lightdash-LICENSE.txt) | Each entry pins its own repository revision and file |
| First-party repository ICOs traced into paths | 1 | Individual upstream licence/terms in the manifest | Pins original ICO bytes, git blob, frame size and final SVG hash |
| First-party repository PNGs traced into paths | 88 | Individual upstream licence/terms in the manifest | Each entry pins its own revision, file, PNG blob and vector trace |

**Galaxy artwork attribution:** Galaxy Project Contributors, [Galaxy logo](https://github.com/galaxyproject/galaxy/blob/618c137d53c796dfa756b57d79ca5a57849386f7/static/favicon.svg), [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/); converted to JSX with its unused embedded SVG font removed and IDs scoped. The white-and-gold first-party artwork is shown on a navy ground for contrast, without redrawing its paths; this was visually checked on the live catalogue card after filtering to Galaxy. The project's [licence file](platform-logo-licenses/Galaxy-LICENSE.txt) specifies CC BY 3.0 for images. Source-collection copyright permissions do **not** transfer the individual projects' trademarks to CloudHost247.

Examples of direct identity checks: Arize Phoenix uses the first-party **blue bird**, not the Elixir framework logo; Yarn.social uses the actual project's pod mark, not Yarnpkg; Cap uses the CAPTCHA project's art, not Cap.so's screen recorder; Airsonic Advanced, changedetection.io, GNS3 Server and Xibo CMS were compared against their first-party graphics. Recent Apache project marks (Hop, HertzBeat, DevLake, ShenYu, Amoro, IoTDB, APISIX, StreamPipes, SkyWalking, Zeppelin, Gravitino and Pinot) are pinned to their own source/site repos, not a generic ASF feather. First-party LightRAG artwork was compared to the repository README logo, and the current useSend wordmark's own app symbol is cropped for square slots. The latest additions pin Indico, code-server, StarRocks, TensorZero, Hasura GraphQL Engine, Corteza, ILLA Builder, Loomio, Nuclio, Rivet, Sim Studio, SQLPage, WinterCMS and NextChat to their own repositories' artwork; the SVG code was visually reviewed at tile size. Distinct first-party logos for Nango and GeoServer were initially located but not pinned while their branding/reuse permissions were reviewed. GeoServer now uses the specifically CC-BY-4.0-covered documentation asset described below; Nango remains pending. Skyvern's available SVG is simply a letter S; it remains pending rather than passing a generic initial off as a reviewed mark. A further 15 first-party vectors were pinned and rendered at tile size: Agenta (from its MIT-covered `web/oss/`, **not** its rights-reserved website), ClassicPress, CVAT, DB Browser for SQLite, eXeLearning, FeatBit, FlexGet, GitIngest, HFS, Horilla, OpenRemote, Spice AI, Steel Browser, Universal Media Server and WebThings Gateway. Spice AI's orange mark is cropped from its own wordmark without altering the mark's paths. The Universal Media Server SVG credits Surf@ceS as the logo creator. Atomic Server's first-party ring-and-orb was located but **not** pinned because its separate [brand licence](https://github.com/ontola/atomic-server/blob/2a9024008cc25462d40ae4566f99f2d1430e1ebb/brand/LICENSE) reserves commercial use as a selling feature; MIT licensing of its *software* is not permission for that use. In the Xibo trace, only the original transparent outer margin was cropped; its glyph paths are untouched.

After inspecting [Hostinger's public application gallery](https://www.hostinger.com/applications) to identify the listed products and compare how their icons appear there, we added **ten** further first-party SVGs: AureusERP, Argilla, DHIS2, FUXA, InsForge, Kafbat Kafka UI, LavinMQ, OpenMausBot, FreeLLMAPI and ServerStatus. Their exact repository revisions and digests are pinned individually in the manifest; the *generated JSX*, not just the raw files, was inspected at tile size. LavinMQ's source contains both the green circular app mark and a wordmark; a viewBox crop reveals its original icon without changing any vector paths. The project's [NOTICE](platform-logo-licenses/LavinMQ-NOTICE.txt) names 84codes AB as its copyright holder and LavinMQ as its trademark; repository Apache licensing **does not** clear the trademark. The public Hostinger catalogue's application thumbnails were visual/identity references only, **not copied or served as logo assets**. The Hostinger homepage itself is a hosting landing page; the specific logos are listed under `/applications`.

A second set of ten first-party vectors was then verified at **64px using the actual generated React components**, not a substitute illustration: agentmemory, ArchivesSpace, BeaverHabits, Cognee, Foxel, Home Gallery, Hoop, HuggingChat (Chat UI), Kotaemon and Krayin CRM. ArchivesSpace's branded blue A favicon matches its official logo, and its [ECL-2.0 COPYING notice](platform-logo-licenses/ArchivesSpace-COPYING.txt) is retained for attribution. HuggingChat uses the specific `static/huggingchat/icon.svg` from the Hugging Face chat-ui project, not an unrelated chat bubble. Kotaemon's favicon nests several SVG viewBoxes; the generator preserves those geometry and paths but removes a nonvisual invalid `text-anchor="none"` on a `<path>` and prevents duplicate accessible names on the nested `<svg>` elements. These are provisional identity matches, **not** a universal commercial trademark licence. We rejected the React boilerplate atom found in Budge, a generic NVIDIA mark found in Auto Ontology, and a generic ASF feather from the Apache JSPWiki site repo instead of calling them project-specific artwork.

**Outstanding rights / fidelity review:** [ASF's trademark policy](https://www.apache.org/foundation/marks/) permits project graphic logos on third-party websites **solely as hyperlinks** to the corresponding project; the shared renderer links Apache marks to their project sites. [Xibo's policy](https://docs.xibosignage.com/kb/readme/can-i-use-the-xibo-name-logo) likewise permits a site logo that links back to Xibo, and that mark is linked. The Vault mark also links to [the official project](https://developer.hashicorp.com/vault), but [HashiCorp's policy](https://www.hashicorp.com/en/trademark-policy) may require further approval for catalogue/service-badge use: a link alone does **not** settle it. None of these links grants permission to imply endorsement. Plone and the WireGuard mark used by WireGuard Easy remain pending because their policies restrict commercial mark use; Apollo and ZNC remain pending because traced letters were visibly inaccurate; Firefly's asset has a personal-use restriction. Canarytokens' first-party `templates/static/token_logo.svg` includes a colourful standalone mark, but is UTF-16 and the repository's [GPL with special clarifications](platform-logo-licenses/Canarytokens-LICENSE.txt) expressly discusses integrating covered content into proprietary software. We did **not** import or trace its artwork into the commercial catalogue pending clarification from the rights holder. Other first-party SVGs located for Decidim, MaxKB, OTOBO, YaCy and GeoNetwork also need source/licensing and trademark review before pinning; a project repository software licence alone is not artwork clearance. Obtain authorisation or a faithful permitted alternative before claiming full compliance.

## Official-repository completion batch (29 additional SVGs)

Added Bookshelf, ClassroomIO, Eclipse hawkBit, Ever Gauzy, Faraday, FeedCraft,
Fleetbase, Form.io, Hermes Workspace, ITFlow, LibreBooking, LMS, MistServer,
OpenHuman, OpenSEO, OpenViking, Paisa, Paperclip, PrivateGPT, pycsw, Ralph,
Razzia, Scoold, ServerKit, ShipShipShip, Songloft, Tinode, Vince Analytics and WBO.
Each manifest record includes its first-party repository, immutable revision,
source path, SHA-256 and repository SPDX licence identifier. Repository software
licensing is recorded for provenance, not represented as trademark clearance.
The generated React SVGs were rendered for inspection at 44px and 96px; ITFlow
uses the upstream light-background variant to keep its wordmark visible.
Nested SVGs retain their original dimensions and receive no duplicate outer
React props, preventing clipped artwork and duplicate accessible labels.

The inspected M3DB, Open Archiver, Para and Screego candidates contain embedded
raster images and were rejected by the generator; they need genuine vectors or
reviewed path traces. No embedded PNGs were admitted. CodiMD/HedgeDoc identity,
parent-company marks, filename collisions and other ambiguous sources remain
under review, rather than being silently substituted. At that checkpoint, **231 gaps remained**;
this batch does not complete the requested 260-entry queue.

## Follow-up completion batch (19 additional marks)

Added 13 first-party SVGs: Bionic GPT, Cheshire Cat AI, DOMjudge, Headroom,
Meteroid, Microweber, Nod, Percona PMM, TeamMapper, ZeroNote, Faktory, REDAXO
and Thruk. All were inspected as generated React output at 44px and detail size.
PMM's original white artwork uses the existing dark-background CSS treatment;
its paths and colours are unchanged. Bionic's B and Meteroid's minimal geometric
mark are their actual upstream designs, not locally invented substitutes.

Six raster-only originals (AllTube, ArcadeDB, Artalk, big-AGI, Teedy and MediaGo)
were traced with pinned VTracer 0.6.15 and compared with their source PNGs and
generated React output. ArcadeDB and MediaGo use the existing gradient-detail
profile. The manifest records both original PNG git blobs/SHA-256 and resulting
SVG hashes. No PNG is embedded or loaded by the browser. AnonUpload's trial
trace distorted its lettering and was not admitted.

Retained the upstream [Faktory licence](platform-logo-licenses/Faktory-LICENSE.txt),
[Thruk licence](platform-logo-licenses/Thruk-LICENSE.txt), and
[REDAXO terms](platform-logo-licenses/REDAXO-LICENSE.txt). REDAXO's extra backend
attribution condition is explicitly recorded, not simplified to unqualified MIT.
DeskRPG, Multica, Open Source POS and SpacetimeDB need further rights review:
their licence files contain use, service or attribution conditions that cannot
be treated as unrestricted artwork clearance. These findings are not claims
that no permitted logo exists. CodiMD/HedgeDoc's naming relationship also remains
unresolved for this catalogue entry. At that checkpoint, **212 entries remained pending.**

## Raster-original completion batch (17 additional marks)

Added CKAN, Dialoqbase, Domoticz, EmbyStat, GPT Researcher, Libredesk,
OwnTracks Recorder, Para, Posterr, Smocker, Speakr, Dataline, Expensave,
Readur, Remark42, Shynet and Waline. These use original PNGs from each
project's repository, traced to paths with VTracer 0.6.15, never embedded
raster data. Both original and trace hashes, source files and immutable
revisions are pinned in the manifest. Domoticz, Speakr, Expensave, Readur
and Remark42 use the existing gradient-detail profile. Original-versus-trace
comparisons and the generated React components were inspected at 44px and
96px. Libredesk and Dataline retain their white artwork on the existing navy
background. The traces are approximations of raster originals, not original
vendor-authored vector files.

Retained the upstream [CKAN notice](platform-logo-licenses/CKAN-LICENSE.txt)
and [OwnTracks Recorder notice](platform-logo-licenses/OwnTracks-Recorder-LICENSE.txt)
to record their actual AGPL-3.0-or-later and GPL-2.0-or-later terms where
GitHub's metadata reported no standard licence identifier.

Rejected/held candidates in this pass:
- Hollama and Open Archiver: low-resolution sources produce visibly distorted detail.
- Karaoke Eternal and Screego: traces introduce outlines/halos absent from the original.
- ClassQuiz: the reviewed trace is nearly 1 MB and exceeds the current generator's
  formatting assumptions; find a simpler official source instead of shipping it.
- ChiefOnboarding: favicon is too small for a faithful detail-size trace.
- PGHero: generic database favicon is insufficient evidence of a distinctive project mark.
- Jelly Clipper and Plandex: trial traces flatten their gradients; more faithful sources needed.
- WAHA: trace alters the inset phone symbol; not admitted.
- Local Deep Research, TaxHacker and MeshCentral: intricate artwork requires further fidelity review.
- Serge: preserve the upstream pixel artwork more faithfully before admitting a trace.
- Koffan: MIT plus Commons Clause, not unrestricted MIT.
- MicroRealEstate: the pinned current revision uses Sustainable Use Licence v2;
  historical MIT commits do not clear the current asset automatically.

At that checkpoint, **195 entries remained pending.** Repository software licensing and visual identity
checks do not constitute blanket commercial trademark permission.

## Further raster review (13 additional marks)

Added Dograh, Reiverr, Trudesk, SickGear, Mopidy, NSQ, AIToEarn, Kill Bill,
Parse Server, SENAITE LIMS, Starbase 80, Thumbor and SCADA-LTS from their
own repositories' PNG originals. Original git blobs and SHA-256 digests,
source revisions, files and trace hashes are individually pinned. All use
the standard VTracer 0.6.15 profile. The original/trace comparisons and
actual generated React output were checked at 44px and 96px. Reiverr's
light mark uses the existing navy ground, without recolouring its paths.
The [Trudesk copyright and Apache-2.0 notice](platform-logo-licenses/Trudesk-LICENSE.txt)
is retained because GitHub's licence metadata did not identify its terms.

Additional rejected candidates:
- FossFLOW: `logo512.png` is the React starter atom, not a project-specific logo.
- PowerDNS Admin: the candidate is a generic globe; identity needs further evidence.
- Cassandra Reaper: this favicon is unrelated site-theme artwork, not Reaper branding.
- CoAI and SnapOtter: low-resolution sources lose important detail when traced.
- Spacedrive and Atlas CMMS: trial traces flatten the original shading.
- Traduora and SyncLounge: transparent edges acquire unwanted dark areas/outlines.
- MapStore and RosarioSIS: shading/fades are lost in the trial traces.
- pygeoapi, Trip and PicoClaw: lettering or detailed contours need a better rendition.
- SoulSync: complex shaded artwork needs further fidelity review.
- Errbit and GeneaC: the selected apple-touch PNG files are empty at the pinned revisions;
  other upstream files still need checking.
- WeKnora: licence metadata is inconclusive; review its actual terms before adding it.

At that checkpoint, **182 entries remained pending.** These rejected candidates do not imply that the
projects lack usable logos; they identify why these particular files were not shipped.

## Alternate-asset review (8 additional marks)

Added original first-party SVGs for Annif, Eve, Isso, SyncLounge and LDAP
Account Manager, plus reviewed PNG-to-path traces for DSpace, Microcks and
OpenLIT. All source revisions, files and SHA-256 hashes are individually
pinned; raster origins also pin their original PNG git blobs and digests.
The generated React components were inspected at 44px and 96px.
SyncLounge now uses its **actual upstream white SVG**, not the rejected PNG
trace, on a navy ground for contrast. This resolves its earlier fidelity blocker.

Retained [Annif's Apache-2.0 notice](platform-logo-licenses/Annif-LICENSE.txt)
and [LDAP Account Manager's copyright/licence inventory](platform-logo-licenses/LDAP-Account-Manager-copyright.txt).
The latter places files outside its explicit Pro exceptions under GPL-3.0-or-later;
the selected `lam/graphics/logo.svg` is not among those Pro exceptions.

The GOWA and CitrineOS SVG candidates contain embedded raster images, so neither
was admitted as vector artwork. Errbit's larger wordmark trace still adds dark
outlines; ChiefOnboarding's wordmark trace damages lettering. Evolution API has
additional attribution/notification conditions, and EmailEngine has proprietary
licence terms; neither was treated as unqualified Apache/MIT artwork. WeKnora's
licence text identifies MIT for its own content, but the candidate wordmark still
needs a cleaner rendition before inclusion.

At that checkpoint, **174 entries remained pending.** These identity and provenance checks are not a
blanket commercial trademark clearance.

## Alternate repository and filename review (3 additional marks)

Added Daptin's original first-party vector, Centrifugo's original SVG from
`centrifugal/web`, and a reviewed trace of Vane's own PNG. Daptin's white
mark uses the existing navy background. All three were checked as generated
React output at 44px and 96px and have individually pinned provenance.
Centrifugo's official web UI repository supplies the artwork absent from its
server repository. Vane is mapped only to the Vane catalogue entry; its mark
was not automatically assigned to the separate Perplexica entry.

Further findings:
- Alternate M3DB, PicoClaw, Screego and Open Archiver SVGs still embed raster data.
- TaxHacker's contents API response did not yield usable SVG bytes; the empty
  download was not accepted or pinned as a logo.
- Automatisch's candidate is a Mation wordmark; confirm the catalogue identity
  before substituting a renamed product's artwork.
- DeepSeek Harness's app favicon remains the parent company's whale, not evidence
  of a distinct Harness logo.
- Alerta's official web UI favicon was found, but its trial trace adds black corners.
- WebCord's trial trace adds a dark outline and flattens shading.
- Pgweb's candidate is a generic database icon; project-specific identity needs review.
- Yao's actual licence adds branding, verification and enterprise-scale conditions;
  it was not treated as unqualified Apache-2.0 artwork.

At that checkpoint, **171 entries remained pending.** Further work should include official companion
web/site repositories rather than assuming a server repository contains all branding.

## Transparent PNG treatment (2 additional marks)

Alerta and Traduora now use reviewed traces of their official PNGs. The earlier
traces interpreted transparent pixels as black corners. The new explicit
`light-ground-detail` profile composites the original RGBA pixels onto white
with **Pillow 13.0.0**, then uses **VTracer 0.6.15** with fixed detail settings.
This preserves the original canvas and aspect ratio; it does not redraw, crop,
resize or sharpen the logo. The white presentation ground is intentional and
is part of the generated vector. These are raster-derived approximations, not
vendor-authored vectors or transparent-background renditions.

The original PNG digest is still checked before compositing, and the resulting
SVG digest is checked after tracing. Cold regeneration fetches the pinned blob
and runs `scripts/trace-logo-light-ground.py`; no intermediate PNG is shipped.
Regression tests cover transparent and partially transparent pixels, preservation
of opaque colours/source bytes/dimensions, version enforcement and cleanup after
failure. Both generated React logos were visually reviewed at 44px and 96px.
Karaoke Eternal, Screego, WebCord and Spacedrive were also tried with this profile,
but remain pending because their shading or detail is still not faithful enough.

At that checkpoint, **169 entries remained pending.**

## Official companion repositories (3 additional marks)

Added Autobase's navbar SVG from `autobase-tech/docs`, OSRM's wordmark SVG
from `Project-OSRM/osrm-frontend`, and a reviewed path trace of Apache
StreamPark's PNG from `apache/streampark-website`. Their immutable revisions,
source files, repository terms and hashes are individually pinned; StreamPark
also pins its original PNG git blob and digest. Actual generated React output
was inspected at 44px and 96px. The existing Apache-logo renderer links
StreamPark to `https://streampark.apache.org/`; this does not imply endorsement
or general commercial trademark clearance.

The companion-repository search also located Gotenberg's illustration and
Apache Kvrocks' logo. The Kvrocks SVG contains raster data, and Gotenberg's
trial trace needs further fidelity review. StreamPark's SVG also embeds raster
data, so the genuine standalone first-party PNG was traced instead. The
openrouteservice app's small wordmark loses lettering fidelity in its trial
trace; its separate `brand.png` depicts institutional sponsors rather than the
project logo and was not substituted. All these unresolved entries remain
pending instead of admitting an unrelated mark or an embedded PNG.

At that checkpoint, **166 entries remained pending.**

## Larger official assets and website artwork (2 additional marks)

Added Fusio's original SVG from `apioo/fusio-website/public/img/logo.svg` and
a reviewed trace of Crawl4AI's larger `deploy/docker/static/assets/logo.png`.
The tiny Crawl4AI favicon trial lost its geometry; it was discarded in favour
of this larger official asset. The white wordmark and turquoise symbol retain
their colours on the existing navy presentation ground. Both additions were
inspected as generated React components at 44px and 96px; revisions, file paths,
source hashes and the Crawl4AI trace/original PNG hashes are pinned.

COPS and FusionDirectory trial traces still distort lettering and are not
included. Komari's web and documentation repositories were also inspected;
their third-party OS logos are not substitutes for Komari branding, and their
artwork licence needs clarification before copying a candidate. The generated
work queue remains authoritative: at that checkpoint, **164 entries were still pending.**

## Shared first-party project branding (3 additional marks)

Added Kiwix-serve using the original Kiwix bird SVG shipped in the `kiwix/libkiwix`
server skin, Casibase using a reviewed trace of the official website's PNG,
and Judge0 CE using the original JUDGE0 wordmark SVG from `judge0/ide`.
These are shared first-party project marks, not invented edition-specific
variants. Their exact source repositories, immutable revisions, file paths,
repository licence identifiers and hashes are pinned in the manifest. Casibase
also pins its original PNG blob/hash and the reviewed VTracer output hash.

The generated React components were checked at 44px and 96px. Judge0's compact
wordmark SVG was chosen instead of the oversized favicon SVG export; no raster
embedding was admitted. Juxtapose's inspected repository contains publisher,
funding-body and Knight Lab logos but no accepted project-specific artwork in
those candidates, so none was substituted for Juxtapose.

At that checkpoint, **161 entries remained pending.** These source and identity checks do not constitute
blanket commercial trademark permission.

## First-party raster review (3 additional marks)

Added Sherlock's illustrated detective, ThinkDashboard's original outlined
`td` design and Coral Talk's coral mark. These are path traces of their own
repository PNGs, not locally invented illustrations or initials. Original PNG
blobs/hashes, immutable revisions, source files and reviewed trace hashes are
pinned individually. The standard VTracer 0.6.15 profile was used, and the
original-versus-trace comparison and generated React output were inspected at
44px and 96px.

Retained [Coral Talk's copyright and Apache-2.0 notice](platform-logo-licenses/Coral-Talk-LICENSE.txt)
because GitHub's metadata did not identify its standard licence. This records
repository terms, not blanket commercial trademark permission. Hiccup's trial
trace changes the rounded background and flattens shading, so it was rejected.

At that checkpoint, **158 entries remained pending.**

## Documentation-repository vectors (2 additional marks)

Added ReadySet's original `public/Currentlogo.svg` from `readysettech/docs-project`
and Tyk Gateway's `img/logos/tyk-logo-opensource.svg` from `TykTechnologies/tyk-docs`.
The latter identifies the open-source offering, not Tyk Cloud. Both are original
vector sources, with individually pinned repositories, immutable revisions,
files, repository licence identifiers and SHA-256 hashes. Generated React output
was inspected at 44px and 96px; no PNG or third-party integration mark was used.
The recorded repository terms are Apache-2.0 and MPL-2.0 respectively, not a claim
of unrestricted commercial trademark permission.

The R2R application repository was also inspected. Its Google, Hatchet, Python,
JavaScript and SciPhi assets are not automatically R2R-specific marks. Letta's
Markdown documentation repository did not supply a usable logo candidate in
this pass. Neither entry was marked complete on that evidence.

At that checkpoint, **156 entries remained pending.**

## Publishing wordmarks (2 additional marks)

Added Open Monograph Press and Open Journal Systems from their original
`templates/images/structure/logo.png` files in the respective official PKP
repositories. Each record pins the revision, PNG git blob, original digest and
reviewed VTracer output digest. These are the projects' original typeset OMP/OJS
wordmarks and underlines, not generic locally generated initials.

The tiny descriptive taglines lost fidelity during tracing. The renderer therefore
crops the viewBox and explicitly clips the original paths below the wordmark,
without redrawing its letter geometry. OMP uses `0 0 289 128`; OJS uses
`0 0 231 138`. The original source and trace hashes still cover the complete
files. An explicit clip is necessary because viewBox cropping alone can expose
outside content in a letterboxed viewport. Regression tests verify both clip
structure and crop bounds. The white wordmarks use the existing navy ground;
the final generated output was reviewed at 44px and 96px.

QloApps and Pydio Cells remain pending: their trial traces alter small lettering
and details. No source was substituted merely to increase the count.

At that checkpoint, **154 entries remained pending.** Repository GPL terms recorded in the manifest
are provenance, not a blanket commercial trademark authorisation.

## Official console and foundation artwork (2 additional marks)

Added ImmuDB's original light-background SVG from `codenotary/immudb-webconsole`
and eKuiper's original green icon from `lf-edge/artwork`. Both pin the exact
repository, immutable revision, source path and SHA-256 and were reviewed as
generated React components at 44px and 96px. These are vectors, not raster traces.

The [LF Edge artwork terms](platform-logo-licenses/LF-Edge-Artwork-LICENSE.md)
are retained and recorded verbatim in substance as Linux Foundation trademark
usage guidelines, not relabelled as Apache/MIT software licensing. The repository
explicitly publishes project artwork for identification under those guidelines;
its notice prohibits implying sponsorship or endorsement. The catalogue must not
represent eKuiper as a CloudHost247-owned mark or claim Foundation endorsement.

The Ant Media management console contains candidate PNGs but no clear repository
licence was found in this pass, so it remains pending rights review. The actual
`hackmdio/codimd` repository was checked instead of assuming HedgeDoc is an
interchangeable identity: its inspected favicon is a generic document symbol,
which was not admitted as distinctive project branding. The earlier HedgeDoc
candidate therefore remains unused.

At that checkpoint, **152 entries remained pending.**

## Quasarr and small-tool review (1 additional mark)

Added Quasarr's own `Quasarr.png` from `rix1337/Quasarr`, traced using the
standard VTracer 0.6.15 profile. The original/trace comparison and generated
React output were inspected at 44px and 96px. The repository revision, original
PNG git blob and SHA-256, and reviewed SVG hash are individually pinned.

The Topola viewer's separate `Pewu/topola-viewer` repository was located, but
its textured favicon loses important detail in the trial trace. Text Generation
Web UI's `css/icon.png` was tested with both standard and gradient-detail profiles;
the thin coloured layers still need a cleaner rendition. Zenfeed's separate
`glidea/zenfeed-web` repository has an icon candidate but its artwork terms remain
unresolved. These were not admitted merely because an asset was found.

At that checkpoint, **151 entries remained pending.**

## Additional source review — no new admissions

This pass retained the **940 sourced / 151 pending** count. Finding an official
asset does not by itself resolve permission or rendition quality.

| Entry | Exact candidate reviewed | Result / next step |
| --- | --- | --- |
| YaCy | `yacy/yacy_artwork` at `b64c412275d846b7a9f2baa6a6a996eb2c7c3be9` | The tree contains only README and LICENSE, not artwork. Its LGPL metadata cannot license files in a different repository. |
| YaCy | `yacy/yacy_net_homepage` at `28798f8a030e566659359a80b11162486a4dcaa6`, `docs/img/YaCyLogo_320_320.png` and related sizes | Logo candidates exist, but the inspected `LICENSE.md` identifies the Cinder theme and embedded dependencies. Confirm terms covering the logo itself; do not label it MIT based on theme licensing. |
| GeoNetwork | `geonetwork/website` at `eb242bb351d17c346d42aad4c44a328b707210a1`, `graphics/gn-logo.svg` | First-party vector located. Repository metadata supplies no licence; the located Blueprint dependency licence is not evidence of rights to GeoNetwork artwork. Seek an artwork notice or permission before admission. |
| SQLChat | `sqlchat/sqlchat` at `85af0b4733d91d5c97a2ad89660cbfc515898676`, `public/chat-logo.webp` and `public/chat-logo-bot.webp` | MIT repository terms recorded during research. VTracer cannot directly decode these WebP inputs in the current environment. Experimental Pillow RGBA-to-PNG decoding allowed tracing, but both trial traces distort lettering/shading; neither was added to the manifest. |

SQLChat's experimental decode preserved the source dimensions and used Pillow
13.0.0 followed by standard VTracer 0.6.15 settings. The decoded PNGs and traced
SVGs are research only, not shipped assets. No WebP-support change was added to
the production generator merely to admit an unfaithful candidate. A cleaner
first-party vector or a demonstrably faithful rendition is still needed.

## Reviewed first-party vectors (3 additional marks)

Added Decidim, MaxKB and OTOBO after inspecting their source files and repository
licence texts. Retained the [Decidim AGPL text](platform-logo-licenses/Decidim-LICENSE.txt),
[MaxKB GPL text](platform-logo-licenses/MaxKB-LICENSE.txt), and
[OTOBO GPL text](platform-logo-licenses/OTOBO-LICENSE.txt). No nonstandard artwork
conditions were identified in those inspected files; this is not blanket trademark
clearance, and the earlier pending source-review notes are resolved only to this extent.

Decidim's app asset embedded PNG data and was rejected. Its root `logo.svg` is
an actual red vector wordmark and is the pinned source. OTOBO uses its exact
segmented `common/img/logo_small.svg` lettering, without completing or redrawing
the intentionally open letter shapes. MaxKB uses the first-party robot SVG.
Its upstream non-ASCII gradient IDs were dropped by SVG optimisation, leaving
blank generated output; the generator now renames just those identifiers and
references to ASCII before normal scoping. Geometry, gradient stops and colours
remain unchanged. A regression test checks the retained gradients and references.

All three generated React components were visually reviewed at 44px and 96px.
Each manifest entry pins its repository, revision, source file and SHA-256.
**148 entries remain pending.**

## Official repository continuation: Lago

Added Lago's original vector lockup from the official `getlago/lago-front`
repository, `packages/configs/brand/lago-logo.svg`, pinned at
`33f905f6714cd8513aa053295f1ad5b4be035806`. The manifest records its exact
SHA-256 and the upstream AGPL-3.0 notice is retained in
[Lago-LICENSE.txt](platform-logo-licenses/Lago-LICENSE.txt). The full original
symbol and wordmark are preserved, without tracing, recolouring or substituting
the unrelated ClickHouse logo found in the main Lago repository's Kafka assets.
The generated React paths were visually reviewed at 44px and 96px.
Repository licensing is not a blanket trademark grant.

**944 of 1,091 entries are now sourced; 147 remain pending.**

## Official repository continuation: Maputnik

Added the map, palette and brush artwork from `maplibre/maputnik`'s
`src/img/maputnik.png`, revision `b6db2ff9e823f4f2156d54c73dcf469c844e57c4`.
The original diagonal background is part of the source and was retained rather
than replaced. The standard VTracer 0.6.15 trace was compared with the original
and the generated React component reviewed at 44px and 96px. Original PNG blob,
original SHA-256 and traced SVG SHA-256 are pinned in the manifest. The upstream
MIT notice is retained in [Maputnik-LICENSE.txt](platform-logo-licenses/Maputnik-LICENSE.txt).
No raster is embedded or loaded at runtime.

Two other official raster sources were reviewed but **not added**:
- Mailtrain: `Mailtrain-org/mailtrain`, revision
  `89b189d0f5fcb3bb069dde7c2da72d5acd071dd5`,
  `client/static/mailtrain-notext.png`. The small original's straight train and
  track details become rounded/distorted in the tested trace.
- Dkron: `dkron-io/dkron`, revision
  `5cca42de0764b67d0b9cbb505df1aa61ade0b9b5`,
  `ui/public/dkron-logo.png`. Both standard and gradient-detail tracing lose
  the original purple-to-pink gradient across the symbol. A recognisable
  silhouette alone does not justify admitting the altered colouring.

**945 of 1,091 entries are now sourced; 146 remain pending.**

## Official repository continuation: OMERO

Added the original OMERO logomark from the Open Microscopy Environment's
[official website repository](https://github.com/ome/www.openmicroscopy.org/blob/50e6b81e9448e5445c96b0b0c5d2934fd6c373fe/img/logos/omero-logomark.svg),
`img/logos/omero-logomark.svg`, revision
`50e6b81e9448e5445c96b0b0c5d2934fd6c373fe`. Attribution: **Open Microscopy
Environment**, [CC BY 4.0](platform-logo-licenses/OMERO-website-LICENSE.txt).
The repository README licenses its content under CC BY 4.0, and its
[licensing page](https://github.com/ome/www.openmicroscopy.org/blob/50e6b81e9448e5445c96b0b0c5d2934fd6c373fe/licensing/index.html)
explicitly permits sharing/adapting website content with OME credit, excluding
screenshots and videos from commercial use. This asset is an original vector
logo, not a screenshot or video. Trademark rights remain separate.

The original paths and colours are preserved through SVG optimisation and
conversion to inline React code; no raster tracing, cropping or invented mark
was used. The standalone logomark matches the symbol in the official OMERO
wordmark. Generated output was visually checked at 44px and 96px. Small legacy
OMERO.web PNGs from `ome/omero-web` were reviewed but not needed once this
properly attributed vector source was located.

**946 of 1,091 entries are now sourced; 145 remain pending.**

## Source review continuation: Eclipse Kura (not admitted)

Located the official management UI artwork in `eclipse-kura/kura-management-ui`
at revision `79659e4b7381dfd1f21747b545e157cb2a098d19`, file
`org.eclipse.kura.web2/src/main/webapp/eclipse/kura/icons/kura_login_logo.png`.
Its `LICENSE` is EPL-2.0; `NOTICE.md` identifies Eclipse Kura and Kura as
Eclipse Foundation trademarks and covers the accompanying materials. These
notices do not independently grant blanket trademark permission.

The 464×157 original is white on transparent and was inspected against a dark
background. Both standard and gradient-detail VTracer 0.6.15 trials turned
several circular dots into visibly squared shapes and degraded the small TM
lettering. Neither trace was admitted. No recolouring, replacement circles,
or embedded PNG was used to hide those differences. The official
`eclipse-kura/kura-website` tree at
`d883586d43806b6645f914d51d956720384cdad4` contains a PNG rather than a project
SVG; its font SVGs are not suitable substitutes. Research files remain outside
the shipped manifest. **Coverage is unchanged: 946 sourced, 145 pending.**

## Official repository continuation: GeoServer

Added the original GeoServer globe icon from
[`geoserver/geoserver`, `doc/en/docguide/img/logo-icon.svg`](https://github.com/geoserver/geoserver/blob/b8ace984a36637ff44745cfca4d65466149ae738/doc/en/docguide/img/logo-icon.svg),
pinned at `b8ace984a36637ff44745cfca4d65466149ae738`. This resolves the earlier
source review using the documentation subtree's explicit **CC BY 4.0** licence,
rather than treating the software GPL notice as blanket artwork clearance.
Attribution: **GeoServer project / Open Source Geospatial Foundation**. The
upstream [documentation licence](platform-logo-licenses/GeoServer-docs-LICENSE.md)
is retained; trademark rights and endorsement remain separate.

The original vector paths, gradients, masks and colours are retained through
optimisation and conversion to React SVG code. No tracing, manual redrawing or
raster embedding was needed. The generated logo was compared with the original
SVG rendering at tile and detail size (44px and 96px). The manifest records the
exact source file, revision and SHA-256.

**947 of 1,091 entries are now sourced; 144 remain pending.**

## Official repository continuation: AgentRun; Nango review

Added AgentRun's official `agent.run()` wordmark from `Parcha-ai/agentrun`,
`docs/assets/readme/wordmark.png`, revision
`47fd2ec113ece79fbd59cc1ebff9198e2c15d22e`. The high-resolution original's
lettering, orange parentheses, dark background and border are retained using
the standard VTracer 0.6.15 profile. The original and traced artwork were
compared, then the generated React component reviewed at 44px and 96px. This is
a full wordmark, so its lettering is necessarily small in a square tile; no
invented standalone symbol or monogram replaces it. Original PNG blob and
SHA-256 plus trace SHA-256 are pinned. The upstream Apache-2.0 text is retained
in [AgentRun-LICENSE.txt](platform-logo-licenses/AgentRun-LICENSE.txt).

Nango was rechecked at `970f9e6715806ff96e7096b12afc86dce22827f6` in
`NangoHQ/nango`. Its `docs/logo/Nango-Light-Mode.svg` is a genuine vector,
but the root `LICENSE` is Elastic License 2.0 with a hosted/managed-service
restriction, and `LICENSE_SHORT` states Nango Inc's rights reservation. No
separate artwork permission was established in this review. Nango remains
pending rights clarification for this hosting catalogue rather than being
labelled an unconditionally reusable open-source mark.

**948 of 1,091 entries are now sourced; 143 remain pending.**

## Official repository continuation: CitrineOS

Added CitrineOS's original faceted gemstone vector from its official operator UI,
`citrineos/citrineos-operator-ui`, `public/logo-collapsed.svg`, revision
`5db96fc43e9d78b966dafa3a7655748579f23289`. This is a genuine path-and-gradient
SVG, unlike the previously rejected raster-embedded asset. The standalone icon
matches the symbol in the same repository's `public/logo-black.svg` wordmark.
The original was compared with generated React output at 44px and 96px;
geometry, colours and gradients are preserved without tracing or redrawing.
Source revision and SHA-256 are pinned, and the upstream Apache-2.0 notice is
retained in [CitrineOS-UI-LICENSE.txt](platform-logo-licenses/CitrineOS-UI-LICENSE.txt).
Repository licensing does not imply endorsement or blanket trademark permission.

Also tested the higher-resolution `GIScience/openrouteservice-app` asset
`app/img/logo@2x.png`. Both standard and light-ground-detail trials still
introduced angular letter contours compared with the original rounded wordmark.
Those trials remain research-only; openrouteservice was not admitted merely
because a larger source was found.

**949 of 1,091 entries are now sourced; 142 remain pending.**

## Official repository continuation: KasmVNC

Added the original **KasmVNC** lockup from its official browser frontend,
[`kasmtech/noVNC`, `app/images/icons/kasm_logo.svg`](https://github.com/kasmtech/noVNC/blob/9283f38cf57d1b6844157c3a9d538ee2672235bd/app/images/icons/kasm_logo.svg),
revision `9283f38cf57d1b6844157c3a9d538ee2672235bd`. The repository README
explicitly identifies this as the KasmVNC web frontend; the artwork spells
KasmVNC, not merely the parent company's name or the upstream noVNC product.

Attribution: **Kasm Technologies / KasmVNC frontend contributors**.
The upstream [licence notice](platform-logo-licenses/KasmVNC-frontend-LICENSE.txt)
explicitly assigns `app/images/` to
[Creative Commons Attribution-ShareAlike 3.0](https://creativecommons.org/licenses/by-sa/3.0/),
rather than the MPL-2.0 used for the JavaScript core. The logo's generated React
rendition is also provided under CC BY-SA 3.0. Changes are SVG optimisation,
identifier scoping and conversion to JSX only; original geometry and colours
are preserved. This does not grant trademark rights or imply endorsement.
The manifest pins its exact source hash, and generated output was compared
with the source at 44px and 96px.

Errbit's `docs/notifications/slack/errbit.png` was also tested with the
gradient-detail profile, but the lettering and shading became visibly broken;
it remains pending. PgHero's small database-cylinder favicon was not admitted
as a distinctive project logo.

**950 of 1,091 entries are now sourced; 141 remain pending.**

## Official repository continuation: OCS Inventory NG

Added the official full OCS Inventory wordmark from
`OCSInventory-NG/OCSInventory-Server-Frontend-Rework`,
`src/assets/img/logo-white.png`, revision
`7e536ca525cfa6a9343421ef1d1b7487cda2bd31`. This higher-resolution original
preserves the project name and purple upload symbol together. The similarly
named `image/logo-ocs.png` in the older reports repository is only an arrow;
it was not substituted for the full project identity. The older
`themes/OCS/logo.png` is a communication illustration, not the wordmark.

The accepted original was traced with standard VTracer 0.6.15 and compared
against the source. Generated React paths were reviewed at 44px and 96px.
The renderer uses its existing dark-ground treatment to preserve visibility
of the original white lettering without recolouring it; the visibility
regression covers this slug. Original PNG blob/hash and trace hash are pinned.
The frontend repository's **GPL-3.0** text is retained in
[OCS-frontend-LICENSE.txt](platform-logo-licenses/OCS-frontend-LICENSE.txt),
not confused with the older reports repository's GPL version. Trademark rights
remain separate from repository licensing.

**951 of 1,091 entries are now sourced; 140 remain pending.**

## Source review continuation: Skyvern and Ant Media (not admitted)

Rechecked `Skyvern-AI/skyvern` at
`b294566a37943a4c4e4aa55c92ba5676966dd867`. Its documentation SVGs are text
placeholders: `docs/favicon.svg` draws a system-font S in a rectangle and
`docs/logo/light.svg` draws the name using system fonts. These do not match
the dragon-and-wordmark actually used by the frontend's `Logo.tsx`, which
loads `public/logo.png`. The frontend PNG and README PNG are only 404×109;
the separate small dragon is also low-resolution. A gradient-detail VTracer
trial of `skyvern-frontend/public/logo.png` visibly fragmented the dragon's
shading and the letter strokes. It was rejected rather than substituting the
S favicon or claiming the generic text SVG was the original branded logo.
The inspected root licence is AGPL-3.0; the remaining immediate blocker is
faithful code-rendered artwork, not absence of a repository licence.

Also inspected `ant-media/ant-media-documentation` at
`545241adf3726b06fd0eef5dbd86d37d370e676e`. The tree contains logo assets,
but no licence/notice file was found establishing artwork reuse terms for
that documentation repository. This does not establish that reuse is
prohibited; permission remains unresolved and no artwork was admitted.

**No coverage change in this pass: 951 sourced, 140 pending.**

## Official repository continuation: Morphic

Added Morphic's original black circle with two white eyes from
[`miurla/morphic`, `components/ui/animated-logo.tsx`](https://github.com/miurla/morphic/blob/41c97193f82b8a7bd15dae2cc565ce7a83fe4508/components/ui/animated-logo.tsx),
revision `41c97193f82b8a7bd15dae2cc565ce7a83fe4508`. This is the project's own
SVG-in-JSX logo, not an invented face or a raster trace. The upstream Apache-2.0
notice is retained in [Morphic-LICENSE.txt](platform-logo-licenses/Morphic-LICENSE.txt).

The generator now supports this one explicitly reviewed JSX source via the
`morphic-static-jsx` profile. The entire original TSX file is SHA-256 pinned.
No upstream JavaScript is executed: extraction retains only the SVG, removes
animation classes and caller overrides, and resolves the upstream default
body colour to black. Remaining JSX expressions or unexpected geometry cause
an error. The body and eyes retain their original coordinates and colours;
SVG optimisation converts equal-radius ellipses into equivalent circles.
The repository/file allowlist is narrow; arbitrary TSX sources are not accepted.

Generated output was visually reviewed at 44px and 96px. A regression checks
all three circles' positions and radii, black/white fills and absence of
animation classes or embedded images. Trademark rights remain separate.

**952 of 1,091 entries are now sourced; 139 remain pending.**

## Official repository continuation: M3DB

Added the original M3 owl from `m3db/m3`,
`site/static/images/logo-square.png`, revision
`ea708d3a685f613af7dd0a39571f98d0802c4105`. This standalone high-resolution
PNG resolves the earlier raster-embedded SVG blocker. Four SVG logo variants
in the same site were rechecked and all embed raster data; none was admitted
as a true vector. Instead, the standalone PNG was traced with standard VTracer
0.6.15, preserving the owl, circular border, blue body and coloured eye.
It matches the owl in the repository's full M3 wordmark.

The original and path trace were visually compared, and generated React output
was reviewed at 44px and 96px. The original PNG blob and SHA-256 plus the trace
SHA-256 are pinned. The Apache-2.0 notice is retained in
[M3-LICENSE.txt](platform-logo-licenses/M3-LICENSE.txt). No PNG is shipped inside
the SVG or loaded by an image element. Repository licensing does not imply
trademark endorsement.

**953 of 1,091 entries are now sourced; 138 remain pending.**

## Official repository continuation: GeoNetwork

Added GeoNetwork's original vector globe from its official core repository,
`geonetwork/core-geonetwork`,
`docs/manual/overrides/assets/images/geonetwork-logo.svg`, revision
`04bcf23d1fe7de1e34a3651d0ce71c088e8c19c2`. This resolves the earlier
website-repository licensing uncertainty by using the manual subtree's
explicit **Creative Commons Attribution 3.0 Unported** licence.
Attribution: **GeoNetwork project contributors**. The upstream notice is
retained in [GeoNetwork-manual-LICENSE.txt](platform-logo-licenses/GeoNetwork-manual-LICENSE.txt).
Trademark rights and endorsement remain separate.

Original paths, blue/yellow fills and gradients are retained through SVG
optimisation and React conversion. No raster trace or recolouring was used.
The original was compared with generated output at 44px and 96px, and the
manifest pins the source revision, exact file and SHA-256.

Also resolved the earlier TaxHacker empty-response uncertainty: retrieving
`public/logo/logo.svg` by its Git blob
`404c044798a623456f647c8fd45853e5e9ddd22d` at
`97f8a59af4361b8e772752204617098e17f299e2` succeeds, but the 1.5 MB SVG
contains embedded raster images rather than usable original vector paths.
It remains pending; no sanitizer exception was made.

**954 of 1,091 entries are now sourced; 137 remain pending.**

## Source review continuation: Gotenberg, ChiefOnboarding and ClassQuiz

Tested Gotenberg's alternate `static/img/logo_hero.png` from
`gotenberg/gotenberg.dev` at
`4cde12f33761398253c0557bcf768d4752e3e909`. This is the detailed portrait with
cartoon facial features, not a simpler vector variant. A gradient-detail
VTracer 0.6.15 trial retained the broad face but changed the fine hat, beard
and background textures into coarse regions. It was not admitted; the earlier
fidelity blocker remains, and this trial is research-only.

Inspected the official `ChiefOnboarding/Documentation` tree at
`53ce50998f1adc646ef374dc5b9922b7bf3465dd`; no logo or favicon asset was found
there to replace the previously rejected trace. Rechecked the ClassQuiz tree
at `15fa2db715aa25dc7024cd146d699a7e6fb3d50c`: the identified brand assets
are `logo.png` and raster favicons; the editor's `x-circle.svg` is a UI icon,
not a substitute logo. These checks do not claim the projects lack logos.

**No coverage change in this pass: 954 sourced, 137 pending.**

## Source review continuation: Apache Kvrocks and Plik (not admitted)

Decoded the original PNG embedded in `apache/kvrocks-website`'s
`static/img/logo.svg` at `a9b47e8e962cfe005877290bc3c1a824d793bde6` for
research only. The embedded image is 203×202. A gradient-detail VTracer 0.6.15
trial made the white emblem edges and drop shadows visibly irregular; it was
rejected. No embedded-image exception or raster-decoding profile was added to
the production generator for this unfaithful candidate. A genuine SVG wrapper
around raster artwork is not itself usable path geometry.

Inspected `root-gg/plik`'s `webapp/src/components/AppHeader.vue` at
`48ca619f4cfbf32e22e625f1fdd0e998dc82949e`. Its brand slot renders a configurable
image when supplied, otherwise the configured name as styled text. The inline
SVGs in that component are upload, terminal, documentation and GitHub navigation
icons, not a project-supplied vector logo. They were not repurposed as Plik's
mark. A suitable original path rendition remains unresolved.

**No coverage change in this pass: 954 sourced, 137 pending.**

## Official repository continuation: openrouteservice

Resolved the earlier small-wordmark trace failure using the official
`GIScience/openrouteservice-app` asset `app/img/logo@2x.png`, revision
`6ff5e9e9e3df1fe8fd45122b4cecbf1c910e7712`. The source is unchanged and its
PNG blob and SHA-256 are pinned. The upstream Apache-2.0 notice is retained in
[Openrouteservice-app-LICENSE.txt](platform-logo-licenses/Openrouteservice-app-LICENSE.txt).

A new explicit `light-ground-upscaled` profile composites transparency onto
white, then resamples to four times the width and height with Pillow 13.0.0
Lanczos before the existing detail VTracer 0.6.15 settings. This gives the
curve fitter more samples and avoids the angular letter contours from earlier
trials. It is deterministic image resampling, not manual redrawing or invented
lettering. Aspect ratio is unchanged, and the output SVG hash is pinned.
Existing trace profiles remain unchanged. The PNG path validator now permits
`@` in upstream filenames for this original `@2x` asset.

The trace was compared with the original and generated React output inspected
at 44px and 96px. Only vector paths ship to the browser. Python regressions
cover opt-in fourfold dimensions, alpha compositing, source-byte preservation
and intermediate cleanup. Mailtrain was also tried with resampling but has
not been admitted; improving one source does not automatically approve others.

**955 of 1,091 entries are now sourced; 136 remain pending.**

## Official repository continuation: Errbit

Resolved Errbit's earlier lettering/shading trace failure with the explicit
`light-ground-upscaled` profile. Source: `errbit/errbit`,
`docs/notifications/slack/errbit.png`, revision
`14655aef50e53ebb4e4d30b3be627a4a0d52740f`. Attribution: **Errbit Team**;
the upstream MIT notice is retained in
[Errbit-LICENSE.txt](platform-logo-licenses/Errbit-LICENSE.txt).

The original wordmark, grey shading, dark square background and margins are
preserved. Fourfold Lanczos resampling before tracing avoids the broken
letter strokes of the prior detail-only trial. This remains a path trace of
the original raster, not a claim of vendor-authored SVG. Original PNG blob and
SHA-256 and the final SVG hash are pinned. Generated React output was compared
with the original and visually reviewed at 44px and 96px. No raster image is
embedded or requested at runtime.

**956 of 1,091 entries are now sourced; 135 remain pending.**

## Official repository continuation: COPS and FusionDirectory

Resolved two earlier small-lettering trace failures with the explicit
`light-ground-upscaled` profile (white compositing, fourfold Lanczos resampling,
then pinned VTracer 0.6.15 detail settings):

- **COPS**: `seblucas/cops`, `images/icons/icon144.png`, revision
  `7828cc600e904941583227071b8f4efd3b9385fb`. Preserves the original book,
  bookmark and vertical COPS lettering. The upstream GPL-2.0 notice is retained
  in [cops-LICENSE.txt](platform-logo-licenses/cops-LICENSE.txt).
- **FusionDirectory**: `fusiondirectory/fusiondirectory`,
  `html/themes/breezy/icons/scalable/apps/fusiondirectory.png`, revision
  `1efe63dab1b99ba57f553cae6d529021cf1e4c52`. Despite the directory's name,
  this source is a PNG, and is honestly recorded as a trace rather than an
  original vector. The complete blue symbol and wordmark are retained. The
  upstream GPL-2.0 notice is in
  [fusiondirectory-LICENSE.txt](platform-logo-licenses/fusiondirectory-LICENSE.txt).

Both originals were compared with their new traces, then the generated React
components inspected at 44px and 96px. The profile improves small curved
lettering without replacing it with fonts or manually drawing paths. Original
PNG blobs and SHA-256 digests and final SVG digests are pinned. These remain
raster-derived renditions; no raster image is loaded or embedded at runtime.
Repository licences do not grant blanket trademark rights or endorsement.

**958 of 1,091 entries are now sourced; 133 remain pending.**

## Official repository continuation: AnonUpload

Added AnonUpload's original white-and-black wordmark from
`Supernova3339/anonupload`, `assets/images/logo.png`, revision
`11a47b262b70be94eddc8896abc482afa86e5a2a`. The previously rejected lettering
now has a reviewed rendition using `light-ground-upscaled`: deterministic
white compositing and fourfold Lanczos resampling before detail tracing.
The source was also inspected on white to verify that the black outlines
and shadow belong to the original artwork, not an invented trace decoration.

The full wordmark and original proportions are retained. Original PNG blob
and SHA-256 and traced SVG SHA-256 are pinned; the upstream GPL-3.0 text is
retained in [AnonUpload-LICENSE.txt](platform-logo-licenses/AnonUpload-LICENSE.txt).
Generated React output was visually checked at 44px and 96px. No runtime
raster is embedded or loaded.

Hiccup was retried with the same profile but remains pending: the original
blue gradient became substantially flatter. Resampling alone does not solve
its shading fidelity issue, and that trial was not admitted.

**959 of 1,091 entries are now sourced; 132 remain pending.**

## Official repository continuation: Eclipse Kura

Resolved the earlier circle/lettering trace failure using the official
`eclipse-kura/kura-management-ui` asset
`org.eclipse.kura.web2/src/main/webapp/eclipse/kura/icons/kura_login_logo.png`,
revision `79659e4b7381dfd1f21747b545e157cb2a098d19`.
The original white wordmark, circle motif and TM are retained without drawing
replacement shapes. Source PNG blob/hash and final SVG hash are pinned.

The new explicit `dark-ground-upscaled` profile uses the same fourfold Lanczos
resampling and detail trace settings as the light variant, but first composites
onto #182448 to keep white artwork visible. The navy presentation ground is
ours, not an upstream logo colour change. Existing profiles are unchanged.
The original on the same ground was compared with the trace, and generated
React output reviewed at 44px and 96px. Python tests cover dark compositing,
white-foreground preservation and source-byte preservation.

Retained the upstream [EPL-2.0 licence](platform-logo-licenses/Kura-UI-LICENSE.txt)
and [notice](platform-logo-licenses/Kura-UI-NOTICE.md), including Eclipse
Foundation's Kura trademark attribution. This is not a blanket trademark grant
or an endorsement claim.

QloApps was also tested on white, but its white foreground disappeared against
that ground; that trial was not admitted. It needs a separate dark-ground
review rather than automatic approval under this new profile.

**960 of 1,091 entries are now sourced; 131 remain pending.**

## Official repository continuation: QloApps

Added the original QloApps lockup from `Qloapps/QloApps`,
`install-dev/theme/img/logo.png`, revision
`dad4ef2034196685ad9858d8d4e886478724870a`. The full white Qlo symbol, building
details, divider and “Hotel Booking & Reservation System” tagline remain
present. The wide original is necessarily small in square catalogue slots;
no invented simplified mark or replacement font was substituted.

The `dark-ground-upscaled` trace profile preserves white foreground detail
on our navy presentation ground; the preceding white-ground trial was rejected.
Original artwork was compared with the new trace, and generated React output
reviewed at 44px and 96px. Original PNG blob/hash and traced SVG hash are pinned.
Only paths are shipped to the browser.

The upstream [OSL-3.0 licence](platform-logo-licenses/QloApps-LICENSE.md) is
retained. Attribution: **QloApps contributors**. This traced rendition is also
provided under OSL-3.0; its changes are compositing, deterministic resampling,
tracing and conversion to JSX. The source reference and reproducible generator
are recorded here and in the manifest. OSL's source/distribution and external
deployment obligations remain applicable; its copyright grant is not a
trademark grant or permission to imply endorsement.

**961 of 1,091 entries are now sourced; 130 remain pending.**
**130 of the original 260 pending entries have now been resolved.**

## Official repository continuation: ChiefOnboarding and Pydio Cells

Added two previously rejected raster originals after reviewing new resampled
traces against the source artwork:

- **ChiefOnboarding**: `chiefonboarding/ChiefOnboarding`,
  `docs/public/header/logo.png`, revision
  `4da52a98bf6e481371646f25d8e784e1f9f989fa`, using `light-ground-upscaled`.
  The original orange/blue symbol and orange/grey wordmark are retained.
  [Upstream AGPL-3.0 notice](platform-logo-licenses/chiefonboarding-LICENSE.txt).
- **Pydio Cells**: `pydio/cells`,
  `discovery/install/assets/src/res/css/PydioLogo250.png`, revision
  `e53f0eec4e719903e67aff3b61a9be83d6c242ea`, using `dark-ground-upscaled`.
  White lettering, central symbol and “PUT YOUR DATA IN ORBIT” tagline remain
  present on our navy presentation ground. The white-ground trial was not
  used. [Upstream AGPL-3.0 notice](platform-logo-licenses/pydio-cells-LICENSE.txt).

Both original PNG blobs/hashes and final SVG hashes are pinned. Generated React
output was visually reviewed at 44px and 96px. These are raster-derived paths,
not vendor-authored vectors; repository licensing is not trademark endorsement.

Pydio's detailed trace exposed Babel's automatic formatting compaction above
500 KB: it removed the newlines used to strip module boilerplate. The generator
now explicitly keeps noncompact Babel formatting, including for large reviewed
artwork. This fixes extraction rather than bypassing the unsafe-element check.
A regression imports and renders the Pydio component and checks for real paths,
no raster/script elements and no leftover import/export text.

**963 of 1,091 entries are now sourced; 128 remain pending.**

## Official repository continuation: WAHA

Added WAHA's original robot-and-chat artwork from `devlikeapro/waha`,
`logo.png`, revision `c42f68ab25b93fd77f583e17477cbcc9d14471cc`.
The `light-ground-upscaled` profile resolves the earlier phone-symbol trace
failure without replacing any shape. The robot, chat bubble, phone, green
palette and proportions were compared with the original, then generated
React output inspected at 44px and 96px. Original PNG blob/hash and final SVG
hash are pinned. The upstream Apache-2.0 notice is retained in
[WAHA-LICENSE.txt](platform-logo-licenses/WAHA-LICENSE.txt).
The artwork includes the upstream WhatsApp-style symbol; repository licensing
is not a trademark grant or a claim of affiliation with WhatsApp/Meta.

Hollama and Open Archiver were retried with the same upscaled profile. Their
small raster originals still lose fine llama/box details; both remain pending.
Those trial files were not admitted to the manifest.

**964 of 1,091 entries are now sourced; 127 remain pending.**

## Official repository continuation: Mailtrain

Added the original train symbol from `Mailtrain-org/mailtrain`,
`client/static/mailtrain-notext.png`, revision
`89b189d0f5fcb3bb069dde7c2da72d5acd071dd5`, using `light-ground-upscaled`.
The earlier standard trace lost train/track detail; the new rendition was
compared on the same white ground at the original 61×72 dimensions, then
reviewed as generated React code at 44px and 96px. The window, lights, train
silhouette and rails remain visible. Its small raster origin still limits
sharpness when enlarged; no extra detail was invented.

Original PNG blob/hash and final SVG hash are pinned, with the upstream
GPL-3.0 text retained in
[Mailtrain-LICENSE.txt](platform-logo-licenses/Mailtrain-LICENSE.txt).
No raster image ships at runtime; trademark rights remain separate.

MapStore and RosarioSIS were retried but not admitted: MapStore lost substantial
lower artwork and RosarioSIS flattened the cap shading. A separate experimental
Dkron trace with finer colour-layer separation still lost its gradient, so that
trial and its settings were not promoted to a production profile.

**965 of 1,091 entries are now sourced; 126 remain pending.**

## Official repository continuation: pygeoapi

Added pygeoapi's original gear/map-pin and wordmark from
`geopython/pygeoapi`, `pygeoapi/static/img/logo.png`, revision
`a7a9a37b257dc062d5f7833c1c9eb577fa2b8ee6`. The `light-ground-upscaled`
profile preserves the blue/grey artwork and improves the earlier lettering
and thin-outline trace. The original was compared with the trace, and generated
React output reviewed at 44px and 96px. No replacement font or hand-drawn
symbol was used. Original PNG blob/hash and final SVG hash are pinned.
Attribution: **pygeoapi development team**; the upstream MIT text is retained
in [pygeoapi-LICENSE.md](platform-logo-licenses/pygeoapi-LICENSE.md).

CoAI and WeKnora were also retried but not admitted. CoAI's small raster still
produced irregular contours/colour bands. WeKnora's enlarged trace introduced
visible grey protrusions over letter tops that are absent from the original;
its 4.7 MB trial is research-only. The inspected WeKnora notice assigns MIT to
its own work with third-party exceptions; that does not cure the fidelity issue.

**966 of 1,091 entries are now sourced; 125 remain pending.**

## Official repository continuation: SnapOtter

Resolved the low-resolution source blocker using the official 512px artwork
from `snapotter-hq/SnapOtter`, `apps/web/public/logo-512.png`, revision
`72c2295ef5f817a79b1dd427300425f619260998`. The earlier tiny source still
produced an unfaithful result, even with resampling, and was not reused.
The larger original preserves the otter, captain's hat, picture tile, bubbles
and circular blue frame with the `light-ground-upscaled` profile.

The original and trace were compared at matching detail size on white, then
generated React output inspected at 44px and 96px. Original PNG blob/hash and
final SVG hash are pinned. The upstream AGPL-3.0 notice is retained in
[SnapOtter-LICENSE.txt](platform-logo-licenses/SnapOtter-LICENSE.txt); the
repository's third-party notice covers Node dependencies, not an alternate
licence for this artwork. No runtime raster embedding or replacement shapes
were introduced. Repository licensing is not trademark endorsement.

TRIP's small icon was also retried and remained insufficiently detailed.
A separate 512px original was located for future review, but no trace of that
larger source has yet been approved or added.

SnapOtter’s detailed trace is isolated in its own lazy chunk so it does not
delay loading other S-named logos. The first validation exposed this shared-chunk
load delay; isolation fixes it without increasing the test timeout.

**967 of 1,091 entries are now sourced; 124 remain pending.**

## Source review continuation: TRIP's larger original (not admitted)

Reviewed `itskovacs/trip`, `src/public/icons/TRIP_512.png`, revision
`856b1edfe81a735fce4b544c2e16a6518cebf164`. Compared the 512px original on
white with two new path traces at matching detail size. The native-resolution
`light-ground-detail` trial (1,315,983 bytes before SVG optimisation) visibly
softens the tower lattice and small architectural details. The fourfold
`light-ground-upscaled` trial preserves substantially more detail but expands
to 15,905,124 bytes before optimisation. Neither is admitted in this pass:
the former fails detail fidelity and the latter needs size/performance work
before it is suitable for a catalogue tile. These sizes describe research SVGs,
not measured browser transfer sizes or a proven runtime failure.

Both trials remain outside the shipped manifest. No raster fallback, simplified
redrawing or coverage increase was substituted for a reviewed result.
**Coverage remains 967 sourced and 124 pending.**

## Official repository continuation: Serge

Added Serge's original pixel-art llama from `serge-chat/serge`,
`web/static/favicon.png`, revision
`3cb250c48286d644fd1e73e8a47cbacb60be6e21`. Earlier spline traces rounded its
pixel geometry. The new explicit `dark-ground-pixel` profile composites partial
alpha onto navy at native dimensions, then uses VTracer 0.6.15 with `mode=none`,
zero speckle filtering, colour precision 8 and layer difference 1. No resampling
or smooth curve fitting is applied. The dark presentation ground is ours;
original purple/white artwork is retained without replacement shapes.

The original and trace were visually compared, then generated React output
reviewed at 44px and 96px. This is a reviewed pixel-boundary trace, not a claim
of byte-identical raster reproduction. Original PNG blob/hash and final SVG
hash are pinned. Retained the upstream
[Apache licence](platform-logo-licenses/Serge-LICENSE-APACHE.txt) and
[MIT notice](platform-logo-licenses/Serge-LICENSE-MIT.txt); the manifest records
Apache-2.0. A Python regression checks native dimensions, alpha compositing,
no curve fitting, zero speckle filtering and unchanged source bytes.

Screego and WebCord were also retried with the upscaled spline profile. Screego
lost its soft colour halos and WebCord flattened its gradients; both remain
pending. No approval was inferred from a recognisable silhouette alone.

**968 of 1,091 entries are now sourced; 123 remain pending.**

## Official repository continuation: GMOD Apollo

Added the original Apollo genome-annotation wordmark, not a different Apollo
product, from `GMOD/Apollo`, `docs/images/ApolloLogo400px.png`, revision
`eb0b574ae5b5498ce49eaff573db5181c9df8a73`. Its filename says 400px but the
source dimensions are 252×111. The `light-ground-upscaled` profile preserves the
stylised helix A, blue crossbar and black serif lettering without replacement
fonts or redraws. Original and trace were compared on white at equal detail
size, then generated React output reviewed at 44px and 96px. Small tile text
is naturally limited by the complete wordmark's aspect ratio.

The source blob and SHA-256 and final SVG SHA-256 are pinned. The BSD-3-Clause
notice, copyright 2020 Regents of the University of California, is retained in
[Apollo-LICENSE.md](platform-logo-licenses/Apollo-LICENSE.md), including its
non-endorsement clause. The old Apollo blocker was removed from the gap-audit
script and the gaps document regenerated rather than hand-edited.

Karaoke Eternal and Jelly Clipper upscaled trials still flatten gradients;
neither inspected repository tree contains an SVG alternative. ZNC's current
`logo.png` at `edeab9c1c158d27f9379c2c707b1dc670608782d` was also retried,
but metallic shading remains visibly degraded. These three remain pending.

**969 of 1,091 entries are now sourced; 122 remain pending.**

## Source review continuation: Plandex, SoulSync and Nango (not admitted)

- Retried Plandex's previously fetched official raster with
  `light-ground-upscaled`. The trace flattens both colour gradients and creates
  pale protrusions at the inner upper edges. Its 1,955,054-byte research SVG
  was not added. The inspected `plandex-ai/plandex` tree at
  `e2d772072efadbe41d2946d97d79be55532dbab5` includes multiple PNG logo variants;
  this retry does not establish that every variant has been exhausted.
- Retried SoulSync's previously fetched raster with the same profile. The
  detailed woven-loop trial expands to 25,205,417 bytes before optimisation.
  It remains research-only pending further fidelity and size/performance work;
  no browser transfer size or runtime performance claim was measured here.
- Found first-party Nango vectors, including `docs/favicon-black.svg`, in
  `NangoHQ/nango` at `970f9e6715806ff96e7096b12afc86dce22827f6`. Its root
  `LICENSE` is Elastic License 2.0, not an unrestricted MIT grant. It prohibits
  offering substantial software functionality as a hosted or managed service
  and preserves notices; trademark use remains subject to applicable law.
  That is a deployment/licensing review flag for this hosting catalogue, not a
  claim that merely displaying the logo necessarily violates ELv2. No artwork
  was admitted while its reuse/deployment scope remains unresolved.

No production manifest changes were made in this review pass.
**Coverage remains 969 sourced and 122 pending.**

## Official repository continuation: MiroFish

Added the original blue pixel-art fish from `666ghj/MiroFish`,
`frontend/public/icon.png`, revision
`7657031ac01184afe2cb220f5ee3545573b5e843`. The same revision's
`frontend/index.html` explicitly identifies `/icon.png` as the MiroFish favicon;
the unrelated sponsor logo in `static/image` is not used.

The explicit `light-ground-pixel` profile composites alpha onto white at native
resolution and traces pixel boundaries with VTracer 0.6.15 (`mode=none`,
`filter_speckle=0`, `color_precision=8`, `layer_difference=1`). There is no
resampling, invented geometry, cropping or raster embedding. The initial dark
ground trial obscured the dark outline and was not selected. The source and
white-ground trace were compared at equal detail size, then generated React
output inspected at 44px and 96px. Fine texture is represented by paths; this
is a reviewed rendition, not a pixel-identical reproduction claim.

Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. The upstream AGPL
notice is retained in [MiroFish-LICENSE.txt](platform-logo-licenses/MiroFish-LICENSE.txt).
A new Python regression checks white alpha compositing, native dimensions,
pixel-mode options and unchanged source bytes. Existing profiles are unchanged.

**970 of 1,091 entries are now sourced; 121 remain pending.**

## Source review continuation: ICO candidate and remaining vector searches

- Located yt-dlp Web UI's own red cloud/download favicon at
  `marcopiovanello/yt-dlp-web-ui`, revision
  `c7ad3bd79c7c520a7d17e7f2ba19d962be8e7897`,
  `frontend/src/assets/favicon.ico`. That revision's `frontend/index.html`
  explicitly uses this file as its favicon. Original ICO SHA-256:
  `53f00b43208b2b726ef77795ed01c1e3a3ceb4985f53da82de112a5dea236601`.
  Pillow selected a 128×128 frame for a research PNG decode and trial trace.
  The red silhouette and arrow remain recognisable, but no production source
  was added: the generator currently pins PNG originals, not ICO originals.
  Admission needs explicit ICO provenance/frame handling, licensing review,
  reproducibility tests and actual React tile review. A local PNG conversion
  must not be misrepresented as a PNG committed by the upstream project.
- Retried Plandex with `light-ground-pixel`; its 750,390-byte research SVG
  still flattens the original gradients. Pixel-boundary tracing alone does
  not solve that colour-fidelity blocker.
- Manticore Search's inspected README points to an external website logo,
  not a logo stored in that repository. Euro-Office's documentation repository
  provides a logo but no root licence in the inspected listing; the README
  describes its documentation tooling, not an artwork reuse grant. Neither
  was admitted by guessing permission or substituting third-party icons.

**Coverage remains 970 sourced and 121 pending.** No production renderer or
manifest changes were made in this review pass.

## Official repository continuation: yt-dlp Web UI

Admitted the previously researched original red cloud/download favicon from
`marcopiovanello/yt-dlp-web-ui`, `frontend/src/assets/favicon.ico`, revision
`c7ad3bd79c7c520a7d17e7f2ba19d962be8e7897`. The upstream HTML explicitly
selects this icon. This is the project's chosen favicon, not a replacement
cloud symbol drawn for this catalogue.

Added a distinct `official-ico` source type: the original ICO blob and SHA-256
are verified at the immutable repository path. Pillow 13.0.0 must select the
explicitly pinned 128×128 frame; absent frames and non-ICO inputs are rejected.
The reviewed light-ground-upscaled profile then traces that frame with VTracer
0.6.15. The source is not mislabeled as an upstream PNG. No ICO/PNG reaches the
browser, and final SVG bytes are separately hashed. Python regression coverage
checks exact frame selection even when a larger frame exists, alpha handling,
source preservation and rejected implicit/wrong-format inputs.

The actual React paths were inspected at 44px and 96px; the cloud silhouette
and negative-space downward arrow remain legible. The original GPL-3.0 licence
is retained in [yt-dlp-web-ui-LICENSE.txt](platform-logo-licenses/yt-dlp-web-ui-LICENSE.txt).
This admission supersedes the earlier ICO pipeline blocker, not the documented
blockers for other projects.

**971 of 1,091 entries are now sourced; 120 remain pending.**

## Official repository continuation: Hollama

Resolved the earlier small-favicon blocker with the official 1024×1024 desktop
icon from `fmaclen/hollama`,
`electron/resources/icons/png/1024x1024.png`, revision
`a6614a2e0c6f0634f75e6b1605dcae28b8628bb1`. The native-resolution
`light-ground-detail` trace retains the llama's eye, ears, teeth, fur, telephone
receiver and coiled cord. Original and trace were compared at equal 300px size
on white, then actual generated React paths reviewed at 44px and 96px. Some
fine hatching remains more stippled than the raster; this is a reviewed trace,
not a pixel-identical or vendor-authored vector claim.

The 3,004,873-byte research SVG is larger than a simple icon, so Hollama uses
its own lazy component instead of increasing every H-logo import. This is
loading isolation, not a claim that the asset has negligible network cost.
The original PNG blob/hash and final SVG hash are pinned, and the MIT notice
(copyright 2023 Fernando Maclen) is retained in
[Hollama-LICENSE.txt](platform-logo-licenses/Hollama-LICENSE.txt).
No source crop, replacement illustration or embedded raster is used.

**972 of 1,091 entries are now sourced; 119 remain pending.**

## Source review continuation: MeshCentral, ClassQuiz and GeneaC (not admitted)

Retried MeshCentral and ClassQuiz with `light-ground-upscaled` and inspected
both originals against 280px trial renders. MeshCentral's MESH lettering,
background transition and cloud shading remain distorted. ClassQuiz's `logo.png`
(at `mawoka-myblock/ClassQuiz` revision
`15fa2db715aa25dc7024cd146d699a7e6fb3d50c`) loses the original softly shaded
zigzag pattern and changes the lettering/shadow boundaries. Its research SVG
also expands to 19,785,070 bytes before optimisation; MeshCentral's trial is
3,845,725 bytes. Neither trial is shipped. These are unoptimised research sizes,
not browser transfer measurements.

The MeshCentral tree at `1eab6b80c90f9e9911f178aa518bf2192e47602c` includes
many interface/device icons, but those must not be substituted for its project
identity merely because they trace more cleanly.

Checked GeneaC's ICO as a possible alternative to its earlier empty PNGs:
`mrysav/geneac`, `public/favicon.ico`, revision
`8f94631fba3e8fb2298028c38d4ae2985fe55d68`. GitHub confirms size **0 bytes**,
blob `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`; it is an empty committed file,
not a decoder failure or an inaccessible logo. Adding ICO support therefore
does not resolve this particular candidate.

**Coverage remains 972 sourced and 119 pending.** No production manifest or
renderer changes were made during this review pass.

## Source review continuation: CoAI desktop artwork and Redpanda terms

Checked `coaidev/coai`, `app/src-tauri/icons/icon.png`, revision
`3048a493eedcfe75de4d59afd5139847ad3195ed`, as an alternative to the small
previously rejected source. The larger desktop image itself has visibly blurred
edges and colour fringes; a native-resolution `light-ground-detail` trace still
changes those boundaries and colour transitions. Neither the alternative source
nor this trial was admitted. A larger filename/dimension does not establish
higher-detail original artwork.

Revisited `redpanda-data/console` at
`027d9212f9325c066654dd6f78c6d41796bbb9da`. Its tree contains genuine project
SVG candidates (`frontend/public/favicon.svg` and
`frontend/src/assets/redpanda/icon-color.svg`). The revision's
`licenses/README.md` describes BSL for core and RCL for enterprise features,
and explicitly discusses restrictions on offering Redpanda as a service.
It links to licence texts in the separate Redpanda repository; this pass did
not establish an artwork-specific reuse grant or resolve that deployment
scope. The vector files remain pending review, not absent. Software deployment
restrictions alone are not a finding that displaying a logo is prohibited.

No production manifest or renderer changes were made in this pass.
**Coverage remains 972 sourced and 119 pending.**

## Source review continuation: TaxHacker and Crucix

Fetched TaxHacker's larger official `public/logo/1024.png` from
`vas3k/TaxHacker` at `97f8a59af4361b8e772752204617098e17f299e2` and tested
native-resolution `light-ground-detail`. The 5,370,130-byte research SVG still
flattens the laptop gradient and the illustration's sprayed texture, with
visible edge artifacts. The source and 300px trial were inspected; this is not
an approved alternative to the previously rejected embedded-raster SVG.

Inspected both `dashboard/public/loading.html` and
`dashboard/public/jarvis.html` in `calesthio/Crucix` at
`3db7068817e0c815df353fa0f19657c85142789d`. The startup branding is `CX` or
`CRUCIX` text inside animated CSS rings. The SVG elements in the dashboard
serve map/chart UI, not a supplied project-logo path. No arbitrary font-to-path
conversion or map/chart symbol was substituted for original logo artwork.
This records the inspected files, not a claim that no logo exists elsewhere.

**Coverage remains 972 sourced and 119 pending.** No production manifest or
renderer changes were made in this review pass.

## Official repository continuation: PicoClaw

Added the standalone official lobster icon from `sipeed/picoclaw`,
`web/backend/icon.png`, revision
`bbf6893ca7afad27f1d00a0f5a45982a549c6ed6`. At that revision,
`web/backend/systray_icon_nonwindows.go` explicitly embeds this PNG as the
application icon. This avoids the previously rejected SVG with embedded raster.

Compared native spline, upscaled spline and native pixel-boundary traces
against the original composited onto the same white ground. Selected the
`light-ground-pixel` profile: it preserves the eye spirals, red claws, tail,
body colour blocks and chip/P emblem more clearly than the spline trials.
Pixel boundaries are somewhat visible at detail size; this is a reviewed
raster-derived rendition, not an assertion of identical pixels or a native
vendor vector. No invented shapes, cropping or recolouring were introduced.
Actual generated React paths were reviewed at 44px and 96px.

The 1,776,498-byte research SVG uses an isolated lazy component so the P-logo
chunk does not inherit it. Original PNG blob/hash and final SVG hash are pinned.
Retained the MIT notice (2026 PicoClaw contributors) in
[PicoClaw-LICENSE.txt](platform-logo-licenses/PicoClaw-LICENSE.txt).

Also inspected Atlas CMMS's `logo-white.png` at
`Grashjs/cmms` revision `a3c7ce38adedeb90ac13c280e8ccad6622ff2a42`;
it is a shaded metallic mark, not a flat monochrome alternative. It remains
pending; no new trace of that white variant was approved.

**973 of 1,091 entries are now sourced; 118 remain pending.**

## Official repository continuation: WeKnora

Resolved the earlier wordmark-trace blocker using the official light-theme
video asset: `Tencent/WeKnora`, `misc/intro-video/assets/logo-light.png`,
revision `032c67f30d63f744ffa9131887c35f7d15121224`. Its full wordmark, sail
and gold/blue wave accents are retained without changing fonts or cropping.
The corresponding dark-theme PNG is pale lettering for a dark background and
was not selected for this white-ground rendition.

The `light-ground-pixel` profile avoids the grey protrusions created by the
previous upscaled spline trial. Compared source and trace on the same white
ground at 400px, then reviewed actual generated React paths at 44px and 96px.
Pixel-boundary texture is visible on close enlargement and the complete wide
wordmark is naturally small at 44px; no claim of pixel-identical reproduction
or a native upstream SVG is made.

Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. The 2,755,563-byte
research SVG is isolated in its own lazy component. Retained the full upstream
[WeKnora-LICENSE.txt](platform-logo-licenses/WeKnora-LICENSE.txt), including
Tencent's 2026 MIT grant and the third-party component exceptions; the
manifest records MIT for this first-party artwork. This supersedes the earlier
NOASSERTION research metadata, not the third-party exceptions or trademark
considerations.

**974 of 1,091 entries are now sourced; 117 remain pending.**

## Official repository continuation: RosarioSIS

Added the original cap/diploma icon from `francoisjacquet/rosariosis`,
`apple-touch-icon.png`, revision
`fe25aeea3b5a667af234169c19dec2a8c6e54376`, using `light-ground-pixel`.
This native-resolution boundary trace preserves the cap's grey/black shading,
red tassel and ribbon, and rolled diploma better than the previous spline
trials. Compared source and trace on white at matching 250px enlargement,
then inspected actual React paths at 44px and 96px. Pixel stair-stepping is
visible when enlarging the 128px source; this is not a smooth native vector
or a claim of pixel-identical reproduction. No replacement graduation icon
or invented geometry was introduced.

Original PNG blob/hash and final SVG hash are pinned. Retained upstream
[LICENSE](platform-logo-licenses/RosarioSIS-LICENSE.txt) and
[COPYRIGHT](platform-logo-licenses/RosarioSIS-COPYRIGHT.txt). The latter
explicitly says GNU/GPLv2 or later and lists the project contributors and
separately licensed dependencies; the manifest therefore records
`GPL-2.0-or-later`, rather than relying on stale research shorthand.

**975 of 1,091 entries are now sourced; 116 remain pending.**

## Source review continuation: pixel-profile limits

Retried the previously fetched WebCord and Jelly Clipper originals with
`light-ground-pixel`, not the already-rejected upscaled spline profile.
The resulting 280px previews still flatten their blue/purple gradients.
This profile's success on other artwork is not evidence of faithful colour
reproduction for these two marks; both remain pending.

Also retried ZNC's `logo.png` at `znc/znc` revision
`edeab9c1c158d27f9379c2c707b1dc670608782d` with native pixel-boundary tracing.
The 300px inspection still shows coarse metallic shading and altered fine
letter borders. No new trace was admitted. Searched the official companion
repository `znc/docs` (master resolved to
`dbc7060dfe6178aa2c845dfd610030a5c3676a92`); its returned tree contained no
PNG or SVG assets, so that search did not supply an alternative source.

**Coverage remains 975 sourced and 116 pending.** This pass updates research
findings only; no production manifest or renderer changes were made.

## Tracing research: colour-layer experiments (not production profiles)

Tested Jelly Clipper's original raster after white alpha compositing with
VTracer 0.6.15, `mode=none`, `filter_speckle=0`, `color_precision=8`, using:

- `hierarchical=cutout`, `layer_difference=0`: the purple-to-blue gradient
  still collapses into a nearly flat colour, with visibly stepped edges.
- `hierarchical=stacked`, `layer_difference=255`: large colour regions merge
  incorrectly, damaging both colour and silhouette.

Both 280px trial renders were inspected and rejected. These experiments do
not justify changing the production defaults or relabeling flattened-colour
results as faithful original artwork. No experimental profile or trial SVG
was added to the generator or manifest. Searches of the existing Dkron,
Hiccup and MapStore trees also found customer/UI/font SVGs rather than a new
project-logo vector; none was substituted merely to increase coverage.

**Coverage remains 975 sourced and 116 pending.**

## Official repository continuation: CodiMD identity correction

Earlier research followed `hedgedoc/hedgedoc`; that is not used for this
CodiMD entry. The correct repository is `hackmdio/codimd`, whose README
identifies CodiMD as the self-hosted collaborative Markdown application.
Pinned `public/favicon.png` at
`b1188a5648a23d970b9ad58612376e6602431f6f`. At the same revision,
`public/views/index/head.ejs` explicitly selects `/favicon.png` as the site
icon. Thus this document silhouette is the upstream-selected favicon, not a
generic replacement chosen by us. It is not presented as a unique wordmark or
proof of exclusive trademark ownership.

Selected `light-ground-pixel` after rejecting the new upscaled spline trial's
grey lobes above the white text-line cutouts. Compared original and trace on
white at 240px, then reviewed actual React output at 44px and 96px. The source
limits enlargement sharpness; no smoothing/redrawing or replacement glyph
was introduced. Source blob/SHA-256 and final SVG SHA-256 are pinned.
Retained the repository AGPL notice in
[CodiMD-LICENSE.txt](platform-logo-licenses/CodiMD-LICENSE.txt); this records
repository terms, not an independent claim about the symbol's design origin.
A regression asserts the correct repository to prevent a HedgeDoc substitution.

**976 of 1,091 entries are now sourced; 115 remain pending.**

## Official repository continuation: MapStore

Added the original shopping-bag/globe icon and MapStore lettering from
`geosolutions-it/MapStore2`, `web/client/product/assets/img/favicon.png`,
revision `cacb8452dbe145267ad3b67b692ff24a8c3feb4b`, using
`light-ground-pixel`. Compared the original and new trace on identical white
grounds at 280px before inspecting generated React paths at 44px and 96px.
The faded lower globe is present in the original alpha composition; this pass
corrects the earlier inference that every such fade represented lost artwork.
No lower artwork was cropped or redrawn. The lettering, bag handles, green
ring and globe remain recognisable; pixel stair-stepping at enlargement and
small lettering at tile size remain inherent limitations of this rendition.

Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. Retrieved the
immutable revision's BSD-2-Clause licence, copyright 2015–2025 GeoSolutions
SRL, and retained it in [MapStore-LICENSE.txt](platform-logo-licenses/MapStore-LICENSE.txt).
This replaces the stale research `NOASSERTION` label with inspected repository
terms; it is not a trademark endorsement or blanket clearance of dependencies.

**977 of 1,091 entries are now sourced; 114 remain pending.**

## Source review continuation: Atlas CMMS and Dkron pixel traces

Tested Atlas CMMS's previously fetched full blue original with
`light-ground-pixel`. The 260px trial loses smooth shading in the A/wrench
surfaces and creates visible colour patches; its research SVG is also
10,876,542 bytes before optimisation. It was not admitted. This is distinct
from the earlier inspection of the small metallic white variant.

Tested Dkron with both light- and dark-ground pixel profiles. Compared the
`dark-ground-pixel` trace against the original composited on exactly the same
navy ground at 350px width. Although the pale wordmark is now clearly visible,
the purple-to-pink emblem gradient is still flattened. The 227,442-byte dark
trial was rejected on fidelity, not size. Dark presentation cannot repair
colour information lost during tracing. Neither profile is newly approved
for either project.

**Coverage remains 977 sourced and 114 pending.** No production manifest or
renderer changes were made in this review pass.

## Official repository continuation: PgHero's selected favicon

Confirmed PgHero's actual favicon in `ankane/pghero` at
`d504e8a7319f18c7d906ac1048868fd4419467e7`:
`app/assets/images/pghero/favicon.png`. At that revision,
`app/views/layouts/pg_hero/application.html.erb` explicitly calls
`favicon_link_tag "pghero/favicon.png"`. The database-stack silhouette is
therefore the project's own selected favicon, not an arbitrary database icon
substituted by this catalogue. This is not a claim that the design is exclusive
to PgHero or independently trademark-protected.

The 32px original limits enlargement quality. Rejected the upscaled spline
trial's irregular grey rims; selected `light-ground-pixel` to retain the
source's stepped edges, four stacked shapes and grey fill. Actual generated
React paths were inspected at 44px and 96px. Enlargement remains visibly
pixelated, as documented rather than disguised by invented smoothing.

Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. Retained the MIT
repository notice, including Andrew Kane and Heroku credits, in
[PgHero-LICENSE.txt](platform-logo-licenses/PgHero-LICENSE.txt). This records
repository terms, not a separate finding about the icon's design authorship.
Tests pin the correct project and favicon path.

**978 of 1,091 entries are now sourced; 113 remain pending.**

## Official repository continuation: Pgweb's selected favicon

Added `sosedoff/pgweb`, `static/img/icon.png`, revision
`e4858a16d8e032730055289596ea9059a91bca64`. The same revision's
`static/index.html` selects `static/img/icon.ico` as the site favicon.
Decoded that original ICO's 256×256 frame with Pillow 13.0.0 and verified that
its RGBA bytes exactly equal the committed PNG. The manifest therefore pins
the real upstream PNG counterpart, not an untracked local conversion.

The outlined database cylinder is the project's own selected icon, not an
arbitrary substitute. It is distinct from PgHero's filled stack, and is not
presented as a unique wordmark or exclusive trademark. The `light-ground-pixel`
trace retains the outline and interior gaps; native pixel boundaries remain
visible on enlargement. Reviewed generated React paths at 44px and 96px.
No replacement glyph or hand-drawn smoothing was used.

Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. Retained the MIT
notice (2014–2024 Dan Sosedoff) in
[Pgweb-LICENSE.txt](platform-logo-licenses/Pgweb-LICENSE.txt). Tests pin the
correct project and PNG source path.

**979 of 1,091 entries are now sourced; 112 remain pending.**

## Renewed public-source review: aaPanel

Revisited Hostinger's public homepage as an identity reference and searched
for aaPanel artwork; third-party search hits are not treated as upstream
provenance. Inspected aaPanel's own website and repository at
`aaPanel/aaPanel` revision `38bf35903b37b50d9654f47c4ad904ca3369715f`.
`BTPanel/static/vite/images/logo.png` and
`BTPanel/static/icons/menu_logo.png` contain a green polygonal animal mark;
`BTPanel/static/images/logo.png` is a small pale wordmark. A filename alone
is not enough to establish which asset is the intended current panel identity.
No third-party green-square/initials recreation was substituted.

Retrieved this revision's `license.txt`: the custom AAPANEL agreement permits
posting/integration of unchanged aaPanel (section 4), restricts public release
of modifications (section 2.2), requires unchanged source on redistribution
(section 4.3), and expressly covers graphics in its intellectual-property
statement (section 5). These terms require review before distributing a traced
logo derivative; they are not an MIT/Apache artwork grant. This is not a claim
that ordinary nominative display of the aaPanel brand is prohibited.

No aaPanel artwork was admitted in this pass. The catalogue remains at
**979 sourced / 112 pending**; hiding unresolved entries or replacing their
marks with guessed symbols is not counted as completion.

## Official repository continuation: PowerDNS-Admin's selected favicon

Pinned `PowerDNS-Admin/PowerDNS-Admin`,
`powerdnsadmin/static/img/favicon.png`, revision
`6b3b9cc160a1db77f52db298a131cae9968db71d`. The same revision's
`powerdnsadmin/templates/base.html` explicitly selects this PNG as its favicon.
The globe is therefore the application's upstream-selected icon, not a generic
DNS illustration substituted by this catalogue. It is not claimed to be an
exclusive wordmark or the separate PowerDNS server brand.

Selected native `light-ground-pixel` tracing. Inspected source and trace and
rendered generated React paths at 44px and 96px; the black globe outlines and
white gaps remain intact, with minor pixel-boundary texture at enlargement.
Original PNG blob/SHA-256 and final SVG SHA-256 are pinned. Retained the MIT
repository notice (Khanh Ngo, Azorian Solutions and Tyler Todd) in
[PowerDNS-Admin-LICENSE.txt](platform-logo-licenses/PowerDNS-Admin-LICENSE.txt).
Tests assert the correct repository and favicon path. This supersedes the old
unverified-globe research blocker based on explicit upstream usage evidence.

**980 of 1,091 entries are now sourced; 111 remain pending.**

## Follow-up validation and JSPWiki candidate

Re-ran logo checks after PowerDNS-Admin: **966 pinned generated marks and 111
gaps verified; 15 logo tests passed, 1 todo**. The combined validation command
reached its time limit while frontend TypeScript was still running; its result
was not captured, so this pass does not claim a completed TypeScript check.

Located `apache/jspwiki` at `d86cfde5c058a65451a4f9aba8606380a721934c`,
`jspwiki-war/src/main/webapp/images/jspwiki_logo.png`. Unlike the generic ASF
feather found earlier, this file contains two adjacent versions of an older
round mark. Inspected the original and a white-ground pixel trace, but did
not add the combined image as a single logo or arbitrarily crop it. Its actual
application usage and state selection need verification first. Research-only
output does not increase the coverage count.

**Coverage remains 980 sourced and 111 pending.**

## JSPWiki state verification and completed typecheck

The explicit follow-up frontend TypeScript run completed with exit code 0.
Together with the previous logo check and 15 passing tests (1 todo), this
confirms validation of the PowerDNS-Admin addition.

Inspected JSPWiki's separate `jspwiki_logo_s.png` (64×64) and a research-only
pixel trace. The pinned revision's `jspwiki-war/src/main/styles/jspwiki.css`
uses the 128×64 `jspwiki_logo.png` sprite at `-64px 0` normally and `0 0` on
hover. This establishes the two-state purpose rather than guessing at a crop.
However, decoded RGBA comparison shows the separate small file is not exactly
equal to either 64×64 sprite half. Its explicit usage found in repository search
was a download test, not a current UI selection. The old styled mark therefore
remains research-only pending verification of the appropriate current asset;
no legacy variant was silently substituted for the catalogue identity.

**Coverage remains 980 sourced and 111 pending.**

## Official repository continuation: Cassandra Reaper

Added the original Reaper wordmark PNG from `thelastpickle/cassandra-reaper`,
`docs/img/logo.png`, revision `41d76351a72e6e88c563635a98b98f31e23bc75d`.
At this revision `docs/download/index.html` explicitly uses `/img/logo.png`
in the navbar homepage link. This is the repository's published documentation
wordmark, not the generic book favicon or the earlier theme-icon candidate.
No font substitution or hand-drawn lettering was used.

Selected `light-ground-pixel`; inspected the source and traced lettering, then
rendered actual generated React paths at 44px and 96px. The small source limits
enlargement smoothness. Original PNG blob/SHA-256 and final SVG SHA-256 are
pinned. Retained the Apache-2.0 text in
[Cassandra-Reaper-LICENSE.txt](platform-logo-licenses/Cassandra-Reaper-LICENSE.txt).
The repository separately identifies an EPL-2.0 EclipseStore dependency; that
software dependency is not incorporated by this logo change. Tests assert the
correct repository and wordmark path.

**981 of 1,091 entries are now sourced; 110 remain pending.**

## Official companion-repository review: Komari

Found the actual mascot favicon in the official `komari-monitor/komari-web`
repository's default `radix` branch, pinned revision
`c306173c9b3274f642afc54d123fc4bc57c5b2a9`, `public/favicon.ico`.
Its `index.html` explicitly selects this file. The unrelated OS logos in
`public/assets/logo` and sponsor logos in `komari-monitor/public` are not used.
Original ICO SHA-256:
`bd28c1ec580926bc3f5e9cb2721976d9ebadeefe221bae77294bf33885c71a69`.

The ICO contains a 256×256 frame, not the 128px frame currently allowed by the
production ICO pipeline. A research-only PNG decode and pixel-boundary trace
were inspected; the mascot's silhouette, hair and facial details are retained.
No manifest entry was added: the frontend tree and README provided no explicit
licence grant, and GitHub's repository licence field is null. Do not infer
artwork permission from the backend repository's separate software licence.
Admission also needs explicit 256px ICO handling and reproducibility tests;
the local decode must not be described as a PNG committed upstream.

**Coverage remains 981 sourced and 110 pending.** Komari now has a confirmed
source candidate, but not completed rights/pipeline review.

## Source review continuation: Juxtapose and Tiny File Manager

Checked `NUKnightLab/juxtapose` at
`8bb72a9f15d2eeea21bb8c06f0e576a58bbf5747`. Its
`website/templates/_header.html` brands the product with styled HTML text,
`Juxtapose <span>JS</span>`, using `product-logo` classes. The PNGs named as
logos in its tree are publisher examples and institutional supporters, not
Juxtapose artwork. None was substituted. An exact typography-derived vector
would require verifying the original font, layout and applicable font terms;
no arbitrary replacement font or hand-drawn symbol was added.

Checked `prasathmani/tinyfilemanager` at
`41491439a6b243c55502581e53fad20bc4c6e777`. `tinyfilemanager.php` defaults
`$favicon_path` to an empty string and only emits a favicon link when an
operator configures one. The inspected repository tree returned no PNG/SVG/ICO
files. This establishes that the default source provides no icon to extract;
it does not prove no official artwork exists anywhere else. Generic file and
folder UI symbols are not a substitute for an original project mark.

**Coverage remains 981 sourced and 110 pending.** This research-only pass
made no production renderer or manifest changes.

## Public brand-resource search: FASTPANEL

Searched beyond third-party icon collections for official FASTPANEL artwork.
Search indexing still describes `https://fastpanel.direct/brand-resources` as
providing SVG/PNG logo downloads and clear-space guidance. Fetching that URL
in this review instead resolved to `https://fastpanel.direct/`, whose current
content says the website is being updated and links to the official wiki.
No downloadable original logo SVG was returned by the fetched page. Search
snippets are not treated as fetched asset bytes or sufficient provenance.

Also fetched `https://fastpanel.wiki/`; its returned server-rack illustration
is not a logo and was not substituted. GitHub search returned API clients and
similarly named projects, not an established vendor branding repository.
No unverified recreation or same-name project asset was admitted. The earlier
CloudHost247 logo PR appearing in search results is not independent evidence
of original vendor artwork.

**Coverage remains 981 sourced and 110 pending.** No production manifest or
renderer changes were made in this research pass.

## Official-source review: ShinyProxy and Svix

Rechecked `openanalytics/shinyproxy` at
`c10dcd481c01d9ffee10fc474eb482b748b38966`. The inspected tree contains no
PNG/SVG/ICO artwork. Its `src/main/resources/templates/fragments/navbar.html`
conditionally displays `${logo}` only when configured, alongside `${title}`.
This establishes a configurable logo slot, not a bundled project icon. The
Open Analytics organisation listing contains numerous application demos;
those applications' own logos must not be mistaken for ShinyProxy branding.

Rechecked `svix/svix-webhooks` at
`3704695e5982a493a9b7a158945bb04846df928e`; the logo/favicon SVG/PNG filename
search returned no candidates. The organisation listing did not reveal an
obvious public branding/documentation repository. This records the limits of
this search, not a claim that Svix has no logo or no artwork elsewhere.

**Coverage remains 981 sourced and 110 pending.** No replacement icons were
introduced and no production code changed in this research pass.

## Source review continuation: SQLChat ICO alternative

Fetched `sqlchat/sqlchat`, `public/favicon.ico`, at
`85af0b4733d91d5c97a2ad89660cbfc515898676`. Its original SHA-256 is
`44d9a5b81221515e5b1d035e98d654ac0eb784ca6e19c2c4d3c447c6524c1bf5`.
The ICO supplies only 16px, 32px and 48px frames. Inspected the largest frame
and a native pixel-boundary trace: the small robot remains recognisable but
fine face and badge details are poorly resolved on enlargement. This does not
provide a higher-detail alternative to the earlier rejected WebP artwork.
The repository's other PNGs are database-provider icons, not SQLChat branding.

The inspected root licence is MIT, copyright 2025 Bytebase; this particular
retry is blocked by rendition quality and the unsupported 48px ICO pipeline,
not by an assertion that the software lacks an open-source licence. The
research decode was not mislabeled as an upstream PNG or added to production.

**Coverage remains 981 sourced and 110 pending.**

## Progressive loading

The user-provided [Hostinger checkout reference](https://cart.hostinger.com/pay/17d0a93c-4324-401c-b975-5757050391aa) shows eight OS thumbnails followed by Show more; its visible names are AlmaLinux, Debian, Rocky Linux, Ubuntu, Alpine Linux, Arch Linux, CentOS and CloudLinux. They are visual identity references, not reusable SVG source files. The public catalogue **fetches and mounts 24 records initially**, requesting only the next 24 after each click. The paged `/api/v1/control-panels/catalog` endpoint merges live DB rows with the [shared 1,091-record catalogue](../cloudhost247-node/shared/platform-catalog.json), deduplicates by slug, and applies search/category/licence filters and total counts to the *whole* list before slicing. Search and filters reset to page zero; stale requests are aborted. The legacy database-only list API remains unchanged. If the API is down, the browser can still lazy-import the complete static catalogue as an offline fallback; that exceptional path is not network-paged. The OS selector mounts **eight initially**, reveals eight at a time and keeps a previously selected OS visible without mounting all preceding choices. Only mounted cards request their lazy inline-logo code chunks. No Hostinger thumbnail is loaded at runtime.

## Regenerate and extend

In `cloudhost247-node/`, run `npm run logos:generate` (source-pinned SVG/PNG → TSX), `npm run logos:gaps` (refresh the work queue) and `npm run logos:check` (verify generated code **and** gap document). Rebuilding with a cold ignored `.cache/` needs authenticated `gh`, npm access for pinned Iconify packages and Python `vtracer==0.6.15` for raster origins plus `Pillow==13.0.0` for the explicit light-ground profile (`python3 -m pip install vtracer==0.6.15 Pillow==13.0.0`). Original and traced SHA-256 digests are checked. Unsafe `<image>`, `<foreignObject>`, external links, inline event handlers and scripts are rejected. The 33 lazy TSX groups (alphabetical groups plus isolated SnapOtter, Hollama, PicoClaw and WeKnora components) under `frontend/src/data/generated-platform-icons/` are imported lazily; no branding CDN is fetched at runtime.

To add a missing mark, confirm the *actual software* and current first-party artwork, check commercial reuse/attribution requirements, pin a source revision and digest, compare at both 44px and detail size, regenerate code and queue, then test. Reject a same-name different product or a low-fidelity path trace even if it would increase the coverage number. The neutral illustration policy for `assets/images/cloudhost247/` and the separate WHMCS site remains unchanged.

Run the light-ground regression tests in the same Python environment with `python3 scripts/test_trace_logo_light_ground.py` from `cloudhost247-node/`.
