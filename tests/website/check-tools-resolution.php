<?php
/**
 * Resolve every path the theme advertises as served through the real tools front controller.
 *
 * Why this exists: the Tools mega menu and the footer's Tools column are enriched at runtime from
 * the platform's catalogue (`GET /api/tools/navigation`), and `templates/cloudhost247/js/site.js`
 * resolves every anchor it appends against *this* origin. `modules/addons/cloudhost247_theme/
 * resources/site.json` therefore publishes `toolsServed`, and the script withholds any link outside
 * it. That projection is a claim about a PHP resolver, so something has to ask the resolver.
 *
 * It is asked here, in both directions, because getting either one wrong is a customer-facing defect
 * and neither is visible to a static audit — the anchors do not exist until the browser makes them:
 *
 *   - a path the shell answers but the projection omits is a **working link silently removed** from
 *     every page (this is not hypothetical: an earlier revision built the projection from the native
 *     catalogue alone and dropped 24 menu links and 4 footer links per page);
 *   - a path the projection lists but the shell 404s is a **broken link added** to every page.
 *
 * `tools/index.php` answers from two catalogues and a 301 is not a failure: `Catalog::resolve()`
 * renders the tool, `Theme\ToolsSite::resolve()` renders an honest noindex signpost for the routes
 * the native catalogue does not know, and an alias under `legacyPaths` is answered with a 301 to the
 * tool's canonical path. Only "neither resolver returned anything" is a defect.
 *
 * CLI only, read-only, no database and no session: it calls the same two static resolvers the front
 * controller calls and nothing else.
 *
 *     php tests/website/check-tools-resolution.php
 *
 * Exit 0 when both directions agree and nothing 404s, 1 on any disagreement, 2 when the tree it needs
 * is missing.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit(2);
}

$root = dirname(__DIR__, 2);

$bootstrap = $root . '/tools/lib/bootstrap.php';
$toolsSite = $root . '/modules/addons/cloudhost247_theme/lib/ToolsSite.php';
$registry = $root . '/modules/addons/cloudhost247_theme/resources/site.json';
foreach (array($bootstrap, $toolsSite, $registry) as $required) {
    if (!is_file($required)) {
        fwrite(STDERR, "check-tools-resolution: missing $required\n");
        exit(2);
    }
}

define('CH247_TOOLS_ROOT', $root);
require_once $bootstrap;
require_once $toolsSite;

$normalise = function ($path) {
    return is_string($path) ? ltrim(trim($path), '/') : '';
};

/** Every path either resolver can answer, derived from the two catalogues they read. */
$answerable = array();
$add = function ($path) use (&$answerable, $normalise) {
    $route = $normalise($path);
    if ($route !== '') {
        $answerable[$route] = true;
    }
};

foreach (\CloudHost247\Tools\Catalog::enabledTools() as $entry) {
    $add(isset($entry['path']) ? $entry['path'] : '');
}
foreach (\CloudHost247\Tools\Catalog::discovery() as $slug => $label) {
    $add('/tools/category/' . $slug);
}
if (method_exists('\CloudHost247\Tools\Catalog', 'collections')) {
    foreach (\CloudHost247\Tools\Catalog::collections() as $collection) {
        $add(isset($collection['path']) ? $collection['path'] : '');
    }
}
$theme = \CloudHost247\Theme\ToolsSite::catalog();
foreach ($theme['tools'] as $tool) {
    $add(isset($tool['path']) ? $tool['path'] : '');
    foreach (isset($tool['legacyPaths']) ? $tool['legacyPaths'] : array() as $legacy) {
        $add($legacy);
    }
}
foreach ($theme['categories'] as $slug => $label) {
    $add('/tools/category/' . $slug);
}
$add('/tools');

/** The projection the theme publishes to the browser. */
$published = array();
$site = json_decode(file_get_contents($registry), true);
foreach (isset($site['toolsServed']) ? $site['toolsServed'] : array() as $path) {
    $route = $normalise($path);
    if ($route !== '') {
        $published[$route] = true;
    }
}

// Ask the resolver chain, path by path. This is the same order tools/index.php uses.
$missing = array();   // published, but the shell does not answer it
$withheld = array();  // the shell answers it, but the projection withholds it
foreach (array_unique(array_merge(array_keys($published), array_keys($answerable))) as $route) {
    $path = '/' . $route;
    $native = \CloudHost247\Tools\Catalog::resolve($path);
    $legacy = $native ? null : \CloudHost247\Theme\ToolsSite::resolve($path);
    $redirect = ($legacy && isset($legacy['path']) && $legacy['path'] !== $path)
        ? $legacy['path']
        : null;
    $answered = (bool) ($native || $legacy);
    if (!$answered) {
        if (isset($published[$route])) {
            $missing[$route] = $path;
        }
        continue;
    }
    if (!isset($published[$route])) {
        $withheld[$route] = $redirect ? "$path → $redirect" : $path;
    }
}

printf("tools resolution: %d derivable, %d published\n", count($answerable), count($published));

if ($missing || $withheld) {
    if ($missing) {
        fwrite(STDERR, "\npublished but not answered by the front controller (" . count($missing) . "):\n");
        foreach ($missing as $route => $path) {
            fwrite(STDERR, "   · $path would be a 404 on every page that links it\n");
        }
    }
    if ($withheld) {
        fwrite(STDERR, "\nthe shell answers these but the projection withholds them (" . count($withheld) . "):\n");
        foreach ($withheld as $route => $detail) {
            fwrite(STDERR, "   · $detail is a working link the menu and footer would drop\n");
        }
    }
    fwrite(STDERR, "\ncheck-tools-resolution: FAILED\n");
    exit(1);
}

echo "✓ every path the shell answers is published, and every path published is answered\n";
