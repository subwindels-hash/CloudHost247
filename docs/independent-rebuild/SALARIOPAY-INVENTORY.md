# SalarioPay reference inventory and how this repository answers it

The brief asks for the twenty-one SalarioPay tools and warns against trusting a category total.
This document records what the reference site actually publishes, where that was read from, and
which CloudHost247 tool answers each entry.

## Where the list came from

`https://www.salariopay.com/sitemap.xml`, fetched and parsed. The `/tools/*` URLs it lists are the
authoritative interactive inventory, and they divide as the site's own tabs claim — 5 calculators,
12 generators, 4 comparisons (plus 28 guide pages and the non-tool `/comparisons/*`, `/integration/*`,
`/product/*` and `/webinar/*` sections, which are not tools).

The site's `/tools` index page displays "Showing 1 - 6 of 49 tools" with tabs **All 49 /
Calculators 5 / Generators 12 / Comparisons 4 / Guides 28** — so the "49" counts guides alongside
tools, and the tool count is 21. The sitemap agrees.

## The twenty-one, and the CloudHost247 tool that answers each

| Reference tool (URL slug) | CloudHost247 tool | CloudHost247 slug | Category |
|---|---|---|---|
| `paye-tax-calculator` | PAYE & Net Salary Calculator | `nigeria-paye-net-salary-calculator` | calculators |
| `pension-calculator` | Pension Calculator | `nigeria-pension-calculator` | calculators |
| `vat-calculator` | VAT Calculator | `nigeria-vat-calculator` | calculators |
| `employer-cost-calculator` | Employer Cost Calculator | `nigeria-employer-cost-calculator` | calculators |
| `ewa-roi-calculator` | EWA ROI Calculator | `earned-wage-access-roi-calculator` | calculators |
| `job-description-generator` | Job Description Generator | `job-description-generator` | generators |
| `job-offer-letter-generator` | Job Offer Letter Generator | `job-offer-letter-generator` | generators |
| `official-payslip-generator` | Official Payslip Generator | `official-payslip-generator` | generators |
| `nda-contract-generator` | NDA Contract Generator | `nda-contract-generator` | generators |
| `employment-contract-generator` | Employment Contract Generator | `employment-contract-generator` | generators |
| `cv-generator` | CV Generator | `cv-generator` | generators |
| `free-business-invoice-generator` | Business Invoice Generator | `business-invoice-generator` | generators |
| `business-card-generator` | Business Card Generator | `business-card-generator` | generators |
| `free-employee-id-generator` | Employee ID Generator | `employee-id-generator` | generators |
| `free-employee-id-card-generator` | Employee ID Card Generator | `employee-id-card-generator` | generators |
| `free-organizational-chart-generator` | Organizational Chart Generator | `organizational-chart-generator` | generators |
| `linkedin-engagement-assistant` | LinkedIn Engagement Assistant | `linkedin-engagement-assistant` | generators |
| `accounting-tool-comparison` | Accounting Tool Comparison | `accounting-tool-comparison` | comparisons |
| `expense-tool-comparison` | Expense Tool Comparison | `expense-tool-comparison` | comparisons |
| `hmo-comparison-nigeria` | HMO Comparison (Nigeria) | `hmo-comparison-nigeria` | comparisons |
| `pfa-comparison-nigeria` | PFA Comparison (Nigeria) | `pfa-comparison-nigeria` | comparisons |

The CloudHost247 slugs deliberately differ for three of them: `nigeria-paye-net-salary-calculator`,
`earned-wage-access-roi-calculator` and `employee-id-card-generator` say what the tool is for a
CloudHost247 audience rather than mirroring another company's URL. Nothing links to the reference
site, and no reference-site copy, artwork or asset is used anywhere in this repository; the
published pages were read as a specification only, which is why this document records behaviour and
geometry rather than text.

## What the reference page told us about the ID card generator

Fetched from `https://www.salariopay.com/tools/free-employee-id-card-generator` (the page exposes its
template SVGs inline, and those give real design facts):

- twelve professional templates, a live front/back preview at "Standard ID-1 card ratio", and
  high-resolution PDF/PNG/JPG download;
- QR **and** Code 128 on the card, both optional;
- photo upload plus company branding (name, address, website, logo);
- "No signup required" and a local-storage statement: card details and uploaded images stay in the
  browser;
- names of two templates that informed geometry: *Corporate Split* (left brand panel, right detail
  column) and *Modern Badge* (1012 × 638 px, an 18 px `#18BF63` top stripe, a 40 px name, a 176 × 176
  QR tile).

Each of those facts is a checked requirement in this repository, and each has a test:
[the ID-card audit](EMPLOYEE-ID-CARD-GENERATOR.md) lists them in §3 and §9.

## What the reference *does not* provide, and what this repository does instead

The brief is explicit that the reference sites are functional specifications, not sources of truth
for correctness. Three places where CloudHost247 deliberately departs:

| Area | Reference behaviour | CloudHost247 behaviour |
|---|---|---|
| Tax and pension figures | Calculator defaults, no dated statutory table | Statutory inputs carry the applicable Nigerian rule, its effective date and a jurisdiction note; user assumptions are kept separate from statutory rates |
| Verification language | A QR is offered for the card | The tool states that a QR containing a URL is a link, that CloudHost247 hosts and operates no verification service, and that a plain-text payload verifies nothing |
| ROI modelling | An ROI figure is produced | At a ₦0 programme cost the ROI is reported as **not computable**, because dividing by zero is undefined rather than infinite; adoption and evaluation period are explicit inputs and the payback period is reported in months |

## Re-checking this inventory

```bash
curl -s https://www.salariopay.com/sitemap.xml | grep -o '<loc>https://www.salariopay.com/tools/[^<]*' | sort -u
cd cloudhost247-node && npx tsx -e "import('./src/tools/business').then(m => console.log(m.BUSINESS_TOOLS.length, m.BUSINESS_TOOL_COUNTS))"
npx vitest run tests/unit/business-tools-engines.test.ts    # the inventory assertions live at the top
```

If the reference site adds a tool, this table is what needs updating — and the count assertion in
`business-tools-engines.test.ts` is what will fail if a CloudHost247 tool is moved between categories
without anyone noticing.
