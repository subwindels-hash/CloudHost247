<?php
/**
 * Catalogue, route and safety checks for the tools engine.
 * Run: scripts/php-wasm/php tests/tools/catalogue.php
 */
require dirname(__DIR__, 2) . '/tools/lib/bootstrap.php';

use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\Engine;
use CloudHost247\Tools\Guard;
use CloudHost247\Tools\View;

$required = array(
    'dns-checker','dns-propagation','domain-dns-validation','reverse-ip-lookup','dns-lookup','cname-lookup','ns-lookup','mx-lookup','spf-record-checker','dmarc-checker','domain-dns-health','dmarc-record-generator','dnskey-lookup','ds-lookup','dkim-checker',
    'ping-ipv4','ping-ipv6','what-is-my-ip','traceroute','ip-location-lookup','trace-email','ip-blacklist-checker','email-blacklist-checker','ip-to-decimal','ip-to-hostname','ip-whois','ipv6-whois','ipv4-to-ipv6','local-ipv6-generator','ipv6-cidr-to-range','ipv6-range-to-cidr','ipv6-compression','ipv6-expand','ip-subnet-calculator','ipv6-to-ipv4','ipv6-compatibility-checker','what-is-my-isp','domain-to-ip',
    'http-headers-checker','website-os-checker','md5-generator','base64-generator','multi-url-opener','mrz-generator','smtp-test','htaccess-redirect-generator','url-rewrite-generator','broken-link-checker','open-graph-checker','raid-calculator','binary-translator','text-to-binary','json-viewer','json-beautifier','json-minifier','email-verifier',
    'rgb-to-colortone','hex-to-colortone','cmyk-to-colortone','hsv-to-colortone',
    'website-link-analyzer','user-agent-checker','pagerank-checker','punycode-converter','serp-simulator','robots-txt-generator',
    'port-checker','mac-address-lookup','mac-address-generator','asn-whois-lookup',
    'ssl-certificate-checker','password-encryption','random-password-generator','password-strength-checker',
    'qr-code-generator','qr-scanner','lorem-ipsum-generator','time-card-calculator','bin-checker','credit-card-checker','reverse-image-search','name-checker','online-notepad','small-text-generator','word-counter','domain-name-search','rot13','morse-code-translator','bimi-checker-generator','image-to-text','runic-translator','invisible-character-generator','internet-speed-test','wifi-qr-scanner',
    'minecraft-color-codes',
);

$failures = array();
function expect($condition, $message)
{
    global $failures;
    if (!$condition) {
        $failures[] = $message;
    }
}

expect(count($required) === 95, 'Required slug list must stay at 95');
$tools = Catalog::tools();
expect(count($tools) >= 104, 'Catalogue has ' . count($tools) . ' tools');
$bySlug = array();
foreach ($tools as $tool) {
    $bySlug[$tool['slug']] = $tool;
    expect(Catalog::resolve($tool['path'])['slug'] === $tool['slug'], 'Resolve failed for ' . $tool['path']);
    $html = View::document($tool + array('kind' => 'tool'), '', '');
    expect(strpos($html, htmlspecialchars($tool['name'], ENT_QUOTES, 'UTF-8')) !== false, 'Page missing name ' . $tool['slug']);
    expect(strpos($html, 'ch-tool-form') !== false || strpos($html, 'disabled') !== false, 'Page missing form ' . $tool['slug']);
    expect(strpos($html, 'Related tools') !== false, 'Page missing related ' . $tool['slug']);
    expect(strpos($html, '<h1') !== false, 'Page missing h1 ' . $tool['slug']);
}
foreach ($required as $slug) {
    expect(isset($bySlug[$slug]), 'Missing required tool ' . $slug);
    if (isset($bySlug[$slug])) {
        expect(!empty($bySlug[$slug]['enabled']), 'Required tool disabled ' . $slug);
        expect($bySlug[$slug]['path'] === '/tools/' . $slug, 'Unexpected path ' . $slug);
    }
}
expect(count(Catalog::categories()) === 9, 'Expected 9 categories');
$hub = View::document(Catalog::resolve('/tools'), '', '');
expect(substr_count($hub, 'ch-tool-card') >= 100, 'Hub did not list the catalogue');

