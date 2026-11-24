# Ten identified catalogue artwork additions

## Scope and honest limitations

This is ten visual additions, not ten legally cleared logos. In response to the
request for original artwork, identity-verified files are integrated into the
preview with explicit source/rights notices. Prior commercial-permission blockers
are **not resolved**. Do not publish commercially without reviewing and satisfying
the applicable terms. No permission was requested from or granted by a rights
holder in this session. No licence exception is invented.

Geneac's file is a branded website banner, not an isolated logo. Plik's copy
comes from YunoHost's catalogue. Those qualifications are retained in metadata.

| Entry | Provenance | Identity/rights notes |
| --- | --- | --- |
| `atomic-server` | https://github.com/ontola/atomic-server/blob/f71b6d07834fbe9a5ca6fa9ff6efe3da571ebcfb/brand/src/atomic-mark.svg | brand/README.md explicitly identifies atomic-mark.svg as the AtomicServer mark. Accurate factual reference is allowed; commercial use as a selling feature requires written permission. No such permission is established here. |
| `canarytokens` | https://github.com/thinkst/canarytokens/blob/61f3e0c7790f08f1be09a947cb0d68e6152cde6a/templates/static/notification-email/token_logo.png | Unchanged wordmark from upstream notification email assets. Full upstream special licence retained. Proprietary integration questions remain unresolved; this is NOT a declaration that this catalogue meets those terms. |
| `firefly` | https://github.com/Safe3/firefly/blob/059019324804d589b6bf75c640a300985bef0a20/logo.png | Hostinger identifies Firefly as the WireGuard server. Safe3/firefly README displays this moth logo. This is NOT Firefly III. Upstream says personal free use only; commercial use is not cleared. |
| `plik` | https://github.com/YunoHost/apps/blob/69141cf300fa45c944fd15fa30ded0c9cb109dce/logos/plik.png | Unchanged Plik wordmark from YunoHost/apps logos/plik.png, not the generic upload-cloud favicon. Third-party catalogue provenance, not a claimed first-party design-file source. |
| `plone` | https://github.com/plone/plone.org/blob/5b67159fab85a6bef0be811bc72254b52b9afa75/frontend/src/components/layout/images/logo.svg | Original complete device, wordmark and registered-trademark symbol. Plone is a registered trademark of the Plone Foundation. Policy permits accurate informational product overviews with attribution/link; broader commercial use requires agreement. No agreement is established here. |
| `open-agent` | https://github.com/the-open-agent/static/blob/29be533f8a94f9c60b1e5313fc747971be7aea47/img/openagent-logo_1900x450.png | Official the-open-agent/static asset; the-open-agent/openagent README explicitly selects img/openagent-logo_1900x450.png from cdn.openagentai.org. Hostinger describes the same multi-provider, RAG and enterprise authentication platform. |
| `geneac` | https://github.com/mrysav/geneac.net/blob/0cf8520b4e0a2530bb9a7aad4b82af90ff3f929f/assets/geneac-social.jpg | Official website social artwork from mrysav/geneac.net, selected by _config.yml. This is a branded photographic banner, NOT an isolated logo. Stored in full without cropping or extracting the wordmark. |
| `fastpanel` | https://i-p.rmcdn.net/646b6be610e35800194fe3bd/6653307/image-7e1bd3f5-f835-4704-b385-d3ffe697d3a1.png?w=798&e=webp&nll=true&cX=225&cY=665&cW=1040&cH=167 | Original white FASTPANEL wordmark as served on the official website. Publisher-side rendition parameters retained; no local crop or tracing. Rejected the unrelated blue F from a third-party listing, generic monitor and promotional badge. |
| `svix` | https://www.svix.com/_next/static/immutable/media/svix-brand.1_kgs6wctypz2.svg | Official press-page brand lockup retrieved as PNG from SVG. This is a captured rendition, NOT byte-identical SVG or a claim of trademark permission. Press assets are expressly subject to Svix Marks Usage Policy; required permission is not established. |
| `openai-codex` | https://registry.npmjs.org/taskchef/-/taskchef-8.5.3.tgz | Unmodified original macOS Codex icon as redistributed in taskchef@8.5.3. Hash matches both its asset notice and LocalPrism PR 111. Bundle version 26.818.61809, build 7019; original path Contents/Resources/icon-codex-light.png. App signature and original bundle were not independently checked here. Not a LobeHub redraw. |

## Why the sources changed

- Hostinger was visited as requested, including its catalogue and individual
  Firefly, Geneac, Open Agent, Canarytokens and Juxtapose pages. It confirmed
  Firefly is the VPN server, not the unrelated finance project. Its thumbnails
  were not treated as permission evidence.
- FASTPANEL's official-site search result actually contains a clean white
  registered wordmark. Earlier results were generic monitor art or badges.
  The blue F from a third-party host was rejected as a branding mismatch.
- Open Agent's current project README selects a logo hosted in the same
  organisation's static repository, resolving its identity ambiguity.
- Codex uses the unmodified 1024px original app icon in taskchef@8.5.3, not a
  LobeHub vector approximation. The hash agrees with its asset notice and
  LocalPrism PR 111. The original app signature was not independently checked.
- Canarytokens' PNG avoids changing its older XML/DOCTYPE-bearing SVG.
- Plone retains the full logo, trademark, attribution and official link, with
  a 160×50 display slot. This does not substitute for commercial permission.
- Svix's captured PNG is a rendering of the official press SVG. No false Git
  blob or upstream byte-equality claim is recorded for either web capture.

## Remaining exclusions

WireGuard Easy remains pending: its adopted dragon is governed by an explicit
commercial-use restriction. ShinyProxy searches still returned screenshots;
Juxtapose on Hostinger is a notification router, not Knight Lab's slider.
Neither was filled with an unrelated mark. Unselected research files are not
production assets.

## Preservation

Seven Git blob hashes were verified before copying. Every production asset
has a local SHA-256, a mirrored public notice and source metadata. Full Atomic,
Canarytokens and Codex-specific notices and Firefly's README terms are retained.
Artwork is served locally, without hotlinks, redraws, local crops or retouching.
White FASTPANEL and Canarytokens wordmarks receive CSS contrast backgrounds,
which do not alter image bytes. No active SVG restrictions were relaxed.

## Validation

24 unit tests passed, one existing coverage TODO. Logo generation/gap audit and
frontend TypeScript passed. All ten served image payloads matched their pinned
SHA-256 hashes; all ten public source notices loaded and included those hashes.
`git diff --check` passed. These checks validate implementation, not permission.
