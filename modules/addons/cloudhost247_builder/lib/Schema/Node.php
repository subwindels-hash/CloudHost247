<?php
namespace CloudHost247\Builder\Schema;

use CloudHost247\Builder\Support\Ids;

/**
 * Node helpers for the page tree.
 *
 * Nodes are plain arrays so a document is exactly what is stored, sent to the
 * editor and rendered -- there is no separate in-memory representation that
 * could drift from the persisted one. Structure is fixed:
 *
 *   section  -> container
 *   container-> container | column | widget
 *   column   -> container | widget
 *   widget   -> leaf
 */
final class Node
{
    const TYPES = array('section', 'container', 'column', 'widget');
    const STRUCTURAL = array('section', 'container', 'column');

    const ALLOWED_CHILDREN = array(
        'section' => array('container'),
        'container' => array('container', 'column', 'widget'),
        'column' => array('container', 'widget'),
        'widget' => array(),
    );

    const DEVICES = array('desktop', 'tablet', 'mobile');

    public static function make($type, $widget = '', array $props = array(), array $style = array(), array $children = array())
    {
        return array(
            'id' => Ids::node(),
            'type' => $type,
            'widget' => $type === 'widget' ? (string) $widget : '',
            'props' => $props,
            'style' => $style,
            'settings' => self::defaultSettings(),
            'children' => $children,
        );
    }

    public static function defaultSettings()
    {
        return array(
            'css_class' => '',
            'anchor' => '',
            'hidden' => array('desktop' => false, 'tablet' => false, 'mobile' => false),
        );
    }

    public static function isNode($node)
    {
        return is_array($node) && isset($node['type']) && in_array($node['type'], self::TYPES, true);
    }

    public static function type($node) { return isset($node['type']) ? (string) $node['type'] : ''; }

    public static function id($node) { return isset($node['id']) ? (string) $node['id'] : ''; }

    public static function children($node)
    {
        return isset($node['children']) && is_array($node['children']) ? $node['children'] : array();
    }

    /** Catalogue key: the widget name for widgets, the type for structure. */
    public static function catalogKey($node)
    {
        $type = self::type($node);
        return $type === 'widget' ? (isset($node['widget']) ? (string) $node['widget'] : '') : $type;
    }

    public static function accepts($parentType, $childType)
    {
        return isset(self::ALLOWED_CHILDREN[$parentType])
            && in_array($childType, self::ALLOWED_CHILDREN[$parentType], true);
    }

    /**
     * Depth-first walk.
     *
     * @param callable $visitor function(array $node, $parentId, int $depth): void
     */
    public static function walk(array $nodes, callable $visitor, $parentId = null, $depth = 0)
    {
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            $visitor($node, $parentId, $depth);
            $children = self::children($node);
            if ($children) { self::walk($children, $visitor, self::id($node), $depth + 1); }
        }
    }

    /** @return array|null */
    public static function find(array $nodes, $id)
    {
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            if (self::id($node) === $id) { return $node; }
            $found = self::find(self::children($node), $id);
            if ($found !== null) { return $found; }
        }
        return null;
    }

    public static function parentOf(array $nodes, $id, $parent = null)
    {
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            if (self::id($node) === $id) { return $parent; }
            $found = self::parentOf(self::children($node), $id, $node);
            if ($found !== null) { return $found; }
        }
        return null;
    }

    /** @return array new tree with the node removed */
    public static function remove(array $nodes, $id)
    {
        $out = array();
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            if (self::id($node) === $id) { continue; }
            if (isset($node['children']) && is_array($node['children'])) {
                $node['children'] = self::remove($node['children'], $id);
            }
            $out[] = $node;
        }
        return $out;
    }

    public static function replace(array $nodes, $id, array $replacement)
    {
        $out = array();
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            if (self::id($node) === $id) { $out[] = $replacement; continue; }
            if (isset($node['children']) && is_array($node['children'])) {
                $node['children'] = self::replace($node['children'], $id, $replacement);
            }
            $out[] = $node;
        }
        return $out;
    }

    /**
     * Insert a node under $parentId at $index. $parentId null means top level.
     *
     * @return array|null the new tree, or null when the parent was not found
     *                    or would not accept that child type
     */
    public static function insert(array $nodes, $parentId, $index, array $child)
    {
        if ($parentId === null || $parentId === '') {
            if (!self::accepts('root', self::type($child)) && self::type($child) !== 'section') { return null; }
            return self::spliceIn($nodes, $index, $child);
        }
        $found = false;
        $out = self::insertInto($nodes, $parentId, $index, $child, $found);
        return $found ? $out : null;
    }

    private static function insertInto(array $nodes, $parentId, $index, array $child, &$found)
    {
        $out = array();
        foreach ($nodes as $node) {
            if (!is_array($node)) { continue; }
            if (self::id($node) === $parentId) {
                if (!self::accepts(self::type($node), self::type($child))) { $out[] = $node; continue; }
                $node['children'] = self::spliceIn(self::children($node), $index, $child);
                $found = true;
                $out[] = $node;
                continue;
            }
            if (isset($node['children']) && is_array($node['children'])) {
                $node['children'] = self::insertInto($node['children'], $parentId, $index, $child, $found);
            }
            $out[] = $node;
        }
        return $out;
    }

    private static function spliceIn(array $nodes, $index, array $child)
    {
        $index = (int) $index;
        if ($index < 0 || $index > count($nodes)) { $index = count($nodes); }
        array_splice($nodes, $index, 0, array($child));
        return $nodes;
    }

    /** Deep copy with fresh identifiers, used by duplicate and paste. */
    public static function regenerateIds(array $node)
    {
        $node['id'] = Ids::node();
        if (isset($node['settings']['anchor']) && $node['settings']['anchor'] !== '') {
            // Two elements must never share an anchor after a duplicate.
            $node['settings']['anchor'] = '';
        }
        if (isset($node['children']) && is_array($node['children'])) {
            $children = array();
            foreach ($node['children'] as $child) {
                if (is_array($child)) { $children[] = self::regenerateIds($child); }
            }
            $node['children'] = $children;
        }
        return $node;
    }

    public static function count(array $nodes)
    {
        $total = 0;
        self::walk($nodes, function () use (&$total) { $total++; });
        return $total;
    }

    public static function depth(array $nodes)
    {
        $deepest = 0;
        self::walk($nodes, function ($node, $parentId, $depth) use (&$deepest) {
            if ($depth + 1 > $deepest) { $deepest = $depth + 1; }
        });
        return $deepest;
    }

    /** Ordered list of ids, used for stable diffing in the editor. */
    public static function ids(array $nodes)
    {
        $ids = array();
        self::walk($nodes, function ($node) use (&$ids) { $ids[] = self::id($node); });
        return $ids;
    }
}
