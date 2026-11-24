# Ten original-logo additions

**Ten previously missing entries added.** No already-covered trace migrations.
Files are unchanged PNG/WebP bytes from pinned upstream Git blobs. All ten were
visually reviewed; their notices are retained in docs and publicly served next
to the images, linked directly from each logo.

| Slug | Repository revision | Original file | Retained terms |
| --- | --- | --- | --- |
| `nango` | `NangoHQ/nango@970f9e6715806ff96e7096b12afc86dce22827f6` | `assets/nango-logo.png` | Elastic-2.0 |
| `redpanda-console` | `redpanda-data/console@027d9212f9325c066654dd6f78c6d41796bbb9da` | `frontend/public/favicon-32.png` | BSL-1.1 (Redpanda additional use grant) |
| `spacetimedb` | `clockworklabs/SpacetimeDB@c31d45503681c5426207f3630da5ac3320324816` | `codex-plugin/plugins/spacetimedb/assets/logo.png` | Apache-2.0 (official Codex plugin artwork) |
| `koffan` | `PanSalut/Koffan@b5eefc90743d1a478bfad8b4be7740912e3995f7` | `static/koffan-logo.webp` | MIT with Commons Clause |
| `jobops` | `DaKheera47/job-ops@46fb785f7e43cc8009781239c5aa560166fcb858` | `orchestrator/public/favicon.png` | AGPL-3.0 (historical release before Commons Clause) |
| `evolution-api` | `EvolutionAPI/evolution-api@182c255ae351ff31043d7d6b872799b809338c42` | `public/images/evolution-logo.png` | Apache-2.0 with Evolution additional conditions |
| `evolution-go` | `evolution-foundation/evolution-go@80d7c72c0727e091425d10f5654b7ccf07e01abe` | `public/images/evolution-logo.png` | Apache-2.0 with Evolution additional conditions |
| `open-source-pos` | `opensourcepos/opensourcepos@8cf7cd43466d7d60168b02be7579707d495b9eff` | `public/images/logo.png` | MIT with attribution/footer conditions |
| `yacy` | `yacy/yacy_search_server@eba3f94b4376180de5fbf3812c41e3c65dad4cfb` | `htroot/env/grafics/YaCyLogo_60ppi.png` | GPL-2.0-or-later |
| `asp-net` | `dotnet/brand@91845f6ddf2123b3bb1bfd1b6a386d9ce02b43aa` | `logo/dotnet-logo.png` | .NET brand guidelines (not CC0) |

## Identity and licence scope

- **JobOps:** pinned the last commit before the Commons Clause addition,
  `46fb785f7e43cc8009781239c5aa560166fcb858`, where the favicon and AGPL licence
  coexist. Do not describe current JobOps software as unrestricted AGPL.
- **SpacetimeDB:** the official Codex plugin's own LICENSE is Apache-2.0;
  its plugin.json explicitly selects this assets/logo.png and names Clockwork
  Labs. The unrelated BSL server licence does not override that specific
  directory's published licence. This is the official companion branding.
- **YaCy:** uses the actual server repository, not its separately licensed
  homepage. COPYRIGHT explicitly assigns all non-cora files to GPL-2.0-or-later.
  defaults/yacy.init and RSS templates select the supplied YaCy logo.
- **ASP.NET:** uses the shared .NET primary mark, not invented ASP.NET letters.
  Microsoft's ASP.NET page identifies ASP.NET as extending .NET and publishes
  the .NET square as its page image. dotnet/brand README permits the logo for
  related .NET content under the brand guidelines (the logo is **not CC0**).
  Reviewed the actual PDF; rendered mark is at least 50px with 16px clear space.
- **Evolution API / Evolution Go:** both official repositories distribute this
  exact shared Evolution mark; its transparent holes were visually checked.
  Their modified Apache terms and explicit usage notices are retained and
  accessible from the logo. No frontend logo/copyright was removed and no
  software deployment is enabled by this change.
- **Nango:** official README selects assets/nango-logo.png. Retain ELv2,
  including its ban on exposing substantial software functionality as a hosted
  service. This change distributes only the identifying artwork, not those
  features; it must not be cited as managed-service permission.
- **Koffan:** README and application templates select the exact supplied WebP.
  Retain MIT plus Commons Clause, including its hosting/sales restrictions.
  An identifying catalogue image is not a hosted copy of Koffan's functional
  application. Commercial deployment remains a separate review requirement.
- **Redpanda Console:** frontend/public/index.html selects favicon-32.png.
  Retain the licence to which Console's licenses/README.md directs users,
  pinned separately in the manifest. Do not treat the catalogue image as a
  grant to offer a streaming or queuing service; no such functionality is
  provided by this image. The native 32px original was not sharpened/upscaled
  in the stored file.
- **Open Source POS:** uses public/images/logo.png from the project's own
  branding, preserving its OSPOS lettering. Retain the full MIT-plus-footer
  conditions. No application footer or copyright text was removed. Distribution
  or operation of the application itself must preserve all required signatures.

## Scope limitations

This is an artwork-only catalogue change, not legal advice or a determination
that commercial hosting of these products is permitted. No restrictive terms
were erased or described as standard permissive licences. Display remains
referential, with no claim of affiliation or endorsement. Existing deployment
and commercial-licensing questions are not resolved by logo coverage counts.

## Validation

Logo audit: 940 generated, 1,020 total sourced, 71 gaps. Unit tests: 17 passed,
1 existing coverage TODO. Frontend TypeScript passed after narrowing noticeUrl
to a string. All ten file SHA-1 Git blobs matched upstream metadata; SHA-256
checks passed. All ten images and ten linked notices returned HTTP 200 on the
local preview. No claim of full-catalogue coverage is made.
