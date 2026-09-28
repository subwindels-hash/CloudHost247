<?php
namespace CloudHost247\Builder\Schema;

use CloudHost247\Builder\Support\BuilderException;

/**
 * A validated page document.
 *
 * One schema powers the visual editor, the preview renderer, the published
 * page renderer, template import/export and revision history: all five read
 * and write this object, so what an administrator arranges in the editor is
 * literally what is stored, restored, exported and served.
 *
 * A Document can only be constructed through the validator, so every instance
 * in the system is known-good.
 */
final class Document
{
    const SCHEMA = 'cloudhost247-page/v1';
    const VERSION = 1;

    private $children;
    private $meta;

    private function __construct(array $children, array $meta)
    {
        $this->children = $children;
        $this->meta = $meta;
    }

    public static function blank()
    {
        return new self(array(), array('generator' => 'cloudhost247-builder', 'schema_version' => self::VERSION));
    }

    /** @param array|string $data decoded document or JSON */
    public static function fromArray($data, SchemaValidator $validator = null, $strict = true)
    {
        $validator = $validator ? $validator : new SchemaValidator();
        $normalized = $validator->validate($data, $strict);
        return new self($normalized['children'], $normalized['meta']);
    }

    public static function fromJson($json, SchemaValidator $validator = null, $strict = true)
    {
        return self::fromArray(SchemaValidator::decode($json), $validator, $strict);
    }

    /** Tolerant load for content already in the database. */
    public static function fromStorage($json, SchemaValidator $validator = null)
    {
        if ($json === null || trim((string) $json) === '') { return self::blank(); }
        try {
            return self::fromArray(SchemaValidator::decode($json), $validator, false);
        } catch (BuilderException $invalid) {
            return self::blank();
        }
    }

    public function toArray()
    {
        return array(
            'schema' => self::SCHEMA,
            'version' => self::VERSION,
            'children' => $this->children,
            'meta' => $this->meta,
        );
    }

    public function toJson($pretty = false)
    {
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE;
        if ($pretty) { $flags |= JSON_PRETTY_PRINT; }
        return json_encode($this->toArray(), $flags);
    }

    public function children() { return $this->children; }

    public function meta() { return $this->meta; }

    public function isEmpty() { return !$this->children; }

    public function nodeCount() { return Node::count($this->children); }

    public function maxDepth() { return Node::depth($this->children); }

    /** Stable fingerprint, used to detect real changes before writing a revision. */
    public function checksum()
    {
        return hash('sha256', (string) json_encode(array($this->children, $this->meta)));
    }

    public function find($id) { return Node::find($this->children, $id); }

    public function withChildren(array $children, SchemaValidator $validator = null)
    {
        return self::fromArray(array('children' => $children, 'meta' => $this->meta), $validator, true);
    }

    public function withMeta(array $meta)
    {
        $copy = new self($this->children, array_merge($this->meta, $meta));
        return $copy;
    }

    /** Distinct widget keys used, including structural types. */
    public function widgetKeys()
    {
        $keys = array();
        Node::walk($this->children, function ($node) use (&$keys) {
            $keys[Node::catalogKey($node)] = true;
        });
        return array_values(array_filter(array_keys($keys)));
    }

    /** Media library ids referenced anywhere in the document. */
    public function mediaIds()
    {
        $ids = array();
        Node::walk($this->children, function ($node) use (&$ids) {
            self::collectMedia(isset($node['props']) ? $node['props'] : array(), $ids);
        });
        return array_values(array_unique($ids));
    }

    /** Builder form ids referenced by form widgets. */
    public function formIds()
    {
        $ids = array();
        Node::walk($this->children, function ($node) use (&$ids) {
            if (Node::catalogKey($node) === 'contact_form' && !empty($node['props']['form'])) {
                $ids[] = (int) $node['props']['form'];
            }
        });
        return array_values(array_unique($ids));
    }

    /** WHMCS product ids referenced by commerce widgets. */
    public function productIds()
    {
        $ids = array();
        Node::walk($this->children, function ($node) use (&$ids) {
            if (!isset($node['props']['product'])) { return; }
            $id = (int) $node['props']['product'];
            if ($id > 0) { $ids[] = $id; }
        });
        return array_values(array_unique($ids));
    }

    /** Menu ids referenced by navigation widgets. */
    public function menuIds()
    {
        $ids = array();
        Node::walk($this->children, function ($node) use (&$ids) {
            if (Node::catalogKey($node) === 'nav_menu' && !empty($node['props']['menu'])) {
                $ids[] = (int) $node['props']['menu'];
            }
        });
        return array_values(array_unique($ids));
    }

    private static function collectMedia(array $props, array &$ids)
    {
        foreach ($props as $value) {
            if (!is_array($value)) { continue; }
            if (isset($value['id'], $value['url']) && (int) $value['id'] > 0) {
                $ids[] = (int) $value['id'];
                continue;
            }
            self::collectMedia($value, $ids);
        }
    }
}
