# Further original-logo search (no admissions)

This pass revisited Hostinger's application directory and Checkrr application
page, searched the web, and inspected current upstream repository trees. No
runtime artwork changed; coverage remains 1,080/1,092, with 12 unresolved.
This is not a completed batch of ten additions.

## Directly checked sources

- https://www.hostinger.com/applications
- https://www.hostinger.com/applications/checkrr — retrieved page provides product
  identity and marketing images, not a downloaded, verified original logo.
- linuxserver/budge: current tree has frontend/public/logo192.png, logo512.png,
  favicon.ico and frontend/src/logo.svg; these do not overturn the previous
  visual finding that the logos are React boilerplate.
- techno-tim/littlelink-server: current README explicitly says inspired by
  LittleLink, not that it adopts its logo. Tree contains social-provider icons;
  neither inspiration nor those third-party icons establish a project mark.
- h2non/imaginary: README has Docker/Fly badges; current tree search yielded no
  logo or favicon paths. No assertion that a logo cannot exist elsewhere.
- AsyncFuncAI/deepwiki-open: README now includes a Grok-Wiki image attachment:
  https://github.com/user-attachments/assets/1f569784-d1c8-479d-9a99-d3ef4ad3ec84
  Download followed a redirect to GitHub's S3 asset host and failed TLS. Image
  was not visually verified or installed. Current public SVG assets are file,
  globe, next, vercel and window; these are not project-specific logo evidence.
- NVIDIA/auto-ontology: tree includes generic UI icons and documentation
  screenshots. No new verified original logo admitted.
- LumePart/Explo: tree has Apple Music, ListenBrainz and Spotify marks and
  dashboard/login screenshots, not evidence those provider marks represent Explo.
- calesthio/Crucix: current image paths found are boot/dashboard/globe/map
  screenshots. No standalone original admitted; CSS recreation remains excluded.
- alseambusher/crontab-ui: tree search returned no logo/favicon/image paths.
- aetaric/checkrr: tree search found Idle/Running screenshots, not an adopted mark.
- openanalytics/shinyproxy: repository lookup succeeds; tree search yielded no
  new logo/favicon asset lead. Operator logos remain excluded.
- stan-smith/FossFLOW: repository API and tree lookup returned HTTP 404 in this
  pass. Previously saved research remains; this does not invalidate it.
- wg-easy/wg-easy: original logo PNG paths remain present; prior documented
  trademark-policy concern remains unresolved.

Web searches for FossFLOW, Crontab UI, Crucix, ShinyProxy and Explo yielded
third-party directories, operator artwork, screenshots or prior leads, not newly
verified project-original files. Third-party labels saying “logo” are not enough
on their own to establish the pictured artwork's identity.

No placeholder was disguised, no fake mark generated, no existing logo counted
as a new missing-entry addition. No runtime tests rerun for this documentation-only
pass.

## Broader internet follow-up

Expanded beyond repository asset names to image search, Docker Hub, app
packagers, documentation sites, historical source and upstream discussions.

New evidence:

- Explo issue https://github.com/LumePart/Explo/issues/240 explicitly requests
  an icon: “Also explo is missing an icon”. Confirmed OPEN with no comments via
  `gh issue view`; it is a user's report, not definitive proof no logo exists.
- Crucix PR https://github.com/calesthio/Crucix/pull/156 proposes **MFB Services
  Intelligence** branding, not an original Crucix identity. Confirmed CLOSED,
  `mergedAt: null`. Do not import these fork/customer marks.
- Budge packaging metadata explicitly has `project_logo: ""`:
  https://github.com/linuxserver/docker-budge/blob/a44b26aec686b12dad86b46a689d029c18f03354/readme-vars.yml
  No Budge-specific logo path found in linuxserver/docker-templates.
- https://hub.docker.com/r/h2non/imaginary/ labels a Gravatar URL “imaginary logo”.
  That label alone does not establish a distinct project mark rather than the
  publisher avatar. Historical helm/charts PR 6818 also records inability to
  find an official icon; neither source proves permanent absence.
- https://www.myqnap.org/product/fossflow-apache84/ supplies an image named
  fossflow-logo.png. Downloaded via image search and visually inspected: it is
  an infrastructure diagram, not a standalone logo. Reddit image-search result
  for FossFLOW likewise is a homelab diagram. Not admitted.
- https://www.shinyproxy.io/ supplies app screenshots; inspected slide1 shows
  configured navbar branding and Streamlit/Shiny/Dash demo application marks,
  not a standalone ShinyProxy artwork file.
- https://technotim.com/posts/open-source-linktree-alt/ and the historical
  littlelink-server README at 51a31aab670e80537364f86c284338798344f185 distinguish
  inspiration from LittleLink and user-configured profile/favicon images.
  Do not treat the author's profile photo as a product logo.
- DeepWiki docs https://asyncfunc.mintlify.app/getting-started/introduction
  use https://asyncfunc.ai/favicon.png as a documentation header logo. This is
  an organization-mark lead, not yet verified as the project's original logo.
  https://grok-wiki.com describes the newer desktop project. Do not silently
  substitute a different product's artwork for the self-hosted catalogue item.
- Auto Ontology favicon at revision c96048c4aefd7a9355647fec2c2518b1d436a536 is
  the NVIDIA eye symbol, not a newly discovered unique application mark.

Also searched walkxcode/dashboard-icons, selfhst/icons and
PapirusDevelopmentTeam/papirus-icon-theme. Similar-name hits included
LittleLink Custom, Crontab Guru and unrelated budgeting apps; none establishes
identity for these unresolved entries. Crontab UI image results were dashboard
screenshots, including the upstream gh-pages screenshot. Broader search is not
an exhaustive search of the entire internet, and no such claim is made.

No newly verified artwork installed. Coverage and runtime unchanged.
