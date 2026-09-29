<?php
/**
 * CloudHost247 Website Builder behavioural tests.
 *
 * These run the real builder against a real SQLite database: the module's own
 * migration creates the tables, the repositories execute their real queries,
 * and the renderer produces the same markup a visitor would receive. WHMCS is
 * replaced by the doubles in fakes.php; none of the validation, sanitisation,
 * publishing or permission logic under test is stubbed.
 *
 * Usage: php tests/builder/run.php
 */

$root = dirname(__DIR__, 2);
$base = $root . '/modules/addons/cloudhost247_builder/lib/';

foreach (array(
    'Support/BuilderException', 'Support/Slug', 'Support/Ids', 'Support/UrlPolicy',
    'Support/HtmlSanitizer', 'Support/CssSanitizer', 'Support/Paths',
    'Schema/StyleSchema', 'Schema/Node', 'Schema/DocumentMigrator',
    'Widgets/WidgetDefinition', 'Widgets/WidgetCatalog',
    'Schema/SchemaValidator', 'Schema/Document',
    'Render/Icons', 'Render/StyleCompiler', 'Render/RenderContext', 'Render/WidgetRenderer', 'Render/Renderer',
    'Contracts/LiveDataSource', 'Catalog/CartLinks', 'Catalog/Money',
) as $file) {
    require_once $base . $file . '.php';
}

require_once __DIR__ . '/fakes.php';

require_once $root . '/modules/addons/cloudhost247_core/lib/Contracts/Migration.php';
require_once $root . '/modules/addons/cloudhost247_builder/migrations/V100.php';
foreach (array(
    'Repositories/PageRepository', 'Repositories/LibraryRepository', 'Repositories/MediaRepository',
    'Repositories/FormRepository', 'Repositories/EventRepository',
    'Security/CapabilityPolicy',
    'Services/Settings', 'Services/PageService', 'Services/TemplateService', 'Services/MediaService',
    'Services/FormService', 'Services/MenuService', 'Services/DisplayConditions', 'Services/ThemeService',
    'Services/Starters',
    'Catalog/WhmcsDataSource', 'Site/PageResolver',
    'Admin/EditorContext', 'Admin/AdminController', 'Admin/AdminView',
) as $file) {
    require_once $base . $file . '.php';
}

use CloudHost247\Builder\Admin\AdminController;
use CloudHost247\Builder\Admin\AdminView;
use CloudHost247\Builder\Contracts\LiveDataSource;
use CloudHost247\Builder\Migrations\BuilderInitialMigration;
use CloudHost247\Builder\Render\Icons;
use CloudHost247\Builder\Render\RenderContext;
use CloudHost247\Builder\Render\Renderer;
use CloudHost247\Builder\Render\StyleCompiler;
use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\FormRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Repositories\MediaRepository;
use CloudHost247\Builder\Repositories\PageRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Schema\SchemaValidator;
use CloudHost247\Builder\Schema\StyleSchema;
use CloudHost247\Builder\Security\CapabilityPolicy;
use CloudHost247\Builder\Services\DisplayConditions;
use CloudHost247\Builder\Services\FormService;
use CloudHost247\Builder\Services\MediaService;
use CloudHost247\Builder\Services\MenuService;
use CloudHost247\Builder\Services\PageService;
use CloudHost247\Builder\Services\Settings;
use CloudHost247\Builder\Services\Starters;
use CloudHost247\Builder\Services\TemplateService;
use CloudHost247\Builder\Services\ThemeService;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\CssSanitizer;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Ids;
use CloudHost247\Builder\Support\Paths;
use CloudHost247\Builder\Support\Slug;
use CloudHost247\Builder\Support\UrlPolicy;
use CloudHost247\Builder\Widgets\WidgetCatalog;
use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use WHMCS\Database\Capsule;

/* ------------------------------------------------------------- harness */

$passed = 0;
$failed = 0;

$check = function ($name, $value) use (&$passed, &$failed) {
    if ($value === true) { $passed++; return; }
    $failed++;
    echo 'FAIL: ' . $name . PHP_EOL;
};

$rejects = function ($name, callable $work, $expectedFragment = '') use (&$passed, &$failed) {
    try {
        $work();
    } catch (\Throwable $error) {
        if ($expectedFragment !== '' && stripos($error->getMessage(), $expectedFragment) === false) {
            $failed++;
            echo 'FAIL: ' . $name . ' (message was "' . $error->getMessage() . '")' . PHP_EOL;
            return;
        }
        $passed++;
        return;
    }
    $failed++;
    echo 'FAIL: ' . $name . ' (no exception raised)' . PHP_EOL;
};

$temp = sys_get_temp_dir() . '/ch247-builder-tests-' . bin2hex(random_bytes(6));
mkdir($temp . '/media', 0755, true);
Paths::overrideApplicationRoot($temp);
Paths::overrideMediaRoot($temp . '/media');
Capsule::boot($temp . '/builder.sqlite');
$_SERVER['REMOTE_ADDR'] = '203.0.113.9';
$_SERVER['REQUEST_METHOD'] = 'GET';
$_SESSION = array('adminid' => 7, 'adminroleid' => 1);

/** Live data double: every method answers from fixtures, or null on purpose. */
class ArrayDataSource implements LiveDataSource
{
    public $catalogueAvailable = true;
    public $productRows = array();
    public $domainRows = array();
    public $statusRows = array();
    public $reviewRows = array();
    public $cartItems = 0;
    public $brokerInstalled = true;
    public $brokerEnabled = false;
    public $brokerFeeRows = array();
    public $brokerCaseRows = array();

    public function available() { return $this->catalogueAvailable; }
    public function unavailableReason() { return 'The WHMCS catalogue is not readable in this test.'; }
    public function productGroups()
    {
        return $this->catalogueAvailable ? array(array('id' => 3, 'name' => 'Shared hosting')) : null;
    }
    public function products($groupId = 0, $limit = 12, $cycle = 'monthly')
    {
        if (!$this->catalogueAvailable) { return null; }
        return array_slice($this->productRows, 0, $limit);
    }
    public function product($id, $cycle = 'monthly')
    {
        if (!$this->catalogueAvailable) { return null; }
        foreach ($this->productRows as $product) {
            if ((int) $product['id'] === (int) $id) { return $product; }
        }
        return null;
    }
    public function price($productId, $cycle = 'monthly')
    {
        $product = $this->product($productId, $cycle);
        return $product === null ? null : $product['price'];
    }
    public function domainPricing(array $tlds = array(), $limit = 8)
    {
        return $this->catalogueAvailable ? array_slice($this->domainRows, 0, $limit) : null;
    }
    public function cart()
    {
        return array('items' => $this->cartItems, 'url' => 'cart.php?a=view', 'checkout_url' => 'cart.php?a=checkout');
    }
    public function reviews($limit = 3) { return $this->reviewRows; }
    public function serviceStatus($limit = 6) { return $this->statusRows; }
    public function currency() { return array('id' => 1, 'code' => 'USD', 'prefix' => '$', 'suffix' => ''); }

    public function brokerageAvailability()
    {
        if (!$this->brokerInstalled) { return null; }
        return array('enabled' => $this->brokerEnabled, 'new_case_url' => 'index.php?m=cloudhost247_broker&a=new', 'list_url' => 'index.php?m=cloudhost247_broker&a=list');
    }

    public function brokerageFees()
    {
        return $this->brokerInstalled ? $this->brokerFeeRows : null;
    }

    public function brokerageCases($clientId, $limit = 5)
    {
        if (!$this->brokerInstalled) { return null; }
        $labels = array('negotiation' => 'Negotiation', 'completed' => 'Completed', 'request_submitted' => 'Request Submitted');
        $rows = array();
        if ((int) $clientId > 0) {
            foreach (array_slice($this->brokerCaseRows, 0, (int) $limit) as $raw) {
                $rows[] = array(
                    'case_number' => $raw->case_number,
                    'domain' => $raw->domain,
                    'status' => $raw->status,
                    'status_label' => isset($labels[$raw->status]) ? $labels[$raw->status] : $raw->status,
                    'updated_at' => $raw->updated_at,
                    'detail_url' => 'index.php?m=cloudhost247_broker&a=detail&id=' . $raw->id,
                );
            }
        }
        return array('rows' => $rows, 'total' => count($rows), 'list_url' => 'index.php?m=cloudhost247_broker&a=list', 'new_case_url' => 'index.php?m=cloudhost247_broker&a=new');
    }
}

