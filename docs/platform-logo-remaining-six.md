# Remaining-entry research — six additions, not a completed ten

| Entry | Source | Identity |
| --- | --- | --- |
| `juxtapose` | https://github.com/jc21/juxtapose/blob/2151f3d31b96e6bfdf6ef50e96c1a959b48df7f4/src/frontend/images/logo.png | Original jc21/juxtapose notification-service logo. NOT NUKnightLab/juxtapose, which is an unrelated before/after slider. README lists Jira, Bitbucket, Docker Hub, Gerrit and Zendesk, matching the Hostinger entry. |
| `deepseek-harness` | https://github.com/deepseek-ai/deepseek-harness/blob/4b399c39a6d1479cd84ca591b4d7c88e24d38a96/apps/web/public/favicon.svg | Official web-app favicon, not an assumed parent-company mark. Source is apps/web/public/favicon.svg in deepseek-ai/deepseek-harness. Brand guidelines preserved; no endorsement is implied. |
| `grok-build` | https://github.com/amahpour/switchboard/blob/0681038a5040c00d5423bb1e80cfc63eb78bd934/src/switchboard/web/static/agents/grok-light.png | Grok mark redistributed unchanged in switchboard. Its pinned static-asset test and PR 940 identify the official x.ai brand kit original Grok_Logomark_Dark.png. SHA-256 agrees with the recorded original; the official ZIP was not independently downloaded here. This identifies Grok Build, not an invented Build-specific emblem. |
| `tiny-file-manager` | https://github.com/prasathmani/tinyfilemanager/blob/41491439a6b243c55502581e53fad20bc4c6e777/tinyfilemanager.php | Original H3K logo embedded in upstream login-page PHP. Extracted static SVG without executing PHP. Removed a stray invalid bare M1008 attribute; no paths, colours or transforms redrawn. Not a newly typed initial logo. |

## Two component groups

- Anki Sync Server Enhanced is explicitly an official Anki sync server packaged
  in Docker. Its README is pinned in bundleSources. Display separately labelled
  original Anki and Docker marks; do not invent an Enhanced-project logo.
- NemoClaw's README calls it a reference stack running agents in OpenShell and
  lists OpenClaw as the default. Display separate original OpenShell + OpenClaw
  marks, not NVIDIA's corporate eye as a purported NemoClaw-specific mark.
  The current stack also supports other agents; the group represents its default.

User approval for separately labelled component marks was already recorded.
Source licences, hashes and mapping references are in the public component notice.

## OpenLiteSpeed and Node.js

Already configured as OpenLiteSpeed + Node.js. Rechecked mapping, local asset
hashes and accessible rendering. Not counted as a new coverage addition.

## Why not ten

The following investigations did not establish four more suitable original marks:

- FossFLOW: reviewed the upstream 512px file; it is the React boilerplate atom,
  not a project-specific logo. Do not misrepresent it as original FossFLOW branding.
- Budge: Hostinger identifies an envelope/personal-budget app; LinuxServer's
  repository links to linuxserver/budge. Its logo files remain React boilerplate.
- DeepWiki Open: the current UI uses Font Awesome's Wikipedia W; the favicon is
  not evidence for a bespoke DeepWiki mark. No unrelated brand substitution.
- Checkrr: image search returned Checkr (employment screening), a different
  product. Repository images were application screenshots.
- Crontab UI: upstream navbar.ejs uses text, not a separately supplied graphic.
- Crucix: the loading logo is CSS-driven CX lettering and rings. No original
  standalone file was found; no screenshot was cropped or new logo drawn.
- Littlelink-Server: configured profile photos/favicons are user content, not its
  project logo. Its inspiration LittleLink is not automatically the same brand.
- ShinyProxy: screenshots and configuration examples do not supply a verified
  standalone project graphic. A similarly named analytics product was rejected.
- The Fasten Healthfazer.ai catalogue name still has unresolved identity; no
  guessed Fasten/Fazer combination was created.

## Preservation and permissions

Three artwork files are byte-identical pinned repository files. Grok's file is
an official-brand-kit redistribution with a recorded upstream checksum, not a
first-party repository asset. Its checksum matches the redistributor's static
asset test. Official brand guidelines allow accurate reference with unaltered
artwork and prohibit implied endorsement. The official kit was not independently
fetched here; no direct-source claim is invented.

Tiny File Manager is a source-code extraction. Its sourceGitBlob belongs to the
PHP file, NOT the resulting SVG. All geometry, colours and transforms are intact;
only the invalid bare M1008 attribute was removed. The public notice includes
the extracted SVG and GPL terms. DeepSeek's MIT licence and brand guidelines are
retained. Juxtapose has an explicit unresolved artwork-permission review.

No active-SVG guard was relaxed. No screenshots, stock graphics or unrelated
marks were used to force the requested count of ten.

## Validation

25 tests passed, one coverage TODO; frontend TypeScript and logo audit passed.
All four served images and their notices matched their hash pins. All six
component images used by the two new groups and OpenLiteSpeed + Node.js loaded
with matching hashes, and the shared notice includes all three new component
hashes. `git diff --check` passed. Browser screenshot validation was not run
because no browser executable is available in the workspace.

## Subsequent standalone-only decision and search

The user explicitly selected **Original logo files only** when asked whether
published text/CSS branding could replace the remaining placeholders. Do not
port Crucix's CSS rings or other projects' plain UI titles and count those as
new standalone originals. This clarification does not fabricate missing files
or prove that a project has no logo.

A subsequent pass revisited Hostinger's homepage and searched ten remaining
candidates: ShinyProxy, FossFLOW, Checkrr, Crucix, Littlelink-Server, Imaginary,
Budge, Crontab UI, Explo and DeepWiki Open. No new admissible file was verified.
Additional Auto Ontology results still identified NVIDIA's corporate branding.
Coverage therefore remains 1,077/1,091, with 14 unresolved entries.

Newly checked leads and rejection evidence:

- https://yantr.org/apps/fossflow/ calls its image a FossFLOW logo, but the actual
  image URL is `https://ui-avatars.com/api/?name=FossFLOW&background=random&color=fff&bold=true`.
  This is generated initial artwork, not original FossFLOW branding. Reject it.
- https://github.com/mong/shinyproxy contains a logo for an SKDE deployment at
  mongr.no. A logo file in this deployment repository does not establish that
  it is the ShinyProxy project's own mark.
- Checkrr searches again returned Checkr's employment-screening brand assets.
  Matching approximate spelling is insufficient; reject the different brand.
- https://github.com/genkin-he/crontab-ui/blob/main/index.html belongs to a
  different implementation and uses a Vite favicon. Do not use it for
  alseambusher/crontab-ui.
- https://github.com/durandtheman/littlelink-server describes the vanilla
  LittleLink implementation, not the previously identified Techno Tim server.
  Its naming alone does not justify swapping the projects' branding.
- https://github.com/AIDotNet/OpenDeepWiki has its own logo, but is not
  AsyncFuncAI/deepwiki-open. Do not substitute it.
- Explo and Imaginary search listings surfaced developer avatars; those do not
  establish product-specific original logos.

Only this research record changed in the follow-up. No placeholder was hidden,
no source was admitted, no count was increased, and no new test run is claimed.
