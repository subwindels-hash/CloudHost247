# Legal text sources

Each `*.txt` file here is the reviewable, committed text of one policy (extracted once from the signed
PDFs in `docs/policies/` by `scripts/site/extract-legal-pdf.mjs`). `scripts/site/extract-legal.mjs`
turns them into the HTML the website renders.

## List markers

A line that starts with `- ` is a list item. Consecutive items become one `<ul>`. A short line
directly above a list (for example `Restoration Policy`) is rendered as a sub-heading.

Do not put bullet glyphs (U+F0B7 or any Private Use Area character) in these files. The repository
check `scripts/check-malformed-bullets.mjs` (run by `npm test` and by CI) fails the build if one is
found.

## Known limitations

* Numbered section headings that the PDF text ran into the preceding sentence (e.g.
  `… non-refundable. 4. Domain Name Refunds …`) are split onto their own line only where the
  section number is sequential. The heading title itself is not separated from its body, so such
  headings keep their body text on the same line. Re-typesetting these from the signed PDFs would
  give cleaner structure; that is a legal-review task, not a formatting one.
* `help-center.txt` numbers its steps inline (`1. Visit … 2. Click …`). These are kept as inline text.
* Item text was never reworded. The check that every edit preserved the wording is letters and
  digits only, in order (see the PR description).