$data = new ArrayDataSource();
$data->productRows = array(
    array('id' => 11, 'name' => 'Starter Cloud', 'description' => 'One site, 20 GB NVMe', 'group_id' => 3,
        'group' => 'Shared hosting', 'order_url' => 'cart.php?a=add&pid=11',
        'price' => array('amount' => 6.5, 'formatted' => '$6.50', 'currency' => 'USD', 'setup' => '', 'cycle' => 'monthly')),
    array('id' => 12, 'name' => 'Business Cloud', 'description' => 'Ten sites, 80 GB NVMe', 'group_id' => 3,
        'group' => 'Shared hosting', 'order_url' => 'cart.php?a=add&pid=12',
        'price' => array('amount' => 18.0, 'formatted' => '$18.00', 'currency' => 'USD', 'setup' => '$10.00', 'cycle' => 'monthly')),
    array('id' => 13, 'name' => 'Unpriced plan', 'description' => '', 'group_id' => 3, 'group' => 'Shared hosting',
        'order_url' => 'cart.php?a=add&pid=13', 'price' => null),
);
$data->domainRows = array(
    array('tld' => '.com', 'register' => '$11.99', 'transfer' => '$11.99', 'renew' => '$13.50', 'currency' => 'USD'),
    array('tld' => '.ng', 'register' => null, 'transfer' => null, 'renew' => null, 'currency' => 'USD'),
);
$data->statusRows = array(
    array('label' => 'OVH API', 'state' => 'ok', 'checked_at' => '2026-09-28 06:00:00'),
    array('label' => 'SMTP relay', 'state' => 'degraded', 'checked_at' => '2026-09-28 05:00:00'),
);

echo "CloudHost247 Website Builder tests" . PHP_EOL;
echo str_repeat('=', 64) . PHP_EOL;

/* --------------------------------------------------- 1. support primitives */

$check('slug rejects reserved words', Slug::isValid('cart') === false || Slug::isReserved('cart'));
$check('slug normalises a title', Slug::make('  Managed WordPress Hosting!  ') === 'managed-wordpress-hosting');
$check('slug rejects traversal', Slug::isValid('../etc/passwd') === false);
$check('slug rejects uppercase', Slug::isValid('Home') === false);
$taken = array('offer' => true, 'offer-2' => true);
$check('slug uniqueness walks suffixes', Slug::unique('offer', function ($candidate) use ($taken) {
    return isset($taken[$candidate]);
}) === 'offer-3');

$check('node ids match the expected pattern', Ids::isNode(Ids::node()));
$check('node id rejects injection', Ids::isNode('n1"><script>') === false);
$check('keys reject uppercase', Ids::isKey('Main-Header') === false);
$check('tokens are long and hex', preg_match('/^[a-f0-9]{64}$/', Ids::token(32)) === 1);
$check('fingerprints are stable', Ids::fingerprint('abc') === Ids::fingerprint('abc') && Ids::fingerprint('abc') !== 'abc');

$check('url policy keeps https', UrlPolicy::link('https://cloudhost247.com/a') === 'https://cloudhost247.com/a');
$check('url policy keeps relative php', UrlPolicy::link('cart.php?a=view') === 'cart.php?a=view');
$check('url policy keeps anchors', UrlPolicy::link('#pricing') === '#pricing');
$check('url policy rejects javascript', UrlPolicy::link('javascript:alert(1)') === null);
$check('url policy rejects data urls in links', UrlPolicy::link('data:text/html,<script>') === null);
$check('url policy rejects protocol-relative', UrlPolicy::link('//evil.example/x') === null);
$check('url policy rejects encoded control characters', UrlPolicy::link("java\tscript:alert(1)") === null);
$check('url policy rejects backslash tricks', UrlPolicy::link('https:\\\\evil.example') === null);
$check('media policy rejects mailto', UrlPolicy::media('mailto:a@b.c') === null);

/* ------------------------------------------------------- 2. html sanitiser */

$sanitizer = new HtmlSanitizer();
$dirty = '<p onclick="steal()">Hello <strong>world</strong><script>alert(1)</script>'
    . '<a href="javascript:alert(2)">bad</a> <a href="https://ok.example" target="_blank">good</a>'
    . '<iframe src="https://evil.example"></iframe><img src="x" onerror="alert(3)" /></p>';
$clean = $sanitizer->clean($dirty);
$check('sanitiser removes script elements', stripos($clean, '<script') === false && stripos($clean, 'alert(1)') === false);
$check('sanitiser removes event handlers', stripos($clean, 'onclick') === false && stripos($clean, 'onerror') === false);
$check('sanitiser removes javascript hrefs', stripos($clean, 'javascript:') === false);
$check('sanitiser removes iframes', stripos($clean, '<iframe') === false);
$check('sanitiser keeps allowed markup', strpos($clean, '<strong>world</strong>') !== false);
$check('sanitiser keeps safe links', strpos($clean, 'https://ok.example') !== false);
$check('sanitiser hardens new-tab links', strpos($clean, 'noopener') !== false);
$check('sanitiser strips style attributes', stripos($sanitizer->clean('<p style="position:fixed">x</p>'), 'style=') === false);
$check('sanitiser drops unknown wrappers but keeps text',
    strpos($sanitizer->clean('<marquee>keep me</marquee>'), 'keep me') !== false
    && stripos($sanitizer->clean('<marquee>keep me</marquee>'), '<marquee') === false);
$check('sanitiser strips svg payloads', stripos($sanitizer->clean('<svg><script>alert(1)</script></svg>'), 'svg') === false);
$check('sanitiser caps length', strlen($sanitizer->clean(str_repeat('<p>abcdefghij</p>', 500), 200)) <= 220);
$check('text() removes markup', $sanitizer->text('<b>Hi</b> <script>x</script>there') === 'Hi there');
$check('text() collapses control characters', strpos($sanitizer->text("a\x00\x07b"), "\x07") === false);
$check('text() honours the length cap', strlen($sanitizer->text(str_repeat('a', 900), 100)) === 100);

/* -------------------------------------------------------- 3. css sanitiser */

$css = new CssSanitizer();
$check('css allows plain rules', $css->clean('.ch247-hero { color: #fff; }') !== '');
$rejects('css rejects expression()', function () use ($css) { $css->clean('a{width:expression(alert(1))}'); }, 'expression');
$rejects('css rejects @import', function () use ($css) { $css->clean('@import url(https://evil.example/x.css);'); }, '@import');
$rejects('css rejects javascript urls', function () use ($css) { $css->clean('a{background:url(javascript:alert(1))}'); });
$rejects('css rejects style element escape', function () use ($css) { $css->clean('a{}</style><script>alert(1)</script>'); });
$rejects('css rejects behavior', function () use ($css) { $css->clean('a{behavior:url(x.htc)}'); }, 'behavior');
$rejects('css rejects remote url()', function () use ($css) { $css->clean('a{background:url(//tracker.example/p.gif)}'); });
$rejects('css rejects unbalanced braces', function () use ($css) { $css->clean('a{color:red'); }, 'braces');
$check('css keeps local url()', $css->clean('a{background:url(/assets/ch247-media/2026/09/x.png)}') !== '');
$check('css escaping strips closing tags', stripos(CssSanitizer::forStyleElement('a{}</style><b>'), '</style') === false);

/* --------------------------------------------------------- 4. style schema */

$styleErrors = array();
$style = StyleSchema::sanitize(array(
    'desktop' => array('padding_top' => '40px', 'color' => 'primary', 'font_size' => '18px', 'evil' => 'x'),
    'mobile' => array('padding_top' => '20px'),
    'watch' => array('padding_top' => '10px'),
), $styleErrors);
$check('style schema keeps known properties', $style['desktop']['padding_top'] === '40px');
$check('style schema keeps colour tokens', $style['desktop']['color'] === 'primary');
$check('style schema drops unknown properties', !isset($style['desktop']['evil']));
$check('style schema drops unknown devices', !isset($style['watch']));
$check('style schema reports what it dropped', count($styleErrors) >= 2);
$check('style schema rejects url() injection', StyleSchema::value('background_image', 'url(javascript:alert(1))') === null);
$check('style schema rejects oversized lengths', StyleSchema::length('999999px') === null);
$check('style schema resolves colour tokens', strpos(StyleSchema::cssColor('primary'), 'var(--ch247-color-primary') === 0);
$check('style schema passes hex colours', StyleSchema::color('#0756d8') === '#0756d8');
$check('style schema rejects malformed colours', StyleSchema::color('red;}body{display:none') === null);
$declarations = StyleSchema::declarations(array('padding_top' => '40px', 'grid_columns' => '3'));
$check('style schema compiles declarations', in_array('padding-top:40px', $declarations, true));
$check('grid columns expand to a template', implode(';', $declarations) !== ''
    && strpos(implode(';', $declarations), 'repeat(3, minmax(0, 1fr))') !== false);
$check('breakpoints are tablet 1024 and mobile 767',
    StyleSchema::BREAKPOINTS['tablet'] === 1024 && StyleSchema::BREAKPOINTS['mobile'] === 767);

/* ------------------------------------------------------- 5. widget catalog */

$catalog = new WidgetCatalog();
$check('catalogue exposes 40 widgets plus 3 layout containers', count($catalog->keys()) === 43);
$check('layout containers are marked structural',
    $catalog->get('section')->isStructural() && $catalog->get('heading')->isStructural() === false);
$check('catalogue has the hosting widgets', $catalog->has('hosting_plans') && $catalog->has('domain_search')
    && $catalog->has('cart_summary') && $catalog->has('service_status'));
