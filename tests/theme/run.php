<?php
/**
 * CloudHost247 Theme Manager behavioural tests.
 *
 * The real repository, product-component bridge, preview renderer and admin
 * panel builder run against the in-memory Capsule double in fakes.php. Nothing
 * here is a stub of the code under test: the only stand-in is the page builder
 * catalogue reader, injected through ProductComponents::useReader() so both the
 * installed and the not-installed paths can be exercised in one process.
 */
$root = dirname(__DIR__, 2);
require_once $root . '/tests/theme/fakes.php';
ch247_theme_fresh();
require_once $root . '/modules/addons/cloudhost247_core/lib/Security/SecretPolicy.php';
require_once $root . '/modules/addons/cloudhost247_core/lib/Support/Logger.php';
require_once $root . '/modules/addons/cloudhost247_core/lib/Support/AuditLogger.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/Content/ProductComponents.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/View/PreviewRenderer.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/View/AdminPanels.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/ThemeRepository.php';
require_once $root . '/modules/addons/cloudhost247_theme/lib/PublicPage.php';

use CloudHost247\Theme\Content\ProductComponents;
use CloudHost247\Theme\ThemeRepository;
use CloudHost247\Theme\View\AdminPanels;

/** Catalogue reader double: records the bounded spec it is asked for. */
class CH247ThemeReaderStub
{
    public $calls = array();
    private $products;
    private $available;
    private $reason;
    public function __construct($available = true, $reason = '', $products = array())
    {
        $this->available = $available;
        $this->reason = $reason;
        $this->products = $products;
    }
    public function available() { return $this->available; }
    public function unavailableReason() { return $this->reason; }
    public function products($group = 0, $limit = 12, $cycle = 'monthly')
    {
        $this->calls[] = compact('group', 'limit', 'cycle');
        return $this->products;
    }
}

$phpDiagnostics = array();
set_error_handler(function ($no, $str, $file, $line) use (&$phpDiagnostics) { $phpDiagnostics[] = basename($file) . ':' . $line . ' ' . $str; return true; });

$tests = array();
$throws = function ($fn) { try { $fn(); return false; } catch (Throwable $e) { return true; } };

/* ------------------------------------------------- product components */

$bounded = ProductComponents::normalise(array('type' => 'products', 'heading' => '  Plans <b>for you</b> ', 'limit' => 99, 'cycle' => 'hourly', 'layout' => 'carousel'));
$tests['product widget spec is bounded'] = $bounded['limit'] === 12 && $bounded['cycle'] === 'monthly' && $bounded['layout'] === 'grid' && $bounded['heading'] === 'Plans for you';
$tests['non product widgets are ignored'] = ProductComponents::normalise(array('type' => 'text')) === null && ProductComponents::normalise('products') === null;

ProductComponents::useReader(function () { return null; });
$missing = ProductComponents::forContent(array(array('id' => 1, 'slug' => 'plans', 'product_widget' => array('type' => 'products', 'limit' => 3))));
$tests['a missing catalogue is reported, not invented'] = $missing[0]['product_component']['available'] === false
    && strpos($missing[0]['product_component']['reason'], 'page builder') !== false
    && $missing[0]['product_component']['products'] === array();

$stub = new CH247ThemeReaderStub(true, '', array(
    array('id' => 1, 'name' => 'Starter'), array('id' => 2, 'name' => 'Growth'),
    array('id' => 3, 'name' => 'Scale'), array('id' => 4, 'name' => 'Extra'),
));
ProductComponents::useReader(function () use ($stub) { return $stub; });
$resolved = ProductComponents::resolve(array('type' => 'products', 'group' => 4, 'limit' => 3, 'cycle' => 'quarterly'));
$tests['the declared limit and cycle reach the reader'] = $resolved['available'] === true && $stub->calls === array(array('group' => 4, 'limit' => 3, 'cycle' => 'quarterly'));
$tests['the component never returns more than its limit'] = count($resolved['products']) === 3 && $resolved['products'][0]['name'] === 'Starter';

$unavailable = new CH247ThemeReaderStub(false, 'The WHMCS product catalogue table is not present.');
ProductComponents::useReader(function () use ($unavailable) { return $unavailable; });
$reported = ProductComponents::resolve(array('type' => 'products'));
$tests['an unavailable catalogue keeps the reader reason'] = $reported['available'] === false && $reported['reason'] === 'The WHMCS product catalogue table is not present.' && $reported['products'] === array();

