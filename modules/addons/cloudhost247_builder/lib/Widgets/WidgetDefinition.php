<?php
namespace CloudHost247\Builder\Widgets;

/**
 * One entry in the widget library.
 *
 * A definition is data: a label, a category, and the list of fields the editor
 * renders and the validator enforces. Nothing here executes; adding a widget
 * means adding a definition plus a render method, which is what makes the
 * builder reusable rather than a set of hard-coded page forms.
 */
final class WidgetDefinition
{
    const FIELD_TYPES = array(
        'text', 'textarea', 'richtext', 'number', 'toggle', 'select', 'color',
        'url', 'media', 'items', 'product', 'productgroup', 'menu', 'form', 'icon',
    );

    private $key;
    private $spec;

    public function __construct($key, array $spec)
    {
        $this->key = (string) $key;
        $this->spec = $spec;
    }

    public function key() { return $this->key; }

    public function label() { return isset($this->spec['label']) ? $this->spec['label'] : $this->key; }

    public function category() { return isset($this->spec['category']) ? $this->spec['category'] : 'content'; }

    public function description() { return isset($this->spec['description']) ? $this->spec['description'] : ''; }

    public function icon() { return isset($this->spec['icon']) ? $this->spec['icon'] : 'square'; }

    /** True for section, container and column: the layout skeleton. */
    public function isStructural() { return !empty($this->spec['structural']); }

    /** True when the node may contain child nodes. */
    public function acceptsChildren() { return !empty($this->spec['children']); }

    /** Node types allowed directly inside this one. */
    public function allowedChildren()
    {
        return isset($this->spec['allowed_children']) ? $this->spec['allowed_children'] : array();
    }

    /** True when the widget reads live platform data rather than stored copy. */
    public function usesLiveData() { return !empty($this->spec['live_data']); }

    public function fields()
    {
        return isset($this->spec['fields']) ? $this->spec['fields'] : array();
    }

    public function field($key)
    {
        foreach ($this->fields() as $field) {
            if ($field['key'] === $key) { return $field; }
        }
        return null;
    }

    /** Default props for a freshly inserted node. */
    public function defaults()
    {
        $defaults = array();
        foreach ($this->fields() as $field) {
            $defaults[$field['key']] = array_key_exists('default', $field) ? $field['default'] : self::emptyFor($field['type']);
        }
        return $defaults;
    }

    /** Default style, applied when the widget is first inserted. */
    public function defaultStyle()
    {
        return isset($this->spec['style']) ? $this->spec['style'] : array();
    }

    /** JSON payload consumed by the editor front end. */
    public function toArray()
    {
        return array(
            'key' => $this->key,
            'label' => $this->label(),
            'category' => $this->category(),
            'description' => $this->description(),
            'icon' => $this->icon(),
            'structural' => $this->isStructural(),
            'children' => $this->acceptsChildren(),
            'allowed_children' => $this->allowedChildren(),
            'live_data' => $this->usesLiveData(),
            'fields' => $this->fields(),
            'defaults' => $this->defaults(),
            'default_style' => $this->defaultStyle(),
        );
    }

    public static function emptyFor($type)
    {
        switch ($type) {
            case 'toggle': return false;
            case 'number': return 0;
            case 'items': return array();
            case 'media': return array('id' => 0, 'url' => '', 'alt' => '');
            case 'product':
            case 'productgroup':
            case 'menu':
            case 'form': return 0;
            default: return '';
        }
    }
}