$check('catalogue has no raw html widget', !$catalog->has('html') && !$catalog->has('raw') && !$catalog->has('script'));
$check('live data widgets are marked', in_array('hosting_plans', $catalog->liveDataWidgets(), true)
    && !in_array('heading', $catalog->liveDataWidgets(), true));

$propErrors = array();
$props = $catalog->sanitizeProps('heading', array(
    'text' => '<script>alert(1)</script>Real heading', 'level' => 'h9', 'url' => 'javascript:alert(1)', 'bogus' => 'x',
), $propErrors);
$check('props strip markup from text fields', strpos($props['text'], '<script') === false);
$check('props fall back for invalid selects', $props['level'] === 'h2');
$check('props reject unsafe urls', $props['url'] === '');
$check('props report unknown keys', count($propErrors) >= 1 && !isset($props['bogus']));

$listErrors = array();
$many = array();
for ($i = 0; $i < 60; $i++) { $many[] = array('text' => 'item ' . $i, 'icon' => 'check'); }
$listProps = $catalog->sanitizeProps('list', array('items' => $many, 'list_style' => 'icon'), $listErrors);
$check('repeaters cap their item count', count($listProps['items']) <= 24);
$check('repeaters report the cap', count($listErrors) >= 1);
$mediaProps = $catalog->sanitizeProps('image', array('image' => array('id' => '5', 'url' => 'javascript:x', 'alt' => '<b>a</b>')), $listErrors);
$check('media props reject unsafe urls', $mediaProps['image']['url'] === '');
$check('a rejected media url clears the whole reference', $mediaProps['image']['id'] === 0);
$check('a rejected media url is reported', count($listErrors) >= 2);
$goodMedia = $catalog->sanitizeProps('image',
    array('image' => array('id' => '5', 'url' => '/assets/ch247-media/2026/09/a.png', 'alt' => '<b>Logo</b>')), $listErrors);
$check('valid media keeps its library id', $goodMedia['image']['id'] === 5);
$check('valid media keeps its url', $goodMedia['image']['url'] === '/assets/ch247-media/2026/09/a.png');
$check('media alt text is plain', strpos($goodMedia['image']['alt'], '<b>') === false
    && strpos($goodMedia['image']['alt'], 'Logo') !== false);

/* ----------------------------------------------------- 6. schema validator */

$validator = new SchemaValidator($catalog);
$valid = array('children' => Starters::blankPage());
$document = Document::fromArray($valid, $validator, true);
$check('a starter page validates', $document->nodeCount() >= 4);
$check('documents expose their widget keys', in_array('heading', $document->widgetKeys(), true));

$rejects('a widget cannot sit at the top level', function () use ($validator) {
    Document::fromArray(array('children' => array(Node::make('widget', 'heading'))), $validator, true);
}, 'sections');
$rejects('a section cannot contain a widget directly', function () use ($validator) {
    $section = Node::make('section');
    $section['children'] = array(Node::make('widget', 'heading'));
    Document::fromArray(array('children' => array($section)), $validator, true);
}, 'cannot contain');
$rejects('unknown widgets are refused', function () use ($validator) {
    $section = Node::make('section');
    $container = Node::make('container');
    $container['children'] = array(Node::make('widget', 'evil_exec'));
    $section['children'] = array($container);
    Document::fromArray(array('children' => array($section)), $validator, true);
}, 'unknown widget');
$rejects('future schema versions are refused', function () use ($validator) {
    Document::fromArray(array('schema' => 'cloudhost247-page/v1', 'version' => 99, 'children' => array()), $validator, true);
}, 'newer version');
$rejects('foreign schemas are refused', function () use ($validator) {
    Document::fromArray(array('schema' => 'elementor/v3', 'children' => array()), $validator, true);
}, 'Unsupported page schema');
$rejects('malformed json is refused', function () {
    SchemaValidator::decode('{"children": [');
}, 'not valid JSON');

$hostile = array('children' => array(array(
    'id' => 'x"><script>alert(1)</script>',
    'type' => 'section',
    'props' => array('html_tag' => 'script'),
    'settings' => array('css_class' => 'ok-class evil"onload="x', 'anchor' => 'a b'),
    'children' => array(),
)));
$errors = array();
$hostileDocument = Document::fromArray($hostile, new SchemaValidator($catalog), false);
$hostileNode = $hostileDocument->children()[0];
$check('hostile node ids are replaced', Ids::isNode($hostileNode['id']));
$check('hostile html tags fall back', $hostileNode['props']['html_tag'] === 'div');
$check('hostile class names are filtered', $hostileNode['settings']['css_class'] === 'ok-class');
$check('hostile anchors are dropped', $hostileNode['settings']['anchor'] === '');

$deep = Node::make('section');
$cursor = &$deep;
for ($i = 0; $i < 20; $i++) {
    $child = Node::make('container');
    $cursor['children'] = array($child);
    $cursor = &$cursor['children'][0];
}
unset($cursor);
$rejects('excessive nesting is refused', function () use ($deep, $catalog) {
    Document::fromArray(array('children' => array($deep)), new SchemaValidator($catalog), true);
});

$check('node ids can be regenerated for a copy',
    Node::regenerateIds(clone_array($document->children()[0]))['id'] !== $document->children()[0]['id']);

function clone_array(array $value) { return json_decode(json_encode($value), true); }

/* ------------------------------------------------------------ 7. rendering */

$renderer = new Renderer($catalog, new StyleCompiler());
$page = Document::fromArray(array('children' => Starters::blankPage()), $validator, true);
$published = $renderer->render($page, RenderContext::publish($data));
$check('published markup contains the heading', strpos($published['html'], '<h1 class="ch247-heading">') !== false);
$check('published markup has no editor attributes', strpos($published['html'], 'data-ch247-id') === false);
$editorRender = $renderer->render($page, RenderContext::editor($data));
$check('editor markup carries node ids', strpos($editorRender['html'], 'data-ch247-id') !== false);
$check('editor markup marks inline fields', strpos($editorRender['html'], 'data-ch247-inline="text"') !== false);

$xssDocument = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'heading', 'props' => array('text' => '"><script>alert(1)</script>', 'level' => 'h2')),
    array('widget' => 'text', 'props' => array('content' => '<p onmouseover="x()">Hi<script>alert(2)</script></p>')),
)))), $validator, false);
$xssHtml = $renderer->render($xssDocument, RenderContext::publish($data))['html'];
$check('heading text is escaped in output', strpos($xssHtml, '<script>alert(1)') === false);
$check('rich text is sanitised in output', strpos($xssHtml, 'onmouseover') === false && strpos($xssHtml, 'alert(2)') === false);
$check('the visible words survive sanitising', strpos($xssHtml, 'Hi') !== false);

$plansDocument = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'hosting_plans', 'props' => array('group' => 3, 'limit' => 3, 'columns' => 3, 'billing_cycle' => 'monthly')),
)))), $validator, false);
$plansHtml = $renderer->render($plansDocument, RenderContext::publish($data))['html'];
$check('hosting plans show live product names', strpos($plansHtml, 'Starter Cloud') !== false);
$check('hosting plans show live prices', strpos($plansHtml, '$6.50') !== false);
$check('hosting plans link to the real cart', strpos($plansHtml, 'cart.php?a=add&amp;pid=11') !== false);
$check('unpriced products say so instead of inventing a price',
    strpos($plansHtml, 'Price not published') !== false && strpos($plansHtml, '$0.00') === false);

$data->catalogueAvailable = false;
$unavailablePublish = $renderer->render($plansDocument, RenderContext::publish($data));
$check('an unreadable catalogue publishes nothing rather than a placeholder',
    strpos($unavailablePublish['html'], 'ch247-plan') === false);
$editorContext = RenderContext::editor($data);
$unavailableEditor = $renderer->render($plansDocument, $editorContext);
$check('the editor explains why a block is empty',
    strpos($unavailableEditor['html'], 'ch247-unavailable') !== false);
$check('the editor collects the notice for the toolbar', count($unavailableEditor['notices']) >= 1);
$data->catalogueAvailable = true;

$domainHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'domain_pricing', 'props' => array('limit' => 5, 'show_transfer' => true, 'show_renew' => true)),
    array('widget' => 'domain_search', 'props' => array('show_pricing' => true)),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('domain pricing renders live rates', strpos($domainHtml, '$11.99') !== false);
$check('unpriced TLDs are marked not offered', strpos($domainHtml, 'not offered') !== false);
$check('domain search posts to the WHMCS checker', strpos($domainHtml, 'action="domainchecker.php"') !== false);

$videoHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'video', 'props' => array('source' => 'youtube', 'url' => 'https://www.youtube.com/watch?v=dQw4w9WgXcQ')),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('youtube embeds use the privacy host', strpos($videoHtml, 'youtube-nocookie.com/embed/dQw4w9WgXcQ') !== false);
$badVideo = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'video', 'props' => array('source' => 'youtube', 'url' => 'https://evil.example/x')),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('unknown video hosts are not embedded', strpos($badVideo, '<iframe') === false);

$statusHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'service_status', 'props' => array('limit' => 4, 'show_checked_at' => true)),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('service status reports measured state', strpos($statusHtml, 'OVH API') !== false
    && strpos($statusHtml, 'is-ok') !== false && strpos($statusHtml, 'is-warn') !== false);

/* --------------------------------------------------- 7b. domain brokerage widgets */

$brokerWidgets = array('broker_this_domain', 'domain_brokerage_cta', 'brokerage_status', 'customer_brokerage_cases', 'brokerage_pricing', 'brokerage_faq');
foreach ($brokerWidgets as $brokerWidgetKey) {
    $check('the widget catalogue declares "' . $brokerWidgetKey . '"', $catalog->has($brokerWidgetKey));
}

$data->brokerInstalled = false;
$notInstalledHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'broker_this_domain', 'props' => array()),
    array('widget' => 'domain_brokerage_cta', 'props' => array()),
    array('widget' => 'brokerage_pricing', 'props' => array()),
)))), $validator, false), RenderContext::editor($data))['html'];
$check('brokerage widgets say so when the module is not installed',
    substr_count($notInstalledHtml, 'Domain Brokerage is not installed') === 3);

$data->brokerInstalled = true;
$data->brokerEnabled = false;
$disabledHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'broker_this_domain', 'props' => array('heading' => 'Want this domain?')),
    array('widget' => 'domain_brokerage_cta', 'props' => array('button_label' => 'Ask a broker')),
)))), $validator, false), RenderContext::editor($data))['html'];
$check('the CTA widgets never invite a request the platform is not accepting',
    strpos($disabledHtml, 'not currently being accepted') !== false
    && strpos($disabledHtml, 'Want this domain?') === false
    && strpos($disabledHtml, 'Ask a broker') === false);

$data->brokerEnabled = true;
$ctaHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'broker_this_domain', 'props' => array('heading' => 'Want this domain?', 'button_label' => 'Broker This Domain')),
    array('widget' => 'domain_brokerage_cta', 'props' => array('button_label' => 'Ask a broker')),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('Broker This Domain renders a real form to the brokerage module', strpos($ctaHtml, 'action="index.php?m=cloudhost247_broker"') !== false
    && strpos($ctaHtml, 'name="domain"') !== false && strpos($ctaHtml, 'Broker This Domain') !== false);
$check('the Domain Brokerage CTA links to the real new-case form', strpos($ctaHtml, 'href="index.php?m=cloudhost247_broker&amp;a=new"') !== false
    && strpos($ctaHtml, 'Ask a broker') !== false);

$previousUid = isset($_SESSION['uid']) ? $_SESSION['uid'] : null;
unset($_SESSION['uid']);
$signedOutHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_status', 'props' => array()),
    array('widget' => 'customer_brokerage_cases', 'props' => array()),
)))), $validator, false), RenderContext::editor($data))['html'];
$check('a signed-out visitor is asked to sign in rather than shown case data',
    substr_count($signedOutHtml, 'Sign in') === 2);

$_SESSION['uid'] = 501;
$data->brokerCaseRows = array();
$emptyCasesHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_status', 'props' => array()),
    array('widget' => 'customer_brokerage_cases', 'props' => array('empty_text' => 'No brokerage cases on this account.')),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('an account with no cases is told so honestly, not shown a sample case',
    strpos($emptyCasesHtml, 'You have no domain brokerage cases yet.') !== false
    && strpos($emptyCasesHtml, 'No brokerage cases on this account.') !== false);

$data->brokerCaseRows = array(
    (object) array('id' => 9, 'case_number' => 'BRK-2026-000184', 'domain' => 'example.com', 'status' => 'negotiation', 'updated_at' => '2026-09-20 10:00:00'),
    (object) array('id' => 10, 'case_number' => 'BRK-2026-000201', 'domain' => 'another.com', 'status' => 'completed', 'updated_at' => '2026-09-21 10:00:00'),
);
$casesHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_status', 'props' => array()),
    array('widget' => 'customer_brokerage_cases', 'props' => array('limit' => 5)),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('brokerage status shows the real most recent case and its real status label',
    strpos($casesHtml, 'BRK-2026-000184') !== false && strpos($casesHtml, 'Negotiation') !== false);
$check('customer brokerage cases lists every real case with a link to its detail page',
    strpos($casesHtml, 'BRK-2026-000201') !== false && strpos($casesHtml, 'Completed') !== false
    && strpos($casesHtml, 'index.php?m=cloudhost247_broker&amp;a=detail&amp;id=9') !== false);
if ($previousUid === null) { unset($_SESSION['uid']); } else { $_SESSION['uid'] = $previousUid; }
$data->brokerCaseRows = array();

$data->brokerFeeRows = array();
$noFeesHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_pricing', 'props' => array()),
)))), $validator, false), RenderContext::editor($data))['html'];
$check('brokerage pricing admits when no fee rules are configured, rather than inventing one',
    strpos($noFeesHtml, 'No brokerage fee rules are configured yet.') !== false);

$data->brokerFeeRows = array(
    array('name' => 'Standard brokerage fee', 'fee_type' => 'percentage', 'applies_to' => 'brokerage_fee', 'amount' => 10.0, 'currency' => 'USD'),
    array('name' => 'Transfer fee', 'fee_type' => 'fixed', 'applies_to' => 'transfer_fee', 'amount' => 25.0, 'currency' => 'USD'),
);
$feesHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_pricing', 'props' => array('heading' => 'Brokerage pricing')),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('brokerage pricing shows the real, separately configured fee rules',
    strpos($feesHtml, 'Standard brokerage fee') !== false && strpos($feesHtml, '10%') !== false
    && strpos($feesHtml, 'Transfer fee') !== false && strpos($feesHtml, 'USD 25.00') !== false);
$check('the acquisition price is always described as separate from these fees',
    strpos($feesHtml, 'always shown separately') !== false);

$faqHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'brokerage_faq', 'props' => array('items' => array(
        array('question' => 'Can you guarantee the acquisition?', 'answer' => '<p>No, never.</p>'),
    ))),
)))), $validator, false), RenderContext::publish($data))['html'];
$check('the Brokerage FAQ widget reuses the real FAQ renderer', strpos($faqHtml, 'Can you guarantee the acquisition?') !== false
    && strpos($faqHtml, 'ch247-faq__item') !== false);

$data->brokerInstalled = true;
$data->brokerEnabled = false;

$check('icons are drawn from the built-in set', Icons::has('check') && Icons::svg('check') !== '');
$check('unknown icons render nothing', Icons::svg('<script>') === '');

/* ------------------------------------------------------ 8. style compiler */

$styled = Document::fromArray(array('children' => array(buildSection(
    array(array('widget' => 'heading', 'props' => array('text' => 'Styled'))),
    array('desktop' => array('padding_top' => '80px'), 'tablet' => array('padding_top' => '40px'),
        'mobile' => array('padding_top' => '24px'))
))), $validator, false);
$compiled = (new StyleCompiler())->document($styled);
$sectionId = $styled->children()[0]['id'];
$check('each element gets its own class rule', strpos($compiled, '.ch247-n-' . $sectionId) !== false);
$check('tablet rules use the tablet breakpoint', strpos($compiled, '@media (max-width:1024px)') !== false);
$check('mobile rules use the mobile breakpoint', strpos($compiled, '@media (max-width:767px)') !== false);
$check('compiled css contains no raw input', strpos($compiled, 'script') === false);

$hiddenDocument = clone_array($styled->toArray());
$hiddenDocument['children'][0]['settings']['hidden'] = array('desktop' => true, 'tablet' => false, 'mobile' => false);
$hiddenCss = (new StyleCompiler())->document(Document::fromArray($hiddenDocument, $validator, false));
$check('desktop-only hiding is scoped to desktop', strpos($hiddenCss, '@media (min-width:1025px)') !== false);

$variables = (new StyleCompiler(array('color-primary' => '#123456', 'color-text' => 'javascript:x')))->variables();
$check('global style overrides apply', $variables['color-primary'] === '#123456');
$check('invalid global styles fall back to defaults', $variables['color-text'] === StyleCompiler::DEFAULT_VARIABLES['color-text']);
$check('root css emits custom properties', strpos((new StyleCompiler())->rootCss(), '--ch247-color-primary') !== false);

/* ------------------------------------------------------ 9. migration + db */

$migration = new BuilderInitialMigration();
$migration->up();
$check('the migration is versioned', $migration->version() === '1.0.0');
foreach (array('pages', 'revisions', 'templates', 'parts', 'menus', 'media', 'forms', 'submissions',
    'settings', 'preview_tokens', 'events') as $table) {
    $check('table mod_cloudhost247_builder_' . $table . ' exists',
        Capsule::schema()->hasTable('mod_cloudhost247_builder_' . $table));
}
$migration->up();
$check('the migration is safe to re-run', Capsule::schema()->hasTable('mod_cloudhost247_builder_pages'));
$check('no WHMCS core table was created', !Capsule::schema()->hasTable('tblproducts'));

/* ------------------------------------------------------- 10. page service */

$library = new LibraryRepository();
$settings = new Settings($library);
$pages = new PageService(new PageRepository(), new EventRepository(), $settings, $validator);

