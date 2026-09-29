<?php
namespace CloudHost247\Builder\Widgets;

use CloudHost247\Builder\Schema\StyleSchema;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\UrlPolicy;

/**
 * The CloudHost247 widget library.
 *
 * Three groups: the layout skeleton (section, container, column and the layout
 * widgets), editorial content, and the hosting widgets that read live WHMCS
 * data. Every field a widget accepts is declared here, and props are validated
 * against these declarations on the way in, so a stored document can only ever
 * contain values this catalogue permits.
 *
 * There is deliberately no "raw HTML" or "custom script" widget: rich text is
 * sanitised to a fixed tag allowlist, and nothing in a document can introduce
 * executable markup.
 */
final class WidgetCatalog
{
    const CATEGORIES = array(
        'layout' => 'Layout and design',
        'content' => 'Content',
        'business' => 'Hosting and business',
        'site' => 'Header, footer and navigation',
    );

    const MAX_ITEMS = 24;
    const MAX_TEXT = 500;
    const MAX_TEXTAREA = 4000;
    const MAX_RICHTEXT = 20000;

    private static $specs = null;
    private $definitions = array();
    private $sanitizer;

    public function __construct(HtmlSanitizer $sanitizer = null)
    {
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
        foreach (self::specs() as $key => $spec) {
            $this->definitions[$key] = new WidgetDefinition($key, $spec);
        }
    }

    /** @return WidgetDefinition[] */
    public function all() { return $this->definitions; }

    public function has($key) { return is_string($key) && isset($this->definitions[$key]); }

    /** @return WidgetDefinition|null */
    public function get($key) { return $this->has($key) ? $this->definitions[$key] : null; }

    public function keys() { return array_keys($this->definitions); }

    public function categories() { return self::CATEGORIES; }

    /** Widget keys that read live platform data, for documentation and tests. */
    public function liveDataWidgets()
    {
        $keys = array();
        foreach ($this->definitions as $key => $definition) {
            if ($definition->usesLiveData()) { $keys[] = $key; }
        }
        return $keys;
    }

    public function toArray()
    {
        $out = array();
        foreach ($this->definitions as $key => $definition) { $out[$key] = $definition->toArray(); }
        return $out;
    }

    /**
     * Validate and normalise one node's props.
     *
     * Unknown props are dropped and reported. Every value is coerced to the
     * declared type; a value that cannot be coerced falls back to the field
     * default rather than being stored half-validated.
     */
    public function sanitizeProps($key, $props, array &$errors = array(), $path = 'props')
    {
        $definition = $this->get($key);
        if (!$definition) {
            $errors[] = $path . ': unknown widget "' . self::describe($key) . '".';
            return array();
        }
        if (!is_array($props)) { $props = array(); }
        $clean = array();
        foreach ($definition->fields() as $field) {
            $name = $field['key'];
            $value = array_key_exists($name, $props) ? $props[$name] : null;
            $clean[$name] = $this->sanitizeField($field, $value, $errors, $path . '.' . $name);
        }
        foreach (array_keys($props) as $name) {
            if (!array_key_exists($name, $clean)) {
                $errors[] = $path . ': "' . self::describe($name) . '" is not a property of the ' . $definition->label() . ' widget.';
            }
        }
        return $clean;
    }

