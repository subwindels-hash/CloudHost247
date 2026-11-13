# File Tools media notices

CloudHost247 File Tools runs media conversion in the visitor's browser. The media implementations are bundled from these pinned dependencies:

- `mediabunny` 1.65.2 — Mozilla Public License 2.0 (MPL-2.0). Package license: `node_modules/mediabunny/LICENSE`. Source: <https://github.com/Vanilagy/mediabunny>.
- `@mediabunny/mp3-encoder` 1.65.2 — MPL-2.0 wrapper that bundles an unmodified WebAssembly build of LAME 3.100. LAME is licensed under GNU LGPL v2 or later; package notices are in `node_modules/@mediabunny/mp3-encoder/licenses/lame/`. LAME asks users to acknowledge its use and link to <https://www.mp3dev.org/>. Source/build details: <https://github.com/Vanilagy/mediabunny/tree/main/packages/mp3-encoder>.
- `@mediabunny/flac-encoder` 1.65.2 — MPL-2.0 wrapper that uses libFLAC. The bundled libFLAC notice is the Xiph.Org BSD-style license at `node_modules/@mediabunny/flac-encoder/licenses/libflac/COPYING.Xiph`; its copyright, conditions, and disclaimer apply. Source: <https://github.com/Vanilagy/mediabunny/tree/main/packages/flac-encoder>.

The File Tools audio UI acknowledges LAME and links to its project and license information. CloudHost247 does not modify these dependencies. Media bytes are read from the selected local file and are not sent to a CloudHost247 server.

## Release checklist — still requires review

The Vite build bundles dependency code into browser assets; the standalone npm license files are not automatically assumed to be present in the deployed asset directory. Before distributing or shipping the production bundle, verify the applicable MPL notices/source obligations, the LGPL obligations for the LAME WebAssembly component (including how recipients can replace or relink it, if required), and the libFLAC notice requirements. Ensure the required notices and source/relink information accompany the actual distribution. This engineering note records the package metadata and notices inspected; it is not a legal determination or release approval. Obtain the appropriate licensing review before shipping.