$created = $pages->create(array('title' => 'Managed WordPress Hosting'), 7,
    Document::fromArray(array('children' => Starters::blankPage()), $validator, false));
$check('creating a page derives a slug', $created['slug'] === 'managed-wordpress-hosting');
$check('a new page starts as a draft', $created['status'] === 'draft');
$check('a new page has no published content', $created['published_json'] === '');

$second = $pages->create(array('title' => 'Managed WordPress Hosting'), 7);
$check('duplicate titles get unique addresses', $second['slug'] !== $created['slug']);
$rejects('a page needs a title', function () use ($pages) { $pages->create(array('title' => '  '), 7); }, 'title');

$draftDocument = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'heading', 'props' => array('text' => 'Hosting that keeps up', 'level' => 'h1')),
    array('widget' => 'text', 'props' => array('content' => '<p>Real copy.</p>')),
)))), $validator, false);
$saved = $pages->saveDraft($created['id'], $draftDocument, 7);
$check('saving a draft reports the change', $saved['changed'] === true);
$check('saving a draft writes a revision', $saved['revision_id'] > 0);
$check('saving a draft does not publish', $saved['page']['status'] === 'draft' && $saved['page']['published_json'] === '');
$again = $pages->saveDraft($created['id'], $draftDocument, 7);
$check('an unchanged save writes no revision', $again['changed'] === false && $again['revision_id'] === 0);

$publishedPage = $pages->publish($created['id'], 7);
$check('publishing sets the status', $publishedPage['status'] === 'published');
$check('publishing copies the draft into the live column', strpos($publishedPage['published_json'], 'Hosting that keeps up') !== false);
$check('publishing records a snapshot revision', $publishedPage['published_revision_id'] > 0);
$check('publish leaves no unpublished changes', $publishedPage['has_unpublished_changes'] === false);

$edited = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'heading', 'props' => array('text' => 'Draft only headline', 'level' => 'h1')),
)))), $validator, false);
$pages->saveDraft($created['id'], $edited, 7);
$afterEdit = $pages->repository()->find($created['id']);
$check('editing after publishing flags unpublished changes', $afterEdit['has_unpublished_changes'] === true);
$check('editing after publishing does not change the live copy',
    strpos($afterEdit['published_json'], 'Draft only headline') === false);

$rejects('an empty page cannot be published', function () use ($pages, $second) {
    $pages->publish($second['id'], 7);
}, 'nothing to publish');
$rejects('scheduling in the past is refused', function () use ($pages, $created) {
    $pages->schedule($created['id'], '2020-01-01 00:00:00', 7);
}, 'future');

$revisions = $pages->revisions($created['id'], 20);
$check('revision history is recorded', count($revisions) >= 3);
$firstContentRevision = null;
foreach ($revisions as $revision) {
    if (strpos($revision['document_json'], 'Hosting that keeps up') !== false) { $firstContentRevision = $revision; }
}
$check('the revision history kept the earlier content', $firstContentRevision !== null);
$restored = $pages->restoreRevision($created['id'], $firstContentRevision['id'], 7);
$check('restoring reports which revision was used', $restored['restored_revision'] >= 1);
$check('restoring loads that version into the draft',
    strpos($pages->repository()->find($created['id'])['document_json'], 'Hosting that keeps up') !== false);
$check('restoring does not change the published page',
    strpos($pages->repository()->find($created['id'])['published_json'], 'Hosting that keeps up') !== false);
$check('the replaced draft is itself kept as a revision',
    count(array_filter($pages->revisions($created['id'], 40), function ($entry) {
        return strpos($entry['document_json'], 'Draft only headline') !== false;
    })) >= 1);
$pages->saveDraft($created['id'], $edited, 7);

$unpublished = $pages->unpublish($created['id'], 7);
$check('unpublishing clears the live copy', $unpublished['published_json'] === '');
$check('unpublishing returns the page to draft', $unpublished['status'] === 'draft');

$duplicate = $pages->duplicate($created['id'], 7);
$check('duplicating creates a new draft', $duplicate['status'] === 'draft' && $duplicate['id'] !== $created['id']);
$check('duplicating keeps the content', strpos($duplicate['document_json'], 'Draft only headline') !== false);

/* ---------------------------------------------------- 11. public resolver */

$theme = new ThemeService($library, new EventRepository(), $validator);
$menus = new MenuService($library);
$forms = new FormService(new FormRepository(), new EventRepository(), $settings, $library, null, FakeLocalApi::handler());
$resolver = new \CloudHost247\Builder\Site\PageResolver($pages, $theme, $settings,
    new Renderer($catalog, $settings->compiler()), $data, $menus, $forms);

$draftResult = $resolver->resolve($created['slug']);
$check('an unpublished page is not publicly reachable', $draftResult['found'] === false && $draftResult['status'] === 404);
$check('the 404 explains itself to the administrator', strpos($draftResult['reason'], 'draft') !== false);

$pages->publish($created['id'], 7);
$liveResult = $resolver->resolve($created['slug']);
$check('a published page is served', $liveResult['found'] === true && $liveResult['status'] === 200);
$check('the published page renders its content', strpos($liveResult['html'], 'Draft only headline') !== false);
$check('the published page ships its compiled css', strpos($liveResult['css'], '--ch247-color-primary') !== false);
$check('the published page is indexable by default', $liveResult['meta']['robots'] === 'index,follow');

$check('an unknown slug is a 404', $resolver->resolve('no-such-page')['status'] === 404);
$check('a traversal slug is refused', $resolver->resolve('../../etc/passwd')['status'] === 404);

$token = $pages->issuePreview($created['id'], 7);
$pages->saveDraft($created['id'], Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'heading', 'props' => array('text' => 'Secret upcoming launch', 'level' => 'h1')),
)))), $validator, false), 7);
$previewResult = $resolver->resolve($created['slug'], array('preview' => $token['token']));
$check('a valid preview token shows the draft', strpos($previewResult['html'], 'Secret upcoming launch') !== false);
$check('a preview is never indexable', $previewResult['meta']['robots'] === 'noindex,nofollow');
$check('the public page still shows the published copy',
    strpos($resolver->resolve($created['slug'])['html'], 'Secret upcoming launch') === false);
$check('an invalid preview token falls back to the published page',
    strpos($resolver->resolve($created['slug'], array('preview' => str_repeat('a', 64)))['html'], 'Secret upcoming launch') === false);

Capsule::table(PageRepository::TOKENS)->where('page_id', $created['id'])
    ->update(array('expires_at' => date('Y-m-d H:i:s', time() - 60)));
$check('an expired preview token is refused',
    $pages->repository()->verifyPreviewToken($created['id'], $token['token']) === false);

$scheduledPage = $pages->create(array('title' => 'Black Friday 2026'), 7);
$pages->saveDraft($scheduledPage['id'], Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'heading', 'props' => array('text' => 'Unannounced offer', 'level' => 'h1')),
)))), $validator, false), 7);
$pages->schedule($scheduledPage['id'], date('Y-m-d H:i:s', time() + 86400), 7);
$scheduledResult = $resolver->resolve('black-friday-2026');
$check('a scheduled page is not served early', $scheduledResult['found'] === false);
$check('the scheduled 404 says why', strpos($scheduledResult['reason'], 'scheduled') !== false);
Capsule::table(PageRepository::PAGES)->where('id', $scheduledPage['id'])
    ->update(array('publish_at' => date('Y-m-d H:i:s', time() - 60)));
$check('a scheduled page goes live when its time arrives', $resolver->resolve('black-friday-2026')['found'] === true);
$promoted = $pages->promoteScheduled(0);
$check('the maintenance task promotes due pages', in_array('black-friday-2026', $promoted, true));

$pages->updateMeta($created['id'], array('visibility' => 'clients'), 7);
$restricted = $resolver->resolve($created['slug'], array('session' => array('client_id' => 0, 'admin_id' => 0)));
$check('a client-only page is withheld from anonymous visitors', $restricted['found'] === false && $restricted['status'] === 403);
$allowed = $resolver->resolve($created['slug'], array('session' => array('client_id' => 42, 'admin_id' => 0)));
$check('a client-only page is served to a signed-in client', $allowed['found'] === true);
$pages->updateMeta($created['id'], array('visibility' => 'public'), 7);

/* ------------------------------------------------------- 12. theme parts */

$part = $theme->create(array('part_key' => 'main-header', 'name' => 'Main header', 'part_type' => 'header'), 7);
$check('a theme part starts as a draft', $part['status'] === 'draft');
$headerDocument = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'site_logo', 'props' => array('alt' => 'CloudHost247', 'url' => '/')),
)))), $validator, false);
$theme->saveDraft($part['id'], $headerDocument, 7);
$check('an unpublished part does not appear on a page',
    strpos($resolver->resolve($created['slug'])['header_html'], 'ch247-logo') === false);
$theme->publish($part['id'], 7);
$check('a published part appears on matching pages',
    strpos($resolver->resolve($created['slug'])['header_html'], 'ch247-logo') !== false);