    private function sanitizeField(array $field, $value, array &$errors, $path)
    {
        $default = array_key_exists('default', $field) ? $field['default'] : WidgetDefinition::emptyFor($field['type']);
        if ($value === null) { return $default; }

        switch ($field['type']) {
            case 'text':
                if (is_array($value) || is_object($value)) { $errors[] = $path . ': expected text.'; return $default; }
                $max = isset($field['max_length']) ? (int) $field['max_length'] : self::MAX_TEXT;
                return $this->sanitizer->text((string) $value, $max);
            case 'textarea':
                if (is_array($value) || is_object($value)) { $errors[] = $path . ': expected text.'; return $default; }
                return $this->sanitizer->text((string) $value, self::MAX_TEXTAREA, true);
            case 'richtext':
                if (is_array($value) || is_object($value)) { $errors[] = $path . ': expected rich text.'; return $default; }
                return $this->sanitizer->clean((string) $value, self::MAX_RICHTEXT);
            case 'number':
                if (!is_numeric($value)) {
                    if ($value !== '') { $errors[] = $path . ': expected a number.'; }
                    return $default;
                }
                $number = (float) $value;
                if (isset($field['min']) && $number < $field['min']) { $number = (float) $field['min']; }
                if (isset($field['max']) && $number > $field['max']) { $number = (float) $field['max']; }
                return $number == (int) $number ? (int) $number : round($number, 3);
            case 'toggle':
                return !($value === false || $value === 0 || $value === '0' || $value === '' || $value === 'false' || $value === null);
            case 'select':
                $options = isset($field['options']) ? array_keys($field['options']) : array();
                $value = is_scalar($value) ? (string) $value : '';
                if (!in_array($value, $options, true)) {
                    if ($value !== '') { $errors[] = $path . ': "' . self::describe($value) . '" is not an allowed option.'; }
                    return $default;
                }
                return $value;
            case 'color':
                $color = is_scalar($value) ? StyleSchema::color(trim((string) $value)) : null;
                if ($color === null) {
                    if ($value !== '') { $errors[] = $path . ': invalid colour.'; }
                    return $default;
                }
                return $color;
            case 'url':
                $url = is_scalar($value) ? UrlPolicy::link((string) $value) : null;
                if ($url === null) {
                    $errors[] = $path . ': unsupported or unsafe URL.';
                    return $default;
                }
                return $url;
            case 'media':
                return $this->sanitizeMedia($value, $errors, $path);
            case 'items':
                return $this->sanitizeItems($field, $value, $errors, $path);
            case 'icon':
                $icon = is_scalar($value) ? (string) $value : '';
                return preg_match('/^[a-z][a-z0-9-]{1,31}$/', $icon) === 1 ? $icon : $default;
            case 'product':
            case 'productgroup':
            case 'menu':
            case 'form':
                if (!is_scalar($value) || !preg_match('/^\d{0,10}$/', (string) $value)) {
                    $errors[] = $path . ': expected a numeric reference.';
                    return $default;
                }
                return (int) $value;
        }
        $errors[] = $path . ': unsupported field type.';
        return $default;
    }

    private function sanitizeMedia($value, array &$errors, $path)
    {
        $empty = array('id' => 0, 'url' => '', 'alt' => '');
        if (is_string($value)) { $value = array('url' => $value); }
        if (!is_array($value)) { $errors[] = $path . ': expected a media reference.'; return $empty; }
        $url = isset($value['url']) && is_scalar($value['url']) ? UrlPolicy::media((string) $value['url']) : '';
        if ($url === null) { $errors[] = $path . ': unsafe media URL.'; return $empty; }
        return array(
            'id' => isset($value['id']) && is_scalar($value['id']) ? (int) $value['id'] : 0,
            'url' => (string) $url,
            'alt' => isset($value['alt']) && is_scalar($value['alt']) ? $this->sanitizer->text((string) $value['alt'], 250) : '',
        );
    }

    private function sanitizeItems(array $field, $value, array &$errors, $path)
    {
        if (!is_array($value)) {
            if ($value !== '') { $errors[] = $path . ': expected a list.'; }
            return array();
        }
        $max = isset($field['max_items']) ? (int) $field['max_items'] : self::MAX_ITEMS;
        $rows = array();
        $index = 0;
        foreach ($value as $row) {
            if ($index >= $max) {
                $errors[] = $path . ': list truncated to ' . $max . ' items.';
                break;
            }
            if (!is_array($row)) { $errors[] = $path . '[' . $index . ']: expected an object.'; $index++; continue; }
            $clean = array();
            foreach ($field['fields'] as $sub) {
                $name = $sub['key'];
                $clean[$name] = $this->sanitizeField($sub, array_key_exists($name, $row) ? $row[$name] : null, $errors, $path . '[' . $index . '].' . $name);
            }
            $rows[] = $clean;
            $index++;
        }
        return $rows;
    }

    /* ------------------------------------------------------------- catalogue */

    private static function field($key, $label, $type, $default = null, array $extra = array())
    {
        $field = array('key' => $key, 'label' => $label, 'type' => $type);
        $field['default'] = $default === null ? WidgetDefinition::emptyFor($type) : $default;
        return array_merge($field, $extra);
    }

