<?php
/**
 * File-based tools administration. Disabled until CH247_TOOLS_ADMIN_TOKEN is set.
 * The token is never written to the overrides file or the page source.
 */
require dirname(__DIR__) . '/lib/bootstrap.php';

use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\Guard;
use CloudHost247\Tools\View;

$expected = getenv('CH247_TOOLS_ADMIN_TOKEN');
if (!is_string($expected) || strlen($expected) < 16) {
    http_response_code(503);
    header('Content-Type: text/plain; charset=UTF-8');
    echo "Tools admin is disabled. Set CH247_TOOLS_ADMIN_TOKEN to a random string of at least 16 characters.\n";
    exit;
}

$cookie = isset($_COOKIE['ch247_tools_admin']) ? $_COOKIE['ch247_tools_admin'] : '';
$authed = false;
if (is_string($cookie) && strpos($cookie, '.') !== false) {
    list($expiry, $sig) = explode('.', $cookie, 2);
    $good = hash_hmac('sha256', $expiry, $expected);
    if (hash_equals($good, $sig) && ctype_digit($expiry) && (int) $expiry > time()) {
        $authed = true;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $given = isset($_POST['token']) ? (string) $_POST['token'] : '';
    if (!$authed && hash_equals($expected, $given)) {
        $expiry = (string) (time() + 3600);
        $sig = hash_hmac('sha256', $expiry, $expected);
        setcookie('ch247_tools_admin', $expiry . '.' . $sig, time() + 3600, '/tools/admin', '', !empty($_SERVER['HTTPS']), true);
        header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
        exit;
    }
    if (!$authed || !isset($_POST['save'])) {
        http_response_code(401);
        echo 'Unauthorized';
        exit;
    }
    $posted = isset($_POST['tools']) && is_array($_POST['tools']) ? $_POST['tools'] : array();
    $overrides = array('tools' => array());
    foreach (Catalog::tools() as $tool) {
        $slug = $tool['slug'];
        if (!isset($posted[$slug]) || !is_array($posted[$slug])) {
            continue;
        }
        $row = $posted[$slug];
        $overrides['tools'][$slug] = array(
            'enabled' => !empty($row['enabled']),
            'featured' => !empty($row['featured']),
            'maintenance' => isset($row['maintenance']) ? substr((string) $row['maintenance'], 0, 200) : '',
            'summary' => isset($row['summary']) ? substr((string) $row['summary'], 0, 400) : $tool['summary'],
            'seoTitle' => isset($row['seoTitle']) ? substr((string) $row['seoTitle'], 0, 180) : $tool['seoTitle'],
            'seoDescription' => isset($row['seoDescription']) ? substr((string) $row['seoDescription'], 0, 300) : $tool['seoDescription'],
            'category' => isset($row['category']) ? (string) $row['category'] : $tool['category'],
            'icon' => isset($row['icon']) ? substr((string) $row['icon'], 0, 40) : $tool['icon'],
            'ratePerMinute' => isset($row['ratePerMinute']) ? (int) $row['ratePerMinute'] : 30,
        );
    }
    if (!empty($_POST['doh'])) {
        $urls = array();
        foreach (preg_split('/\s+/', trim((string) $_POST['doh'])) as $url) {
            if (preg_match('#^https://[a-z0-9.-]+(?:/[a-z0-9._~:/?#\[\]@!$&\'()*+,;=%-]*)?$#i', $url)) {
                $urls[] = $url;
            }
        }
        $overrides['providers'] = array('doh' => $urls);
    }
    Catalog::saveOverrides($overrides);
    Guard::log('admin-save', 'overrides updated');
    header('Location: ' . strtok($_SERVER['REQUEST_URI'], '?'));
    exit;
}

header('Content-Type: text/html; charset=UTF-8');
header('X-Robots-Tag: noindex');
echo '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Tools admin</title><link rel="stylesheet" href="/templates/cloudhost247/css/site.css"><link rel="stylesheet" href="/templates/cloudhost247/css/tools.css"></head><body class="ch-site"><main class="ch-wrap ch-section"><h1>Tools administration</h1>';
if (!$authed) {
    echo '<form method="post"><label for="token">Admin token</label><input id="token" name="token" type="password" autocomplete="current-password" required><button class="ch-btn" type="submit">Continue</button></form></main></body></html>';
    exit;
}
echo '<p>Changes are stored in tools/data/overrides.json. Source files are not edited. API keys are not entered here.</p><form method="post"><input type="hidden" name="save" value="1"><label for="doh">DNS-over-HTTPS providers, one HTTPS URL per line</label><textarea id="doh" name="doh" rows="3"></textarea>';
echo '<div class="ch-table-scroll"><table><thead><tr><th>Tool</th><th>On</th><th>Featured</th><th>Category</th><th>Rate/min</th><th>SEO title</th><th>Maintenance</th></tr></thead><tbody>';
foreach (Catalog::tools() as $tool) {
    $slug = View::e($tool['slug']);
    echo '<tr><th>' . View::e($tool['name']) . '</th>';
    echo '<td><input type="checkbox" name="tools[' . $slug . '][enabled]" value="1"' . (!empty($tool['enabled']) ? ' checked' : '') . '></td>';
    echo '<td><input type="checkbox" name="tools[' . $slug . '][featured]" value="1"' . (!empty($tool['featured']) ? ' checked' : '') . '></td>';
    echo '<td><input name="tools[' . $slug . '][category]" value="' . View::e($tool['category']) . '"></td>';
    echo '<td><input name="tools[' . $slug . '][ratePerMinute]" type="number" min="1" max="120" value="' . (isset($tool['ratePerMinute']) ? (int) $tool['ratePerMinute'] : 30) . '"></td>';
    echo '<td><input name="tools[' . $slug . '][seoTitle]" value="' . View::e($tool['seoTitle']) . '"></td>';
    echo '<td><input name="tools[' . $slug . '][maintenance]" value="' . View::e(isset($tool['maintenance']) ? $tool['maintenance'] : '') . '"></td></tr>';
    echo '<input type="hidden" name="tools[' . $slug . '][summary]" value="' . View::e($tool['summary']) . '">';
    echo '<input type="hidden" name="tools[' . $slug . '][seoDescription]" value="' . View::e($tool['seoDescription']) . '">';
    echo '<input type="hidden" name="tools[' . $slug . '][icon]" value="' . View::e($tool['icon']) . '">';
}
echo '</tbody></table></div><button class="ch-btn" type="submit">Save tool settings</button></form></main></body></html>';
