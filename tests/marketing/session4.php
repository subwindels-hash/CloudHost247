<?php
/**
 * CloudHost247 Marketing — SESSION 4 behavior suite.
 *
 * Templates and the block builder: the closed block catalog, the sanitizer,
 * URL rules, honest warnings, rendered-output fidelity and the admin flow.
 * Pure PHP, in-memory fakes (fakes.php); every test calls the real classes.
 * Run: php tests/marketing/run.php
 */

use CloudHost247\Marketing\Domain\TemplateBlock;
use CloudHost247\Marketing\Repositories\TemplateRepository;
use CloudHost247\Marketing\Security\HtmlSanitizer;
use CloudHost247\Marketing\Services\TemplateService;
use WHMCS\Database\Capsule;

/** A valid, fully populated design used by several tests. */
function ch247_marketing_sample_design()
{
    return array('blocks' => array(
        array('type' => 'heading', 'text' => 'Welcome aboard', 'level' => '1', 'align' => 'center'),
        array('type' => 'paragraph', 'text' => "Hello there,\nhere is the news.", 'align' => 'left'),
        array('type' => 'button', 'label' => 'Read more', 'url' => 'https://cloudhost247.example/read', 'variant' => 'primary', 'align' => 'center'),
        array('type' => 'legal', 'text' => 'CloudHost247 — unsubscribe from any message.'),
    ));
}

function ch247_marketing_template_flush()
{
    ch247_marketing_fresh();
    cloudhost247_marketing_activate(); // also seeds the builtin library
    $_SESSION['adminid'] = 1;
    $_SESSION['adminroleid'] = 1;
    $_SERVER['REQUEST_METHOD'] = 'GET';
    $_GET = array(); $_POST = array(); $_REQUEST = array();
}

return array(

// ------------------------------------------------------------------- catalog

'The block catalog is closed: unknown blocks, unknown fields and bad values are refused' => function () {
    ch247_marketing_admin();
    $service = new TemplateService();

    $rejects = array(
        array(array('blocks' => array(array('type' => 'iframe', 'src' => 'x'))), 'unknown type'),
        array(array('blocks' => array(array('text' => 'no type'))), 'unknown type'),
        array(array('blocks' => array()), 'at least one block'),
        array(array('blocks' => array(array('type' => 'heading', 'text' => ''))), 'Heading text is required'),
        array(array('blocks' => array(array('type' => 'heading', 'text' => str_repeat('x', 161)))), 'at most 160 characters'),
        array(array('blocks' => array(array('type' => 'heading', 'text' => 'Hi', 'align' => 'justify'))), 'must be one of left, center, right'),
        array(array('blocks' => array(array('type' => 'spacer', 'height' => '12px'))), 'must be a whole number'),
        array(array('blocks' => array(array('type' => 'spacer', 'height' => '200'))), 'must be at most 96'),
        array(array('blocks' => array(array('type' => 'image', 'url' => 'https://a.example/i.png', 'alt' => 'x', 'width' => '50'))), 'must be at least 100'),
        array(array('blocks' => array(array('type' => 'button', 'label' => 'Go', 'url' => 'not a url'))), 'absolute http(s) or mailto URL'),
        array(array('blocks' => array(array('type' => 'button', 'label' => 'Go', 'url' => 'javascript:alert(1)'))), 'absolute http(s) or mailto URL'),
        array(array('blocks' => array(array('type' => 'bullets', 'items' => implode("\n", array_fill(0, 21, 'item'))))), 'at most 20 items'),
    );

    foreach ($rejects as $case) {
        try {
            $service->normaliseDesign($case[0]);
        } catch (InvalidArgumentException $e) {
            if (strpos($e->getMessage(), $case[1]) === false) { return false; }
            continue;
        }
        return false;
    }

    $tooMany = array();
    for ($i = 0; $i < 31; $i++) { $tooMany[] = array('type' => 'divider'); }
    try {
        $service->normaliseDesign(array('blocks' => $tooMany));
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'at most 30 blocks') === false) { return false; }
    }
    array_pop($tooMany);
    return count($service->normaliseDesign(array('blocks' => $tooMany))['blocks']) === 30;
},