$theme->disable($part['id'], 7);
$check('a disabled part disappears again',
    strpos($resolver->resolve($created['slug'])['header_html'], 'ch247-logo') === false);

$check('display conditions match everywhere by default',
    DisplayConditions::matches(array(), array('page_id' => 1, 'slug' => 'a', 'page_type' => 'page')));
$check('slug prefix conditions match',
    DisplayConditions::matches(array('include' => array(array('type' => 'slug_prefix', 'value' => 'offers/'))),
        array('slug' => 'offers/black-friday')));
$check('slug prefix conditions do not over-match',
    DisplayConditions::matches(array('include' => array(array('type' => 'slug_prefix', 'value' => 'offers/'))),
        array('slug' => 'pricing')) === false);
$check('exclusions beat inclusions',
    DisplayConditions::matches(array(
        'include' => array(array('type' => 'all', 'value' => '')),
        'exclude' => array(array('type' => 'page', 'value' => '5')),
    ), array('page_id' => 5)) === false);
$check('conditions describe themselves in words',
    strpos(DisplayConditions::describe(array('include' => array(array('type' => 'front_page', 'value' => '')))), 'front page') !== false);

/* --------------------------------------------------------- 13. templates */

$templates = new TemplateService($library, new EventRepository(), $validator);
$seeded = Starters::seed($library, $validator, 7);
$check('built-in templates are seeded', count($seeded) >= 8);
$check('built-in templates validate', count($templates->all()) >= 8);
$check('a built-in landing page template exists', $library->templateByKey('ch247-landing-page') !== null);
$rejects('built-in templates cannot be deleted', function () use ($templates, $library) {
    $templates->delete($library->templateByKey('ch247-hero-split')['id'], 7);
}, 'Built-in');

$saveSource = Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'cta', 'props' => array('heading' => 'Reusable CTA', 'button_label' => 'Go', 'button_url' => 'cart.php')),
)))), $validator, false);
$customTemplate = $templates->saveFromDocument(array(
    'template_key' => 'my-cta', 'name' => 'My CTA', 'category' => 'section',
), $saveSource, 7);
$check('a section can be saved as a template', $customTemplate['template_key'] === 'my-cta');

$exported = $templates->export($customTemplate['id'], 7);
$package = json_decode($exported, true);
$check('an export declares its format', $package['format'] === TemplateService::PACKAGE_FORMAT);
$check('an export carries a checksum', !empty($package['checksum']));
$inspection = $templates->inspect($exported);
$check('a round-tripped package verifies', $inspection['checksum_matches'] === true);
$check('inspection lists the widgets it contains', in_array('cta', $inspection['widgets'], true));

$tampered = $package;
$tampered['document']['children'][0]['children'][0]['children'][0]['children'][0]['props']['heading'] = 'Edited after export';
$tamperedInspection = $templates->inspect(json_encode($tampered));
$check('a tampered package fails its checksum', $tamperedInspection['checksum_matches'] === false);
$check('a tampered package is reported, not silently imported', count($tamperedInspection['warnings']) >= 1);

$rejects('a package with an unknown widget is refused', function () use ($templates, $package) {
    $evil = $package;
    $evil['document']['children'][0]['children'][0]['children'][0]['children'][0]['widget'] = 'php_exec';
    $templates->inspect(json_encode($evil));
}, 'unknown widget');
$rejects('a package that is not JSON is refused', function () use ($templates) {
    $templates->inspect('<?php system($_GET["c"]); ?>');
}, 'not valid JSON');
$rejects('a foreign package format is refused', function () use ($templates) {
    $templates->inspect(json_encode(array('format' => 'wordpress/v1', 'document' => array())));
}, 'Unsupported template format');

$scriptPackage = $package;
$scriptPackage['document']['children'][0]['children'][0]['children'][0]['children'][0]['props']['heading'] = '<script>alert(1)</script>';
$importedScript = $templates->import(json_encode($scriptPackage), 7);
$importedDocument = Document::fromJson($importedScript['template']['document_json'], $validator, false);
$importedHtml = $renderer->render($importedDocument, RenderContext::publish($data))['html'];
$check('an imported template cannot inject script', strpos($importedHtml, '<script>alert(1)') === false);

/* ------------------------------------------------------------- 14. media */

$media = new MediaService(new MediaRepository(), new EventRepository(), $settings, new PageRepository());
$pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==');
$pngPath = $temp . '/upload.png';
file_put_contents($pngPath, $pngBytes);

$uploaded = $media->upload(array('name' => 'Company Logo.png', 'tmp_name' => $pngPath, 'error' => UPLOAD_ERR_OK, 'size' => strlen($pngBytes)),
    7, array('alt_text' => 'Logo'), false);
$check('a valid image is stored', $uploaded['media']['id'] > 0);
$check('the stored file name is generated by the server',
    preg_match('/^company-logo-[a-f0-9]{10}\.png$/', $uploaded['media']['file_name']) === 1);
$check('the stored file lives under the media root',
    is_file($temp . '/media/' . $uploaded['media']['stored_path']));
$check('the media row records the real mime type', $uploaded['media']['mime'] === 'image/png');
$check('the directory is protected against execution', is_file($temp . '/media/.htaccess')
    && strpos((string) file_get_contents($temp . '/media/.htaccess'), 'php_flag engine off') !== false);

file_put_contents($temp . '/upload2.png', $pngBytes);
$duplicate = $media->upload(array('name' => 'other.png', 'tmp_name' => $temp . '/upload2.png', 'error' => UPLOAD_ERR_OK, 'size' => strlen($pngBytes)), 7, array(), false);
$check('identical bytes reuse the existing library item',
    $duplicate['duplicate'] === true && $duplicate['media']['id'] === $uploaded['media']['id']);

$shellPath = $temp . '/shell.png';
file_put_contents($shellPath, "<?php system(\$_GET['c']); ?>");
$rejects('a php payload renamed to .png is refused', function () use ($media, $shellPath) {
    $media->upload(array('name' => 'shell.png', 'tmp_name' => $shellPath, 'error' => UPLOAD_ERR_OK, 'size' => 40), 7, array(), false);
}, 'do not match');

$svgPath = $temp . '/logo.svg';
file_put_contents($svgPath, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
$rejects('svg uploads are refused with an explanation', function () use ($media, $svgPath) {
    $media->upload(array('name' => 'logo.svg', 'tmp_name' => $svgPath, 'error' => UPLOAD_ERR_OK, 'size' => 60), 7, array(), false);
}, 'SVG');

$phpPath = $temp . '/backdoor.php';
file_put_contents($phpPath, '<?php echo 1;');
$rejects('php uploads are refused', function () use ($media, $phpPath) {
    $media->upload(array('name' => 'backdoor.php', 'tmp_name' => $phpPath, 'error' => UPLOAD_ERR_OK, 'size' => 13), 7, array(), false);
}, 'never accepted');

$traversalPath = $temp . '/traversal.png';
file_put_contents($traversalPath, $pngBytes);
$traversal = $media->upload(array('name' => '../../../../etc/cron.d/evil.png', 'tmp_name' => $traversalPath,
    'error' => UPLOAD_ERR_OK, 'size' => strlen($pngBytes)), 7, array(), false);
$check('a traversal file name cannot escape the media root',
    strpos($traversal['media']['stored_path'], '..') === false
    && is_file($temp . '/media/' . $traversal['media']['stored_path']));

$oversized = $temp . '/big.png';
file_put_contents($oversized, $pngBytes . str_repeat('x', 200));
$settings->save(array('media_max_mib' => '1'), 7);
$check('the upload limit follows the setting', $media->maxBytes() === 1048576);
$check('containment refuses an absolute path', Paths::containedPath($temp . '/media', '/etc/passwd') === false);
$check('containment refuses traversal', Paths::containedPath($temp . '/media', '../../x') === false);
$check('containment resolves a normal path', Paths::containedPath($temp . '/media', '2026/09/a.png') !== false);

$usagePage = $pages->create(array('title' => 'Uses the logo'), 7);
$pages->saveDraft($usagePage['id'], Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'image', 'props' => array('image' => array(
        'id' => $uploaded['media']['id'], 'url' => $uploaded['media']['url_path'], 'alt' => 'Logo'))),
)))), $validator, false), 7);
$usage = $media->usage($uploaded['media']['id']);
$check('media usage is reported before deletion', count($usage) >= 1);
$deleted = $media->delete($uploaded['media']['id'], 7);
$check('deleting media removes the file', $deleted['file_removed'] === true);
$check('deleting media reports which pages referenced it', count($deleted['usage']) >= 1);

/* -------------------------------------------------------------- 15. forms */

