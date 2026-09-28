<?php
namespace CloudHost247\Builder\Schema;

use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Ids;
use CloudHost247\Builder\Widgets\WidgetCatalog;

/**
 * The gate every document passes through.
 *
 * Editor saves, template imports, revision restores and API writes all call
 * this before anything is stored, and the renderer only ever receives a
 * validated document. The validator enforces structure (which node type may
 * contain which), identity (server-generated ids, no duplicates), size (node
 * count and nesting depth) and content (props against the widget catalogue,
 * styles against the style schema).
 *
 * Anything it cannot vouch for is dropped, and every drop is reported, so a
 * malformed or hostile document fails loudly instead of being half-saved.
 */
final class SchemaValidator
{
    const MAX_NODES = 600;
    const MAX_DEPTH = 12;
    const MAX_CLASS_LENGTH = 120;
    const MAX_JSON_BYTES = 2097152;

    private $catalog;
    private $errors = array();
    private $seenIds = array();

    public function __construct(WidgetCatalog $catalog = null)
    {
        $this->catalog = $catalog ? $catalog : new WidgetCatalog(new HtmlSanitizer());
    }

    public function catalog() { return $this->catalog; }

    public function errors() { return $this->errors; }

    /**
     * Validate and normalise a decoded document.
     *
     * @param bool $strict throw when anything was rejected
     * @return array normalised document array
     */
    public function validate($document, $strict = true)
    {
        $this->errors = array();
        $this->seenIds = array();

        if (is_string($document)) { $document = self::decode($document); }
        if (!is_array($document)) {
            throw BuilderException::schema('The page document must be an object.');
        }
        $document = DocumentMigrator::upgrade($document, $this->errors);

        $children = isset($document['children']) && is_array($document['children']) ? $document['children'] : array();
        $normalized = $this->nodes($children, 'root', 0, 'document');

        $count = Node::count($normalized);
        if ($count > self::MAX_NODES) {
            throw BuilderException::schema('This page has ' . $count . ' elements; the maximum is ' . self::MAX_NODES . '.');
        }
        $depth = Node::depth($normalized);
        if ($depth > self::MAX_DEPTH) {
            throw BuilderException::schema('Elements are nested ' . $depth . ' levels deep; the maximum is ' . self::MAX_DEPTH . '.');
        }

        $result = array(
            'schema' => Document::SCHEMA,
            'version' => Document::VERSION,
            'children' => $normalized,
            'meta' => $this->meta(isset($document['meta']) ? $document['meta'] : array()),
        );

        if ($strict && $this->errors) {
            throw BuilderException::schema(
                'The page could not be saved: ' . $this->errors[0]
                . (count($this->errors) > 1 ? ' (' . (count($this->errors) - 1) . ' further problem(s))' : ''),
                $this->errors
            );
        }
        return $result;
    }