'Designs canonicalise: catalog defaults are filled and fields the catalog does not declare are dropped' => function () {
    ch247_marketing_admin();
    $service = new TemplateService();

    $design = $service->normaliseDesign(array('blocks' => array(
        array('type' => 'heading', 'text' => 'Hi', 'onclick' => 'evil()', 'style' => 'x'),
        array('type' => 'spacer'),
        array('type' => 'bullets', 'items' => "one\n\n  two  \nthree"),
    )));

    if ($design['blocks'][0] !== array('type' => 'heading', 'text' => 'Hi', 'level' => '2', 'align' => 'left')) { return false; }
    if ($design['blocks'][1] !== array('type' => 'spacer', 'height' => 24)) { return false; }
    if ($design['blocks'][2]['items'] !== "one\ntwo\nthree") { return false; }

    // A bare list of blocks is accepted the same way a design object is.
    $bare = $service->normaliseDesign(array(array('type' => 'divider')));
    if (count($bare['blocks']) !== 1 || $bare['blocks'][0]['type'] !== 'divider') { return false; }

    // JSON arrives through the same door.
    $json = $service->normaliseDesign(json_encode(ch247_marketing_sample_design()));
    return count($json['blocks']) === 4;
},

// ------------------------------------------------------------------ rendering

'Rendering produces table markup with inline styles, a plain-text twin and no script surface' => function () {
    ch247_marketing_admin();
    $rendered = (new TemplateService())->render(ch247_marketing_sample_design());

    if (strpos($rendered['html'], '<table role="presentation"') === false) { return false; }
    if (strpos($rendered['html'], 'style="') === false || strpos($rendered['html'], 'font-size:') === false) { return false; }
    if (strpos($rendered['html'], 'bgcolor="#1f6fb2"') === false) { return false; }
    if (stripos($rendered['html'], '<script') !== false || stripos($rendered['html'], 'javascript:') !== false) { return false; }
    if (strpos($rendered['html'], 'onerror') !== false || strpos($rendered['html'], '<iframe') !== false) { return false; }
    if (strpos($rendered['html'], 'Welcome aboard') === false) { return false; }
    if ($rendered['warnings'] !== array()) { return false; }

    // Plain text: no tags, the button target spelled out, newlines preserved.
    if (strpos($rendered['text'], '<') !== false) { return false; }
    if (strpos($rendered['text'], 'Read more: https://cloudhost247.example/read') === false) { return false; }
    if (strpos($rendered['text'], "Hello there,\nhere is the news.") === false) { return false; }
    return strpos($rendered['text'], 'unsubscribe') !== false;
},

'Operator copy is sanitised down to the tiny rich-text subset' => function () {
    ch247_marketing_admin();
    $hostile = 'Hello <b>there</b> <script>alert(1)</script><img src=x onerror=alert(1)>'
        . '<a href="javascript:alert(1)">bad</a><a href="https://good.example" onclick="evil()">good</a><style>p{}</style>';

    $clean = HtmlSanitizer::richText($hostile);
    if (strpos($clean, '<b>there</b>') === false) { return false; }
    if (stripos($clean, 'script') !== false || strpos($clean, 'onerror') !== false || strpos($clean, 'onclick') !== false) { return false; }
    if (stripos($clean, 'javascript:') !== false) { return false; }
    if (strpos($clean, '<style') !== false || strpos($clean, '<img') !== false) { return false; }
    if (strpos($clean, '<a href="https://good.example"') === false || strpos($clean, '>good</a>') === false) { return false; }
    if (strpos($clean, 'bad') === false) { return false; } // link text survives, the tag does not

    // Through a template, the same rules hold.
    $rendered = (new TemplateService())->render(array('blocks' => array(
        array('type' => 'paragraph', 'text' => $hostile, 'align' => 'left'),
    )));
    if (stripos($rendered['html'], 'script') !== false || strpos($rendered['html'], 'onerror') !== false) { return false; }
    if (strpos($rendered['html'], 'javascript:') !== false) { return false; }
    return strpos($rendered['html'], '<b>there</b>') !== false;
},

'URLs must be absolute http(s) or mailto — everything else is refused' => function () {
    if (HtmlSanitizer::safeUrl('https://cloudhost247.example/read') === '') { return false; }
    if (HtmlSanitizer::safeUrl('http://cloudhost247.example') === '') { return false; }
    if (HtmlSanitizer::safeUrl('https://localhost:8443/x') === '') { return false; }
    if (HtmlSanitizer::safeMailto('post@example.com') !== 'mailto:post@example.com') { return false; }

    foreach (array('javascript:alert(1)', '//evil.example/x', '/relative', 'ftp://a.example/f', 'https://user:pass@a.example', 'https://a.example/ space', '', 'data:text/html;base64,PHNjcmlwdD4=') as $bad) {
        if (HtmlSanitizer::safeUrl($bad) !== '') { return false; }
    }
    if (HtmlSanitizer::safeMailto('not an address') !== '') { return false; }
    return (new TemplateBlock()) instanceof TemplateBlock;
},

