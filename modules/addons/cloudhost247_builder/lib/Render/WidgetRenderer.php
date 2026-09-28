<?php
namespace CloudHost247\Builder\Render;

use CloudHost247\Builder\Catalog\CartLinks;
use CloudHost247\Builder\Catalog\Money;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\UrlPolicy;
use CloudHost247\Builder\Widgets\WidgetCatalog;

/**
 * Markup for every widget in the library.
 *
 * Two rules run through the whole file.
 *
 * 1. Everything is escaped at the point of output. Rich text is the only
 *    unescaped value and it has already been through HtmlSanitizer.
 * 2. A widget that depends on live platform data never invents it. When the
 *    catalogue, the pricing table, the cart or the integrations centre cannot
 *    be read, the editor shows the administrator exactly what is missing and
 *    the published page omits the block. There is no demo price anywhere in
 *    this file.
 */
final class WidgetRenderer
{
    private $catalog;
    private $sanitizer;

    public function __construct(WidgetCatalog $catalog = null, HtmlSanitizer $sanitizer = null)
    {
        $this->catalog = $catalog ? $catalog : new WidgetCatalog();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    /** Widget key => method. Anything not listed simply renders nothing. */
    private static function map()
    {
        return array(
            'spacer' => 'spacer', 'divider' => 'divider', 'tabs' => 'tabs', 'accordion' => 'accordion',
            'carousel' => 'carousel', 'heading' => 'heading', 'text' => 'textWidget', 'image' => 'image',
            'gallery' => 'gallery', 'video' => 'video', 'icon' => 'iconWidget', 'button' => 'button',
            'list' => 'listWidget', 'testimonial' => 'testimonial', 'pricing_table' => 'pricingTable',
            'counter' => 'counter', 'progress' => 'progress', 'cta' => 'cta',
            'hosting_plans' => 'hostingPlans', 'product_card' => 'productCard', 'order_button' => 'orderButton',
            'server_specs' => 'serverSpecs', 'domain_search' => 'domainSearch', 'domain_pricing' => 'domainPricing',
            'cart_summary' => 'cartSummary', 'checkout_link' => 'checkoutLink', 'reviews' => 'reviews',
            'contact_form' => 'contactForm', 'faq' => 'faq', 'service_status' => 'serviceStatus',
            'site_logo' => 'siteLogo', 'nav_menu' => 'navMenu', 'account_links' => 'accountLinks',
            'copyright' => 'copyright',
        );
    }

    public function supports($key)
    {
        $map = self::map();
        return isset($map[$key]);
    }

    public function render($key, array $node, RenderContext $context, Renderer $renderer)
    {
        $map = self::map();
        if (!isset($map[$key])) { return ''; }
        $method = $map[$key];
        $props = isset($node['props']) && is_array($node['props']) ? $node['props'] : array();
        return $this->$method($props, $context, $node, $renderer);
    }

    /* ---------------------------------------------------------------- layout */

    private function spacer(array $props, RenderContext $context)
    {
        $height = max(1, min(800, (int) $this->prop($props, 'height', 48)));
        return '<div class="ch247-spacer" style="height:' . $height . 'px" aria-hidden="true"></div>';
    }

    private function divider(array $props, RenderContext $context)
    {
        $style = in_array($this->prop($props, 'line_style'), array('solid', 'dashed', 'dotted'), true)
            ? $this->prop($props, 'line_style') : 'solid';
        $thickness = max(1, min(12, (int) $this->prop($props, 'thickness', 1)));
        $width = max(5, min(100, (int) $this->prop($props, 'width', 100)));
        $color = \CloudHost247\Builder\Schema\StyleSchema::cssColor($this->prop($props, 'line_color', 'border'));
        return '<hr class="ch247-divider" style="border:0;border-top:' . $thickness . 'px ' . $style . ' '
            . $this->e($color) . ';width:' . $width . '%" />';
    }

    /**
     * Tabs.
     *
     * Without JavaScript every panel is visible with its title as a heading,
     * so the content is always readable; runtime.js upgrades it to real tabs
     * when it loads. Nothing is hidden behind script that a visitor needs.
     */
    private function tabs(array $props, RenderContext $context, array $node)
    {
        $items = $this->items($props, 'items');
        if (!$items) { return $this->unavailable($context, 'Add at least one tab.'); }
        $group = 'ch247-tabs-' . preg_replace('/[^a-z0-9]/', '', Node::id($node));
        $buttons = '';
        $panels = '';
        $index = 0;
        foreach ($items as $item) {
            $title = $this->str($item, 'title');
            $panelId = $group . '-panel-' . $index;
            $buttons .= '<button type="button" class="ch247-tabs__label" role="tab"'
                . ' data-ch247-tab-button="' . $index . '" aria-controls="' . $this->e($panelId) . '"'
                . ' aria-selected="' . ($index === 0 ? 'true' : 'false') . '">' . $this->e($title) . '</button>';
            $panels .= '<section class="ch247-tabs__panel' . ($index === 0 ? ' is-active' : '') . '" role="tabpanel"'
                . ' id="' . $this->e($panelId) . '" data-ch247-tab="' . $index . '">'
                . '<h3 class="ch247-tabs__fallback">' . $this->e($title) . '</h3>'
                . $this->rich($item, 'content') . '</section>';
            $index++;
        }
        return '<div class="ch247-tabs" data-ch247-tabs="' . (int) count($items) . '">'
            . '<div class="ch247-tabs__bar" role="tablist">' . $buttons . '</div>'
            . '<div class="ch247-tabs__panels">' . $panels . '</div></div>';
    }

    private function accordion(array $props, RenderContext $context)
    {
        $items = $this->items($props, 'items');
        if (!$items) { return $this->unavailable($context, 'Add at least one accordion panel.'); }
        $firstOpen = !empty($props['first_open']);
        $html = '<div class="ch247-accordion">';
        $index = 0;
        foreach ($items as $item) {
            $open = $firstOpen && $index === 0 ? ' open' : '';
            $html .= '<details class="ch247-accordion__item"' . $open . '>'
                . '<summary class="ch247-accordion__title">' . $this->e($this->str($item, 'title')) . '</summary>'
                . '<div class="ch247-accordion__body">' . $this->rich($item, 'content') . '</div></details>';
            $index++;
        }
        return $html . '</div>';
    }

    private function carousel(array $props, RenderContext $context, array $node)
    {
        $items = $this->items($props, 'items');
        $slides = '';
        $dots = '';
        $index = 0;
        foreach ($items as $item) {
            $media = $this->media($item, 'image');
            if ($media['url'] === '') { continue; }
            $slideId = 'ch247-slide-' . preg_replace('/[^a-z0-9]/', '', Node::id($node)) . '-' . $index;
            $caption = $this->str($item, 'caption');
            $url = isset($item['url']) ? UrlPolicy::link($item['url']) : '';
            $image = '<img src="' . $this->e($media['url']) . '" alt="' . $this->e($media['alt'] !== '' ? $media['alt'] : $caption) . '" loading="lazy" />';
            if ($url !== null && $url !== '') { $image = '<a href="' . $this->e($url) . '">' . $image . '</a>'; }
            $slides .= '<div class="ch247-carousel__slide" id="' . $this->e($slideId) . '">' . $image
                . ($caption !== '' ? '<p class="ch247-carousel__caption">' . $this->e($caption) . '</p>' : '') . '</div>';
            $dots .= '<a class="ch247-carousel__dot" href="#' . $this->e($slideId) . '" aria-label="Slide ' . ($index + 1) . '"></a>';
            $index++;
        }
        if ($slides === '') { return $this->unavailable($context, 'Add at least one slide with an image.'); }
        $autoplay = !empty($props['autoplay']) ? ' data-ch247-autoplay="' . max(2, min(30, (int) $this->prop($props, 'interval', 6))) . '"' : '';
        return '<div class="ch247-carousel"' . $autoplay . '><div class="ch247-carousel__track">' . $slides . '</div>'
            . (!empty($props['show_dots']) ? '<div class="ch247-carousel__dots">' . $dots . '</div>' : '') . '</div>';
    }

    /* --------------------------------------------------------------- content */

    private function heading(array $props, RenderContext $context)
    {
        $level = in_array($this->prop($props, 'level'), array('h1', 'h2', 'h3', 'h4', 'h5', 'h6'), true)
            ? $this->prop($props, 'level') : 'h2';
        $text = $this->prop($props, 'text');
        if (trim((string) $text) === '') { return $this->unavailable($context, 'Empty heading.'); }
        $inner = $this->e($text);
        $url = UrlPolicy::link($this->prop($props, 'url'));
        if ($url !== null && $url !== '') { $inner = '<a href="' . $this->e($url) . '">' . $inner . '</a>'; }
        return '<' . $level . ' class="ch247-heading"' . $this->inline($context, 'text') . '>' . $inner . '</' . $level . '>';
    }

    private function textWidget(array $props, RenderContext $context)
    {
        $html = $this->sanitizer->clean($this->prop($props, 'content'), WidgetCatalog::MAX_RICHTEXT);
        if (trim(strip_tags($html)) === '') { return $this->unavailable($context, 'Empty text block.'); }
        return '<div class="ch247-text"' . $this->inline($context, 'content') . '>' . $html . '</div>';
    }

    private function image(array $props, RenderContext $context)
    {
        $media = $this->media($props, 'image');
        if ($media['url'] === '') {
            return $this->unavailable($context, 'Choose an image from the media library.');
        }
        $alt = $this->prop($props, 'alt');
        if ($alt === '') { $alt = $media['alt']; }
        $loading = $this->prop($props, 'loading') === 'eager' ? 'eager' : 'lazy';
        $img = '<img class="ch247-image__img" src="' . $this->e($media['url']) . '" alt="' . $this->e($alt) . '" loading="' . $loading . '" />';
        $url = UrlPolicy::link($this->prop($props, 'url'));
        if ($url !== null && $url !== '') { $img = '<a href="' . $this->e($url) . '">' . $img . '</a>'; }
        $caption = $this->prop($props, 'caption');
        if ($caption !== '') {
            return '<figure class="ch247-image">' . $img . '<figcaption>' . $this->e($caption) . '</figcaption></figure>';
        }
        return '<div class="ch247-image">' . $img . '</div>';
    }

    private function gallery(array $props, RenderContext $context)
    {
        $items = $this->items($props, 'items');
        $columns = max(1, min(6, (int) $this->prop($props, 'columns', 3)));
        $cells = '';
        foreach ($items as $item) {
            $media = $this->media($item, 'image');
            if ($media['url'] === '') { continue; }
            $caption = $this->str($item, 'caption');
            $cells .= '<figure class="ch247-gallery__item"><img src="' . $this->e($media['url']) . '" alt="'
                . $this->e($media['alt'] !== '' ? $media['alt'] : $caption) . '" loading="lazy" />'
                . ($caption !== '' ? '<figcaption>' . $this->e($caption) . '</figcaption>' : '') . '</figure>';
        }
        if ($cells === '') { return $this->unavailable($context, 'Add images to the gallery.'); }
        return '<div class="ch247-gallery" style="grid-template-columns:repeat(' . $columns . ', minmax(0, 1fr))">' . $cells . '</div>';
    }

    private function video(array $props, RenderContext $context)
    {
        $source = $this->prop($props, 'source', 'youtube');
        $url = UrlPolicy::media($this->prop($props, 'url'));
        if ($url === null || $url === '') {
            return $this->unavailable($context, 'Add a video URL.');
        }
        $poster = $this->media($props, 'poster');
        if ($source === 'file') {
            $attributes = ' controls';
            if (!empty($props['loop'])) { $attributes .= ' loop'; }
            if ($poster['url'] !== '') { $attributes .= ' poster="' . $this->e($poster['url']) . '"'; }
            return '<div class="ch247-video"><video class="ch247-video__player" src="' . $this->e($url) . '"' . $attributes . '></video></div>';
        }
        $embed = $this->embedUrl($source, $url);
        if ($embed === null) {
            return $this->unavailable($context, 'That URL is not a recognised ' . ($source === 'vimeo' ? 'Vimeo' : 'YouTube') . ' video.');
        }
        return '<div class="ch247-video ch247-video--embed"><iframe src="' . $this->e($embed) . '" title="Video" loading="lazy"'
            . ' allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>';
    }

    /** Only two known embed hosts, both rewritten to their privacy endpoints. */
    private function embedUrl($source, $url)
    {
        $host = strtolower((string) parse_url($url, PHP_URL_HOST));
        if ($source === 'youtube') {
            $id = '';
            if (preg_match('#^(?:www\.)?youtube(?:-nocookie)?\.com$#', $host) === 1) {
                parse_str((string) parse_url($url, PHP_URL_QUERY), $query);
                if (isset($query['v'])) { $id = (string) $query['v']; }
                if ($id === '' && preg_match('#/embed/([A-Za-z0-9_-]{6,20})#', (string) parse_url($url, PHP_URL_PATH), $match) === 1) {
                    $id = $match[1];
                }
            } elseif ($host === 'youtu.be') {
                $id = trim((string) parse_url($url, PHP_URL_PATH), '/');
            }
            return preg_match('/^[A-Za-z0-9_-]{6,20}$/', $id) === 1
                ? 'https://www.youtube-nocookie.com/embed/' . $id : null;
        }
        if ($source === 'vimeo' && preg_match('#(?:^|\.)vimeo\.com$#', $host) === 1) {
            if (preg_match('#/(\d{5,12})#', (string) parse_url($url, PHP_URL_PATH), $match) === 1) {
                return 'https://player.vimeo.com/video/' . $match[1];
            }
        }
        return null;
    }

    private function iconWidget(array $props, RenderContext $context)
    {
        $icon = $this->prop($props, 'icon', 'check');
        if (!Icons::has($icon)) { return $this->unavailable($context, 'Choose an icon.'); }
        $size = max(12, min(160, (int) $this->prop($props, 'size', 32)));
        $color = \CloudHost247\Builder\Schema\StyleSchema::cssColor($this->prop($props, 'icon_color', 'primary'));
        $svg = '<span class="ch247-icon-wrap" style="color:' . $this->e($color) . '">' . Icons::svg($icon, $size) . '</span>';
        $url = UrlPolicy::link($this->prop($props, 'url'));
        return $url !== null && $url !== '' ? '<a href="' . $this->e($url) . '">' . $svg . '</a>' : $svg;
    }

    private function button(array $props, RenderContext $context)
    {
        $label = $this->prop($props, 'label');
        if (trim($label) === '') { return $this->unavailable($context, 'Give the button a label.'); }
        $url = UrlPolicy::link($this->prop($props, 'url'));
        if ($url === null || $url === '') { $url = '#'; }
        $icon = $this->prop($props, 'icon');
        $inner = ($icon !== '' && Icons::has($icon) ? Icons::svg($icon, 18) : '')
            . '<span' . $this->inline($context, 'label') . '>' . $this->e($label) . '</span>';
        return $this->anchor($url, $inner, $this->buttonClasses($props), $this->prop($props, 'target'));
    }

    private function listWidget(array $props, RenderContext $context)
    {
        $items = $this->items($props, 'items');
        if (!$items) { return $this->unavailable($context, 'Add list items.'); }
        $style = $this->prop($props, 'list_style', 'icon');
        $tag = $style === 'number' ? 'ol' : 'ul';
        $html = '<' . $tag . ' class="ch247-list ch247-list--' . $this->e($style) . '">';
        foreach ($items as $item) {
            $icon = isset($item['icon']) ? (string) $item['icon'] : '';
            $marker = $style === 'icon' && Icons::has($icon) ? Icons::svg($icon, 18, 'ch247-list__icon') : '';
            $html .= '<li>' . $marker . '<span>' . $this->e($this->str($item, 'text')) . '</span></li>';
        }
        return $html . '</' . $tag . '>';
    }

    private function testimonial(array $props, RenderContext $context)
    {
        $quote = $this->prop($props, 'quote');
        if (trim($quote) === '') { return $this->unavailable($context, 'Add the testimonial text.'); }
        $avatar = $this->media($props, 'avatar');
        $rating = max(0, min(5, (int) $this->prop($props, 'rating', 0)));
        $stars = '';
        for ($i = 0; $i < $rating; $i++) { $stars .= Icons::svg('star', 16, 'ch247-star'); }
        return '<figure class="ch247-testimonial">'
            . ($stars !== '' ? '<div class="ch247-testimonial__rating" aria-label="' . $rating . ' out of 5">' . $stars . '</div>' : '')
            . '<blockquote>' . $this->e($quote) . '</blockquote>'
            . '<figcaption class="ch247-testimonial__author">'
            . ($avatar['url'] !== '' ? '<img src="' . $this->e($avatar['url']) . '" alt="" loading="lazy" />' : '')
            . '<span><strong>' . $this->e($this->prop($props, 'author')) . '</strong>'
            . ($this->prop($props, 'role') !== '' ? '<small>' . $this->e($this->prop($props, 'role')) . '</small>' : '')
            . '</span></figcaption></figure>';
    }

    private function pricingTable(array $props, RenderContext $context)
    {
        $features = '';
        foreach ($this->items($props, 'features') as $feature) {
            $features .= '<li>' . Icons::svg('check', 16, 'ch247-list__icon') . '<span>' . $this->e($this->str($feature, 'text')) . '</span></li>';
        }
        $url = UrlPolicy::link($this->prop($props, 'button_url'));
        $button = '';
        if ($this->prop($props, 'button_label') !== '') {
            $button = $this->anchor($url !== null && $url !== '' ? $url : '#',
                $this->e($this->prop($props, 'button_label')), 'ch247-btn ch247-btn--primary ch247-btn--md ch247-btn--block');
        }
        $badge = $this->prop($props, 'badge');
        return '<div class="ch247-pricing' . (!empty($props['featured']) ? ' is-featured' : '') . '">'
            . ($badge !== '' ? '<span class="ch247-pricing__badge">' . $this->e($badge) . '</span>' : '')
            . '<h3 class="ch247-pricing__plan">' . $this->e($this->prop($props, 'plan')) . '</h3>'
            . '<p class="ch247-pricing__price"><span>' . $this->e($this->prop($props, 'price')) . '</span>'
            . ($this->prop($props, 'period') !== '' ? '<small>' . $this->e($this->prop($props, 'period')) . '</small>' : '') . '</p>'
            . ($features !== '' ? '<ul class="ch247-list ch247-list--icon">' . $features . '</ul>' : '')
            . $button . '</div>';
    }

    private function counter(array $props, RenderContext $context)
    {
        $value = (float) $this->prop($props, 'value', 0);
        $display = $value == (int) $value ? (string) (int) $value : (string) $value;
        return '<div class="ch247-counter"><p class="ch247-counter__value" data-ch247-counter="' . $this->e($display) . '">'
            . $this->e($this->prop($props, 'prefix')) . '<span>' . $this->e($display) . '</span>'
            . $this->e($this->prop($props, 'suffix')) . '</p>'
            . '<p class="ch247-counter__label">' . $this->e($this->prop($props, 'label')) . '</p></div>';
    }

    private function progress(array $props, RenderContext $context)
    {
        $percent = max(0, min(100, (int) $this->prop($props, 'percent', 0)));
        $color = \CloudHost247\Builder\Schema\StyleSchema::cssColor($this->prop($props, 'bar_color', 'primary'));
        return '<div class="ch247-progress">'
            . '<div class="ch247-progress__head"><span>' . $this->e($this->prop($props, 'label')) . '</span>'
            . (!empty($props['show_value']) ? '<span>' . $percent . '%</span>' : '') . '</div>'
            . '<div class="ch247-progress__track" role="progressbar" aria-valuenow="' . $percent . '" aria-valuemin="0" aria-valuemax="100">'
            . '<div class="ch247-progress__bar" style="width:' . $percent . '%;background:' . $this->e($color) . '"></div>'
            . '</div></div>';
    }

    private function cta(array $props, RenderContext $context)
    {
        $primaryUrl = UrlPolicy::link($this->prop($props, 'button_url'));
        $secondaryUrl = UrlPolicy::link($this->prop($props, 'secondary_url'));
        $buttons = '';
        if ($this->prop($props, 'button_label') !== '') {
            $buttons .= $this->anchor($primaryUrl !== null && $primaryUrl !== '' ? $primaryUrl : '#',
                $this->e($this->prop($props, 'button_label')), 'ch247-btn ch247-btn--primary ch247-btn--lg');
        }
        if ($this->prop($props, 'secondary_label') !== '') {
            $buttons .= $this->anchor($secondaryUrl !== null && $secondaryUrl !== '' ? $secondaryUrl : '#',
                $this->e($this->prop($props, 'secondary_label')), 'ch247-btn ch247-btn--outline ch247-btn--lg');
        }
        $layout = $this->prop($props, 'layout', 'inline') === 'stacked' ? 'stacked' : 'inline';
        return '<div class="ch247-cta ch247-cta--' . $layout . '"><div class="ch247-cta__copy">'
            . '<h2' . $this->inline($context, 'heading') . '>' . $this->e($this->prop($props, 'heading')) . '</h2>'
            . ($this->prop($props, 'text') !== '' ? '<p>' . nl2br($this->e($this->prop($props, 'text'))) . '</p>' : '')
            . '</div><div class="ch247-cta__actions">' . $buttons . '</div></div>';
    }

    /* -------------------------------------------------------------- business */

    private function hostingPlans(array $props, RenderContext $context)
    {
        $data = $context->data();
        if ($data === null) {
            return $this->unavailable($context, 'Live product data is not available in this context.');
        }
        $cycle = $this->prop($props, 'billing_cycle', 'monthly');
        $products = $data->products((int) $this->prop($props, 'group', 0), (int) $this->prop($props, 'limit', 4), $cycle);
        if ($products === null) {
            return $this->unavailable($context, 'WHMCS products could not be read: ' . $data->unavailableReason());
        }
        if (!$products) {
            return $this->unavailable($context, 'That product group contains no visible products.');
        }
        $columns = max(1, min(4, (int) $this->prop($props, 'columns', 3)));
        $highlight = (int) $this->prop($props, 'highlight', 0);
        $label = $this->prop($props, 'button_label', 'Order now');
        $cards = '';
        $position = 1;
        foreach ($products as $product) {
            $price = isset($product['price']) ? $product['price'] : null;
            $priceHtml = $price === null
                ? '<p class="ch247-plan__price ch247-plan__price--none">Price not published for this billing cycle</p>'
                : '<p class="ch247-plan__price"><span>' . $this->e($price['formatted']) . '</span><small>'
                    . $this->e(Money::cycleLabel($cycle)) . '</small></p>';
            $cards .= '<div class="ch247-plan' . ($highlight === $position ? ' is-featured' : '') . '">'
                . '<h3 class="ch247-plan__name">' . $this->e($product['name']) . '</h3>'
                . (!empty($props['show_description']) && $product['description'] !== ''
                    ? '<p class="ch247-plan__description">' . nl2br($this->e($product['description'])) . '</p>' : '')
                . $priceHtml
                . ($price !== null && $price['setup'] !== ''
                    ? '<p class="ch247-plan__setup">Setup fee ' . $this->e($price['setup']) . '</p>' : '')
                . $this->anchor($product['order_url'], $this->e($label), 'ch247-btn ch247-btn--primary ch247-btn--md ch247-btn--block')
                . '</div>';
            $position++;
        }
        return '<div class="ch247-plans" style="grid-template-columns:repeat(' . $columns . ', minmax(0, 1fr))">' . $cards . '</div>';
    }

    private function productCard(array $props, RenderContext $context)
    {
        $data = $context->data();
        $productId = (int) $this->prop($props, 'product', 0);
        if ($productId <= 0) { return $this->unavailable($context, 'Choose a WHMCS product.'); }
        if ($data === null) { return $this->unavailable($context, 'Live product data is not available in this context.'); }
        $cycle = $this->prop($props, 'billing_cycle', 'monthly');
        $product = $data->product($productId, $cycle);
        if ($product === null) {
            return $this->unavailable($context, 'Product #' . $productId . ' could not be read: ' . $data->unavailableReason());
        }
        $price = isset($product['price']) ? $product['price'] : null;
        return '<div class="ch247-plan">'
            . ($product['group'] !== '' ? '<p class="ch247-plan__group">' . $this->e($product['group']) . '</p>' : '')
            . '<h3 class="ch247-plan__name">' . $this->e($product['name']) . '</h3>'
            . (!empty($props['show_description']) && $product['description'] !== ''
                ? '<p class="ch247-plan__description">' . nl2br($this->e($product['description'])) . '</p>' : '')
            . ($price === null
                ? '<p class="ch247-plan__price ch247-plan__price--none">Price not published for this billing cycle</p>'
                : '<p class="ch247-plan__price"><span>' . $this->e($price['formatted']) . '</span><small>' . $this->e(Money::cycleLabel($cycle)) . '</small></p>')
            . $this->anchor($product['order_url'], $this->e($this->prop($props, 'button_label', 'Order now')), 'ch247-btn ch247-btn--primary ch247-btn--md ch247-btn--block')
            . '</div>';
    }

    private function orderButton(array $props, RenderContext $context)
    {
        $productId = (int) $this->prop($props, 'product', 0);
        if ($productId <= 0) { return $this->unavailable($context, 'Choose the product this button orders.'); }
        $label = $this->prop($props, 'label', 'Add to cart');
        $cycle = $this->prop($props, 'billing_cycle', 'monthly');
        $data = $context->data();
        $suffix = '';
        if (!empty($props['show_price']) && $data !== null) {
            $price = $data->price($productId, $cycle);
            if ($price !== null) { $suffix = ' <span class="ch247-btn__price">' . $this->e($price['formatted']) . '</span>'; }
        }
        $classes = 'ch247-btn ch247-btn--' . $this->variant($this->prop($props, 'variant', 'primary')) . ' ch247-btn--md';
        return $this->anchor(CartLinks::product($productId, $cycle), '<span>' . $this->e($label) . '</span>' . $suffix, $classes);
    }

    private function serverSpecs(array $props, RenderContext $context)
    {
        $rows = '';
        foreach ($this->items($props, 'items') as $item) {
            $icon = isset($item['icon']) ? (string) $item['icon'] : '';
            $rows .= '<tr><th scope="row">' . ($icon !== '' && Icons::has($icon) ? Icons::svg($icon, 16, 'ch247-spec__icon') : '')
                . $this->e($this->str($item, 'label')) . '</th><td>' . $this->e($this->str($item, 'value')) . '</td></tr>';
        }
        $header = '';
        $productId = (int) $this->prop($props, 'product', 0);
        if ($productId > 0) {
            $data = $context->data();
            $product = $data === null ? null : $data->product($productId);
            if ($product === null) {
                $header = $this->unavailable($context, 'Linked product #' . $productId . ' could not be read.');
            } else {
                $price = !empty($props['show_price']) && isset($product['price']) ? $product['price'] : null;
                $header = '<div class="ch247-specs__head"><h3>' . $this->e($product['name']) . '</h3>'
                    . ($price !== null ? '<p class="ch247-specs__price">' . $this->e($price['formatted']) . ' <small>' . $this->e(Money::cycleLabel($price['cycle'])) . '</small></p>' : '')
                    . $this->anchor($product['order_url'], 'Order', 'ch247-btn ch247-btn--primary ch247-btn--sm') . '</div>';
            }
        }
        if ($rows === '' && $header === '') { return $this->unavailable($context, 'Add specification rows.'); }
        return '<div class="ch247-specs">' . $header
            . ($rows !== '' ? '<table class="ch247-specs__table"><tbody>' . $rows . '</tbody></table>' : '') . '</div>';
    }

    private function domainSearch(array $props, RenderContext $context)
    {
        $heading = $this->prop($props, 'heading');
        $strip = '';
        if (!empty($props['show_pricing'])) {
            $data = $context->data();
            $tlds = array_filter(array_map('trim', explode(',', (string) $this->prop($props, 'tlds'))));
            $pricing = $data === null ? null : $data->domainPricing($tlds, 8);
            if ($pricing === null) {
                $strip = $this->unavailable($context, 'Domain pricing could not be read, so the price strip is hidden.');
            } else {
                foreach ($pricing as $row) {
                    if ($row['register'] === null) { continue; }
                    $strip .= '<li><strong>' . $this->e($row['tld']) . '</strong><span>' . $this->e($row['register']) . '</span></li>';
                }
                $strip = $strip === '' ? '' : '<ul class="ch247-domain__strip">' . $strip . '</ul>';
            }
        }
        // Posts straight to the WHMCS domain checker: availability is decided there.
        return '<div class="ch247-domain">'
            . ($heading !== '' ? '<h2 class="ch247-domain__heading"' . $this->inline($context, 'heading') . '>' . $this->e($heading) . '</h2>' : '')
            . '<form class="ch247-domain__form" method="post" action="' . $this->e(CartLinks::domainChecker()) . '">'
            . '<input type="hidden" name="direct" value="true" />'
            . '<label class="ch247-sr-only" for="ch247-domain-input">Domain name</label>'
            . '<input class="ch247-domain__input" id="ch247-domain-input" type="text" name="domain" autocomplete="off" spellcheck="false"'
            . ' placeholder="' . $this->e($this->prop($props, 'placeholder', 'yourbusiness.com')) . '" />'
            . '<button class="ch247-btn ch247-btn--primary ch247-btn--md" type="submit">'
            . $this->e($this->prop($props, 'button_label', 'Search')) . '</button>'
            . '</form>' . $strip . '</div>';
    }

    private function domainPricing(array $props, RenderContext $context)
    {
        $data = $context->data();
        if ($data === null) { return $this->unavailable($context, 'Live domain pricing is not available in this context.'); }
        $tlds = array_filter(array_map('trim', explode(',', (string) $this->prop($props, 'tlds'))));
        $rows = $data->domainPricing($tlds, (int) $this->prop($props, 'limit', 8));
        if ($rows === null) {
            return $this->unavailable($context, 'Domain pricing could not be read: ' . $data->unavailableReason());
        }
        if (!$rows) { return $this->unavailable($context, 'No matching TLDs are configured in WHMCS.'); }
        $showTransfer = !empty($props['show_transfer']);
        $showRenew = !empty($props['show_renew']);
        $head = '<tr><th scope="col">Extension</th><th scope="col">Register</th>'
            . ($showTransfer ? '<th scope="col">Transfer</th>' : '')
            . ($showRenew ? '<th scope="col">Renew</th>' : '') . '</tr>';
        $body = '';
        foreach ($rows as $row) {
            $body .= '<tr><th scope="row">' . $this->e($row['tld']) . '</th>'
                . '<td>' . ($row['register'] === null ? '<span class="ch247-muted">not offered</span>' : $this->e($row['register'])) . '</td>'
                . ($showTransfer ? '<td>' . ($row['transfer'] === null ? '<span class="ch247-muted">not offered</span>' : $this->e($row['transfer'])) . '</td>' : '')
                . ($showRenew ? '<td>' . ($row['renew'] === null ? '<span class="ch247-muted">not offered</span>' : $this->e($row['renew'])) . '</td>' : '')
                . '</tr>';
        }
        return '<div class="ch247-table-wrap"><table class="ch247-table ch247-domain-pricing">'
            . '<thead>' . $head . '</thead><tbody>' . $body . '</tbody></table>'
            . '<p class="ch247-table__note">Prices are the first-year rates configured in WHMCS.</p></div>';
    }

    private function cartSummary(array $props, RenderContext $context)
    {
        $data = $context->data();
        $cart = $data === null ? null : $data->cart();
        if ($cart === null) { return $this->unavailable($context, 'The cart cannot be read in this context.'); }
        $items = (int) $cart['items'];
        return '<div class="ch247-cart">'
            . '<h3 class="ch247-cart__heading">' . $this->e($this->prop($props, 'heading', 'Your cart')) . '</h3>'
            . ($items === 0
                ? '<p class="ch247-cart__empty">' . $this->e($this->prop($props, 'empty_text', 'Your cart is empty.')) . '</p>'
                : '<p class="ch247-cart__count">' . $items . ' item' . ($items === 1 ? '' : 's') . ' in your cart</p>')
            . $this->anchor($cart['url'], $this->e($this->prop($props, 'button_label', 'View cart')), 'ch247-btn ch247-btn--secondary ch247-btn--md')
            . '</div>';
    }

    private function checkoutLink(array $props, RenderContext $context)
    {
        $classes = 'ch247-btn ch247-btn--' . $this->variant($this->prop($props, 'variant', 'primary')) . ' ch247-btn--md';
        return $this->anchor(CartLinks::checkout(), $this->e($this->prop($props, 'label', 'Checkout')), $classes);
    }

    private function reviews(array $props, RenderContext $context)
    {
        $data = $context->data();
        $reviews = $data === null ? null : $data->reviews((int) $this->prop($props, 'limit', 3));
        if ($reviews === null) {
            return $this->unavailable($context, 'Reviews are read from published testimonials; none could be loaded.');
        }
        if (!$reviews) { return $this->unavailable($context, 'No published testimonials yet.'); }
        $columns = max(1, min(4, (int) $this->prop($props, 'columns', 3)));
        $cards = '';
        foreach ($reviews as $review) {
            $cards .= '<figure class="ch247-testimonial"><blockquote>' . $this->e($review['quote']) . '</blockquote>'
                . '<figcaption class="ch247-testimonial__author"><span><strong>' . $this->e($review['author']) . '</strong></span></figcaption></figure>';
        }
        $heading = $this->prop($props, 'heading');
        return ($heading !== '' ? '<h2 class="ch247-section-heading">' . $this->e($heading) . '</h2>' : '')
            . '<div class="ch247-reviews" style="grid-template-columns:repeat(' . $columns . ', minmax(0, 1fr))">' . $cards . '</div>';
    }

    private function contactForm(array $props, RenderContext $context)
    {
        $formId = (int) $this->prop($props, 'form', 0);
        if ($formId <= 0) { return $this->unavailable($context, 'Choose a form.'); }
        $form = $context->form($formId);
        if ($form === null) {
            return $this->unavailable($context, 'Form #' . $formId . ' no longer exists or is disabled.');
        }
        $fields = '';
        foreach (isset($form['fields']) && is_array($form['fields']) ? $form['fields'] : array() as $field) {
            $fields .= $this->formField($field, $formId);
        }
        if ($fields === '') { return $this->unavailable($context, 'This form has no fields yet.'); }

        $title = $this->prop($props, 'title');
        $description = $this->prop($props, 'description');
        $action = $context->formAction();
        $token = $context->formToken($formId);
        $disabled = $context->isEditor() ? ' data-ch247-inert="1"' : '';

        return '<div class="ch247-form-wrap">'
            . ($title !== '' ? '<h3 class="ch247-form__title">' . $this->e($title) . '</h3>' : '')
            . ($description !== '' ? '<p class="ch247-form__description">' . nl2br($this->e($description)) . '</p>' : '')
            . '<form class="ch247-form" method="post" action="' . $this->e($action) . '"' . $disabled . '>'
            . '<input type="hidden" name="ch247_form_id" value="' . $formId . '" />'
            . '<input type="hidden" name="ch247_form_token" value="' . $this->e($token) . '" />'
            . '<input type="hidden" name="ch247_form_ts" value="' . time() . '" />'
            . '<div class="ch247-form__trap" aria-hidden="true">'
            . '<label>Leave this field empty<input type="text" name="ch247_hp" tabindex="-1" autocomplete="off" /></label></div>'
            . $fields
            . '<button class="ch247-btn ch247-btn--primary ch247-btn--md" type="submit">'
            . $this->e($this->prop($props, 'submit_label', 'Send')) . '</button>'
            . '</form></div>';
    }

    private function formField(array $field, $formId)
    {
        $name = isset($field['name']) ? (string) $field['name'] : '';
        if (preg_match('/^[a-z][a-z0-9_]{0,39}$/', $name) !== 1) { return ''; }
        $type = isset($field['type']) ? (string) $field['type'] : 'text';
        $label = $this->sanitizer->text(isset($field['label']) ? $field['label'] : $name, 120);
        $required = !empty($field['required']) ? ' required' : '';
        $placeholder = $this->sanitizer->text(isset($field['placeholder']) ? $field['placeholder'] : '', 120);
        $id = 'ch247-f' . (int) $formId . '-' . $name;
        $help = $this->sanitizer->text(isset($field['help']) ? $field['help'] : '', 200);

        $control = '';
        switch ($type) {
            case 'textarea':
                $control = '<textarea class="ch247-input" id="' . $this->e($id) . '" name="' . $this->e($name) . '" rows="5"'
                    . ($placeholder !== '' ? ' placeholder="' . $this->e($placeholder) . '"' : '') . $required . '></textarea>';
                break;
            case 'select':
                $options = '';
                foreach (isset($field['options']) && is_array($field['options']) ? $field['options'] : array() as $option) {
                    $option = $this->sanitizer->text($option, 120);
                    if ($option === '') { continue; }
                    $options .= '<option value="' . $this->e($option) . '">' . $this->e($option) . '</option>';
                }
                if ($options === '') { return ''; }
                $control = '<select class="ch247-input" id="' . $this->e($id) . '" name="' . $this->e($name) . '"' . $required . '>'
                    . '<option value="">Please choose</option>' . $options . '</select>';
                break;
            case 'checkbox':
                return '<div class="ch247-field ch247-field--check"><label for="' . $this->e($id) . '">'
                    . '<input type="checkbox" id="' . $this->e($id) . '" name="' . $this->e($name) . '" value="1"' . $required . ' /> '
                    . $this->e($label) . '</label>'
                    . ($help !== '' ? '<small class="ch247-field__help">' . $this->e($help) . '</small>' : '') . '</div>';
            default:
                $inputType = in_array($type, array('email', 'tel', 'number', 'url', 'date'), true) ? $type : 'text';
                $control = '<input class="ch247-input" type="' . $inputType . '" id="' . $this->e($id) . '" name="' . $this->e($name) . '"'
                    . ($placeholder !== '' ? ' placeholder="' . $this->e($placeholder) . '"' : '') . $required . ' />';
        }
        return '<div class="ch247-field"><label class="ch247-field__label" for="' . $this->e($id) . '">' . $this->e($label)
            . ($required !== '' ? ' <span class="ch247-req" aria-hidden="true">*</span>' : '') . '</label>' . $control
            . ($help !== '' ? '<small class="ch247-field__help">' . $this->e($help) . '</small>' : '') . '</div>';
    }

    private function faq(array $props, RenderContext $context)
    {
        $items = $this->items($props, 'items');
        if (!$items) { return $this->unavailable($context, 'Add at least one question.'); }
        $html = '<div class="ch247-faq">';
        $structured = array();
        foreach ($items as $item) {
            $question = $this->str($item, 'question');
            $answer = $this->rich($item, 'answer');
            if ($question === '') { continue; }
            $html .= '<details class="ch247-faq__item"><summary>' . $this->e($question) . '</summary>'
                . '<div class="ch247-faq__answer">' . $answer . '</div></details>';
            $structured[] = array(
                '@type' => 'Question',
                'name' => $question,
                'acceptedAnswer' => array('@type' => 'Answer', 'text' => trim(strip_tags($answer))),
            );
        }
        $html .= '</div>';
        if (!empty($props['schema_markup']) && $structured && !$context->isEditor()) {
            $json = json_encode(array('@context' => 'https://schema.org', '@type' => 'FAQPage', 'mainEntity' => $structured),
                JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
            if (is_string($json)) {
                $html .= '<script type="application/ld+json">' . $json . '</script>';
            }
        }
        return $html;
    }

    private function serviceStatus(array $props, RenderContext $context)
    {
        $data = $context->data();
        $rows = $data === null ? null : $data->serviceStatus((int) $this->prop($props, 'limit', 6));
        if ($rows === null) {
            return $this->unavailable($context, 'No measured status is available: ' . ($data === null ? 'no data source in this context.' : $data->unavailableReason()));
        }
        if (!$rows) { return $this->unavailable($context, 'No integrations are configured yet, so there is nothing to report.'); }
        $heading = $this->prop($props, 'heading');
        $showChecked = !empty($props['show_checked_at']);
        $list = '';
        foreach ($rows as $row) {
            $state = strtolower((string) $row['state']);
            $class = in_array($state, array('ok', 'healthy', 'success'), true) ? 'ok'
                : (in_array($state, array('degraded', 'warning', 'slow'), true) ? 'warn'
                : (in_array($state, array('unknown', '', 'never_tested'), true) ? 'unknown' : 'down'));
            $list .= '<li class="ch247-status__row is-' . $class . '">'
                . '<span class="ch247-status__dot" aria-hidden="true"></span>'
                . '<span class="ch247-status__label">' . $this->e($row['label']) . '</span>'
                . '<span class="ch247-status__state">' . $this->e($row['state'] === '' ? 'not tested' : $row['state']) . '</span>'
                . ($showChecked && $row['checked_at'] !== '' ? '<time class="ch247-status__time">' . $this->e($row['checked_at']) . '</time>' : '')
                . '</li>';
        }
        return '<div class="ch247-status">'
            . ($heading !== '' ? '<h3 class="ch247-status__heading">' . $this->e($heading) . '</h3>' : '')
            . '<ul class="ch247-status__list">' . $list . '</ul>'
            . '<p class="ch247-status__note">Measured by the CloudHost247 API &amp; Integrations centre.</p></div>';
    }

    /* ------------------------------------------------------------------ site */

    private function siteLogo(array $props, RenderContext $context)
    {
        $media = $this->media($props, 'image');
        $width = max(40, min(480, (int) $this->prop($props, 'width', 160)));
        $alt = $this->prop($props, 'alt', 'CloudHost247');
        $inner = $media['url'] === ''
            ? '<span class="ch247-logo__text">' . $this->e($alt) . '</span>'
            : '<img src="' . $this->e($media['url']) . '" alt="' . $this->e($alt) . '" width="' . $width . '" />';
        $url = UrlPolicy::link($this->prop($props, 'url', '/'));
        return $url !== null && $url !== ''
            ? '<a class="ch247-logo" href="' . $this->e($url) . '">' . $inner . '</a>'
            : '<span class="ch247-logo">' . $inner . '</span>';
    }

    private function navMenu(array $props, RenderContext $context)
    {
        $menuId = (int) $this->prop($props, 'menu', 0);
        if ($menuId <= 0) { return $this->unavailable($context, 'Choose a navigation menu.'); }
        $menu = $context->menu($menuId);
        if ($menu === null) { return $this->unavailable($context, 'Menu #' . $menuId . ' no longer exists.'); }
        $items = isset($menu['items']) && is_array($menu['items']) ? $menu['items'] : array();
        if (!$items) { return $this->unavailable($context, 'That menu has no items yet.'); }
        $orientation = $this->prop($props, 'orientation', 'horizontal') === 'vertical' ? 'vertical' : 'horizontal';
        $collapse = !empty($props['collapse_mobile']) ? ' ch247-nav--collapse' : '';
        return '<nav class="ch247-nav ch247-nav--' . $orientation . $collapse . '" aria-label="' . $this->e(isset($menu['name']) ? $menu['name'] : 'Navigation') . '">'
            . ($collapse !== '' ? '<button class="ch247-nav__toggle" type="button" aria-expanded="false">' . Icons::svg('menu', 22) . '<span class="ch247-sr-only">Menu</span></button>' : '')
            . $this->menuList($items, 0) . '</nav>';
    }

    private function menuList(array $items, $depth)
    {
        if ($depth > 1) { return ''; }
        $html = '<ul class="ch247-nav__list' . ($depth > 0 ? ' ch247-nav__list--sub' : '') . '">';
        foreach ($items as $item) {
            if (!is_array($item)) { continue; }
            $label = $this->sanitizer->text(isset($item['label']) ? $item['label'] : '', 80);
            if ($label === '') { continue; }
            $url = isset($item['url']) ? UrlPolicy::link($item['url']) : '';
            $children = isset($item['children']) && is_array($item['children']) ? $item['children'] : array();
            $target = !empty($item['target']) && $item['target'] === 'blank' ? ' target="_blank" rel="noopener noreferrer"' : '';
            $html .= '<li class="ch247-nav__item' . ($children ? ' has-children' : '') . '">'
                . ($url === null || $url === ''
                    ? '<span class="ch247-nav__link">' . $this->e($label) . '</span>'
                    : '<a class="ch247-nav__link" href="' . $this->e($url) . '"' . $target . '>' . $this->e($label) . '</a>')
                . ($children ? $this->menuList($children, $depth + 1) : '')
                . '</li>';
        }
        return $html . '</ul>';
    }

    private function accountLinks(array $props, RenderContext $context)
    {
        $classes = 'ch247-btn ch247-btn--' . $this->variant($this->prop($props, 'variant', 'ghost')) . ' ch247-btn--sm';
        $loggedIn = !empty($_SESSION['uid']);
        $links = '';
        if ($loggedIn) {
            // Real session state: a signed-in visitor is not offered a login link.
            $links .= $this->anchor(CartLinks::clientArea(), 'My account', $classes);
        } else {
            if (!empty($props['show_login'])) { $links .= $this->anchor(CartLinks::login(), 'Login', $classes); }
            if (!empty($props['show_register'])) { $links .= $this->anchor(CartLinks::register(), 'Register', $classes); }
            if (!empty($props['show_client_area']) && empty($props['show_login'])) {
                $links .= $this->anchor(CartLinks::clientArea(), 'Client area', $classes);
            }
        }
        if ($links === '') { return $this->unavailable($context, 'Enable at least one account link.'); }
        return '<div class="ch247-account-links">' . $links . '</div>';
    }

    private function copyright(array $props, RenderContext $context)
    {
        $text = $this->prop($props, 'text');
        $prefix = !empty($props['show_year']) ? '&copy; ' . date('Y') . ' ' : '';
        return '<p class="ch247-copyright">' . $prefix . $this->e($text) . '</p>';
    }

    /* --------------------------------------------------------------- helpers */

    private function prop(array $props, $key, $default = '')
    {
        if (!array_key_exists($key, $props)) { return $default; }
        $value = $props[$key];
        if (is_array($value) || is_object($value)) { return $default; }
        if (is_bool($value)) { return $value; }
        return is_string($value) ? $value : (string) $value;
    }

    private function items(array $props, $key)
    {
        return isset($props[$key]) && is_array($props[$key]) ? $props[$key] : array();
    }

    private function str(array $row, $key)
    {
        return isset($row[$key]) && is_scalar($row[$key]) ? (string) $row[$key] : '';
    }

    private function rich(array $row, $key)
    {
        return $this->sanitizer->clean(isset($row[$key]) ? (string) $row[$key] : '', WidgetCatalog::MAX_RICHTEXT);
    }

    private function media(array $props, $key)
    {
        $empty = array('id' => 0, 'url' => '', 'alt' => '');
        if (!isset($props[$key]) || !is_array($props[$key])) { return $empty; }
        $media = $props[$key];
        $url = isset($media['url']) ? UrlPolicy::media((string) $media['url']) : '';
        return array(
            'id' => isset($media['id']) ? (int) $media['id'] : 0,
            'url' => $url === null ? '' : (string) $url,
            'alt' => isset($media['alt']) ? $this->sanitizer->text((string) $media['alt'], 250) : '',
        );
    }

    private function variant($variant)
    {
        return in_array($variant, array('primary', 'secondary', 'outline', 'ghost'), true) ? $variant : 'primary';
    }

    private function buttonClasses(array $props)
    {
        $size = in_array($this->prop($props, 'size'), array('sm', 'md', 'lg'), true) ? $this->prop($props, 'size') : 'md';
        $classes = 'ch247-btn ch247-btn--' . $this->variant($this->prop($props, 'variant', 'primary')) . ' ch247-btn--' . $size;
        if (!empty($props['full_width'])) { $classes .= ' ch247-btn--block'; }
        return $classes;
    }

    private function anchor($url, $innerHtml, $classes, $target = '')
    {
        $safe = UrlPolicy::link($url);
        if ($safe === null || $safe === '') { $safe = '#'; }
        $attributes = ' class="' . $this->e($classes) . '" href="' . $this->e($safe) . '"';
        if ($target === 'blank') { $attributes .= ' target="_blank" rel="noopener noreferrer"'; }
        return '<a' . $attributes . '>' . $innerHtml . '</a>';
    }

    /**
     * Editor-only explanation of why a widget has nothing to show.
     *
     * Publish mode returns an empty string, which makes Renderer drop the node
     * entirely: a live page never shows scaffolding or an unexplained gap.
     */
    private function unavailable(RenderContext $context, $message)
    {
        if (!$context->isEditor()) { return ''; }
        $context->note($message);
        return '<div class="ch247-unavailable">' . Icons::svg('info', 16) . '<span>' . $this->e($message) . '</span></div>';
    }

    private function inline(RenderContext $context, $prop)
    {
        return $context->isEditor() ? ' data-ch247-inline="' . $this->e($prop) . '"' : '';
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
