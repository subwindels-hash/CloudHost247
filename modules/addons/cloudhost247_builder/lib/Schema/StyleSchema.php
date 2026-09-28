<?php
namespace CloudHost247\Builder\Schema;

use CloudHost247\Builder\Support\UrlPolicy;

/**
 * The responsive style vocabulary, and the reason builder CSS is safe.
 *
 * A style is never a free-text CSS string. Every property is declared here
 * with a kind, and every value is matched against that kind before it is
 * stored and again before it is compiled. A value that does not match is
 * dropped with an error rather than escaped, so no document can emit a
 * declaration this file did not authorise -- there is no path from stored
 * content to arbitrary CSS, and therefore none to CSS-based script execution
 * or layout escape.
 *
 * Every property is per device. Desktop is the base rule; tablet and mobile
 * are emitted inside max-width media queries, which is what allows a mobile
 * layout to differ from the desktop one.
 */
final class StyleSchema
{
    const DEVICES = array('desktop', 'tablet', 'mobile');
    const BREAKPOINTS = array('tablet' => 1024, 'mobile' => 767);

    /** Palette names resolved to CSS variables produced by the global styles. */
    const COLOR_TOKENS = array(
        'primary', 'primary-dark', 'secondary', 'accent', 'text', 'heading', 'muted',
        'surface', 'background', 'border', 'inverse', 'success', 'warning', 'danger',
    );
    const FONT_TOKENS = array('body', 'heading', 'mono');
    const SHADOWS = array(
        'none' => 'none',
        'sm' => '0 1px 2px rgba(15, 23, 42, 0.08)',
        'md' => '0 4px 12px rgba(15, 23, 42, 0.10)',
        'lg' => '0 12px 32px rgba(15, 23, 42, 0.14)',
        'xl' => '0 24px 60px rgba(15, 23, 42, 0.18)',
        'inset' => 'inset 0 1px 3px rgba(15, 23, 42, 0.14)',
    );
    const LENGTH_UNITS = array('px', 'rem', 'em', '%', 'vh', 'vw');
    const MAX_LENGTH_MAGNITUDE = 5000;

    /** Properties that the compiler turns into an ::before overlay instead of a declaration. */
    const OVERLAY_PROPERTIES = array('overlay_color', 'overlay_opacity');

    private static $properties = null;