'Warnings are honest: a block that cannot render safely is skipped and explained, never approximated' => function () {
    ch247_marketing_admin();
    $rendered = (new TemplateService())->render(array('blocks' => array(
        array('type' => 'heading', 'text' => 'Kept', 'level' => '2', 'align' => 'left'),
        array('type' => 'button', 'label' => 'Dangerous', 'url' => 'javascript:alert(1)', 'variant' => 'primary', 'align' => 'left'),
        array('type' => 'image', 'url' => 'https://a.example/i.png', 'alt' => '', 'width' => 600),
        array('type' => 'paragraph', 'text' => '   ', 'align' => 'left'),
    )));

    if (count($rendered['warnings']) !== 3) { return false; }
    if (strpos($rendered['html'], 'Kept') === false) { return false; }
    if (strpos($rendered['html'], 'Dangerous') !== false) { return false; }
    if (strpos($rendered['html'], '<img') !== false) { return false; }
    foreach ($rendered['warnings'] as $warning) {
        if (strpos($warning, 'Block ') !== 0) { return false; }
    }
    return strpos($rendered['text'], 'Kept') !== false;
},

// ---------------------------------------------------------------- persistence

'Saving stores the rendered output, audits the change and refuses missing required values' => function () {
    ch247_marketing_admin();
    $service = new TemplateService();
    $design = ch247_marketing_sample_design();

    $result = $service->save(array('template_key' => 'welcome', 'name' => 'Welcome', 'design' => $design));
    $template = $result['template'];
    $expected = $service->render($design);
    if ($template->html !== $expected['html'] || $template->text !== $expected['text']) { return false; }
    if ($template->source !== 'custom' || $template->status !== 'active') { return false; }
    if (!in_array('template.created', ch247_marketing_audit_actions(), true)) { return false; }

    // Editing re-renders and re-audits.
    $changed = $design;
    $changed['blocks'][1]['text'] = 'A completely different message.';
    $service->save(array('name' => 'Welcome', 'design' => $changed), (int) $template->id);
    $updated = (new TemplateRepository())->find((int) $template->id);
    if (strpos($updated->html, 'A completely different message.') === false) { return false; }
    if (strpos($updated->html, 'here is the news') !== false) { return false; }
    if (!in_array('template.updated', ch247_marketing_audit_actions(), true)) { return false; }

    // A strict save refuses to store a design with a required field missing…
    $broken = $changed;
    $broken['blocks'][0]['text'] = '';
    $before = (new TemplateRepository())->find((int) $template->id)->html;
    try {
        $service->save(array('name' => 'Welcome', 'design' => $broken), (int) $template->id);
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'Heading text is required') === false) { return false; }
    }
    // …and leaves the stored template exactly as it was.
    return (new TemplateRepository())->find((int) $template->id)->html === $before;
},

'Builtin templates are seeded idempotently and can be archived but never deleted' => function () {
    ch247_marketing_template_flush();
    $service = new TemplateService();
    $repository = new TemplateRepository();

    // Activation already seeded the library; seeding again changes nothing.
    if ($repository->count() !== 3) { return false; }
    if ($service->ensureBuiltins() !== 0) { return false; }

    $plain = $repository->findByKey('builtin-plain');
    if (!$plain || $plain->source !== 'builtin' || $plain->status !== 'active') { return false; }
    if ($plain->html === '' || $plain->text === '') { return false; }
    foreach ($service->builtinDefinitions() as $key => $definition) {
        if (!$repository->findByKey($key)) { return false; }
    }

    $service->archive((int) $plain->id);
    if ($repository->find((int) $plain->id)->status !== 'archived') { return false; }
    $service->activate((int) $plain->id);
    if ($repository->find((int) $plain->id)->status !== 'active') { return false; }

    try {
        $service->delete((int) $plain->id);
        return false;
    } catch (InvalidArgumentException $e) {
        if (strpos($e->getMessage(), 'never deleted') === false) { return false; }
    }

    // A custom template can be deleted, and the deletion is audited.
    $custom = $service->save(array('template_key' => 'throwaway', 'name' => 'Throwaway', 'design' => ch247_marketing_sample_design()))['template'];
    $service->delete((int) $custom->id);
    if ($repository->find((int) $custom->id) !== null) { return false; }
    return in_array('template.deleted', ch247_marketing_audit_actions(), true);
},