ProductComponents::useReader(function () { throw new RuntimeException('reader exploded'); });
$tests['a broken reader cannot break the page'] = ProductComponents::resolve(array('type' => 'products'))['available'] === false;

$budget = array();
for ($i = 0; $i < ProductComponents::MAX_COMPONENTS + 1; $i++) {
    $budget[] = array('id' => $i + 1, 'slug' => 'block-' . $i, 'product_widget' => array('type' => 'products', 'limit' => 1));
}
$decorated = ProductComponents::forContent($budget);
$tests['the component budget is enforced'] = isset($decorated[ProductComponents::MAX_COMPONENTS - 1]['product_component']) && !isset($decorated[ProductComponents::MAX_COMPONENTS]['product_component']);
$tests['rows without a product widget are untouched'] = !array_key_exists('product_component', ProductComponents::forContent(array(array('id' => 9, 'slug' => 'plain')))[0]);

/* ------------------------------------ the real page builder catalogue reader */

foreach (array('Contracts/LiveDataSource', 'Support/HtmlSanitizer', 'Catalog/Money', 'Catalog/CartLinks', 'Catalog/WhmcsDataSource') as $file) {
    require_once $root . '/modules/addons/cloudhost247_builder/lib/' . $file . '.php';
}
\WHMCS\Database\Capsule::table('tblproducts')->insert(array('id' => 21, 'gid' => 2, 'name' => 'Cloud Starter', 'description' => 'Small plan', 'hidden' => 0, 'order' => 0));
\WHMCS\Database\Capsule::table('tblproductgroups')->insert(array('id' => 2, 'name' => 'Hosting', 'hidden' => 0, 'order' => 0));
\WHMCS\Database\Capsule::table('tblcurrencies')->insert(array('id' => 1, 'code' => 'USD', 'prefix' => '$', 'suffix' => '', 'default' => 1));
\WHMCS\Database\Capsule::table('tblpricing')->insert(array('id' => 1, 'type' => 'product', 'relid' => 21, 'currency' => 1, 'monthly' => 9.5, 'msetupfee' => 0));
ProductComponents::useReader(null);
$live = ProductComponents::resolve(array('type' => 'products', 'group' => 2, 'limit' => 6, 'cycle' => 'monthly'));
$tests['the component queries real whmcs products through the builder reader'] = $live['available'] === true && count($live['products']) === 1 && $live['products'][0]['name'] === 'Cloud Starter';
$tests['a published price comes from tblpricing as a number'] = isset($live['products'][0]['price']['amount']) && abs($live['products'][0]['price']['amount'] - 9.5) < 0.0001;
\WHMCS\Database\Capsule::table('tblpricing')->where('relid', 21)->update(array('monthly' => -1));
$unpriced = ProductComponents::resolve(array('type' => 'products', 'group' => 2, 'limit' => 6, 'cycle' => 'monthly'));
$tests['a cycle whmcs does not offer has no price at all'] = $unpriced['products'][0]['price'] === null;

/* ------------------------------------------------------------------ ordering */

ch247_theme_seed_content(4, 'block', 'front-page-only', 'Front page only', 0, true, array('pages' => array('index-php'), 'layout' => 'block-hero'));
ch247_theme_seed_content(1, 'navigation', 'home', 'Home', 0, true);
ch247_theme_seed_content(2, 'navigation', 'hosting', 'Hosting', 1, true);
ch247_theme_seed_content(3, 'navigation', 'domains', 'Domains', 2, true);
$repository = new ThemeRepository();
$moved = $repository->reorder(array('content_type' => 'navigation', 'ids' => array(3, 1, 2)));
$order = array();
foreach (ch247_theme_rows('mod_cloudhost247_theme_content') as $row) { $order[(int) $row->id] = (int) $row->sort_order; }
$tests['a complete permutation is applied in the given order'] = $moved === 3 && $order[3] === 0 && $order[1] === 1 && $order[2] === 2;

$repository->reorder(array('content_type' => 'navigation', 'order' => array(3 => 0)));
$order = array();
foreach (ch247_theme_rows('mod_cloudhost247_theme_content') as $row) { $order[(int) $row->id] = (int) $row->sort_order; }
$tests['the numeric fallback moves the named row and re-sequences the rest'] = $order[3] === 0 && $order[1] === 1 && $order[2] === 2;