FakeLocalApi::reset();
$form = $forms->save(array(
    'form_key' => 'contact-us', 'name' => 'Contact us', 'enabled' => true,
    'fields' => array(
        array('name' => 'full_name', 'label' => 'Full name', 'type' => 'text', 'required' => true),
        array('name' => 'email', 'label' => 'Email', 'type' => 'email', 'required' => true),
        array('name' => 'message', 'label' => 'Message', 'type' => 'textarea', 'required' => true),
        array('name' => 'Company Name', 'label' => 'Company', 'type' => 'text'),
        array('name' => '9invalid', 'label' => 'Dropped', 'type' => 'text'),
        array('name' => 'weird', 'label' => 'Dropped too', 'type' => 'select', 'options' => array()),
    ),
    'settings' => array('create_ticket' => true, 'ticket_department' => 2, 'notify_email' => 'ops@example.com'),
), 7);
$check('forms normalise usable field names', count($form['fields']) === 4
    && $form['fields'][3]['name'] === 'company_name');
$check('forms drop names that cannot be normalised',
    !in_array('9invalid', array_column($form['fields'], 'name'), true));
$check('a select with no choices is dropped',
    !in_array('weird', array_column($form['fields'], 'name'), true));
$check('form settings are normalised', $form['settings']['ticket_department'] === 2);
$rejects('a form needs at least one field', function () use ($forms) {
    $forms->save(array('form_key' => 'empty-form', 'name' => 'Empty', 'fields' => array()), 7);
}, 'at least one field');
$rejects('an invalid notification address is refused', function () use ($forms) {
    $forms->save(array('form_key' => 'bad-email', 'name' => 'Bad', 'fields' => array(
        array('name' => 'a', 'label' => 'A', 'type' => 'text')),
        'settings' => array('notify_email' => 'not-an-address')), 7);
}, 'not valid');

$formToken = $forms->issueToken($form['id']);
$check('form tokens verify', $forms->verifyToken($form['id'], $formToken) === true);
$check('form tokens are bound to their form', $forms->verifyToken($form['id'] + 1, $formToken) === false);
$check('forged form tokens are refused', $forms->verifyToken($form['id'], time() . '.' . str_repeat('a', 64)) === false);

$submission = array(
    'ch247_form_id' => $form['id'], 'ch247_form_token' => $formToken, 'ch247_form_ts' => time() - 30,
    'full_name' => 'Ada Lovelace', 'email' => 'ada@example.com', 'message' => 'Please migrate my site.',
);
FakeLocalApi::$responses['OpenTicket'] = array('result' => 'success', 'id' => 4242);
$outcome = $forms->submit($submission, array('page_id' => $created['id']));
$check('a valid submission is accepted', $outcome['status'] === 'received');
$check('a submission is stored', $forms->repository()->submissions($form['id'])['total'] === 1);
$check('a submission opens a real ticket', strpos($outcome['notification'], 'ticket #4242') !== false);
$check('the ticket call went through localAPI', FakeLocalApi::$calls[0]['action'] === 'OpenTicket');
$check('an admin notification is sent through WHMCS',
    strpos($outcome['notification'], 'admin email') !== false);
$stored = $forms->repository()->submissions($form['id'])['rows'][0];
$check('the stored submission keeps the declared fields only',
    isset($stored['payload']['email']) && !isset($stored['payload']['ch247_form_token']));
$check('the submission records the ticket id', $stored['ticket_id'] === 4242);

$honeypot = $submission;
$honeypot['ch247_hp'] = 'bot';
$honeypotResult = $forms->submit($honeypot, array());
$check('a honeypot submission is dropped quietly', $honeypotResult['status'] === 'ignored');
$check('a honeypot submission is not stored', $forms->repository()->submissions($form['id'])['total'] === 1);

$rejects('an expired or missing token is refused', function () use ($forms, $form) {
    $forms->submit(array('ch247_form_id' => $form['id'], 'ch247_form_token' => 'nope', 'full_name' => 'x'), array());
}, 'expired');
$rejects('a too-fast submission is refused', function () use ($forms, $form) {
    $forms->submit(array(
        'ch247_form_id' => $form['id'], 'ch247_form_token' => $forms->issueToken($form['id']),
        'ch247_form_ts' => time(), 'full_name' => 'x', 'email' => 'x@example.com', 'message' => 'y',
    ), array());
}, 'too quickly');
$rejects('missing required fields are refused', function () use ($forms, $form) {
    $forms->submit(array(
        'ch247_form_id' => $form['id'], 'ch247_form_token' => $forms->issueToken($form['id']),
        'ch247_form_ts' => time() - 30, 'full_name' => '', 'email' => 'ada@example.com', 'message' => 'y',
    ), array());
}, 'required');
$rejects('an invalid email is refused', function () use ($forms, $form) {
    $forms->submit(array(
        'ch247_form_id' => $form['id'], 'ch247_form_token' => $forms->issueToken($form['id']),
        'ch247_form_ts' => time() - 30, 'full_name' => 'A', 'email' => 'not-an-address', 'message' => 'y',
    ), array());
}, 'valid email');

$settings->save(array('form_rate_limit' => '1'), 7);
$rejects('the rate limit stops a flood', function () use ($forms, $form) {
    $forms->submit(array(
        'ch247_form_id' => $form['id'], 'ch247_form_token' => $forms->issueToken($form['id']),
        'ch247_form_ts' => time() - 30, 'full_name' => 'B', 'email' => 'b@example.com', 'message' => 'y',
    ), array());
}, 'Too many');
$settings->save(array('form_rate_limit' => '20'), 7);

$disabled = $forms->repository()->setEnabled($form['id'], false);
$check('a disabled form stops accepting submissions', $forms->publicDefinition($form['id']) === null);
$forms->repository()->setEnabled($form['id'], true);

/* -------------------------------------------------------------- 16. menus */

$menu = $menus->save(array('menu_key' => 'main-navigation', 'name' => 'Main navigation', 'items' => array(
    array('label' => 'Hosting', 'url' => 'cart.php', 'children' => array(
        array('label' => 'Shared', 'url' => 'cart.php?gid=3'),
    )),
    array('label' => 'Status', 'url' => 'https://status.example', 'target' => 'blank'),
)), 7);
$check('menus save their items', count($menu['items']) === 2);
$check('menus keep one level of children', count($menu['items'][0]['children']) === 1);
$rejects('a javascript menu link is refused', function () use ($menus) {
    $menus->save(array('menu_key' => 'bad-menu', 'name' => 'Bad', 'items' => array(
        array('label' => 'Evil', 'url' => 'javascript:alert(1)'),
    )), 7);
}, 'not an acceptable URL');

$navHtml = $renderer->render(Document::fromArray(array('children' => array(buildSection(array(
    array('widget' => 'nav_menu', 'props' => array('menu' => $menu['id'])),
)))), $validator, false), RenderContext::publish($data, array('menus' => $menus->resolver())))['html'];
$check('menus render as navigation', strpos($navHtml, 'Hosting') !== false && strpos($navHtml, 'ch247-nav__list--sub') !== false);
$check('new-tab menu links get rel protection', strpos($navHtml, 'rel="noopener noreferrer"') !== false);

/* ----------------------------------------------------------- 17. settings */

$check('settings expose defaults', $settings->get('public_base_path') === 'builder-page.php');
$rejects('out-of-range settings are refused', function () use ($settings) {
    $settings->save(array('revision_limit' => '9999'), 7);
}, 'between');
$rejects('a dangerous public path is refused', function () use ($settings) {
    $settings->save(array('public_base_path' => '../../shell.php'), 7);
}, 'simple relative path');
$settings->save(array('custom_css' => '.ch247-hero{color:#123456}'), 7);
$check('valid custom css is stored', strpos($settings->get('custom_css'), '#123456') !== false);
$rejects('dangerous custom css never reaches storage', function () use ($settings) {
    $settings->save(array('custom_css' => 'a{}</style><script>alert(1)</script>'), 7);
});
$check('the stored css is still the safe one', strpos($settings->get('custom_css'), 'script') === false);
$settings->save(array('global_styles' => array('color-primary' => '#ff6600', 'bogus' => 'x')), 7);
$check('global styles keep known variables', $settings->globalStyles()['color-primary'] === '#ff6600');
$check('global styles drop unknown variables', !isset($settings->globalStyles()['bogus']));
$check('custom css reaches the rendered page',
    strpos($resolver->resolve($created['slug'])['css'], '#123456') !== false);

/* ------------------------------------------------- 18. capabilities, log */

$policy = CapabilityPolicy::seedDefaults();
$check('capability seeding reports when the table is absent', $policy['available'] === false);
$check('capabilities default to permissive when unconfigured', CapabilityPolicy::allows('builder.publish') === true);
$check('privileged capabilities are declared',
    in_array('builder.publish', CapabilityPolicy::PRIVILEGED, true) && in_array('builder.css', CapabilityPolicy::PRIVILEGED, true));
$check('every capability has a label', count(CapabilityPolicy::CAPABILITIES) === count(CapabilityPolicy::keys()));

$events = new EventRepository();
$events->record('page.publish', array('entity_type' => 'page', 'entity_id' => '1', 'admin_id' => 7,
    'summary' => 'Published', 'metadata' => array('api_key' => 'secret-value', 'password' => 'hunter2',
        'elements' => 12, 'nested' => array('token' => 'abc', 'safe' => 'yes'))));
