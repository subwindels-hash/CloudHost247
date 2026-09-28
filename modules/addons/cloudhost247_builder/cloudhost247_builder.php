<?php
/**
 * CloudHost247 Website Builder.
 *
 * Super Admin -> Website Builder. A visual, drag-and-drop page builder for the
 * public site: pages, templates, theme parts, menus, global styles, media,
 * forms, SEO and revisions, all driven by one versioned page schema.
 *
 * Three properties define this module.
 *
 * 1. It is additive. No HostX or WHMCS template file is read, written or
 *    replaced; builder pages are served by their own front controller and
 *    rendered inside the active client-area theme, so existing pages, the
 *    cart, checkout, login and registration keep working untouched.
 * 2. Nothing it renders is invented. Products, prices, domain rates, cart
 *    contents and service status come from WHMCS and the API & Integrations
 *    centre at render time; when a source cannot be read the editor says so
 *    and the published page omits the block.
 * 3. Content cannot become code. Rich text, URLs, CSS, uploads and imported
 *    templates each pass a dedicated validator, and a template import executes
 *    nothing at all.
 *
 * The module ships inactive. Activating it creates its own namespaced tables
 * and restricts publishing to Super Admin roles by default.
 */
if (!defined('WHMCS')) { die('Direct access denied'); }

require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/migrations/V100.php';

use CloudHost247\Builder\Admin\AdminController;
use CloudHost247\Builder\Admin\AdminView;
use CloudHost247\Builder\Migrations\BuilderInitialMigration;
use CloudHost247\Builder\Security\CapabilityPolicy;
use CloudHost247\Builder\Services\Settings;
use CloudHost247\Builder\Services\Starters;
use CloudHost247\Builder\Support\Paths;
use CloudHost247\Foundation\Database\MigrationRunner;

function cloudhost247_builder_config()
{
    return array(
        'name' => 'CloudHost247 Website Builder',
        'description' => 'Visual drag-and-drop page builder for the public website: pages, templates, theme builder, menus, global styles, media library, forms, SEO and revision history, driven by a versioned page schema and live WHMCS data.',
        'version' => '1.0.0',
        'author' => 'CloudHost247',
        'language' => 'english',
        'fields' => array(),
    );
}

function cloudhost247_builder_activate()
{
    try {
        $applied = (new MigrationRunner())->run('cloudhost247_builder', array(new BuilderInitialMigration()));
        $notes = array('Website Builder installed. Applied: ' . ($applied ? implode(', ', $applied) : 'already current') . '.');

        $seeded = Starters::seed();
        $notes[] = count($seeded) . ' built-in templates are available in the template library.';

        $mediaRoot = Paths::mediaRoot();
        if (Paths::ensureDirectory($mediaRoot)) {
            Paths::protectDirectory($mediaRoot);
            $notes[] = 'Media directory ready at ' . $mediaRoot . ' with execution disabled.';
        } else {
            $notes[] = 'IMPORTANT: the media directory ' . $mediaRoot . ' could not be created, so uploads will fail until it exists and is writable.';
        }

        $settings = new Settings();
        $notes[] = 'Published pages are served from ' . $settings->get('public_base_path', 'builder-page.php')
            . '?slug=... . Nothing is published until an administrator publishes it.';

        if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
            $notes[] = 'The API & Integrations centre is not active, so the service status widget will report that it has nothing measured to show.';
        }
        $notes[] = CapabilityPolicy::describeSeeding(CapabilityPolicy::seedDefaults());

        return array('status' => 'success', 'description' => implode(' ', $notes));
    } catch (\Throwable $error) {
        return array('status' => 'error', 'description' => $error->getMessage());
    }
}

function cloudhost247_builder_deactivate()
{
    return array(
        'status' => 'success',
        'description' => 'Data retained. Pages, revisions, templates, theme parts, menus, media records, forms and submissions all remain in the database and no files were deleted. While the module is deactivated the public front controller stops serving builder pages, so published builder URLs return not found until it is activated again.',
    );
}

function cloudhost247_builder_output($vars)
{
    $link = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=cloudhost247_builder';
    $controller = new AdminController($link);
    $data = $controller->handle();
    if (!empty($data['__handled'])) {
        // JSON editor API and asset responses have already been written and exited.
        return;
    }
    echo (new AdminView($link))->render($data);
}
