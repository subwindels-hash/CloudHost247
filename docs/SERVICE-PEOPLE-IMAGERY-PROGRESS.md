# People-focused service imagery rollout

User requested unique people-focused imagery across all service landing pages, with people sending email on SMTP and Email Hosting.

## First batch completed (six pages)

- `/smtp-hosting`: developer sending an email at a desktop monitor
- `/hosting/email`: business owner composing/sending email on a laptop
- `/hosting`: consultant at desktop beside server equipment
- `/hosting/web-hosting`: designer at a website-editor monitor
- `/hosting/vps`: engineer at dual monitors beside a server cabinet
- `/hosting/dedicated`: engineer with laptop beside dedicated server rack

Each has a unique AI-generated image, responsive AVIF/WebP files, descriptive alt text and full-frame layout with cards below rather than obscuring people or monitors. Image/variant hashes are in the public hosting-email-sources.json notice bundle. These are fictional scenes, not actual facilities or customers.

Number Services and SMM people scenes were completed earlier on this branch; Google Workspace and Microsoft 365 already have people imagery. Existing pricing and order logic is unchanged.

## Second batch completed (eight pages)

- `/cloud`: Two cloud specialists reviewing a diagram on a desktop monitor beside a server rack
- `/cloud/public`: An engineer using a laptop and large cloud resource monitor near server racks
- `/cloud/private`: A systems specialist using a laptop beside an enclosed private server cabinet
- `/cloud/enterprise-servers`: Two engineers reviewing a workstation monitor beside enterprise server racks
- `/cloud/game-servers`: A game developer at dual monitors showing a game and server panels beside a computer tower
- `/cloud/infrastructure`: An engineer checking a tablet beside networking racks and a topology monitor
- `/cloud/data-centers`: A technician using a laptop on a cart beside an open rack in a data center aisle
- `/cloud/network`: A network engineer at a desktop monitor beside switches and organized network cables

Each image is distinct, AI-generated and illustrative; responsive asset hashes are recorded in `cloud-infrastructure-sources.json`. No image is a real facility or customer claim.

## Third batch completed (eight pages)

- `/cloud/operating-systems`: A systems administrator at an operating system settings monitor beside a server tower
- `/cloud/server-management`: A server administrator using a laptop beside an open server rack
- `/cloud/monitoring`: An operations analyst reviewing resource charts on dual monitors beside a server rack
- `/cloud/backups`: A backup administrator at a file scheduling monitor beside a storage array
- `/cloud/firewall`: A network specialist reviewing firewall rules at a monitor beside a network appliance
- `/cloud/security`: A security analyst at an audit monitor beside glass-front server equipment
- `/cloud/ip-management`: A network administrator reviewing address allocation on a monitor beside network switches
- `/cloud/managed-services`: Two support professionals reviewing a service ticket monitor beside a server cabinet

Distinct AI-generated illustrations with responsive assets recorded in `cloud-operations-sources.json`. Pricing, order flows and original brand logos remain unchanged.

## Fourth batch completed (eight pages)

- `/developers`: Two developers reviewing code on a desktop monitor beside a computer tower
- `/developers/deployment`: A release engineer using a laptop beside a deployment pipeline monitor and server rack
- `/developers/environments`: An engineer using dual monitors with code and application previews beside a workstation tower
- `/developers/nodejs`: A developer at a code editor monitor with a laptop and computer tower
- `/developers/php`: A web developer at a monitor showing code and a web application preview
- `/developers/python`: A developer reviewing code and data visualizations on a monitor beside a computer tower
- `/developers/laravel`: A web developer at a code and dashboard monitor beside a laptop and computer tower
- `/developers/docker`: A DevOps engineer at dual monitors showing a container diagram and terminal beside a server cabinet

Each image is unique and AI-generated, with responsive AVIF/WebP variants and descriptive alt text. File hashes are recorded in `developer-sources.json`. Original brand logos, pricing and order flows are unchanged.

## Fifth batch completed (ten pages)

- `/hosting/business`: A business owner reviewing an online shop on a desktop monitor beside a laptop and computer tower
- `/hosting/wordpress`: A content creator at a blog editor monitor beside a computer tower
- `/hosting/reseller`: Two agency professionals reviewing client websites on a monitor beside a server cabinet
- `/hosting/windows`: A systems administrator at a server configuration monitor beside server equipment
- `/hosting/developer`: A developer using a laptop beside a code and website preview monitor
- `/hosting/api`: An engineer at a request and response monitor beside a laptop and server tower
- `/hosting/ssl`: A website administrator reviewing certificate settings on a desktop monitor
- `/hosting/backups`: An administrator at a backup scheduling monitor beside a storage array
- `/hosting/migration`: An engineer at dual monitors showing source and destination website files
- `/hosting/security`: A security engineer at a website audit monitor beside a server rack