    /**
     * property key => array(css, kind, ...constraints)
     *
     * kind: length | color | keyword | number | integer | font | shadow | media
     */
    public static function properties()
    {
        if (self::$properties !== null) { return self::$properties; }
        $length = function ($css, $negative = false) {
            return array('css' => $css, 'kind' => 'length', 'negative' => $negative);
        };
        $keyword = function ($css, array $values) {
            return array('css' => $css, 'kind' => 'keyword', 'values' => $values);
        };
        self::$properties = array(
            // ------------------------------------------------------------ box
            'width' => array('css' => 'width', 'kind' => 'length', 'negative' => false, 'keywords' => array('auto', 'fit-content')),
            'max_width' => array('css' => 'max-width', 'kind' => 'length', 'negative' => false, 'keywords' => array('none')),
            'min_width' => $length('min-width'),
            'height' => array('css' => 'height', 'kind' => 'length', 'negative' => false, 'keywords' => array('auto')),
            'min_height' => $length('min-height'),
            'max_height' => array('css' => 'max-height', 'kind' => 'length', 'negative' => false, 'keywords' => array('none')),
            'margin_top' => $length('margin-top', true),
            'margin_right' => $length('margin-right', true),
            'margin_bottom' => $length('margin-bottom', true),
            'margin_left' => $length('margin-left', true),
            'padding_top' => $length('padding-top'),
            'padding_right' => $length('padding-right'),
            'padding_bottom' => $length('padding-bottom'),
            'padding_left' => $length('padding-left'),
            // --------------------------------------------------------- layout
            'display' => $keyword('display', array('block', 'flex', 'grid', 'inline-flex', 'inline-block')),
            'flex_direction' => $keyword('flex-direction', array('row', 'row-reverse', 'column', 'column-reverse')),
            'justify_content' => $keyword('justify-content', array('flex-start', 'center', 'flex-end', 'space-between', 'space-around', 'space-evenly')),
            'align_items' => $keyword('align-items', array('flex-start', 'center', 'flex-end', 'stretch', 'baseline')),
            'flex_wrap' => $keyword('flex-wrap', array('wrap', 'nowrap', 'wrap-reverse')),
            'gap' => $length('gap'),
            'row_gap' => $length('row-gap'),
            'grid_columns' => array('css' => 'grid-template-columns', 'kind' => 'integer', 'min' => 1, 'max' => 12),
            'flex_basis' => array('css' => 'flex-basis', 'kind' => 'length', 'negative' => false, 'keywords' => array('auto')),
            'flex_grow' => array('css' => 'flex-grow', 'kind' => 'integer', 'min' => 0, 'max' => 12),
            'order' => array('css' => 'order', 'kind' => 'integer', 'min' => -12, 'max' => 12),
            'align_self' => $keyword('align-self', array('auto', 'flex-start', 'center', 'flex-end', 'stretch')),
            'position' => $keyword('position', array('static', 'relative')),
            'overflow' => $keyword('overflow', array('visible', 'hidden', 'auto')),
            // ----------------------------------------------------- typography
            'font_family' => array('css' => 'font-family', 'kind' => 'font'),
            'font_size' => $length('font-size'),
            'font_weight' => $keyword('font-weight', array('300', '400', '500', '600', '700', '800', '900', 'normal', 'bold')),
            'font_style' => $keyword('font-style', array('normal', 'italic')),
            'line_height' => array('css' => 'line-height', 'kind' => 'number', 'min' => 0.7, 'max' => 4),
            'letter_spacing' => $length('letter-spacing', true),
            'text_transform' => $keyword('text-transform', array('none', 'uppercase', 'lowercase', 'capitalize')),
            'text_decoration' => $keyword('text-decoration', array('none', 'underline', 'line-through')),
            'text_align' => $keyword('text-align', array('left', 'center', 'right', 'justify')),
            'color' => array('css' => 'color', 'kind' => 'color'),
            // ----------------------------------------------------- background
            'background_color' => array('css' => 'background-color', 'kind' => 'color'),
            'background_image' => array('css' => 'background-image', 'kind' => 'media'),
            'background_size' => $keyword('background-size', array('cover', 'contain', 'auto')),
            'background_position' => $keyword('background-position', array('center', 'top', 'bottom', 'left', 'right', 'top left', 'top right', 'bottom left', 'bottom right')),
            'background_repeat' => $keyword('background-repeat', array('no-repeat', 'repeat', 'repeat-x', 'repeat-y')),
            'background_attachment' => $keyword('background-attachment', array('scroll', 'fixed')),
            'gradient_from' => array('css' => '', 'kind' => 'color'),
            'gradient_to' => array('css' => '', 'kind' => 'color'),
            'gradient_angle' => array('css' => '', 'kind' => 'integer', 'min' => 0, 'max' => 360),
            'overlay_color' => array('css' => '', 'kind' => 'color'),
            'overlay_opacity' => array('css' => '', 'kind' => 'number', 'min' => 0, 'max' => 1),
            // --------------------------------------------------------- border
            'border_style' => $keyword('border-style', array('none', 'solid', 'dashed', 'dotted', 'double')),
            'border_width' => $length('border-width'),
            'border_color' => array('css' => 'border-color', 'kind' => 'color'),
            'border_radius' => $length('border-radius'),
            // -------------------------------------------------------- effects
            'box_shadow' => array('css' => 'box-shadow', 'kind' => 'shadow'),
            'opacity' => array('css' => 'opacity', 'kind' => 'number', 'min' => 0, 'max' => 1),
        );
        return self::$properties;
    }

