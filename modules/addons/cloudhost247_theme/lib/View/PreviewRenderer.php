<?php
namespace CloudHost247\Theme\View;

use CloudHost247\Theme\Content\ProductComponents;

/**
 * Visual preview of unsaved theme settings and content.
 *
 * The preview answers one question an operator asks before saving: "what will
 * the client theme look like with these values?". It renders the same custom
 * properties the live ClientAreaHeadOutput hook emits, and a plain structural
 * sketch of the header, navigation, sections and footer the client theme draws.
 *
 * It is safe by construction: every value is escaped, rich text is reduced to
 * its text content (the preview never needs to execute the stored markup), and
 * product components are drawn from the bounded resolver. It writes nothing.
 */
final class PreviewRenderer
{
    /**
     * @param array $settings Theme settings (saved or an unsaved POST merge).
     * @param array $content  Content rows, already hydrated and localised.
     * @return array{css:string,markup:string,notes:array,sections:array}
     */
    public static function render(array $settings, array $content)
    {
        $notes = array();
        $css = self::css($settings, $notes);
        $sections = array();
        $byType = array();
        // Resolve declared product components the same way the live block
        // context does, so the preview cannot show a component production
        // would leave empty (or the other way round).
        $content = ProductComponents::forContent($content);
        foreach ($content as $item) {
            $type = isset($item['content_type']) ? (string) $item['content_type'] : '';
            if (!isset($byType[$type])) { $byType[$type] = array(); }
            $byType[$type][] = $item;
        }
        $brand = self::text(isset($settings['brand_name']) ? $settings['brand_name'] : '', 120);
        $logo = isset($settings['logo_url']) ? (string) $settings['logo_url'] : '';
        $markup = '<div class="ch247-preview" style="max-width:' . (int) (isset($settings['layout_width']) ? $settings['layout_width'] : 1180) . 'px;margin:0 auto;font-family:' . self::attribute(isset($settings['font_family']) ? $settings['font_family'] : '') . '">';
        if (!empty($settings['show_announcement']) && $settings['show_announcement'] === '1' && !empty($settings['announcement_text'])) {
            $markup .= '<div class="ch247-preview__announcement" style="background:' . self::attribute(isset($settings['primary_color']) ? $settings['primary_color'] : '') . ';color:#fff;padding:8px 12px">' . self::text($settings['announcement_text'], 300) . '</div>';
        }
        $markup .= '<header style="display:flex;align-items:center;justify-content:space-between;padding:12px 0">';
        $markup .= $logo !== '' ? '<img src="' . self::attribute($logo) . '" alt="' . self::attribute($brand) . '" style="max-height:48px">' : '<strong>' . self::text($brand, 120) . '</strong>';
        $navigation = self::items(isset($byType['navigation']) ? $byType['navigation'] : array());
        if ($navigation) {
            $markup .= '<nav aria-label="Preview navigation"><ul style="list-style:none;display:flex;gap:12px;margin:0;padding:0">';
            foreach ($navigation as $item) { $markup .= '<li style="font-weight:600">' . self::text($item['title'], 80) . '</li>'; }
            $markup .= '</ul></nav>';
        }
        $markup .= '</header>';
        if (!empty($settings['hero_title'])) {
            $sections[] = 'hero';
            $markup .= '<section style="padding:28px 0"><h1 style="margin:0 0 8px">' . self::text($settings['hero_title'], 200) . '</h1><p>' . self::text(isset($settings['hero_text']) ? $settings['hero_text'] : '', 400) . '</p>';
            if (!empty($settings['hero_cta_label'])) { $markup .= '<span style="display:inline-block;padding:8px 16px;border-radius:4px;background:' . self::attribute(isset($settings['primary_color']) ? $settings['primary_color'] : '') . ';color:#fff">' . self::text($settings['hero_cta_label'], 80) . '</span>'; }
            $markup .= '</section>';
        }
        foreach (array('banner', 'section', 'testimonial', 'block', 'landing') as $type) {
            foreach ((isset($byType[$type]) ? $byType[$type] : array()) as $item) {
                if (empty($item['published'])) { continue; }
                $component = isset($item['product_component']) ? $item['product_component'] : null;
                $sections[] = $type . ':' . (isset($item['slug']) ? (string) $item['slug'] : '');
                $markup .= '<section style="padding:16px 0;border-top:1px solid #e6e6e6"><h2 style="margin:0 0 6px">' . self::text(isset($item['title']) ? $item['title'] : '', 200) . '</h2>';
                $summary = self::text(isset($item['summary']) ? $item['summary'] : '', 400);
                if ($summary !== '') { $markup .= '<p>' . $summary . '</p>'; }
                if (isset($item['body']) && trim(strip_tags((string) $item['body'])) !== '') {
                    $markup .= '<p>' . self::text(strip_tags((string) $item['body']), 600) . '</p>';
                }
                if ($component !== null) { $markup .= self::component($component, $notes); }
                $markup .= '</section>';
            }
        }
        $markup .= '<footer style="padding:16px 0;border-top:1px solid #e6e6e6">' . self::text(isset($settings['footer_text']) ? $settings['footer_text'] : '', 400) . '</footer></div>';
        return array('css' => $css, 'markup' => $markup, 'notes' => $notes, 'sections' => $sections);
    }