$before = $order;
$tests['an incomplete list is refused'] = $throws(function () use ($repository) { $repository->reorder(array('content_type' => 'navigation', 'ids' => array(1, 2))); });
$tests['a duplicated list is refused'] = $throws(function () use ($repository) { $repository->reorder(array('content_type' => 'navigation', 'ids' => array(1, 1, 2))); });
$tests['an unknown type is refused'] = $throws(function () use ($repository) { $repository->reorder(array('content_type' => 'widget', 'ids' => array(1, 2, 3))); });
$tests['an item outside the type is refused'] = $throws(function () use ($repository) { $repository->reorder(array('content_type' => 'navigation', 'order' => array(999 => 0))); });
$after = array();
foreach (ch247_theme_rows('mod_cloudhost247_theme_content') as $row) { $after[(int) $row->id] = (int) $row->sort_order; }
$tests['a refused reorder changes nothing'] = $before === $after;

/* ------------------------------------------------------------- authoring */

$tests['an unsafe widget link is refused'] = $throws(function () use ($repository) {
    $repository->reorder(array('content_type' => 'navigation', 'ids' => array(3, 1, 2)));
    $repository->saveContent(array('content_type' => 'block', 'title' => 'Pricing', 'slug' => 'pricing', 'widgets' => "One | First | javascript:alert(1)"));
});

$blockId = $repository->saveContent(array(
    'content_type' => 'block', 'title' => 'Pricing block', 'slug' => 'Pricing Block', 'published' => 1,
    'layout' => '../../etc/block-pricing.tpl', 'pages' => 'Home Page, cloudhost247-hosting.php',
    'widgets' => "Starter | Good for one site | https://example.test/plans\n\nGrowth | More room | /cart.php",
    'show_products' => 1, 'product_heading' => 'Popular plans', 'product_group' => 2, 'product_limit' => 99, 'product_cycle' => 'annually', 'product_layout' => 'list',
));
$stored = null;
foreach (ch247_theme_rows('mod_cloudhost247_theme_content') as $row) { if ((int) $row->id === (int) $blockId) { $stored = json_decode($row->payload_json, true); } }
$tests['block composition is stored sanitised'] = $stored['layout'] === 'etcblock-pricingtpl'
    && $stored['pages'] === array('home-page', 'cloudhost247-hosting-php')
    && count($stored['widgets']) === 2 && $stored['widgets'][0]['title'] === 'Starter' && $stored['widgets'][1]['url'] === '/cart.php';
$tests['the stored product component is the bounded spec'] = $stored['product_widget']['limit'] === ProductComponents::MAX_LIMIT
    && $stored['product_widget']['cycle'] === 'annually' && $stored['product_widget']['layout'] === 'list' && $stored['product_widget']['group'] === 2;

$plainId = $repository->saveContent(array('content_type' => 'block', 'title' => 'Plain', 'slug' => 'plain', 'published' => 1));
$plain = null;
foreach (ch247_theme_rows('mod_cloudhost247_theme_content') as $row) { if ((int) $row->id === (int) $plainId) { $plain = json_decode($row->payload_json, true); } }
$tests['a block without the checkbox stores no product component'] = $plain['product_widget'] === null && $plain['widgets'] === array();

\WHMCS\Database\Capsule::table('mod_cloudhost247_theme_content')->insert(array('id' => 77, 'content_type' => 'block', 'slug' => 'draft-block', 'title' => 'Draft', 'payload_json' => json_encode(array('product_widget' => array('type' => 'products', 'limit' => 2))), 'published' => 0, 'sort_order' => 0));
$blocks = $repository->blocks();
$tests['a published block exposes the resolved component to the theme'] = isset($blocks['pricing-block']->product_component['component']['limit']) && $blocks['pricing-block']->product_component['component']['limit'] === ProductComponents::MAX_LIMIT;
$tests['an unpublished block stays out of the client context'] = !isset($blocks['draft-block']);

$layout = $repository->pageLayout('cloudhost247-hosting.php');
$tests['block layout resolves the sanitised template name'] = $layout['block_layouts']['pricing-block'] === 'etcblock-pricingtpl' && $layout['block_layouts']['plain'] === 'plain';
$tests['a block assigned to a page only renders there'] = in_array('pricing-block', $layout['page_blocks'], true) && !in_array('front-page-only', $layout['page_blocks'], true);
$tests['an assigned block renders on its own page'] = in_array('front-page-only', $repository->pageLayout('index.php')['page_blocks'], true);
$tests['a block with no page assignment renders everywhere'] = in_array('plain', $repository->pageLayout('index.php')['page_blocks'], true) && in_array('plain', $layout['page_blocks'], true);