    public static function has($property)
    {
        $properties = self::properties();
        return isset($properties[$property]);
    }

    public static function isDevice($device)
    {
        return in_array($device, self::DEVICES, true);
    }

    /**
     * Validate a device => property => value map.
     *
     * Unknown devices and unknown properties are dropped and reported; invalid
     * values are dropped and reported. The return value is always safe to
     * store and to compile.
     */
    public static function sanitize($style, array &$errors = array(), $path = 'style')
    {
        $clean = array();
        if (!is_array($style)) {
            if ($style !== null && $style !== '') { $errors[] = $path . ': style must be an object.'; }
            return $clean;
        }
        foreach ($style as $device => $properties) {
            if (!self::isDevice($device)) {
                $errors[] = $path . ': unknown device "' . self::describe($device) . '".';
                continue;
            }
            if (!is_array($properties)) {
                $errors[] = $path . '.' . $device . ': device styles must be an object.';
                continue;
            }
            $bucket = array();
            foreach ($properties as $property => $value) {
                if (!self::has($property)) {
                    $errors[] = $path . '.' . $device . ': unsupported style property "' . self::describe($property) . '".';
                    continue;
                }
                if ($value === null || $value === '') { continue; }
                $normalized = self::value($property, $value);
                if ($normalized === null) {
                    $errors[] = $path . '.' . $device . '.' . $property . ': invalid value "' . self::describe($value) . '".';
                    continue;
                }
                $bucket[$property] = $normalized;
            }
            if ($bucket) {
                ksort($bucket);
                $clean[$device] = $bucket;
            }
        }
        return $clean;
    }

    /** Canonical stored form of one value, or null when it is not acceptable. */
    public static function value($property, $value)
    {
        $properties = self::properties();
        if (!isset($properties[$property])) { return null; }
        $spec = $properties[$property];
        if (is_bool($value) || is_array($value) || is_object($value)) { return null; }
        $value = trim((string) $value);
        if ($value === '') { return null; }
        if (strlen($value) > 512) { return null; }

        switch ($spec['kind']) {
            case 'length':
                if (isset($spec['keywords']) && in_array($value, $spec['keywords'], true)) { return $value; }
                return self::length($value, !empty($spec['negative']));
            case 'color':
                return self::color($value);
            case 'keyword':
                return in_array($value, $spec['values'], true) ? $value : null;
            case 'number':
                if (!is_numeric($value)) { return null; }
                $number = (float) $value;
                if ($number < $spec['min'] || $number > $spec['max']) { return null; }
                return rtrim(rtrim(sprintf('%.4F', $number), '0'), '.') ?: '0';
            case 'integer':
                if (preg_match('/^-?\d{1,4}$/', $value) !== 1) { return null; }
                $integer = (int) $value;
                if ($integer < $spec['min'] || $integer > $spec['max']) { return null; }
                return (string) $integer;
            case 'font':
                return in_array($value, self::FONT_TOKENS, true) || $value === 'inherit' ? $value : null;
            case 'shadow':
                return isset(self::SHADOWS[$value]) ? $value : null;
            case 'media':
                $safe = UrlPolicy::media($value);
                return $safe === null || $safe === '' ? null : $safe;
        }
        return null;
    }

    public static function length($value, $allowNegative = false)
    {
        if (preg_match('/^(-?\d+(?:\.\d{1,3})?)(px|rem|em|%|vh|vw)?$/', $value, $match) !== 1) { return null; }
        $number = (float) $match[1];
        if (!$allowNegative && $number < 0) { return null; }
        if (abs($number) > self::MAX_LENGTH_MAGNITUDE) { return null; }
        $unit = isset($match[2]) && $match[2] !== '' ? $match[2] : 'px';
        $number = rtrim(rtrim(sprintf('%.3F', $number), '0'), '.');
        if ($number === '' || $number === '-') { $number = '0'; }
        return $number === '0' ? '0' : $number . $unit;
    }