    /** Decode JSON with hard size and depth limits before it reaches the parser. */
    public static function decode($json)
    {
        $json = (string) $json;
        if (strlen($json) > self::MAX_JSON_BYTES) {
            throw BuilderException::schema('The page document exceeds ' . round(self::MAX_JSON_BYTES / 1048576, 1) . ' MiB.');
        }
        $data = json_decode($json, true, 64);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw BuilderException::schema('The page document is not valid JSON (' . json_last_error_msg() . ').');
        }
        return $data;
    }

    /* --------------------------------------------------------------- nodes */

    private function nodes($nodes, $parentType, $depth, $path)
    {
        $out = array();
        if (!is_array($nodes)) {
            $this->errors[] = $path . ': expected a list of elements.';
            return $out;
        }
        $index = 0;
        foreach ($nodes as $node) {
            $normalized = $this->node($node, $parentType, $depth, $path . '[' . $index . ']');
            if ($normalized !== null) { $out[] = $normalized; }
            $index++;
        }
        return $out;
    }

    private function node($node, $parentType, $depth, $path)
    {
        if (!is_array($node)) {
            $this->errors[] = $path . ': element must be an object.';
            return null;
        }
        $type = isset($node['type']) && is_string($node['type']) ? $node['type'] : '';
        if (!in_array($type, Node::TYPES, true)) {
            $this->errors[] = $path . ': unknown element type "' . self::describe($type) . '".';
            return null;
        }
        if ($parentType === 'root') {
            if ($type !== 'section') {
                $this->errors[] = $path . ': the top level of a page contains sections; found "' . $type . '".';
                return null;
            }
        } elseif (!Node::accepts($parentType, $type)) {
            $this->errors[] = $path . ': a ' . $parentType . ' cannot contain a ' . $type . '.';
            return null;
        }
        if ($depth >= self::MAX_DEPTH) {
            $this->errors[] = $path . ': nesting is deeper than ' . self::MAX_DEPTH . ' levels.';
            return null;
        }

        $key = $type === 'widget' ? (isset($node['widget']) && is_string($node['widget']) ? $node['widget'] : '') : $type;
        if (!$this->catalog->has($key)) {
            $this->errors[] = $path . ': unknown widget "' . self::describe($key) . '".';
            return null;
        }
        $definition = $this->catalog->get($key);
        if ($type === 'widget' && $definition->isStructural()) {
            $this->errors[] = $path . ': "' . $key . '" is a layout element, not a widget.';
            return null;
        }

        $id = isset($node['id']) ? (string) $node['id'] : '';
        if (!Ids::isNode($id) || isset($this->seenIds[$id])) {
            // Never trust or reuse a client-supplied id that is unusable: mint one.
            $id = Ids::node();
        }
        $this->seenIds[$id] = true;

        $props = $this->catalog->sanitizeProps($key, isset($node['props']) ? $node['props'] : array(), $this->errors, $path . '.props');
        $style = StyleSchema::sanitize(isset($node['style']) ? $node['style'] : array(), $this->errors, $path . '.style');
        $settings = $this->settings(isset($node['settings']) ? $node['settings'] : array(), $path . '.settings');

        $children = array();
        if ($definition->acceptsChildren()) {
            $children = $this->nodes(isset($node['children']) ? $node['children'] : array(), $type, $depth + 1, $path . '.children');
        } elseif (!empty($node['children'])) {
            $this->errors[] = $path . ': the ' . $definition->label() . ' widget cannot contain other elements.';
        }

        return array(
            'id' => $id,
            'type' => $type,
            'widget' => $type === 'widget' ? $key : '',
            'props' => $props,
            'style' => $style,
            'settings' => $settings,
            'children' => $children,
        );
    }

    private function settings($settings, $path)
    {
        $clean = Node::defaultSettings();
        if (!is_array($settings)) {
            if ($settings !== null && $settings !== '') { $this->errors[] = $path . ': expected an object.'; }
            return $clean;
        }
        if (isset($settings['css_class']) && is_scalar($settings['css_class'])) {
            $classes = array();
            foreach (preg_split('/\s+/', trim((string) $settings['css_class'])) as $class) {
                if ($class === '') { continue; }
                if (preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/', $class) !== 1) {
                    $this->errors[] = $path . '.css_class: "' . self::describe($class) . '" is not a valid class name.';
                    continue;
                }
                if (strncmp($class, 'ch247-n-', 8) === 0) {
                    $this->errors[] = $path . '.css_class: class names reserved for generated element styles cannot be reused.';
                    continue;
                }
                $classes[] = $class;
            }
            $clean['css_class'] = substr(implode(' ', $classes), 0, self::MAX_CLASS_LENGTH);
        }
        if (isset($settings['anchor']) && is_scalar($settings['anchor']) && (string) $settings['anchor'] !== '') {
            $anchor = (string) $settings['anchor'];
            if (preg_match('/^[A-Za-z][A-Za-z0-9_-]{0,63}$/', $anchor) === 1) {
                $clean['anchor'] = $anchor;
            } else {
                $this->errors[] = $path . '.anchor: anchors must start with a letter and contain letters, numbers, hyphen or underscore.';
            }
        }
        if (isset($settings['hidden']) && is_array($settings['hidden'])) {
            foreach (Node::DEVICES as $device) {
                $clean['hidden'][$device] = !empty($settings['hidden'][$device]);
            }
        }
        return $clean;
    }

    private function meta($meta)
    {
        $clean = array('generator' => 'cloudhost247-builder', 'schema_version' => Document::VERSION);
        if (!is_array($meta)) { return $clean; }
        if (isset($meta['source']) && is_scalar($meta['source'])) {
            $source = preg_replace('/[^A-Za-z0-9 ._-]/', '', (string) $meta['source']);
            $clean['source'] = substr((string) $source, 0, 64);
        }
        if (isset($meta['template_key']) && is_scalar($meta['template_key'])) {
            $key = (string) $meta['template_key'];
            if (Ids::isKey($key)) { $clean['template_key'] = $key; }
        }
        return $clean;
    }

    private static function describe($value)
    {
        if (!is_scalar($value)) { return gettype($value); }
        $value = preg_replace('/[^\x20-\x7E]/', '', (string) $value);
        return strlen($value) > 40 ? substr($value, 0, 40) . '...' : $value;
    }
}