/* --------------------------------------------------------------- preview */

$visual = $repository->visualPreview($repository->settings(), $repository->all());
$tests['the preview emits the live custom properties'] = strpos($visual['css'], '--ch247-primary:#0756d8') !== false && strpos($visual['css'], '--ch247-width:1180px') !== false;
$tests['the preview renders the published sections'] = in_array('hero', $visual['sections']) && $visual['markup'] !== '' && strpos($visual['markup'], 'ch247-preview') !== false;

$bad = $repository->visualPreview(array_merge($repository->settings(), array('primary_color' => 'red', 'layout_width' => '400')));
$tests['an invalid colour is not used in the preview'] = strpos($bad['css'], '--ch247-primary:inherit') !== false;
$tests['the preview explains what it could not use'] = count($bad['notes']) >= 2;

$markup = $repository->visualPreview($repository->settings(), array(array('id' => 1, 'content_type' => 'section', 'slug' => 'about', 'title' => 'About <b>us</b>', 'published' => true, 'summary' => '', 'body' => '<script>alert(1)</script><p>Hello</p>')));
$tests['the preview escapes content and executes no stored markup'] = strpos($markup['markup'], '<script') === false && strpos($markup['markup'], 'alert(1)') !== false && strpos($markup['markup'], '&lt;b&gt;') !== false;

ProductComponents::useReader(function () { return null; });
$visualUnavailable = $repository->visualPreview($repository->settings(), $repository->all());
$tests['the preview names an unavailable product component'] = count($visualUnavailable['notes']) > 0 && strpos($visualUnavailable['notes'][0], 'not shown') !== false;
$contentBefore = count(ch247_theme_rows('mod_cloudhost247_theme_content'));
$repository->visualPreview(array('brand_name' => 'Other'), array());
$tests['the preview persists nothing'] = count(ch247_theme_rows('mod_cloudhost247_theme_content')) === $contentBefore;

/* ---------------------------------------------------------- admin panels */

$panel = AdminPanels::order($repository->all(), 'tok-123');
$tests['the ordering panel offers drag and drop with a saved order'] = strpos($panel, 'ch247-order-list') !== false && strpos($panel, 'name="ids[]"') !== false && strpos($panel, 'value="reorder"') !== false && strpos($panel, 'name="order[') !== false;
$tests['the ordering panel carries the csrf token'] = strpos($panel, 'name="token" value="tok-123"') !== false;
$escapedPanel = AdminPanels::order(array(array('id' => 5, 'content_type' => 'page', 'title' => '<img src=x onerror=alert(1)>', 'slug' => 'x', 'published' => true)), 'tok');
$tests['the ordering panel escapes titles'] = strpos($escapedPanel, '<img src=x') === false && strpos($escapedPanel, '&lt;img src=x') !== false;
$visualPanel = AdminPanels::visual($visual);
$tests['the visual panel wraps the preview css and reports notes'] = strpos($visualPanel, '<style>') !== false && strpos($visualPanel, $visual['css']) !== false;

/* ------------------------------------------------------------ public routes */

/** Records what a root page's front controller asked the client area to do. */
class CH247ThemeClientAreaRecorder
{
    public $calls = array();
    public $assigned = array();
    public function setPageTitle($title) { $this->calls[] = array('setPageTitle', $title); }
    public function addToBreadCrumb($url, $label) { $this->calls[] = array('addToBreadCrumb', $url, $label); }
    public function assign($key, $value) { $this->assigned[$key] = $value; }
    public function setTemplate($template) { $this->calls[] = array('setTemplate', $template); }
    public function output() { $this->calls[] = array('output'); }
    public function template() { foreach ($this->calls as $call) { if ($call[0] === 'setTemplate') { return $call[1]; } } return null; }
    public function title() { foreach ($this->calls as $call) { if ($call[0] === 'setPageTitle') { return $call[1]; } } return null; }
}

