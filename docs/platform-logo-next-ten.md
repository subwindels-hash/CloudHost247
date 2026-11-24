# Next ten visually covered catalogue entries

Eight individual marks plus two approved component groups; all were previously
missing. This count describes image coverage, **not universal rights clearance**.

| Slug | Repository revision | Original file | Retained terms |
| --- | --- | --- | --- |
| `aapanel` | `aaPanel/aaPanel@38bf35903b37b50d9654f47c4ad904ca3369715f` | `BTPanel/static/icons/menu_logo.png` | aaPanel custom licence; source sections 4.1–4.3 |
| `multica` | `multica-ai/multica@6368504e1181a0365013ca5796ec453bf9535f11` | `apps/web/public/icons/icon-512.png` | Multica License (Apache-2.0 plus additional conditions) |
| `nopcommerce` | `nopSolutions/nopCommerce@9cdf7a5fc7e941e2a6100ded2e85b6f47f5b1d26` | `src/Presentation/Nop.Web/wwwroot/css/admin/images/logo.png` | nopCommerce Public License; retain additional conditions |
| `fmd-find-my-device` | `selfhst/icons@8d96200b728b377b2d3bb361e8fdc4daa1541f60` | `png/fmd.png` | selfh.st collection CC-BY-4.0; third-party marks retained |
| `foundry-vtt` | `selfhst/icons@8d96200b728b377b2d3bb361e8fdc4daa1541f60` | `png/foundry-virtual-tabletop.png` | selfh.st collection CC-BY-4.0; Foundry brand rights retained |
| `sharkey` | `selfhst/icons@8d96200b728b377b2d3bb361e8fdc4daa1541f60` | `png/sharkey.png` | selfh.st collection CC-BY-4.0; third-party marks retained |
| `mcp-server` | `modelcontextprotocol/modelcontextprotocol@b0be8f0f2481be8d5ea5294cf3fa57cd03cedc48` | `docs/logo/dark.png` | Upstream mixed Apache-2.0/MIT/CC-BY-4.0 transition; see notice |
| `ant-media-server-ce` | `ant-media/ant-media-documentation@545241adf3726b06fd0eef5dbd86d37d370e676e` | `static/img/Ant-Media-Logo-light.png` | Copyright Ant Media; separate artwork licence not established |

## Identity checks and limits

- aaPanel: the original menu_logo PNG exactly matches the dashboard-icons copy,
  byte for byte. We pinned the actual aaPanel source rather than relying on
  that mirror. Rejected BT.cn's related but differently branded wordmark.
  The aaPanel source licence expressly discusses website publishing and
  unmodified integration in sections 4.1–4.3; those terms are retained.
- Sharkey: rejected an old fork's inherited Misskey “Mi” icon. The selected
  selfh.st entry is explicitly named Sharkey and supplies the shark-hood mascot.
- FMD / Foundry VTT: the collection identifies the exact projects. These are
  unchanged raster files, not a traced vector or generated replacement. Retain
  collection attribution to selfh.st and CC BY 4.0, without implying that its
  collection licence removes third-party trademark or hosting restrictions.
- Multica: official web-app PWA artwork; full custom licence retained. This
  change does not operate or redistribute its application UI or waive its
  commercial-service and attribution conditions.
- nopCommerce: official admin wordmark, not a plugin provider logo. Full NPL
  and additional conditions retained. No application copyright/footer was
  removed; this does not grant a commercial hosting or software licence.
- MCP Server: official **protocol** wordmark, not a claim of a unique logo for
  a particular MCP server implementation. The upstream licensing transition
  notice is preserved rather than relabelled as unconditionally MIT.
- Ant Media Server CE: exact wordmark from official documentation, with a dark
  CSS ground for white lettering. **A separate artwork licence was not found**.
  Attribution/source are retained; the manifest has an explicit rightsReview
  field and the public notice states that no blanket reuse grant is asserted.
  Wider promotional reuse and trademark clearance remain review items.
- MEAN / MEVN: MongoDB + Express + AngularJS or Vue.js + Node.js, separately
  labelled; AngularJS from pinned Devicon, Vue.js from pinned SVG Logos.
  No vendor-supplied composite logo is claimed.

Pins, Git blobs and SHA-256 values are in the original/bundle manifests.
Every new image is linked to its publicly served source/licence notice.

## Validation

19 unit tests passed, with one existing coverage TODO. Logo/hash audit and
frontend TypeScript passed. Eight original PNG Git blobs were checked against
upstream metadata before installation. New AngularJS and Vue component vectors
were visually reviewed. All 19 new image/notice URLs returned HTTP 200 on the
preview. The previous negative aaPanel test was updated only after the genuine
aaPanel source file was pinned; other unresolved-mark checks remain intact.
