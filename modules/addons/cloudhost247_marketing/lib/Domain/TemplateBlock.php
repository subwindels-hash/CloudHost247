<?php
namespace CloudHost247\Marketing\Domain;

/**
 * The closed block catalog the email builder can render (requirement #9).
 *
 * A template is a list of blocks, and a block is nothing but a type plus its
 * typed fields. There is no executable markup anywhere in a design: an operator
 * cannot paste raw HTML into a template, because every block renders through
 * this catalog into table-based e-mail markup with inline styles. That is what
 * keeps previews, exported HTML and what actually leaves the queue identical.
 */
final class TemplateBlock
{
    const MAX_BLOCKS = 30;
    const MAX_BULLETS = 20;

    const TYPE_HEADING = 'heading';
    const TYPE_PARAGRAPH = 'paragraph';
    const TYPE_BULLETS = 'bullets';
    const TYPE_BUTTON = 'button';
    const TYPE_IMAGE = 'image';
    const TYPE_DIVIDER = 'divider';
    const TYPE_SPACER = 'spacer';
    const TYPE_LEGAL = 'legal';

    const TYPE_TEXT = 'text';
    const TYPE_TEXTAREA = 'textarea';
    const TYPE_URL = 'url';
    const TYPE_ENUM = 'enum';
    const TYPE_INT = 'int';

    /** @var array<string,array>|null */
    private static $blocks;

    /** @return array<string,array> */
    public static function all()
    {
        if (self::$blocks !== null) { return self::$blocks; }

        $align = array('left', 'center', 'right');

        self::$blocks = array(
            self::TYPE_HEADING => array(
                'label' => 'Heading',
                'summary' => 'One line title, rendered as a styled heading cell.',
                'fields' => array(
                    'text' => array('type' => self::TYPE_TEXT, 'label' => 'Heading text', 'required' => true, 'max' => 160),
                    'level' => array('type' => self::TYPE_ENUM, 'label' => 'Size', 'values' => array('1', '2', '3'), 'default' => '2'),
                    'align' => array('type' => self::TYPE_ENUM, 'label' => 'Alignment', 'values' => $align, 'default' => 'left'),
                ),
            ),
            self::TYPE_PARAGRAPH => array(
                'label' => 'Paragraph',
                'summary' => 'Body copy; bold, italic, underline and links are allowed.',
                'fields' => array(
                    'text' => array('type' => self::TYPE_TEXTAREA, 'label' => 'Text', 'required' => true, 'max' => 2000),
                    'align' => array('type' => self::TYPE_ENUM, 'label' => 'Alignment', 'values' => $align, 'default' => 'left'),
                ),
            ),
            self::TYPE_BULLETS => array(
                'label' => 'Bullet list',
                'summary' => 'One item per line; rendered as a plain list so it survives every client.',
                'fields' => array(
                    'items' => array('type' => self::TYPE_TEXTAREA, 'label' => 'Items (one per line)', 'required' => true, 'max' => 2000),
                ),
            ),
            self::TYPE_BUTTON => array(
                'label' => 'Button',
                'summary' => 'Single call to action; the URL must be http(s) or mailto.',
                'fields' => array(
                    'label' => array('type' => self::TYPE_TEXT, 'label' => 'Button label', 'required' => true, 'max' => 60),
                    'url' => array('type' => self::TYPE_URL, 'label' => 'Target URL', 'required' => true, 'max' => 500),
                    'variant' => array('type' => self::TYPE_ENUM, 'label' => 'Style', 'values' => array('primary', 'secondary'), 'default' => 'primary'),
                    'align' => array('type' => self::TYPE_ENUM, 'label' => 'Alignment', 'values' => $align, 'default' => 'left'),
                ),
            ),
            self::TYPE_IMAGE => array(
                'label' => 'Image',
                'summary' => 'Remote image with required alternative text for accessibility.',
                'fields' => array(
                    'url' => array('type' => self::TYPE_URL, 'label' => 'Image URL', 'required' => true, 'max' => 500),
                    'alt' => array('type' => self::TYPE_TEXT, 'label' => 'Alternative text', 'required' => true, 'max' => 160),
                    'link_url' => array('type' => self::TYPE_URL, 'label' => 'Link (optional)', 'required' => false, 'max' => 500),
                    'width' => array('type' => self::TYPE_INT, 'label' => 'Width in pixels', 'min' => 100, 'max' => 600, 'default' => 600),
                ),
            ),
            self::TYPE_DIVIDER => array(
                'label' => 'Divider',
                'summary' => 'Horizontal rule rendered as a table row border.',
                'fields' => array(),
            ),
            self::TYPE_SPACER => array(
                'label' => 'Spacer',
                'summary' => 'Vertical breathing room.',
                'fields' => array(
                    'height' => array('type' => self::TYPE_INT, 'label' => 'Height in pixels', 'min' => 8, 'max' => 96, 'default' => 24),
                ),
            ),
            self::TYPE_LEGAL => array(
                'label' => 'Legal / compliance footer',
                'summary' => 'Company identity and the reason the recipient is receiving this mail.',
                'fields' => array(
                    'text' => array('type' => self::TYPE_TEXTAREA, 'label' => 'Footer text', 'required' => true, 'max' => 1000),
                ),
            ),
        );

        return self::$blocks;
    }

    public static function isValid($type)
    {
        $all = self::all();
        return is_string($type) && isset($all[$type]);
    }

    public static function definition($type)
    {
        if (!self::isValid($type)) {
            throw new \InvalidArgumentException('Unknown template block: ' . (string) $type);
        }
        $all = self::all();
        return $all[$type];
    }

    public static function label($type)
    {
        $block = self::definition($type);
        return $block['label'];
    }

    /** @return string[] every block type, in catalog order */
    public static function types()
    {
        return array_keys(self::all());
    }

    /**
     * Default values for a fresh block (used by the builder's blank rows and by
     * previews of partially filled forms).
     *
     * @return array<string,mixed>
     */
    public static function defaults($type)
    {
        $block = self::definition($type);
        $out = array();
        foreach ($block['fields'] as $name => $field) {
            if (array_key_exists('default', $field)) { $out[$name] = $field['default']; }
            elseif (!empty($field['required'])) { $out[$name] = ''; }
            else { $out[$name] = $field['type'] === self::TYPE_INT ? null : ''; }
        }
        return $out;
    }
}