    /**
     * Custom properties exactly as the live head hook emits them, so the
     * preview cannot drift from production.
     */
    public static function css(array $settings, array &$notes = array())
    {
        $primary = self::colour(isset($settings['primary_color']) ? $settings['primary_color'] : '', $notes);
        $accent = self::colour(isset($settings['accent_color']) ? $settings['accent_color'] : '', $notes);
        $font = self::text(isset($settings['font_family']) ? $settings['font_family'] : '', 120);
        $width = (int) (isset($settings['layout_width']) ? $settings['layout_width'] : 0);
        if ($width < 960 || $width > 1600) { $width = 1180; $notes[] = 'Layout width outside 960-1600 was replaced with 1180 in the preview.'; }
        return ':root{--ch247-primary:' . $primary . ';--ch247-accent:' . $accent . ';--ch247-font:' . $font . ';--ch247-width:' . $width . 'px}';
    }

    private static function component(array $component, array &$notes)
    {
        $spec = $component['component'];
        if (empty($component['available'])) {
            $notes[] = 'Product component "' . $spec['heading'] . '" is not shown: ' . $component['reason'];
            return '<p class="ch247-preview__unavailable"><em>Product component unavailable: ' . self::text($component['reason'], 200) . '</em></p>';
        }
        if (!$component['products']) { $notes[] = 'Product component "' . $spec['heading'] . '" matched no visible products.'; }
        $markup = '<div class="ch247-preview__products ch247-preview__products--' . $spec['layout'] . '">';
        foreach ($component['products'] as $product) {
            $price = $product['price'];
            $priceText = '';
            if (is_array($price)) {
                $priceText = isset($price['amount']) ? (string) $price['amount'] : '';
                if ($priceText === '' && isset($price['price'])) { $priceText = (string) $price['price']; }
                if ($priceText !== '' && !empty($price['currency'])) { $priceText .= ' ' . (string) $price['currency']; }
            } elseif ($price !== null && $price !== '') {
                $priceText = (string) $price;
            }
            $markup .= '<div style="padding:8px;border:1px solid #e6e6e6;border-radius:4px">';
            $markup .= '<strong>' . self::text(isset($product['name']) ? $product['name'] : '', 150) . '</strong>';
            $markup .= '<div>' . ($priceText === '' ? '<em>Price not published</em>' : self::text($priceText, 60) . ' / ' . self::text($spec['cycle'], 20)) . '</div>';
            $markup .= '</div>';
        }
        return $markup . '</div>';
    }

    private static function items(array $items)
    {
        $out = array();
        foreach ($items as $item) {
            if (empty($item['published'])) { continue; }
            $out[] = $item;
        }
        return $out;
    }

    private static function colour($value, array &$notes)
    {
        $value = trim((string) $value);
        if (!preg_match('/^#[0-9a-fA-F]{6}$/', $value)) {
            if ($value !== '') { $notes[] = 'Colour "' . substr($value, 0, 20) . '" is not six-digit hexadecimal and was not used in the preview.'; }
            return 'inherit';
        }
        return $value;
    }

    private static function text($value, $maxLength)
    {
        $value = trim((string) $value);
        $value = htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
        if (strlen($value) > $maxLength) { $value = substr($value, 0, $maxLength); }
        return $value;
    }

    private static function attribute($value)
    {
        return htmlspecialchars(trim((string) $value), ENT_QUOTES, 'UTF-8');
    }
}