'Preview and storage are the same bytes, and a stored design can be re-rendered after a reload' => function () {
    ch247_marketing_admin();
    $service = new TemplateService();
    $design = ch247_marketing_sample_design();
    $template = $service->save(array('template_key' => 'fidelity', 'name' => 'Fidelity', 'design' => $design))['template'];

    $stored = TemplateRepository::designOf($template);
    $rendered = $service->render($stored);
    if ($rendered['html'] !== $template->html || $rendered['text'] !== $template->text) { return false; }
    if ($service->preview($stored)['html'] !== $template->html) { return false; }

    // The design survives a JSON round trip through the database as JSON, not as
    // executable markup: the stored design is data only.
    return strpos((string) $template->design_json, '<') === false;
},

// -------------------------------------------------------------- admin screens

'Admin creates, edits, previews and archives a template through POST with CSRF and capability guards' => function () {
    ch247_marketing_template_flush();
    $repository = new TemplateRepository();
    $builtinCount = $repository->count();

    // Missing CSRF token: refused before anything is written.
    $_SERVER['REQUEST_METHOD'] = 'POST';
    $_GET = array('view' => 'templates');
    $_POST = array('action' => 'template.save', 'name' => 'No token');
    $_REQUEST = $_POST;
    $refused = false;
    try { (new CloudHost247\Marketing\Http\AdminController())->handle(); } catch (RuntimeException $e) { $refused = true; }
    if (!$refused || $repository->count() !== $builtinCount) { return false; }

    // Create from the library form: one catalog block, catalog defaults, warnings shown.
    $created = ch247_marketing_post('templates', array(
        'action' => 'template.save',
        'name' => 'My template',
        'template_key' => '',
        'category' => 'general',
        'add_block' => 'heading',
    ));
    if (strpos($created['notice'], 'Template created. 1 block(s).') === false) { return false; }
    if (strpos($created['error'], 'Warnings') === false) { return false; }
    $template = $repository->findByKey('my-template');
    if (!$template) { return false; }

    // Edit with a real block set: strict save, no warnings.
    $edited = ch247_marketing_post('template', array(
        'action' => 'template.save',
        'template_id' => (int) $template->id,
        'name' => 'My template',
        'category' => 'general',
        'block' => array(
            array('type' => 'heading', 'text' => 'Hello', 'level' => '2', 'align' => 'left'),
            array('type' => 'paragraph', 'text' => 'Body copy.', 'align' => 'left'),
        ),
    ), array('id' => (int) $template->id));
    if (strpos($edited['notice'], 'Template updated. 2 block(s).') === false || $edited['error'] !== '') { return false; }
    if (strpos($repository->find((int) $template->id)->html, 'Body copy.') === false) { return false; }

    // Preview renders the posted design in the response without writing.
    $preview = ch247_marketing_post('template', array(
        'action' => 'template.preview',
        'template_id' => (int) $template->id,
        'block' => array(array('type' => 'paragraph', 'text' => 'Preview only.', 'align' => 'left')),
    ), array('id' => (int) $template->id));
    if (empty($preview['templatePreview']['html']) || strpos($preview['templatePreview']['html'], 'Preview only.') === false) { return false; }
    if (strpos($repository->find((int) $template->id)->html, 'Preview only.') !== false) { return false; }

    $archived = ch247_marketing_post('templates', array('action' => 'template.archive', 'template_id' => (int) $template->id));
    if ($archived['notice'] !== 'Template archived.') { return false; }

    foreach (array('template.created', 'template.updated', 'template.archived') as $action) {
        if (!in_array($action, ch247_marketing_audit_actions(), true)) { return false; }
    }

    // Capability policy for role 2 only: role 1 is refused outright.
    CH247MarketingFakeDB::rowsRef('mod_cloudhost247_capabilities')[] = array(
        'id' => 3, 'module' => 'cloudhost247_marketing', 'capability' => 'marketing.campaigns.manage', 'role_ids' => '2',
    );
    $_SESSION['adminroleid'] = 1;
    try {
        ch247_marketing_post('templates', array('action' => 'template.archive', 'template_id' => (int) $template->id));
        return false;
    } catch (RuntimeException $e) {
        return true;
    }
},