    /** Raw widget specifications. */
    public static function specs()
    {
        if (self::$specs !== null) { return self::$specs; }
        $f = array(__CLASS__, 'field');
        $tag = call_user_func($f, 'html_tag', 'HTML tag', 'select', 'div', array('options' => array(
            'div' => 'div', 'section' => 'section', 'header' => 'header', 'footer' => 'footer',
            'main' => 'main', 'article' => 'article', 'aside' => 'aside', 'nav' => 'nav',
        )));
        $linkTarget = call_user_func($f, 'target', 'Open in', 'select', 'self', array('options' => array('self' => 'Same tab', 'blank' => 'New tab')));

        self::$specs = array(
            /* ------------------------------------------------------ structure */
            'section' => array(
                'label' => 'Section', 'category' => 'layout', 'icon' => 'section', 'structural' => true, 'children' => true,
                'allowed_children' => array('container'),
                'description' => 'Full-width band. Holds one or more containers.',
                'fields' => array(
                    $tag,
                    call_user_func($f, 'content_width', 'Content width', 'select', 'boxed', array('options' => array('boxed' => 'Boxed', 'full' => 'Full width'))),
                ),
                'style' => array('desktop' => array('padding_top' => '64px', 'padding_bottom' => '64px')),
            ),
            'container' => array(
                'label' => 'Container', 'category' => 'layout', 'icon' => 'container', 'structural' => true, 'children' => true,
                'allowed_children' => array('container', 'column', 'widget'),
                'description' => 'Flex or grid box. Nest containers to build any layout.',
                'fields' => array(
                    $tag,
                    call_user_func($f, 'layout', 'Layout', 'select', 'flex', array('options' => array('flex' => 'Flexbox', 'grid' => 'Grid', 'block' => 'Stacked'))),
                ),
                'style' => array('desktop' => array('display' => 'flex', 'flex_direction' => 'row', 'gap' => '24px', 'align_items' => 'stretch', 'flex_wrap' => 'wrap')),
            ),
            'column' => array(
                'label' => 'Column', 'category' => 'layout', 'icon' => 'column', 'structural' => true, 'children' => true,
                'allowed_children' => array('container', 'widget'),
                'description' => 'Sits inside a container and holds widgets.',
                'fields' => array(
                    $tag,
                    call_user_func($f, 'vertical_align', 'Vertical alignment', 'select', 'flex-start', array('options' => array('flex-start' => 'Top', 'center' => 'Middle', 'flex-end' => 'Bottom'))),
                ),
                'style' => array('desktop' => array('flex_basis' => '50%', 'flex_grow' => '1', 'display' => 'flex', 'flex_direction' => 'column', 'gap' => '16px')),
            ),

            /* --------------------------------------------------------- layout */
            'spacer' => array(
                'label' => 'Spacer', 'category' => 'layout', 'icon' => 'spacer',
                'description' => 'Vertical space, adjustable per device.',
                'fields' => array(call_user_func($f, 'height', 'Height (px)', 'number', 48, array('min' => 1, 'max' => 800))),
            ),
            'divider' => array(
                'label' => 'Divider', 'category' => 'layout', 'icon' => 'divider',
                'fields' => array(
                    call_user_func($f, 'line_style', 'Style', 'select', 'solid', array('options' => array('solid' => 'Solid', 'dashed' => 'Dashed', 'dotted' => 'Dotted'))),
                    call_user_func($f, 'thickness', 'Thickness (px)', 'number', 1, array('min' => 1, 'max' => 12)),
                    call_user_func($f, 'width', 'Width (%)', 'number', 100, array('min' => 5, 'max' => 100)),
                    call_user_func($f, 'line_color', 'Colour', 'color', 'border'),
                ),
            ),
            'tabs' => array(
                'label' => 'Tabs', 'category' => 'layout', 'icon' => 'tabs',
                'description' => 'Tabbed panels. Works without JavaScript using native details/summary fallback.',
                'fields' => array(
                    call_user_func($f, 'items', 'Tabs', 'items', array(), array('max_items' => 12, 'fields' => array(
                        call_user_func($f, 'title', 'Tab title', 'text', 'Tab'),
                        call_user_func($f, 'content', 'Content', 'richtext', '<p>Tab content.</p>'),
                    ))),
                ),
            ),
            'accordion' => array(
                'label' => 'Accordion', 'category' => 'layout', 'icon' => 'accordion',
                'fields' => array(
                    call_user_func($f, 'items', 'Panels', 'items', array(), array('max_items' => 20, 'fields' => array(
                        call_user_func($f, 'title', 'Title', 'text', 'Panel title'),
                        call_user_func($f, 'content', 'Content', 'richtext', '<p>Panel content.</p>'),
                    ))),
                    call_user_func($f, 'first_open', 'Open the first panel', 'toggle', true),
                ),
            ),
            'carousel' => array(
                'label' => 'Carousel', 'category' => 'layout', 'icon' => 'carousel',
                'fields' => array(
                    call_user_func($f, 'items', 'Slides', 'items', array(), array('max_items' => 12, 'fields' => array(
                        call_user_func($f, 'image', 'Image', 'media'),
                        call_user_func($f, 'caption', 'Caption', 'text', ''),
                        call_user_func($f, 'url', 'Link', 'url', ''),
                    ))),
                    call_user_func($f, 'autoplay', 'Autoplay', 'toggle', false),
                    call_user_func($f, 'interval', 'Interval (seconds)', 'number', 6, array('min' => 2, 'max' => 30)),
                    call_user_func($f, 'show_dots', 'Show position dots', 'toggle', true),
                ),
            ),

            /* -------------------------------------------------------- content */
            'heading' => array(
                'label' => 'Heading', 'category' => 'content', 'icon' => 'heading',
                'fields' => array(
                    call_user_func($f, 'text', 'Heading', 'text', 'Your heading', array('max_length' => 250, 'inline' => true)),
                    call_user_func($f, 'level', 'Level', 'select', 'h2', array('options' => array('h1' => 'H1', 'h2' => 'H2', 'h3' => 'H3', 'h4' => 'H4', 'h5' => 'H5', 'h6' => 'H6'))),
                    call_user_func($f, 'url', 'Link', 'url', ''),
                ),
            ),
            'text' => array(
                'label' => 'Text editor', 'category' => 'content', 'icon' => 'text',
                'fields' => array(call_user_func($f, 'content', 'Content', 'richtext', '<p>Write something worth reading.</p>', array('inline' => true))),
            ),
            'image' => array(
                'label' => 'Image', 'category' => 'content', 'icon' => 'image',
                'fields' => array(
                    call_user_func($f, 'image', 'Image', 'media'),
                    call_user_func($f, 'alt', 'Alternative text', 'text', '', array('max_length' => 250)),
                    call_user_func($f, 'caption', 'Caption', 'text', ''),
                    call_user_func($f, 'url', 'Link', 'url', ''),
                    call_user_func($f, 'loading', 'Loading', 'select', 'lazy', array('options' => array('lazy' => 'Lazy', 'eager' => 'Eager'))),
                ),
            ),
            'gallery' => array(
                'label' => 'Image gallery', 'category' => 'content', 'icon' => 'gallery',
                'fields' => array(
                    call_user_func($f, 'items', 'Images', 'items', array(), array('max_items' => 24, 'fields' => array(
                        call_user_func($f, 'image', 'Image', 'media'),
                        call_user_func($f, 'caption', 'Caption', 'text', ''),
                    ))),
                    call_user_func($f, 'columns', 'Columns', 'number', 3, array('min' => 1, 'max' => 6)),
                ),
            ),
            'video' => array(
                'label' => 'Video', 'category' => 'content', 'icon' => 'video',
                'description' => 'YouTube, Vimeo or a self-hosted file. Embeds are restricted to known hosts.',
                'fields' => array(
                    call_user_func($f, 'source', 'Source', 'select', 'youtube', array('options' => array('youtube' => 'YouTube', 'vimeo' => 'Vimeo', 'file' => 'Uploaded file'))),
                    call_user_func($f, 'url', 'Video URL', 'url', ''),
                    call_user_func($f, 'poster', 'Poster image', 'media'),
                    call_user_func($f, 'controls', 'Show controls', 'toggle', true),
                    call_user_func($f, 'loop', 'Loop', 'toggle', false),
                ),
            ),
            'icon' => array(
                'label' => 'Icon', 'category' => 'content', 'icon' => 'star',
                'fields' => array(
                    call_user_func($f, 'icon', 'Icon', 'icon', 'check'),
                    call_user_func($f, 'size', 'Size (px)', 'number', 32, array('min' => 12, 'max' => 160)),
                    call_user_func($f, 'icon_color', 'Colour', 'color', 'primary'),
                    call_user_func($f, 'url', 'Link', 'url', ''),
                ),
            ),
            'button' => array(
                'label' => 'Button', 'category' => 'content', 'icon' => 'button',
                'fields' => array(
                    call_user_func($f, 'label', 'Label', 'text', 'Get started', array('max_length' => 120, 'inline' => true)),
                    call_user_func($f, 'url', 'Link', 'url', ''),
                    $linkTarget,
                    call_user_func($f, 'variant', 'Style', 'select', 'primary', array('options' => array('primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline', 'ghost' => 'Text only'))),
                    call_user_func($f, 'size', 'Size', 'select', 'md', array('options' => array('sm' => 'Small', 'md' => 'Medium', 'lg' => 'Large'))),
                    call_user_func($f, 'icon', 'Icon', 'icon', ''),
                    call_user_func($f, 'full_width', 'Full width', 'toggle', false),
                ),
            ),
            'list' => array(
                'label' => 'List', 'category' => 'content', 'icon' => 'list',
                'fields' => array(
                    call_user_func($f, 'items', 'Items', 'items', array(), array('max_items' => 24, 'fields' => array(
                        call_user_func($f, 'text', 'Text', 'text', 'List item'),
                        call_user_func($f, 'icon', 'Icon', 'icon', 'check'),
                    ))),
                    call_user_func($f, 'list_style', 'Style', 'select', 'icon', array('options' => array('icon' => 'Icon', 'bullet' => 'Bullet', 'number' => 'Numbered'))),
                ),
            ),
            'testimonial' => array(
                'label' => 'Testimonial', 'category' => 'content', 'icon' => 'quote',
                'fields' => array(
                    call_user_func($f, 'quote', 'Quote', 'textarea', 'They moved our infrastructure over in a weekend.'),
                    call_user_func($f, 'author', 'Author', 'text', 'Customer name'),
                    call_user_func($f, 'role', 'Role', 'text', ''),
                    call_user_func($f, 'avatar', 'Avatar', 'media'),
                    call_user_func($f, 'rating', 'Rating (0-5)', 'number', 5, array('min' => 0, 'max' => 5)),
                ),
            ),
            'pricing_table' => array(
                'label' => 'Pricing table', 'category' => 'content', 'icon' => 'pricing',
                'description' => 'Editorial pricing card. For live WHMCS pricing use the Hosting plans widget.',
                'fields' => array(
                    call_user_func($f, 'plan', 'Plan name', 'text', 'Starter'),
                    call_user_func($f, 'price', 'Price', 'text', ''),
                    call_user_func($f, 'period', 'Period', 'text', 'per month'),
                    call_user_func($f, 'features', 'Features', 'items', array(), array('max_items' => 16, 'fields' => array(
                        call_user_func($f, 'text', 'Feature', 'text', 'Feature'),
                    ))),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Choose plan'),
                    call_user_func($f, 'button_url', 'Button link', 'url', ''),
                    call_user_func($f, 'featured', 'Highlight this plan', 'toggle', false),
                    call_user_func($f, 'badge', 'Badge', 'text', ''),
                ),
            ),
            'counter' => array(
                'label' => 'Counter', 'category' => 'content', 'icon' => 'counter',
                'fields' => array(
                    call_user_func($f, 'value', 'Value', 'number', 99, array('min' => -1000000, 'max' => 1000000000)),
                    call_user_func($f, 'prefix', 'Prefix', 'text', ''),
                    call_user_func($f, 'suffix', 'Suffix', 'text', ''),
                    call_user_func($f, 'label', 'Label', 'text', 'Uptime'),
                ),
            ),
            'progress' => array(
                'label' => 'Progress bar', 'category' => 'content', 'icon' => 'progress',
                'fields' => array(
                    call_user_func($f, 'label', 'Label', 'text', 'Network capacity'),
                    call_user_func($f, 'percent', 'Percent', 'number', 75, array('min' => 0, 'max' => 100)),
                    call_user_func($f, 'show_value', 'Show value', 'toggle', true),
                    call_user_func($f, 'bar_color', 'Bar colour', 'color', 'primary'),
                ),
            ),
            'cta' => array(
                'label' => 'Call to action', 'category' => 'content', 'icon' => 'cta',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Ready to move?', array('inline' => true)),
                    call_user_func($f, 'text', 'Supporting text', 'textarea', 'Migration is included on every plan.'),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Start now'),
                    call_user_func($f, 'button_url', 'Button link', 'url', ''),
                    call_user_func($f, 'secondary_label', 'Secondary label', 'text', ''),
                    call_user_func($f, 'secondary_url', 'Secondary link', 'url', ''),
                    call_user_func($f, 'layout', 'Layout', 'select', 'inline', array('options' => array('inline' => 'Inline', 'stacked' => 'Stacked'))),
                ),
            ),

            /* ------------------------------------------------------- business */
            'hosting_plans' => array(
                'label' => 'Hosting plans', 'category' => 'business', 'icon' => 'server', 'live_data' => true,
                'description' => 'Live products and prices from WHMCS. Nothing is rendered when the catalogue cannot be read.',
                'fields' => array(
                    call_user_func($f, 'group', 'Product group', 'productgroup', 0),
                    call_user_func($f, 'billing_cycle', 'Billing cycle', 'select', 'monthly', array('options' => array(
                        'monthly' => 'Monthly', 'quarterly' => 'Quarterly', 'semiannually' => 'Semi-annually',
                        'annually' => 'Annually', 'biennially' => 'Biennially', 'triennially' => 'Triennially',
                    ))),
                    call_user_func($f, 'limit', 'Maximum plans', 'number', 4, array('min' => 1, 'max' => 12)),
                    call_user_func($f, 'columns', 'Columns', 'number', 3, array('min' => 1, 'max' => 4)),
                    call_user_func($f, 'show_description', 'Show product description', 'toggle', true),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Order now'),
                    call_user_func($f, 'highlight', 'Highlight plan number', 'number', 0, array('min' => 0, 'max' => 12)),
                ),
            ),
            'product_card' => array(
                'label' => 'Product card', 'category' => 'business', 'icon' => 'card', 'live_data' => true,
                'fields' => array(
                    call_user_func($f, 'product', 'Product', 'product', 0),
                    call_user_func($f, 'billing_cycle', 'Billing cycle', 'select', 'monthly', array('options' => array(
                        'monthly' => 'Monthly', 'quarterly' => 'Quarterly', 'semiannually' => 'Semi-annually',
                        'annually' => 'Annually', 'biennially' => 'Biennially', 'triennially' => 'Triennially',
                    ))),
                    call_user_func($f, 'show_description', 'Show description', 'toggle', true),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Order now'),
                ),
            ),
            'order_button' => array(
                'label' => 'Order button', 'category' => 'business', 'icon' => 'cart', 'live_data' => true,
                'description' => 'Adds a real WHMCS product to the cart.',
                'fields' => array(
                    call_user_func($f, 'product', 'Product', 'product', 0),
                    call_user_func($f, 'label', 'Label', 'text', 'Add to cart'),
                    call_user_func($f, 'billing_cycle', 'Billing cycle', 'select', 'monthly', array('options' => array(
                        'monthly' => 'Monthly', 'quarterly' => 'Quarterly', 'semiannually' => 'Semi-annually',
                        'annually' => 'Annually', 'biennially' => 'Biennially', 'triennially' => 'Triennially',
                    ))),
                    call_user_func($f, 'variant', 'Style', 'select', 'primary', array('options' => array('primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline'))),
                    call_user_func($f, 'show_price', 'Show price on the button', 'toggle', true),
                ),
            ),
            'server_specs' => array(
                'label' => 'Server specifications', 'category' => 'business', 'icon' => 'specs', 'live_data' => true,
                'description' => 'Specification table. Linking a product pulls its real name, group and price.',
                'fields' => array(
                    call_user_func($f, 'product', 'Linked product', 'product', 0),
                    call_user_func($f, 'items', 'Specifications', 'items', array(), array('max_items' => 20, 'fields' => array(
                        call_user_func($f, 'label', 'Label', 'text', 'vCPU'),
                        call_user_func($f, 'value', 'Value', 'text', '4 cores'),
                        call_user_func($f, 'icon', 'Icon', 'icon', ''),
                    ))),
                    call_user_func($f, 'show_price', 'Show live price', 'toggle', true),
                ),
            ),
            'domain_search' => array(
                'label' => 'Domain search', 'category' => 'business', 'icon' => 'search', 'live_data' => true,
                'description' => 'Posts to the WHMCS domain checker. Availability is decided by WHMCS, never by the builder.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Find your domain'),
                    call_user_func($f, 'placeholder', 'Placeholder', 'text', 'yourbusiness.com'),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Search'),
                    call_user_func($f, 'show_pricing', 'Show TLD pricing strip', 'toggle', true),
                    call_user_func($f, 'tlds', 'Pricing strip TLDs', 'text', '.com,.net,.org,.ng', array('max_length' => 200)),
                ),
            ),
            'domain_pricing' => array(
                'label' => 'Domain pricing', 'category' => 'business', 'icon' => 'globe', 'live_data' => true,
                'description' => 'Registration, transfer and renewal prices from the WHMCS domain pricing table.',
                'fields' => array(
                    call_user_func($f, 'tlds', 'TLDs (blank for all)', 'text', '', array('max_length' => 300)),
                    call_user_func($f, 'limit', 'Maximum rows', 'number', 8, array('min' => 1, 'max' => 40)),
                    call_user_func($f, 'show_transfer', 'Show transfer price', 'toggle', true),
                    call_user_func($f, 'show_renew', 'Show renewal price', 'toggle', true),
                ),
            ),
            'cart_summary' => array(
                'label' => 'Shopping cart', 'category' => 'business', 'icon' => 'cart', 'live_data' => true,
                'description' => 'Reads the visitor\'s real WHMCS cart session. Empty is shown as empty.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Your cart'),
                    call_user_func($f, 'empty_text', 'Empty message', 'text', 'Your cart is empty.'),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'View cart'),
                ),
            ),
            'checkout_link' => array(
                'label' => 'Checkout link', 'category' => 'business', 'icon' => 'checkout', 'live_data' => true,
                'fields' => array(
                    call_user_func($f, 'label', 'Label', 'text', 'Checkout'),
                    call_user_func($f, 'variant', 'Style', 'select', 'primary', array('options' => array('primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline'))),
                ),
            ),
            'reviews' => array(
                'label' => 'Customer reviews', 'category' => 'business', 'icon' => 'quote', 'live_data' => true,
                'description' => 'Published testimonials from the CloudHost247 theme content store.',
                'fields' => array(
                    call_user_func($f, 'limit', 'Maximum reviews', 'number', 3, array('min' => 1, 'max' => 12)),
                    call_user_func($f, 'columns', 'Columns', 'number', 3, array('min' => 1, 'max' => 4)),
                    call_user_func($f, 'heading', 'Heading', 'text', 'What customers say'),
                ),
            ),
            'contact_form' => array(
                'label' => 'Form', 'category' => 'business', 'icon' => 'form', 'live_data' => true,
                'description' => 'Renders a form built in Website Builder -> Forms. Submissions are stored and can open a ticket.',
                'fields' => array(
                    call_user_func($f, 'form', 'Form', 'form', 0),
                    call_user_func($f, 'title', 'Title', 'text', ''),
                    call_user_func($f, 'description', 'Description', 'textarea', ''),
                    call_user_func($f, 'submit_label', 'Submit label', 'text', 'Send'),
                ),
            ),
            'faq' => array(
                'label' => 'FAQ', 'category' => 'business', 'icon' => 'faq',
                'fields' => array(
                    call_user_func($f, 'items', 'Questions', 'items', array(), array('max_items' => 24, 'fields' => array(
                        call_user_func($f, 'question', 'Question', 'text', 'How long does migration take?'),
                        call_user_func($f, 'answer', 'Answer', 'richtext', '<p>Most migrations finish the same day.</p>'),
                    ))),
                    call_user_func($f, 'schema_markup', 'Add FAQ structured data', 'toggle', true),
                ),
            ),
            'service_status' => array(
                'label' => 'Service status', 'category' => 'business', 'icon' => 'status', 'live_data' => true,
                'description' => 'Real integration health from the API & Integrations centre. Never shows a status it has not measured.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Platform status'),
                    call_user_func($f, 'limit', 'Maximum services', 'number', 6, array('min' => 1, 'max' => 24)),
                    call_user_func($f, 'show_checked_at', 'Show last checked time', 'toggle', true),
                ),
            ),
            'broker_this_domain' => array(
                'label' => 'Broker This Domain', 'category' => 'business', 'icon' => 'globe', 'live_data' => true,
                'description' => 'Lets a visitor ask CloudHost247 to try to acquire a specific domain. Submits to the real Domain Brokerage service; shown as unavailable if brokerage is not enabled.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Want this domain?'),
                    call_user_func($f, 'text', 'Supporting text', 'textarea', 'We can reach out on your behalf through legitimate channels. Buying registered domains is never guaranteed.'),
                    call_user_func($f, 'placeholder', 'Domain field placeholder', 'text', 'example.com'),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Broker This Domain'),
                ),
            ),
            'domain_brokerage_cta' => array(
                'label' => 'Domain Brokerage CTA', 'category' => 'business', 'icon' => 'bolt', 'live_data' => true,
                'description' => 'A general call-to-action that links into the real Domain Brokerage request form. Shown as unavailable if brokerage is not enabled.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Can\'t get the domain you want?'),
                    call_user_func($f, 'text', 'Supporting text', 'textarea', 'Our domain brokers can contact the owner and negotiate on your behalf.'),
                    call_user_func($f, 'button_label', 'Button label', 'text', 'Start a Brokerage Request'),
                    call_user_func($f, 'variant', 'Style', 'select', 'primary', array('options' => array('primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline'))),
                ),
            ),
            'brokerage_status' => array(
                'label' => 'Brokerage Status', 'category' => 'business', 'icon' => 'status', 'live_data' => true,
                'description' => 'The signed-in customer\'s most recent Domain Brokerage case and its real status. Shown only to a signed-in visitor with at least one case.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Your brokerage request'),
                ),
            ),
            'customer_brokerage_cases' => array(
                'label' => 'Customer Brokerage Cases', 'category' => 'business', 'icon' => 'menu', 'live_data' => true,
                'description' => 'A signed-in customer\'s real Domain Brokerage case list with a link to the full dashboard. Never shows another customer\'s cases.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Your domain brokerage cases'),
                    call_user_func($f, 'limit', 'Maximum cases', 'number', 5, array('min' => 1, 'max' => 20)),
                    call_user_func($f, 'empty_text', 'Message when there are none', 'text', 'You have no domain brokerage cases yet.'),
                ),
            ),
            'brokerage_pricing' => array(
                'label' => 'Brokerage Pricing', 'category' => 'business', 'icon' => 'card', 'live_data' => true,
                'description' => 'The admin-configured Domain Brokerage fee rules (Super Admin -> Domain Brokerage -> Fees). Never a sample price list.',
                'fields' => array(
                    call_user_func($f, 'heading', 'Heading', 'text', 'Brokerage pricing'),
                    call_user_func($f, 'text', 'Supporting text', 'textarea', 'The acquisition price, brokerage fee, transfer fee and any service fee are always itemised separately.'),
                ),
            ),
            'brokerage_faq' => array(
                'label' => 'Brokerage FAQ', 'category' => 'business', 'icon' => 'faq',
                'description' => 'Frequently asked questions about the Domain Brokerage service. Same editor as the general FAQ widget.',
                'fields' => array(
                    call_user_func($f, 'items', 'Questions', 'items', array(), array('max_items' => 24, 'fields' => array(
                        call_user_func($f, 'question', 'Question', 'text', 'Can you guarantee you will get the domain?'),
                        call_user_func($f, 'answer', 'Answer', 'richtext', '<p>No. A registered domain may not be for sale, and an owner may decline or not respond. We only use legitimate contact channels and will always tell you the real status of your request.</p>'),
                    ))),
                    call_user_func($f, 'schema_markup', 'Add FAQ structured data', 'toggle', true),
                ),
            ),

            /* ----------------------------------------------------------- site */
            'site_logo' => array(
                'label' => 'Logo', 'category' => 'site', 'icon' => 'image',
                'fields' => array(
                    call_user_func($f, 'image', 'Logo image', 'media'),
                    call_user_func($f, 'alt', 'Alternative text', 'text', 'CloudHost247'),
                    call_user_func($f, 'url', 'Link', 'url', '/'),
                    call_user_func($f, 'width', 'Width (px)', 'number', 160, array('min' => 40, 'max' => 480)),
                ),
            ),
            'nav_menu' => array(
                'label' => 'Navigation menu', 'category' => 'site', 'icon' => 'menu', 'live_data' => true,
                'fields' => array(
                    call_user_func($f, 'menu', 'Menu', 'menu', 0),
                    call_user_func($f, 'orientation', 'Orientation', 'select', 'horizontal', array('options' => array('horizontal' => 'Horizontal', 'vertical' => 'Vertical'))),
                    call_user_func($f, 'collapse_mobile', 'Collapse on mobile', 'toggle', true),
                ),
            ),
            'account_links' => array(
                'label' => 'Account links', 'category' => 'site', 'icon' => 'user', 'live_data' => true,
                'description' => 'Links to the real WHMCS client area, login and registration pages. The builder never re-implements authentication.',
                'fields' => array(
                    call_user_func($f, 'show_client_area', 'Client area link', 'toggle', true),
                    call_user_func($f, 'show_login', 'Login link', 'toggle', true),
                    call_user_func($f, 'show_register', 'Register link', 'toggle', true),
                    call_user_func($f, 'variant', 'Style', 'select', 'ghost', array('options' => array('primary' => 'Primary', 'secondary' => 'Secondary', 'outline' => 'Outline', 'ghost' => 'Text only'))),
                ),
            ),
            'copyright' => array(
                'label' => 'Copyright', 'category' => 'site', 'icon' => 'text',
                'fields' => array(
                    call_user_func($f, 'text', 'Text', 'text', 'CloudHost247. All rights reserved.'),
                    call_user_func($f, 'show_year', 'Prefix with the current year', 'toggle', true),
                ),
            ),
        );
        return self::$specs;
    }

    private static function describe($value)
    {
        if (!is_scalar($value)) { return gettype($value); }
        $value = preg_replace('/[^\x20-\x7E]/', '', (string) $value);
        return strlen($value) > 40 ? substr($value, 0, 40) . '...' : $value;
    }
}