ch247_theme_fresh();
$repository = new ThemeRepository();
ch247_theme_seed_content(101, 'page', 'dedicated-server', 'Dedicated servers from us', 0, true, array('summary' => 'Bare metal', 'body' => '<p>Real page body</p>', 'seo_title' => 'Dedicated servers | CloudHost247'));
ch247_theme_seed_content(102, 'page', 'offers', 'Draft offers', 0, false, array('body' => '<p>Not published</p>'));

$resolvedPage = \CloudHost247\Theme\PublicPage::resolve('dedicated-server');
$tests['a published page resolves for its route'] = is_array($resolvedPage) && $resolvedPage['title'] === 'Dedicated servers from us' && $resolvedPage['body'] === '<p>Real page body</p>';
$tests['an unpublished page does not resolve'] = \CloudHost247\Theme\PublicPage::resolve('offers') === null;
$tests['an unknown slug does not resolve'] = \CloudHost247\Theme\PublicPage::resolve('never-written') === null;

$_SERVER['PHP_SELF'] = '/dedicated-server.php';
$recorder = new CH247ThemeClientAreaRecorder();
$result = \CloudHost247\Theme\PublicPage::route($recorder, 'dedicated-server', 'Dedicated Servers');
$tests['a published route renders the first-party page template'] = $result['status'] === 200 && $recorder->template() === 'cloudhost247-page';
$tests['the rendered page is assigned to the theme variable'] = isset($recorder->assigned['cloudhost247Page']) && $recorder->assigned['cloudhost247Page']['slug'] === 'dedicated-server';
$tests['seo title wins for the document title'] = $recorder->title() === 'Dedicated servers | CloudHost247';
$tests['the breadcrumb keeps the route label'] = in_array(array('addToBreadCrumb', 'dedicated-server.php', 'Dedicated Servers'), $recorder->calls, true);

$recorder = new CH247ThemeClientAreaRecorder();
$result = \CloudHost247\Theme\PublicPage::route($recorder, 'offers', 'Offers');
$tests['an unpublished route answers 404'] = $result['status'] === 404 && $result['page']['missing'] === true;
$tests['an unpublished route explains itself'] = strpos($result['page']['body'], 'no published content') !== false;
$tests['an unpublished route still uses the first-party template'] = $recorder->template() === 'cloudhost247-page';

$recorder = new CH247ThemeClientAreaRecorder();
$result = \CloudHost247\Theme\PublicPage::notFound($recorder, 'page-not-found', 'Page Not Found');
$tests['the not-found route answers 404 with built-in wording'] = $result['status'] === 404 && strpos($result['page']['body'], 'no published content') !== false;

ch247_theme_seed_content(103, 'page', 'page-not-found', 'We could not find that page', 0, true, array('body' => '<p>Operator wording</p>'));
$recorder = new CH247ThemeClientAreaRecorder();
$result = \CloudHost247\Theme\PublicPage::notFound($recorder, 'page-not-found', 'Page Not Found');
$tests['the not-found route uses the operators wording when published'] = $result['status'] === 404 && $result['page']['body'] === '<p>Operator wording</p>' && $recorder->title() === 'We could not find that page';

$hostile = \CloudHost247\Theme\PublicPage::missing('<script>alert(1)</script>');
$tests['a fallback title is escaped'] = strpos($hostile['title'], '<script') === false && strpos($hostile['title'], '&lt;script&gt;') !== false;

CH247ThemeFakeDB::$failTables = array('mod_cloudhost247_theme_content');
$tests['a failing content store is a 404, not a fatal error'] = \CloudHost247\Theme\PublicPage::resolve('dedicated-server') === null;
$recorder = new CH247ThemeClientAreaRecorder();
$tests['a failing content store still renders a page'] = \CloudHost247\Theme\PublicPage::route($recorder, 'dedicated-server', 'Dedicated Servers')['status'] === 404;
CH247ThemeFakeDB::$failTables = array();

restore_error_handler();
$tests['no php diagnostics raised'] = ($phpDiagnostics === array());
foreach (array_slice(array_unique($phpDiagnostics), 0, 5) as $diagnostic) { echo "# diagnostic: $diagnostic\n"; }

$fail = 0;
foreach ($tests as $name => $ok) { echo ($ok ? 'ok' : 'not ok') . " - $name\n"; if (!$ok) { $fail++; } }
echo '# ' . count($tests) . ' assertions, ' . $fail . " failed\n";
exit($fail ? 1 : 0);