'The editor only stores fields the block type declares, and removing a block is honoured' => function () {
    ch247_marketing_template_flush();
    $repository = new TemplateRepository();
    $design = array('blocks' => array(
        array('type' => 'heading', 'text' => 'Title', 'level' => '1', 'align' => 'center'),
        array('type' => 'divider'),
        array('type' => 'paragraph', 'text' => 'Body', 'align' => 'left'),
    ));
    $template = (new TemplateService())->save(array('template_key' => 'editor', 'name' => 'Editor', 'design' => $design))['template'];

    $posted = ch247_marketing_post('template', array(
        'action' => 'template.save',
        'template_id' => (int) $template->id,
        'name' => 'Editor',
        'block' => array(
            array('type' => 'heading', 'text' => 'Title', 'level' => '1', 'align' => 'center', 'onclick' => 'evil()'),
            array('type' => 'divider', 'remove' => '1'),
            array('type' => 'paragraph', 'text' => 'Body', 'align' => 'left'),
        ),
    ), array('id' => (int) $template->id));
    if (strpos($posted['notice'], '2 block(s)') === false) { return false; }

    $stored = TemplateRepository::designOf($repository->find((int) $template->id));
    if (count($stored['blocks']) !== 2) { return false; }
    foreach ($stored['blocks'] as $block) {
        if ($block['type'] === 'divider') { return false; }
        if (array_key_exists('onclick', $block)) { return false; }
    }
    return $stored['blocks'][0] === array('type' => 'heading', 'text' => 'Title', 'level' => '1', 'align' => 'center');
},

'Adding a block from the editor appends catalog defaults and can be filled in afterwards' => function () {
    ch247_marketing_template_flush();
    $repository = new TemplateRepository();
    $template = (new TemplateService())->save(array(
        'template_key' => 'grow', 'name' => 'Grow',
        'design' => array('blocks' => array(array('type' => 'paragraph', 'text' => 'Start', 'align' => 'left'))),
    ))['template'];

    $added = ch247_marketing_post('template', array(
        'action' => 'template.add_block',
        'template_id' => (int) $template->id,
        'name' => 'Grow',
        'add_block' => 'button',
        'block' => array(array('type' => 'paragraph', 'text' => 'Start', 'align' => 'left')),
    ), array('id' => (int) $template->id));
    if (strpos($added['notice'], '2 block(s)') === false) { return false; }
    if (strpos($added['error'], 'Warnings') === false) { return false; }

    // The half-filled block renders as a skipped block with a warning, and the
    // strict Save refuses it until the operator fills it in.
    $stored = TemplateRepository::designOf($repository->find((int) $template->id));
    if ($stored['blocks'][1]['type'] !== 'button' || $stored['blocks'][1]['variant'] !== 'primary') { return false; }
    $blocked = ch247_marketing_post('template', array(
        'action' => 'template.save',
        'template_id' => (int) $template->id,
        'name' => 'Grow',
        'block' => $stored['blocks'],
    ), array('id' => (int) $template->id));
    return $blocked['notice'] === '' && strpos($blocked['error'], 'Button label is required') !== false;
},

'The template screens render the live library, the design and the block catalog' => function () {
    ch247_marketing_template_flush();
    $_GET = array('view' => 'templates');
    $list = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if ($list['view'] !== 'templates' || count($list['templatesView']['rows']) !== 3) { return false; }
    if (count($list['templatesView']['catalog']) !== count(TemplateBlock::all())) { return false; }
    if (!isset($list['templatesView']['catalog']['button']['fields']['url'])) { return false; }

    $plain = (new TemplateRepository())->findByKey('builtin-plain');
    $_GET = array('view' => 'template', 'id' => (int) $plain->id);
    $detail = (new CloudHost247\Marketing\Http\AdminController())->handle();
    if (empty($detail['templateDetail']['row'])) { return false; }
    if (count($detail['templateDetail']['design']['blocks']) < 3) { return false; }
    if ($detail['templateDetail']['warnings'] !== array()) { return false; }

    // A missing id is reported, not silently swapped for another template.
    $_GET = array('view' => 'template', 'id' => 99999);
    $missing = (new CloudHost247\Marketing\Http\AdminController())->handle();
    return empty($missing['templateDetail']) && strpos($missing['error'], 'does not exist') !== false;
},

);
