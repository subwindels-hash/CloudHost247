#!/usr/bin/env node
/**
 * Regenerate the code-rendered catalogue logos from pinned, attributed vector sources.
 *
 * Usage: npm run logos:generate (requires authenticated `gh` and npm when the .cache
 * folder is empty); npm run logos:check (compare generated code without writing).
 * The static SPA imports only the generated TSX, never source SVG files or a logo CDN.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from '@svgr/core';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repository = path.resolve(project, '..');
const cache = path.join(repository, '.cache', 'platform-logo-sources');
const output = path.join(project, 'frontend/src/data/generated-platform-icons');
const manifest = JSON.parse(readFileSync(path.join(project, 'frontend/src/data/platform-logo-sources.json'), 'utf8'));
const checking = process.argv.includes('--check');
const SHA = (data) => createHash('sha256').update(data).digest('hex');
const validId = /^[a-z0-9][a-z0-9-]*$/;
const validAsset = /^[a-z0-9][a-z0-9-]*(?:\/[a-z0-9][a-z0-9-]*)?$/;

function githubSource(collection, asset, ref) {
  const meta = manifest.collections[collection];
  // A logo in a product's OWN repository is stronger evidence of identity than
  // a name match in a community icon collection. Pin each upstream separately.
  const repositoryName = ref.repository ?? meta.repository;
  const revision = ref.revision ?? meta.revision;
  const file = ref.file ?? `${meta.folder}/${asset}.svg`;
  const reviewedJsx = ref.sourceProfile === 'morphic-static-jsx' &&
    repositoryName === 'miurla/morphic' && file === 'components/ui/animated-logo.tsx';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repositoryName) || !/^[a-f0-9]{40}$/.test(revision) ||
      (!/^[\w. -]+(?:\/[\w. -]+)*\.svg$/.test(file) && !reviewedJsx) || file.includes('..')) {
    throw new Error(`Invalid pinned GitHub source for ${collection}:${asset}`);
  }
  const [owner, repo] = repositoryName.split('/');
  return { owner, repo, revision, file };
}

function iconifySource(collection, asset, dataset) {
  const icon = dataset.icons[asset];
  if (!icon) throw new Error(`Missing ${collection}:${asset} in pinned Iconify package`);
  const width = icon.width ?? dataset.width ?? dataset.height ?? 24;
  const height = icon.height ?? dataset.height ?? width;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${icon.left ?? 0} ${icon.top ?? 0} ${width} ${height}">${icon.body}</svg>`;
}

function getIconifyData(collection) {
  const meta = manifest.collections[collection];
  const alreadyCached = path.join(repository, '.cache', `iconify-${collection}`, 'package', 'icons.json');
  if (existsSync(alreadyCached)) return JSON.parse(readFileSync(alreadyCached, 'utf8'));

  const temp = mkdtempSync(path.join(os.tmpdir(), 'platform-iconify-'));
  try {
    const filename = execFileSync('npm', ['pack', `${meta.package}@${meta.version}`, '--silent', '--pack-destination', temp], { cwd: project, encoding: 'utf8' }).trim().split('\n').at(-1);
    execFileSync('tar', ['-xzf', path.join(temp, filename), '-C', temp, 'package/icons.json']);
    return JSON.parse(readFileSync(path.join(temp, 'package/icons.json'), 'utf8'));
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function tracePinnedPngs(icons) {
  const version = execFileSync('python3', ['-c', 'import importlib.metadata; print(importlib.metadata.version("vtracer"))'], {
    cwd: project, encoding: 'utf8',
    env: { ...process.env, PYTHONPATH: [path.join(repository, '.cache/py-libs'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
  }).trim();
  if (version !== '0.6.15') throw new Error(`Pinned VTracer 0.6.15 is required to rebuild raster-derived SVG paths (found ${version})`);

  const temp = mkdtempSync(path.join(os.tmpdir(), 'platform-png-trace-'));
  try {
    for (const [slug] of icons) {
      const ref = manifest.icons[slug];
      const meta = manifest.collections[ref.source];
      const originRepo = ref.repository ?? meta.repository;
      const revision = ref.revision ?? meta.revision;
      const file = ref.file ?? `${meta.folder}/${ref.icon}.png`;
      const isIco = ref.source === 'official-ico';
      if (isIco && (ref.icoSize !== 128 || ref.traceProfile !== 'light-ground-upscaled' || !file.endsWith('.ico'))) {
        throw new Error(`${slug}: ICO source requires the reviewed 128px light-ground-upscaled frame`);
      }
      if (!isIco && !file.endsWith('.png')) throw new Error(`${slug}: PNG source requires a PNG file`);
      if (!/^[\w.-]+\/[\w.-]+$/.test(originRepo) || !/^[a-f0-9]{40}$/.test(revision) ||
          !/^[\w.@-]+(?:\/[\w.@-]+)*\.(?:png|ico)$/.test(file) || file.includes('..') ||
          !/^[a-f0-9]{40}$/.test(ref.originGitSha)) {
        throw new Error(`${slug}: invalid pinned raster git object, revision or path`);
      }
      // Prove that the pinned raster object really occupies this named file in this
      // project's immutable revision, not just that its bytes exist on GitHub.
      const [owner, repo] = originRepo.split('/');
      const query = `query { repository(owner: "${owner}", name: "${repo}") { source: object(expression: "${revision}:${file}") { oid } } }`;
      const tree = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { cwd: project, encoding: 'utf8' }));
      if (tree.errors || tree.data?.repository?.source?.oid !== ref.originGitSha) {
        throw new Error(`${slug}: original raster git object does not match ${revision}:${file}`);
      }
      const { content } = JSON.parse(execFileSync('gh', ['api', `repos/${originRepo}/git/blobs/${ref.originGitSha}`], {
        cwd: project, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024,
      }));
      const png = Buffer.from(content, 'base64');
      if (SHA(png) !== ref.originSha256) throw new Error(`${slug}: original raster differs from the pinned git object`);
      const input = path.join(temp, `${slug}.${isIco ? 'ico' : 'png'}`);
      const outputSvg = path.join(temp, `${slug}.svg`);
      writeFileSync(input, png);
      // No raster is shipped to the browser. VTracer produces genuine <path> elements;
      // SVGs whose trace visually distorts the source were omitted from the manifest.
      // The original Photoview favicon has gradient facets. The standard
      // profile drops them, so preserve their contours with the reviewed
      // higher-precision profile; all other traces use the original settings.
      const traceOptions = ref.traceProfile === 'gradient-detail'
        ? 'mode="spline", filter_speckle=1, color_precision=8, layer_difference=5, corner_threshold=45, length_threshold=1.5, max_iterations=10, splice_threshold=50, path_precision=2'
        : ['light-ground-detail', 'light-ground-upscaled', 'dark-ground-upscaled', 'dark-ground-pixel', 'light-ground-pixel'].includes(ref.traceProfile)
          ? null // Pinned Pillow alpha compositing and VTracer settings live in the helper.
        : ref.traceProfile === undefined
          ? 'mode="spline", filter_speckle=2, color_precision=7, layer_difference=8, corner_threshold=60, length_threshold=4, max_iterations=10, splice_threshold=45, path_precision=2'
          : (() => { throw new Error(`${slug}: unsupported trace profile`); })();
      const traceCommand = ['light-ground-detail', 'light-ground-upscaled', 'dark-ground-upscaled', 'dark-ground-pixel', 'light-ground-pixel'].includes(ref.traceProfile)
        ? [path.join(project, 'scripts/trace-logo-light-ground.py'), input, outputSvg, ...(isIco ? ['--ico-128-upscale'] : ref.traceProfile === 'light-ground-pixel' ? ['--pixel'] : ref.traceProfile === 'dark-ground-pixel' ? ['--dark-pixel'] : ref.traceProfile === 'dark-ground-upscaled' ? ['--dark-upscale'] : ref.traceProfile === 'light-ground-upscaled' ? ['--upscale'] : [])]
        : ['-c',
          `import sys, vtracer; vtracer.convert_image_to_svg_py(sys.argv[1], sys.argv[2], colormode="color", hierarchical="stacked", ${traceOptions})`,
          input, outputSvg];
      execFileSync('python3', traceCommand, {
        cwd: project,
        env: { ...process.env, PYTHONPATH: [path.join(repository, '.cache/py-libs'), process.env.PYTHONPATH].filter(Boolean).join(path.delimiter) },
      });
      const svg = readFileSync(outputSvg);
      if (SHA(svg) !== ref.sha256) throw new Error(`${slug}: vector trace differs from the reviewed output hash`);
      writeFileSync(path.join(cache, `${slug}.svg`), svg);
    }
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function obtainSources() {
  mkdirSync(cache, { recursive: true });
  const missing = new Map();
  for (const [slug, ref] of Object.entries(manifest.icons)) {
    if (!validId.test(slug) || !validAsset.test(ref.icon) || !manifest.collections[ref.source]) {
      throw new Error(`Unsafe icon identifier or unknown source: ${slug} / ${ref.icon} / ${ref.source}`);
    }
    if (['official', 'official-png', 'official-ico'].includes(ref.source)) {
      if (!ref.license || !ref.identityUrl || !/^https:\/\//.test(ref.identityUrl) ||
          !ref.file || !ref.repository || !/^[a-f0-9]{40}$/.test(ref.revision)) {
        throw new Error(`${slug}: official artwork needs an individual license, identity URL and pinned upstream file`);
      }
      if (['official-png', 'official-ico'].includes(ref.source) && (!/^[a-f0-9]{40}$/.test(ref.originGitSha) ||
          !/^[a-f0-9]{64}$/.test(ref.originSha256))) {
        throw new Error(`${slug}: traced first-party artwork needs its original raster git blob and SHA-256`);
      }
    }
    const cached = path.join(cache, `${slug}.svg`);
    if (existsSync(cached) && SHA(readFileSync(cached)) === ref.sha256) continue;
    const bucket = ref.repository ? `${ref.source}:${ref.repository}:${ref.revision}` : ref.source;
    if (!missing.has(bucket)) missing.set(bucket, { source: ref.source, icons: [] });
    missing.get(bucket).icons.push([slug, ref.icon]);
  }
  for (const { source, icons } of missing.values()) {
    if (manifest.collections[source].traced) {
      tracePinnedPngs(icons);
    } else if (manifest.collections[source].repository || source === 'official') {
      // Fetch one immutable git revision for every icon; this will not silently update artwork.
      for (let i = 0; i < icons.length; i += 25) {
        const batch = icons.slice(i, i + 25);
        const fields = batch.map(([, icon], j) => {
          const { revision, file } = githubSource(source, icon, manifest.icons[batch[j][0]]);
          return `i${j}: object(expression: "${revision}:${file}") { ... on Blob { text isBinary } }`;
        }).join(' ');
        const { owner, repo } = githubSource(source, batch[0][1], manifest.icons[batch[0][0]]);
        const query = `query { repository(owner: "${owner}", name: "${repo}") { ${fields} } }`;
        const result = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', `query=${query}`], { cwd: project, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }));
        if (result.errors) throw new Error(JSON.stringify(result.errors));
        batch.forEach(([slug], j) => {
          const blob = result.data.repository[`i${j}`];
          if (!blob?.text || blob.isBinary) throw new Error(`${source}:${slug} has no text SVG`);
          if (SHA(blob.text) !== manifest.icons[slug].sha256) throw new Error(`${source}:${slug} changed since its source hash was reviewed`);
          writeFileSync(path.join(cache, `${slug}.svg`), blob.text);
        });
      }
    } else {
      const data = getIconifyData(source);
      for (const [slug, asset] of icons) {
        const svg = iconifySource(source, asset, data);
        if (SHA(svg) !== manifest.icons[slug].sha256) throw new Error(`${source}:${slug} changed since its source hash was reviewed`);
        writeFileSync(path.join(cache, `${slug}.svg`), svg);
      }
    }
  }
}

function prepareSvg(source, slug) {
  if (manifest.icons[slug].sourceProfile === 'morphic-static-jsx') {
    // Extract only the reviewed static SVG from the hash-pinned TSX. Never
    // execute upstream JavaScript. Preserve its default black body/white eyes;
    // remove animation classes and caller-provided overrides, not geometry.
    if (slug !== 'morphic' || (source.match(/<svg\b/g) ?? []).length !== 1) {
      throw new Error('morphic: unexpected upstream JSX structure');
    }
    source = source.match(/<svg\b[\s\S]*?<\/svg>/)?.[0] ?? '';
    source = source.replace(/className=\{cn\([\s\S]*?\)\}/g, '')
      .replace('{...props}', '')
      .replace("fill={bodyColor ?? 'black'}", 'fill="black"');
    if (!source.includes('viewBox="0 0 256 256"') ||
        (source.match(/<circle\b/g) ?? []).length !== 1 ||
        (source.match(/<ellipse\b/g) ?? []).length !== 2 || /[{}]/.test(source)) {
      throw new Error('morphic: unreviewed expression or geometry in static logo');
    }
  }
  if (slug === 'maxkb') {
    // SVGO drops gradients with these upstream non-ASCII IDs while retaining
    // their CSS references. Rename identifiers/references only; keep every
    // stop, colour, coordinate and path unchanged before normal ID scoping.
    if ((source.match(/<linearGradient\b/g) ?? []).length !== 6 || !source.includes('未命名的渐变_7')) {
      throw new Error('maxkb: unexpected upstream gradient structure');
    }
    source = source.replaceAll('未命名的渐变_7', 'maxkb-gradient');
  }
  if (slug === 'galaxy') {
    // Galaxy's Inkscape export contains an embedded, unused SVG <font> table.
    // Its actual visible logo is nine vector paths; React has no <font> or
    // <glyph> elements. Keep the original marks, drop only this dead table.
    if (!/<font\b[\s\S]*?<\/font>/.test(source) || (source.match(/<path\b/g) ?? []).length !== 9) {
      throw new Error('galaxy: unexpected first-party favicon artwork');
    }
    source = source.replace(/<font\b[\s\S]*?<\/font>/, '');
  }
  if (slug === 'phoenix') {
    // The current Arize Phoenix lockup includes a separate blue bird and a
    // wordmark. At icon size use the source's bird paths, not the older black
    // bird or the unrelated Elixir Phoenix framework mark. The wordmark is a
    // single path starting at x=75, outside the 64px icon region.
    if (!source.includes('viewBox="0 0 344 64"') || !source.includes('fill="#009DD2"')) {
      throw new Error('phoenix: expected the pinned Arize Phoenix brand lockup');
    }
    const withoutWordmark = source.replace(/\s*<path d="M 75\.582,[^"]*" fill="#454554"\s*\/>/, '');
    if (withoutWordmark === source || /M 75\.582,/.test(withoutWordmark)) {
      throw new Error('phoenix: failed to isolate the official blue icon');
    }
    source = withoutWordmark.replace('viewBox="0 0 344 64"', 'viewBox="0 0 64 64"');
  }
  // Yarn.social's MIT-licensed pod mark is a real SVG, but its original wide
  // template also includes a dynamic pod name (not the Yarn.social logo).
  // Keep the source's exact path geometry and crop the unused text area;
  // the official yarn.social/logo.png supplies the blue #55acee colour.
  if (slug === 'yarn') {
    if (!source.includes('{{ .PodName }}') || (source.match(/<path\b/g) ?? []).length !== 4) {
      throw new Error('yarn: expected the pinned Yarn.social pod mark');
    }
    source = source.replace(/<text\b[^>]*>[\s\S]*?<\/text>/g, '')
      .replace(/viewBox="0 0 210 70"/, 'viewBox="0 0 70 70"')
      .replace(/currentColor/g, '#55acee');
    if (/<text\b|{{/.test(source)) throw new Error('yarn: unconverted pod template');
  }
  if (slug === 'tunarr') {
    // The upstream <style> uses global line/circle selectors. All shapes already
    // specify their own light-background colors; drop only those global rules.
    if (!source.includes('path.darkMode, circle') || !source.includes('<style>')) {
      throw new Error('tunarr: unexpected upstream style');
    }
    source = source.replace(/<style>[\s\S]*?<\/style>/, '');
  }
  // SVG <image> (even a base64 image) is NOT code-rendered vector artwork. Likewise,
  // external references and foreignObject can fetch assets or execute arbitrary markup.
  const unsafeCssUrl = [...source.matchAll(/\burl\(\s*([^)]*)\)/gi)]
    .some((match) => !match[1].trim().replace(/^["']/, '').startsWith('#'));
  if (/<\s*(?:image|foreignObject|script|iframe|a)\b/i.test(source) ||
      /\b(?:xlink:)?(?:href|src)\s*=\s*["'](?!#)/i.test(source) ||
      /\s+on[a-z]+\s*=|javascript:|@import\b/i.test(source) || unsafeCssUrl) {
    throw new Error(`${slug}: source contains an image, external link or non-SVG content`);
  }
  const svgTag = source.match(/<svg\b[^>]*>/i)?.[0];
  if (!svgTag) throw new Error(`${slug}: no SVG root`);
  let root = svgTag;
  if (!/\bviewBox\s*=/.test(root)) {
    const width = root.match(/\bwidth="(\d+(?:\.\d+)?)(?:px)?"/)?.[1];
    const height = root.match(/\bheight="(\d+(?:\.\d+)?)(?:px)?"/)?.[1];
    if (!width || !height) throw new Error(`${slug}: cannot derive a scalable viewBox`);
    root = root.replace(/>$/, ` viewBox="0 0 ${width} ${height}">`);
  }
  // The Appsmith source is a real wordmark in the middle 4/24 of a square
  // canvas. Crop only its blank canvas, not any of its paths, to keep it legible.
  if (slug === 'appsmith') root = root.replace(/viewBox="[^"]+"/, 'viewBox="0 9 24 6"');
  // The official Xibo PNG has a large transparent margin. Crop the *viewBox*
  // (never its vectorised letter paths) to keep the trademark wordmark readable.
  if (slug === 'xibo-cms') {
    if (!root.includes('viewBox="0 0 1407 749"')) throw new Error('xibo-cms: unexpected original artwork dimensions');
    root = root.replace('viewBox="0 0 1407 749"', 'viewBox="117 87 1172 576"');
  }
  // The original project wordmarks also contain standalone branded icons.
  // Crop their untouched paths to make the icon legible in small square slots.
  if (slug === 'usesend') {
    if (!root.includes('viewBox="0 0 2785 678"')) throw new Error('usesend: unexpected official wordmark dimensions');
    root = root.replace('viewBox="0 0 2785 678"', 'viewBox="0 0 678 678"');
  }
  if (slug === 'spice-ai') {
    // The first-party wordmark includes this separate orange mark. Crop only its
    // unmodified vector paths to keep the mark legible in 44px catalogue slots.
    if (!root.includes('viewBox="0 0 2268 664"')) throw new Error('spice-ai: unexpected official wordmark dimensions');
    root = root.replace('viewBox="0 0 2268 664"', 'viewBox="120 100 450 440"');
  }
  if (slug === 'lavinmq') {
    // LavinMQ publishes the circular green brand mark at x=0..81 alongside
    // lettering at x>100. Crop only the viewBox; keep every supplied path.
    if (!root.includes('viewBox="0 0 394 80"')) throw new Error('lavinmq: unexpected official wordmark dimensions');
    root = root.replace('viewBox="0 0 394 80"', 'viewBox="0 0 81 80"');
  }
  if (slug === 'apache-streampipes') {
    if (!root.includes('viewBox="0 0 1417.32 283.46"')) throw new Error('apache-streampipes: unexpected official wordmark dimensions');
    root = root.replace('viewBox="0 0 1417.32 283.46"', 'viewBox="55 14 255 255"');
  }
  // PKP's original OMP/OJS artwork combines a distinctive typeset wordmark,
  // underline and tiny descriptive tagline. Show only the original wordmark
  // and underline in catalogue slots: the raster-derived tagline is not faithful
  // at this size. No traced letter geometry is redrawn or substituted.
  const publishingCrop = {
    'open-monograph-press': ['0 0 289 160', '0 0 289 128'],
    'open-journal-systems': ['0 0 231 160', '0 0 231 138'],
  }[slug];
  if (publishingCrop) {
    const [original, cropped] = publishingCrop;
    if (!root.includes(`viewBox="${original}"`)) throw new Error(`${slug}: unexpected original wordmark dimensions`);
    root = root.replace(`viewBox="${original}"`, `viewBox="${cropped}"`);
    const [, , width, height] = cropped.split(' ');
    // Explicit clipping also excludes tagline paths when the SVG is nested in
    // a larger viewport with preserveAspectRatio letterboxing.
    source = source.replace(svgTag, `${svgTag}<defs><clipPath id="publishing-wordmark"><rect width="${width}" height="${height}" /></clipPath></defs><g clip-path="url(#publishing-wordmark)">`)
      .replace(/<\/svg>\s*$/, '</g></svg>');
  }
  // Pixel dimensions in some Inkscape exports exceed 100,000 px. The viewBox
  // plus the caller's CSS is what scales the React-rendered vector.
  root = root.replace(/\s+(?:width|height)="[^"]*"/g, '').replace(/\s+aria-hidden="true"/g, '');
  // The shared component supplies the product's accessible name. Editor-exported
  // labels on child groups can be stale (and SVGO may turn numeric ones into numbers).
  return source.replace(svgTag, root).replace(/\s+aria-label="[^"]*"/g, '');
}

function codeFor(slug, number) {
  const ref = manifest.icons[slug];
  const source = prepareSvg(readFileSync(path.join(cache, `${slug}.svg`), 'utf8'), slug);
  const componentName = `Icon_${number}`;
  const jsx = transform.sync(source, {
    plugins: ['@svgr/plugin-svgo', '@svgr/plugin-jsx'],
    typescript: true,
    jsxRuntime: 'automatic',
    // Babel's automatic >500 KB compaction removes the newlines used below
    // to strip imports/exports. Keep the same format for large reviewed art;
    // the unsafe-element rejection remains unchanged.
    jsx: { babelConfig: { compact: false } },
    // Keep original brand colours, clip paths and viewBox. Prefix style selectors and IDs
    // per slug so two different brands can never reference each other's gradients.
    svgoConfig: { plugins: [{ name: 'preset-default', params: { overrides: { removeViewBox: false } } }, { name: 'prefixIds', params: { prefix: slug } }] },
    expandProps: 'end',
  }, { componentName });
  let body = jsx.replace(/^import .*;\n/gm, '').replace(new RegExp(`\\nexport default ${componentName};\\s*$`), '');
  // A handful of old vector editors add nonstandard CSS that has no effect on
  // vector shapes and is rejected by React's typed CSSProperties.
  body = body.replace(/^\s*(?:InkscapeFontSpecification|blockProgression|solidColor|solidOpacity|shapePadding|imageRendering):[^\n]*\n/gm, '')
    .replace(/\s+writingMode="lr-tb"/g, '')
    .replace(/^\s*writingMode: "lr-tb",?\n/gm, '')
    .replace(/\s+(?:xmlns:(?:inkscape|sodipodi)|(?:inkscape|sodipodi):[\w-]+)=(?:"[^"]*"|\{[^}]*\})/g, '');
  if (slug === 'kotaemon') {
    // The first-party favicon has several nested SVG viewBoxes. SVGR forwards
    // React props to every one by default, which would duplicate the outer
    // accessible name on the children. The original path-only design uses
    // text-anchor="none" on a <path>; it has no visual effect and is invalid
    // in React's SVG typings. Keep all nested viewBoxes and vector paths.
    if ((body.match(/<svg\b/g) ?? []).length !== 10 || !body.includes('textAnchor="none"')) {
      throw new Error('kotaemon: unexpected first-party favicon structure');
    }
    let firstSvg = true;
    body = body.replace(/\s+\{\.\.\.props\}/g, (attribute) => {
      if (firstSvg) { firstSvg = false; return attribute; }
      return '';
    }).replace(/\s+textAnchor="none"/g, '');
  }
  // Nested source SVGs must retain their own geometry. Forwarding tile dimensions
  // or accessibility props to them shrinks/clips artwork and duplicates labels.
  let outerProps = true;
  body = body.replace(/\s+\{\.\.\.props\}/g, (attribute) => {
    if (outerProps) { outerProps = false; return attribute; }
    return '';
  });
  if (body === jsx || /<\s*(?:image|foreignObject|script)\b/i.test(body)) throw new Error(`Unsafe or unconverted JSX for ${slug}`);
  const meta = manifest.collections[ref.source];
  const url = ref.repository
    ? `https://github.com/${ref.repository}/blob/${ref.revision}/${encodeURI(ref.file)}`
    : meta.repository
      ? `https://github.com/${meta.repository}/blob/${meta.revision}/${meta.folder}/${ref.icon}.${meta.traced ? 'png' : 'svg'}`
      : `https://www.npmjs.com/package/${meta.package}/v/${meta.version}`;
  const change = meta.traced ? 'traced to SVG paths with VTracer, then transformed to JSX' : 'transformed to React JSX';
  return `// ${slug}: ${url} (${ref.license ?? meta.license}; ${change})\n${body.trim()}\n`;
}

// Keep the detailed mascot from delaying every other S-logo's lazy import.
const groupFor = (slug) => ['snapotter', 'hollama', 'picoclaw', 'weknora'].includes(slug) ? slug : slug[0].toLowerCase();

function renderGroups() {
  const groups = new Map();
  const slugs = Object.keys(manifest.icons).sort();
  for (const slug of slugs) {
    const group = groupFor(slug);
    if (!/^[a-z0-9]+$/.test(group)) throw new Error(`Unexpected first letter: ${slug}`);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(slug);
  }
  const generated = new Map();
  for (const [group, members] of groups) {
    const body = members.map((slug, i) => codeFor(slug, i)).join('\n');
    const records = members.map((slug, i) => `  ${JSON.stringify(slug)}: Icon_${i},`).join('\n');
    generated.set(`${group}.tsx`, `// GENERATED by scripts/generate-platform-inline-icons.mjs. Do not edit by hand.\nimport type { ComponentType, SVGProps } from 'react';\n\n${body}\nconst ICONS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {\n${records}\n};\n\nexport default function IconGroup({ slug, ...props }: SVGProps<SVGSVGElement> & { slug: string }) {\n  const Logo = ICONS[slug];\n  return Logo ? <Logo {...props} /> : null;\n}\n`);
  }
  const loaders = [...groups.keys()].sort().map((group) => `  ${JSON.stringify(group)}: lazy(() => import('./${group}')),`).join('\n');
  const index = slugs.map((slug) => `  ${JSON.stringify(slug)}: ${JSON.stringify(groupFor(slug))},`).join('\n');
  const wideSlugs = slugs.filter((slug) => {
    const source = prepareSvg(readFileSync(path.join(cache, `${slug}.svg`), 'utf8'), slug);
    const viewBox = source.match(/<svg\b[^>]*?viewBox="([^"]+)"/)?.[1];
    const dimensions = viewBox?.split(/[ ,]+/).map(Number);
    return dimensions?.length === 4 && dimensions[2] / dimensions[3] >= 2;
  });
  const wideIndex = wideSlugs.map((slug) => `  ${JSON.stringify(slug)},`).join('\n');
  generated.set('registry.tsx', `// GENERATED by scripts/generate-platform-inline-icons.mjs. Do not edit by hand.\nimport { lazy } from 'react';\nimport type { ComponentType, LazyExoticComponent, SVGProps } from 'react';\n\ntype LogoProps = Omit<SVGProps<SVGSVGElement>, 'ref'> & { slug: string };\nconst GROUPS: Record<string, LazyExoticComponent<ComponentType<LogoProps>>> = {\n${loaders}\n};\n\nconst ICON_GROUP_BY_SLUG: Record<string, string> = {\n${index}\n};\n\nconst WIDE_LOGOS = new Set([\n${wideIndex}\n]);\n\nexport function isWideCodeRenderedLogo(slug: string): boolean {\n  return WIDE_LOGOS.has(slug);\n}\n\nexport function hasCodeRenderedLogo(slug: string): boolean {\n  return Object.prototype.hasOwnProperty.call(ICON_GROUP_BY_SLUG, slug);\n}\n\nexport default function InlineCatalogueLogo(props: LogoProps) {\n  const Group = GROUPS[ICON_GROUP_BY_SLUG[props.slug] ?? ''];\n  return Group ? <Group {...props} /> : null;\n}\n`);
  return generated;
}

obtainSources();
const generated = renderGroups();
mkdirSync(output, { recursive: true });
if (checking) {
  const invalid = [...generated].filter(([file, content]) => !existsSync(path.join(output, file)) || readFileSync(path.join(output, file), 'utf8') !== content).map(([file]) => file);
  if (invalid.length) throw new Error(`Generated platform logos are stale: ${invalid.join(', ')}`);
  console.log(`Verified ${manifest && Object.keys(manifest.icons).length} pinned inline logos in ${generated.size - 1} code chunks.`);
} else {
  for (const filename of readdirSync(output)) {
    if (/^(?:[a-z0-9]|snapotter|hollama|picoclaw|weknora|registry)\.tsx$/.test(filename) && !generated.has(filename)) unlinkSync(path.join(output, filename));
  }
  for (const [file, content] of generated) writeFileSync(path.join(output, file), content);
  console.log(`Generated ${Object.keys(manifest.icons).length} pinned inline logos in ${generated.size - 1} code chunks.`);
}