// The MRZ tool is a browser-only document tool: the page must state where the data is processed,
// and the server executor must refuse it without echoing a submitted field back.
$mrz = isset($bySlug['mrz-generator']) ? $bySlug['mrz-generator'] : null;
expect($mrz !== null, 'MRZ tool missing from the catalogue');
if ($mrz) {
    expect($mrz['mode'] === 'local', 'MRZ tool must run in the browser, not on the server');
    expect(!empty($mrz['sensitive']), 'MRZ tool must be flagged sensitive');
    expect($mrz['path'] === '/tools/mrz-generator', 'Unexpected MRZ path ' . $mrz['path']);
    $mrzHtml = View::document($mrz + array('kind' => 'tool'), '', '');
    expect(strpos($mrzHtml, 'Processing stays in this browser') !== false, 'MRZ page must state that processing stays in the browser');
    expect(strpos($mrzHtml, 'ch-tool-crumb') !== false, 'MRZ page must keep the breadcrumb');
    expect(strpos($mrzHtml, 'name="mode"') !== false, 'MRZ page must render the action select');
    expect(strpos($mrzHtml, 'name="mrz"') !== false, 'MRZ page must render the MRZ textarea');
}
$serverMrz = Engine::run('mrz-generator', array('documentNumber' => 'L898902C3', 'mrz' => 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<'), array('ip' => '203.0.113.10'));
expect(empty($serverMrz['ok']), 'A browser-only MRZ tool must be refused by the server executor');
expect(strpos(json_encode($serverMrz), 'L898902C3') === false, 'MRZ document number leaked into the server result');
expect(strpos(json_encode($serverMrz), 'P<UTO') === false, 'MRZ string leaked into the server result');

$local = Engine::run('password-encryption', array('password' => 'secret-value'), array('ip' => '203.0.113.10'));
expect(empty($local['ok']), 'Password tool must be rejected by the server');
expect(strpos(json_encode($local), 'secret-value') === false, 'Password leaked into the server result');

$card = Engine::run('credit-card-checker', array('number' => '4111111111111111'), array('ip' => '203.0.113.10'));
expect(empty($card['ok']), 'Card tool must stay in the browser');

foreach (array('http://127.0.0.1/', 'http://169.254.169.254/latest', 'http://10.1.1.1/', 'http://192.168.0.1/', 'http://[::1]/') as $url) {
    $blocked = Engine::run('http-headers-checker', array('url' => $url), array('ip' => '203.0.113.10'));
    expect(empty($blocked['ok']), 'SSRF URL was accepted: ' . $url);
}
$privatePort = Engine::run('port-checker', array('host' => '127.0.0.1', 'port' => '22'), array('ip' => '203.0.113.10'));
expect(empty($privatePort['ok']), 'Private port check was accepted');

$dns = Engine::run('dns-lookup', array('domain' => 'example.com', 'type' => 'A'), array('ip' => '203.0.113.10'));
$blob = json_encode($dns);
expect(stripos($blob, 'United States') === false && stripos($blob, 'country') === false, 'DNS lookup invented a location');
if (!empty($dns['ok'])) {
    expect(isset($dns['rows'][0]['Value']) && filter_var($dns['rows'][0]['Value'], FILTER_VALIDATE_IP), 'DNS row is not an address');
} else {
    expect(!empty($dns['error']) && empty($dns['rows']), 'DNS failure must be an error, not a fabricated answer');
}
$rank = Engine::run('pagerank-checker', array('url' => 'https://example.com/'), array('ip' => '203.0.113.10'));
$rankBlob = json_encode($rank);
expect(stripos($rankBlob, 'Not available') !== false || stripos($rankBlob, 'not a public') !== false, 'PageRank did not refuse a score');
expect(!preg_match('/"PageRank","Value":"[0-9]/', $rankBlob), 'PageRank invented a numeric score');

expect(Guard::isPublicIp('203.0.113.10') === false, 'Documentation range must not be public');
expect(Guard::isPublicIp('1.1.1.1') === true, '1.1.1.1 should be public');
expect(Guard::isPublicIp('169.254.169.254') === false, 'Metadata address must be blocked');
expect(Guard::isPublicIp('172.29.1.0') === false, 'RFC1918 must be blocked');

if ($failures) {
    fwrite(STDERR, implode("\n", $failures) . "\n");
    echo count($failures) . " failed\n";
    exit(1);
}
echo "catalogue ok tools=" . count($tools) . " required=95\n";
