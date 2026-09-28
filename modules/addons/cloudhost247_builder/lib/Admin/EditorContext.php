<?php
namespace CloudHost247\Builder\Admin;

use CloudHost247\Builder\Contracts\LiveDataSource;
use CloudHost247\Builder\Render\RenderContext;

/**
 * The render context the editor canvas uses.
 *
 * Editor mode differs from the published page in exactly two ways: nodes carry
 * selection attributes, and a widget with unreadable live data explains itself
 * instead of disappearing. Everything else -- the markup, the classes, the
 * generated CSS -- is produced by the same renderer that serves visitors,
 * which is why what an administrator arranges is what gets published.
 *
 * Forms rendered on the canvas get no submission token: the canvas is a
 * preview, not a place to submit customer data.
 */
final class EditorContext
{
    public static function make(array $services)
    {
        $data = isset($services['data']) && $services['data'] instanceof LiveDataSource ? $services['data'] : null;
        $options = array(
            'menus' => isset($services['menus']) && is_callable($services['menus']) ? $services['menus'] : null,
            'forms' => isset($services['forms']) && is_callable($services['forms']) ? $services['forms'] : null,
            'form_token' => function () { return ''; },
            'form_action' => '',
        );
        return RenderContext::editor($data, $options);
    }
}