Unique AI-generated illustrations, responsive AVIF/WebP variants, descriptive alt text and full-frame people layouts. Hashes: `hosting-specialties-sources.json`. Original logos, pricing and order flows unchanged.

## Sixth batch completed (ten pages)

- `/platforms`: A platform engineer at an application monitor beside a server cabinet
- `/platforms/applications`: A developer reviewing an application catalog on a desktop monitor beside a laptop
- `/platforms/databases`: A database administrator reviewing tables and schema on a monitor beside a storage server
- `/platforms/containers`: An engineer at dual monitors showing container resources and a terminal beside a server rack
- `/platforms/paas`: Two engineers reviewing an application deployment dashboard on a desktop monitor
- `/hosting/cpanel`: A website administrator reviewing hosting controls on a monitor beside a computer tower
- `/websites`: A web designer reviewing a website layout on a desktop monitor beside a laptop
- `/hosting/rdp`: A remote worker using a desktop monitor with application windows beside a laptop
- `/digital-products`: A creative professional reviewing digital templates on a monitor beside a graphics tablet
- `/proxy-services`: A network engineer reviewing a routing diagram on a monitor beside a network appliance

Unique AI-generated illustrations, responsive AVIF/WebP files and descriptive alt text. Hashes: `platform-services-sources.json`. Original logos, pricing and order flows unchanged.

## Rollout complete

Domains now has a unique AI-generated entrepreneur at a domain-search monitor.
Its six responsive variants are recorded in `domain-sources.json`. No pages
remain pending in the 55-page service hero scope.

Business Hosting's revised male shop-owner image now uses fresh
`business-hosting-shop-v2` URLs for all six variants to prevent stale cached
images. Existing revised image content is retained; the earlier URL is no
longer referenced. Original logos, pricing and order flows remain unchanged.

Validation for the first batch: 73 focused storefront/image tests and frontend TypeScript passed. Earlier run also passed all 341 marketing-page tests. Uniqueness checks still cover 55 hero images. Browser screenshot verification has not been performed in this batch.

Second-batch validation: 423 tests passed across storefront, service hero and
marketing page suites. Frontend TypeScript and diff whitespace checks passed.
All eight new fallback images returned HTTP 200 through the running preview.
Full browser screenshot verification was not performed.

Third-batch validation: 432 tests passed across storefront, service hero and
marketing suites. Frontend TypeScript and diff whitespace checks passed.
All eight new WebP fallback images returned HTTP 200 through the live preview.
Generated source images were visually reviewed; browser screenshots were not
verified. Unique-image checks continue to cover all 55 service hero assignments.

Fourth-batch validation: 441 tests passed across storefront, service hero and
marketing suites. Frontend TypeScript and diff whitespace checks passed.
All eight new WebP fallback images returned HTTP 200 through the live preview.
Generated images were visually reviewed; browser screenshots were not verified.
Unique-image checks continue to cover all 55 service hero assignments.

Fifth-batch validation: 452 tests passed across storefront, service hero and
marketing suites. Frontend TypeScript and diff whitespace checks passed.
All ten new WebP fallback images returned HTTP 200 through the live preview.
Generated images were visually reviewed; browser screenshots were not verified.
Unique-image checks continue to cover all 55 service hero assignments.

Sixth-batch validation: 467 tests passed across storefront, service hero, marketing and domain interaction suites. Frontend TypeScript and diff whitespace checks passed. All ten new fallback images returned HTTP 200 in the preview. Generated images were visually reviewed; browser screenshots were not verified. All 55 hero assignments remain unique. Only Domains awaits replacement, after the ten-image generation limit blocked its requested image.

Final validation: 470 tests passed across storefront, hero, marketing and domain
interaction suites. Frontend TypeScript and diff checks passed. All 318 responsive
hero URLs across the 53 shared component assignments returned HTTP 200 with image
content types. Uniqueness checks include the two dedicated productivity pages
for 55 total heroes. Generated Domains image was visually reviewed; full browser
screenshots remain unverified.