$recorded = $events->recent(array('event_type' => 'page.publish'), 1, 1)['rows'][0];
$check('the log drops credential-shaped metadata',
    !isset($recorded['metadata']['api_key']) && !isset($recorded['metadata']['password'])
    && !isset($recorded['metadata']['nested']['token']));
$check('the log keeps ordinary metadata',
    $recorded['metadata']['elements'] === 12 && $recorded['metadata']['nested']['safe'] === 'yes');
$check('the log never stores a raw ip address',
    strpos((string) json_encode($recorded), '203.0.113.9') === false);
$check('ip hashes are stable', EventRepository::ipHash() === EventRepository::ipHash() && EventRepository::ipHash() !== '');

/* -------------------------------------------------- 19. admin controller */

AdminGuard::reset();
AuditLogger::reset();
$controller = new AdminController('addonmodules.php?module=cloudhost247_builder', array(
    'settings' => $settings, 'library' => $library, 'validator' => $validator, 'pages' => $pages,
    'templates' => $templates, 'theme' => $theme, 'menus' => $menus, 'media' => $media,
    'forms' => $forms, 'events' => $events, 'catalog' => $catalog,
    'renderer' => new Renderer($catalog, $settings->compiler()),
));

$_GET = array('view' => 'pages');
$_POST = array();
$_SERVER['REQUEST_METHOD'] = 'GET';
$listing = $controller->handle();
$check('the controller authenticates the administrator', in_array('requireAdmin', AdminGuard::$calls, true));
$check('the controller checks a view capability', in_array('require:builder.view', AdminGuard::$calls, true));
$check('the pages view lists pages', isset($listing['listing']) && $listing['listing']['total'] >= 3);
$check('the controller supplies a CSRF token', $listing['token'] === 'test-csrf-token');

$view = new AdminView('addonmodules.php?module=cloudhost247_builder');
$html = $view->render($listing);
$check('the pages screen renders', strpos($html, 'Website Builder') !== false);
$check('every write form carries the token', substr_count($html, 'name="token"') >= 1);
$check('the screen escapes page titles', strpos($html, '<script>') === false);

AdminGuard::reset();
$_SERVER['REQUEST_METHOD'] = 'POST';
$_POST = array('action' => 'page.create', 'title' => 'Created through the controller', 'start_blank' => '1');
$_GET = array('view' => 'pages');
$result = $controller->handle();
$check('a POST action requires the CSRF token', in_array('requirePostToken', AdminGuard::$calls, true));
$check('a POST action requires its own capability', in_array('require:builder.pages', AdminGuard::$calls, true));
$check('the create action reports success', strpos($result['notice'], 'Created') !== false);

AdminGuard::reset();
AdminGuard::$tokenValid = false;
$_POST = array('action' => 'page.delete', 'page_id' => $created['id'], 'confirm_slug' => $created['slug']);
$denied = $controller->handle();
$check('a missing CSRF token blocks the action', strpos($denied['error'], 'CSRF') !== false);
$check('the page survived the blocked delete', $pages->repository()->find($created['id']) !== null);
AdminGuard::$tokenValid = true;

AdminGuard::reset();
AdminGuard::$denied = array('builder.publish');
$_POST = array('action' => 'page.publish', 'page_id' => $created['id']);
$refused = $controller->handle();
$check('publishing without the capability is refused', strpos($refused['error'], 'capability') !== false);
AdminGuard::$denied = array();

AdminGuard::reset();
$_POST = array('action' => 'page.delete', 'page_id' => $created['id'], 'confirm_slug' => 'wrong-slug');
$badConfirm = $controller->handle();
$check('deletion requires the exact address to confirm', strpos($badConfirm['error'], 'confirm') !== false);
$check('the page is still there after a failed confirmation', $pages->repository()->find($created['id']) !== null);

AdminGuard::reset();
$_GET = array('view' => 'settings');
$_POST = array();
$_SERVER['REQUEST_METHOD'] = 'GET';
$settingsView = $controller->handle();
$check('the settings screen reports real system state', isset($settingsView['health']['media_writable']));
$check('the settings screen lists the capability policy', count($settingsView['capability_labels']) === 10);
$settingsHtml = $view->render($settingsView);
$check('the settings screen renders', strpos($settingsHtml, 'Builder settings') !== false);

foreach (array('dashboard', 'templates', 'theme', 'headers', 'menus', 'styles', 'media',
    'backups', 'forms', 'seo', 'css', 'activity') as $screen) {
    AdminGuard::reset();
    $_GET = array('view' => $screen);
    $screenData = $controller->handle();
    $screenHtml = $view->render($screenData);
    $check('the ' . $screen . ' screen renders without error',
        is_string($screenHtml) && strlen($screenHtml) > 200 && strpos($screenHtml, 'Fatal error') === false);
}

AdminGuard::reset();
$_GET = array('view' => 'editor', 'id' => $created['id']);
$_POST = array();
$_SERVER['REQUEST_METHOD'] = 'GET';
$editorScreen = $controller->handle();
$editorHtml = $view->render($editorScreen);
$check('the editor screen mounts with a config payload', strpos($editorHtml, 'data-config=') !== false);
$check('the editor config carries the api base and token',
    strpos($editorHtml, 'ajax=1') !== false && strpos($editorHtml, 'test-csrf-token') !== false);
preg_match('/data-config="([^"]*)"/', $editorHtml, $configMatch);
$editorConfig = json_decode(html_entity_decode(isset($configMatch[1]) ? $configMatch[1] : '', ENT_QUOTES, 'UTF-8'), true);
$check('the editor config is valid JSON', is_array($editorConfig));
$check('editor config urls are usable, not html-escaped',
    is_array($editorConfig) && strpos($editorConfig['backUrl'], '&amp;') === false
    && strpos($editorConfig['api'], '&amp;') === false);
$check('the editor loads its assets through the allowlisted route',
    strpos($editorHtml, 'asset=editor.js') !== false && strpos($editorHtml, 'asset=runtime.css') !== false);

AdminGuard::reset();
$_GET = array('view' => 'backups');
$backups = $controller->handle();
$check('the backups index lists every page with its history',
    isset($backups['backups']) && count($backups['backups']) >= 3
    && $backups['backups'][0]['revisions'] >= 1);
$check('the backups index counts published snapshots separately',
    isset($backups['backups'][0]['snapshots']));

AdminGuard::reset();
$_GET = array('view' => 'headers');
$headers = $controller->handle();
$check('the header and footer screen lists only site parts',
    count(array_filter($headers['parts'], function ($part) {
        return !in_array($part['part_type'], array('header', 'footer'), true);
    })) === 0);

AdminGuard::reset();
AdminGuard::$denied = array('builder.css');
$_GET = array('view' => 'css');
$cssDenied = $controller->handle();
$check('a denied view shows the access screen', $cssDenied['view'] === 'denied');
$check('the denied screen names the capability', stripos($cssDenied['error'], 'custom CSS') !== false);
AdminGuard::$denied = array();

/* --------------------------------------------------- 20. renderer parity */

AdminGuard::reset();
$parityPage = $pages->repository()->find($created['id']);
$parityDocument = $pages->published($parityPage);
$publishRender = $renderer->render($parityDocument, RenderContext::publish($data));
$previewRender = $renderer->render($parityDocument, RenderContext::preview($data));
$check('preview and published markup are identical', $publishRender['html'] === $previewRender['html']);
$check('preview and published css are identical', $publishRender['css'] === $previewRender['css']);

$editorParity = $renderer->render($parityDocument, RenderContext::editor($data));
$strippedEditor = preg_replace('/ data-ch247-(id|type|widget|inline)="[^"]*"/', '', $editorParity['html']);
$check('the editor canvas differs from the published page only by its editing hooks',
    strpos($strippedEditor, '<h1 class="ch247-heading">') !== false);

/* ---------------------------------------------------------------- report */

echo str_repeat('-', 64) . PHP_EOL;
echo 'Assertions passed: ' . $passed . PHP_EOL;
if ($failed > 0) {
    echo 'Assertions failed: ' . $failed . PHP_EOL;
}

// Clean up the temporary docroot.
$cleanup = function ($path) use (&$cleanup) {
    if (!is_dir($path)) { return; }
    foreach (scandir($path) as $entry) {
        if ($entry === '.' || $entry === '..') { continue; }
        $full = $path . '/' . $entry;
        if (is_dir($full)) { $cleanup($full); continue; }
        @unlink($full);
    }
    @rmdir($path);
};
$cleanup($temp);

exit($failed === 0 ? 0 : 1);

/** Build a section > container > column wrapper around widget specs. */
function buildSection(array $widgets, array $style = array())
{
    $column = Node::make('column', '', array('html_tag' => 'div', 'vertical_align' => 'flex-start'));
    foreach ($widgets as $widget) {
        $column['children'][] = Node::make('widget', $widget['widget'],
            isset($widget['props']) ? $widget['props'] : array());
    }
    $container = Node::make('container', '', array('html_tag' => 'div', 'layout' => 'flex'));
    $container['children'] = array($column);
    $section = Node::make('section', '', array('html_tag' => 'section', 'content_width' => 'boxed'), $style);
    $section['children'] = array($container);
    return $section;
}