    public static function color($value)
    {
        if (in_array($value, self::COLOR_TOKENS, true)) { return $value; }
        if ($value === 'transparent' || $value === 'inherit' || $value === 'currentColor') { return $value; }
        if (preg_match('/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/', $value) === 1) { return strtolower($value); }
        if (preg_match('/^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/', $value) === 1) {
            return preg_replace('/\s+/', '', $value);
        }
        return null;
    }

    /** Stored colour value to a CSS value (palette tokens become variables). */
    public static function cssColor($value)
    {
        return in_array($value, self::COLOR_TOKENS, true) ? 'var(--ch247-color-' . $value . ')' : $value;
    }

    /**
     * Compile one device bucket into ordered CSS declarations.
     *
     * @return string[] e.g. array('padding-top:24px', 'color:var(--ch247-color-primary)')
     */
    public static function declarations(array $properties)
    {
        $out = array();
        $specs = self::properties();
        foreach ($properties as $property => $value) {
            if (!isset($specs[$property])) { continue; }
            $spec = $specs[$property];
            if (in_array($property, self::OVERLAY_PROPERTIES, true)) { continue; }
            if (in_array($property, array('gradient_from', 'gradient_to', 'gradient_angle'), true)) { continue; }
            // Re-validate on the way out: storage is not trusted as a source.
            if (self::value($property, $value) === null) { continue; }
            switch ($spec['kind']) {
                case 'color':
                    $out[] = $spec['css'] . ':' . self::cssColor($value);
                    break;
                case 'font':
                    $out[] = $spec['css'] . ':' . ($value === 'inherit' ? 'inherit' : 'var(--ch247-font-' . $value . ')');
                    break;
                case 'shadow':
                    $out[] = $spec['css'] . ':' . self::SHADOWS[$value];
                    break;
                case 'media':
                    $out[] = $spec['css'] . ':url("' . str_replace(array('"', '\\', '(', ')'), '', $value) . '")';
                    break;
                case 'integer':
                    if ($property === 'grid_columns') {
                        $out[] = 'display:grid';
                        $out[] = $spec['css'] . ':repeat(' . (int) $value . ', minmax(0, 1fr))';
                        break;
                    }
                    $out[] = $spec['css'] . ':' . (int) $value;
                    break;
                default:
                    $out[] = $spec['css'] . ':' . $value;
            }
        }
        // A gradient is only emitted when both stops are present.
        if (isset($properties['gradient_from'], $properties['gradient_to'])) {
            $from = self::value('gradient_from', $properties['gradient_from']);
            $to = self::value('gradient_to', $properties['gradient_to']);
            if ($from !== null && $to !== null) {
                $angle = isset($properties['gradient_angle']) ? (int) self::value('gradient_angle', $properties['gradient_angle']) : 180;
                $out[] = 'background-image:linear-gradient(' . $angle . 'deg, ' . self::cssColor($from) . ', ' . self::cssColor($to) . ')';
            }
        }
        return $out;
    }

    /** Declarations for the overlay pseudo-element, or an empty array. */
    public static function overlayDeclarations(array $properties)
    {
        if (!isset($properties['overlay_color'])) { return array(); }
        $color = self::value('overlay_color', $properties['overlay_color']);
        if ($color === null) { return array(); }
        $opacity = isset($properties['overlay_opacity']) ? self::value('overlay_opacity', $properties['overlay_opacity']) : '0.5';
        if ($opacity === null) { $opacity = '0.5'; }
        return array(
            'content:""', 'position:absolute', 'inset:0', 'pointer-events:none',
            'background-color:' . self::cssColor($color), 'opacity:' . $opacity,
        );
    }

    private static function describe($value)
    {
        if (is_array($value)) { return 'array'; }
        if (is_object($value)) { return 'object'; }
        if (is_bool($value)) { return $value ? 'true' : 'false'; }
        $value = (string) $value;
        $value = preg_replace('/[^\x20-\x7E]/', '', $value);
        return strlen($value) > 40 ? substr($value, 0, 40) . '...' : $value;
    }
}
