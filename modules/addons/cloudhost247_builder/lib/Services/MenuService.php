<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Ids;
use CloudHost247\Builder\Support\UrlPolicy;

/**
 * Navigation menus.
 *
 * Menus are validated on save, not on render: labels become plain text and
 * every destination passes UrlPolicy, so a menu cannot carry a javascript:
 * link into a header that appears on every page.
 */
class MenuService
{
    const MAX_ITEMS = 40;
    const MAX_DEPTH = 2;

    private $library;
    private $events;
    private $sanitizer;

    public function __construct(LibraryRepository $library = null, EventRepository $events = null, HtmlSanitizer $sanitizer = null)
    {
        $this->library = $library ? $library : new LibraryRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function all() { return $this->library->menus(); }

    public function find($id) { return $this->library->menu($id); }

    public function save(array $input, $adminId)
    {
        $key = isset($input['menu_key']) ? (string) $input['menu_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A menu key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        $items = $this->validateItems(isset($input['items']) ? $input['items'] : array(), 1);
        $id = $this->library->saveMenu(array(
            'menu_key' => $key,
            'name' => $this->sanitizer->text(isset($input['name']) ? $input['name'] : $key, 160),
        ), $items, $adminId);
        $this->events->record('menu.save', array(
            'entity_type' => 'menu', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Saved menu "' . $key . '" with ' . count($items) . ' top-level item(s)',
        ));
        return $this->library->menu($id);
    }

    public function delete($id, $adminId)
    {
        $menu = $this->library->menu($id);
        if (!$menu) { throw BuilderException::notFound('That menu no longer exists.'); }
        $this->library->deleteMenu($id);
        $this->events->record('menu.delete', array(
            'entity_type' => 'menu', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Deleted menu "' . $menu['menu_key'] . '"',
        ));
        return true;
    }

    public function validateItems($items, $depth)
    {
        if (!is_array($items) || $depth > self::MAX_DEPTH) { return array(); }
        $clean = array();
        foreach ($items as $item) {
            if (count($clean) >= self::MAX_ITEMS) { break; }
            if (!is_array($item)) { continue; }
            $label = $this->sanitizer->text(isset($item['label']) ? $item['label'] : '', 80);
            if ($label === '') { continue; }
            $url = isset($item['url']) ? UrlPolicy::link($item['url']) : '';
            if ($url === null) {
                throw BuilderException::validation('The link for "' . $label . '" is not an acceptable URL.');
            }
            $clean[] = array(
                'label' => $label,
                'url' => (string) $url,
                'target' => isset($item['target']) && $item['target'] === 'blank' ? 'blank' : 'self',
                'children' => $this->validateItems(isset($item['children']) ? $item['children'] : array(), $depth + 1),
            );
        }
        return $clean;
    }

    /** Resolver handed to the renderer. */
    public function resolver()
    {
        $library = $this->library;
        return function ($id) use ($library) {
            $menu = $library->menu($id);
            return $menu === null ? null : array('name' => $menu['name'], 'items' => $menu['items']);
        };
    }
}
