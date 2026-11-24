# Ten web/repository logo additions

Ten previously missing entries; no existing-logo replacements counted.

| Slug | Source/pin | Format | Terms / limitations |
| --- | --- | --- | --- |
| `clustercontrol` | official-website: https://docs.severalnines.com/clustercontrol/latest/getting-started/ | PNG | Artwork reuse review open |
| `kusanagi` | official-website: https://kusanagi.tokyo/character/ | PNG | Artwork reuse review open |
| `manticore-search` | official-website: https://manticoresearch.com/about/ | PNG | Artwork reuse review open |
| `letta` | official-website: https://letta.com/blog/announcing-letta | WEBP | Artwork reuse review open |
| `tinycp` | third-party-listing: https://sourceforge.net/software/product/TinyCP/ | PNG | Artwork reuse review open |
| `r2r` | official-website: https://r2r-docs.sciphi.ai/self-hosting/configuration/retrieval/overview | PNG | Artwork reuse review open |
| `apache-jspwiki` | `apache/jspwiki@d86cfde5c058a65451a4f9aba8606380a721934c` | PNG | Apache-2.0 plus ASF mark policy |
| `drizzle-gateway` | `drizzle-team/gateway-website@d34e3c56bc64b921341ff619d74ce9dc7b9bcc7c` | ICO | Separate artwork licence not established |
| `euro-office-documentserver` | `Euro-Office/documentation@cab9d09a158f18abf5b23e9233845c9a5ed55079` | SVG | Separate artwork licence not established |
| `perplexica` | `ItzCrazyKns/Perplexica@295334b19502e942339fdde7e343e8bf9e6ed1a1` | PNG | MIT (historical Perplexica v1.11.2) |

## Visual and identity review

- Apache JSPWiki: rejected the generic ASF feather and two-state sprite. The
  selected upstream jspwiki_logo_s.png is a single 64×64 project emblem, also
  used by its portable distribution. Link it to the official project under
  the ASF mark policy; retain Apache licence and NOTICE.
- Drizzle Gateway: found the actual gateway-website repository. Its own
  favicon is the green slashed mark, so no assumption from ORM artwork is needed.
- Euro-Office: official docs mkdocs.yml selects the authored E logo by default.
  This is not a letter invented by CloudHost247; the unmodified SVG is retained.
- Perplexica: v1.11.2 still names Perplexica and contains public/icon.png at the
  same revision. The new pin resolves the previous generic triangle/current
  Vane identity dead ends without silently substituting the renamed product.
- ClusterControl: original wordmark selected from official documentation.
- KUSANAGI: original publisher-hosted wordmark linked from its product site.
- Manticore Search: original logo from its official About page. The publisher
  already supplies a resized web asset; no local image processing was done.
- Letta: official announcement artwork bearing the complete logo, with its
  original blue background. This is a branded banner, not an isolated icon.
- TinyCP: wordmark retrieved from its SourceForge software listing. The official
  product site confirms the panel identity; no first-party byte provenance or
  native design-file claim is made for this directory capture.
- R2R: the official documentation logo visibly reads R2R despite the source
  filename sciphi_black.svg. Retrieved PNG is a rendering of that source SVG,
  not byte-identical to the SVG. Dark CSS ground preserves white lettering.

## Provenance and rights

All local files are hash-pinned. Four have independently verified Git blob
hashes. Six captures have source pages and local hashes only; no publisher
checksum or Git revision is fabricated. No local drawing, tracing, retouching
or cropping was performed. Their notices explicitly distinguish captured
representations from upstream design files.

The eight uncertain artwork reuse grants remain rightsReview fields and
publicly linked notices. This does not authorise commercial hosting or imply
endorsement. No protected marks with explicit unresolved permission demands
(such as Svix, Plone or WireGuard) were added to fill the batch.

FASTPANEL stays pending: retrieved candidates were a generic monitor graphic,
a promotional free-plan badge, or a hosting-provider-branded screenshot.
Codex screenshots and an unadopted Euro-Office logo proposal were rejected.

## Validation

22 unit tests passed, with one existing coverage TODO. Logo/hash audit and
frontend TypeScript passed. All ten served image payloads matched their local
SHA-256 pins, and all ten linked/public notices loaded with the corresponding
image hash. Four upstream Git blob hashes were checked before installation.
