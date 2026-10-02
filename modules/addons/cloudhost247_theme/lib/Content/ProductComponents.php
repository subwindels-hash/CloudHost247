<?php
namespace CloudHost247\Theme\Content;

/**
 * Product-query components for landing blocks.
 *
 * A landing block may declare a product component ("show six VPS plans"). The
 * query itself is not written here: the CloudHost247 page builder owns the
 * bounded WHMCS catalogue reader (WhmcsDataSource), and this class only
 * validates the declared widget and asks that reader for the rows. Reusing it
 * keeps one product query in the codebase and one definition of "no price means
 * no price".
 *
 * Two rules follow from that:
 *   - The component declares its limits; anything outside the whitelist is
 *     clamped, never passed through to a query.
 *   - If the builder module is not installed, or the catalogue cannot be read,
 *     the component reports that honestly (`available` false plus a reason) and
 *     returns no products. It never fabricates a price or a product list.
 */
final class ProductComponents
{
    /** Billing cycles the catalogue reader understands. */
    const CYCLES = array('monthly', 'quarterly', 'semiannually', 'annually', 'biennially', 'triennially');
    /** Layouts the theme template knows how to draw. */
    const LAYOUTS = array('grid', 'list');
    const MAX_LIMIT = 12;
    const MAX_COMPONENTS = 12;

    /** Catalogue-reader factory override, for tests that must drive both paths. */
    private static $readerFactory = null;

    /**
     * Replace (or clear, with null) the catalogue reader factory. The tests use
     * this to exercise "the builder is not installed" without unloading a class.
     */
    public static function useReader($factory)
    {
        self::$readerFactory = $factory === null ? null : $factory;
    }

    /**
     * The page builder's catalogue reader, or null when it is not installed.
     */
    private static function reader()
    {
        if (self::$readerFactory !== null) { return call_user_func(self::$readerFactory); }
        if (!class_exists('CloudHost247\Builder\Catalog\WhmcsDataSource')) { return null; }
        return new \CloudHost247\Builder\Catalog\WhmcsDataSource();
    }

    /**
     * Normalise a declared component into a bounded spec, or return null when
     * the widget is not a product component at all.
     */
    public static function normalise($widget)
    {
        if (!is_array($widget)) { return null; }
        $type = isset($widget['type']) ? strtolower(trim((string) $widget['type'])) : '';
        if ($type !== 'products' && $type !== 'product') { return null; }
        $limit = isset($widget['limit']) ? (int) $widget['limit'] : 3;
        if ($limit < 1) { $limit = 1; }
        if ($limit > self::MAX_LIMIT) { $limit = self::MAX_LIMIT; }
        $cycle = isset($widget['cycle']) ? strtolower(trim((string) $widget['cycle'])) : 'monthly';
        if (!in_array($cycle, self::CYCLES, true)) { $cycle = 'monthly'; }
        $layout = isset($widget['layout']) ? strtolower(trim((string) $widget['layout'])) : 'grid';
        if (!in_array($layout, self::LAYOUTS, true)) { $layout = 'grid'; }
        return array(
            'type' => 'products',
            'heading' => self::text(isset($widget['heading']) ? $widget['heading'] : '', 120),
            'group' => isset($widget['group']) ? max(0, (int) $widget['group']) : 0,
            'limit' => $limit,
            'cycle' => $cycle,
            'layout' => $layout,
        );
    }

    /**
     * Resolve one component: bounded catalogue rows, or an explained empty set.
     */
    public static function resolve(array $widget)
    {
        $spec = self::normalise($widget);
        if ($spec === null) { return null; }
        try { $source = self::reader(); }
        catch (\Throwable $brokenReader) { $source = null; $readerFailed = true; }
        if ($source === null) {
            $reason = !empty($readerFailed)
                ? 'The product catalogue reader could not be started, so the component was not rendered.'
                : 'The CloudHost247 page builder module is not installed, so product components cannot be resolved.';
            return array('component' => $spec, 'available' => false, 'reason' => $reason, 'products' => array());
        }
        try {
            if (!$source->available()) {
                return array('component' => $spec, 'available' => false, 'reason' => (string) $source->unavailableReason(), 'products' => array());
            }
            $products = $source->products($spec['group'], $spec['limit'], $spec['cycle']);
        } catch (\Throwable $error) {
            return array('component' => $spec, 'available' => false, 'reason' => 'The product catalogue could not be read.', 'products' => array());
        }
        if (!is_array($products)) {
            return array('component' => $spec, 'available' => false, 'reason' => (string) $source->unavailableReason(), 'products' => array());
        }
        return array('component' => $spec, 'available' => true, 'reason' => '', 'products' => array_slice($products, 0, $spec['limit']));
    }

    /**
     * Decorate a list of hydrated content rows that declare product widgets.
     *
     * Bounded twice: at most MAX_COMPONENTS components are resolved and the
     * caller's rows keep their order; a row with no product widget is returned
     * untouched so the theme template can iterate one list.
     */
    public static function forContent(array $items)
    {
        $resolved = 0;
        foreach ($items as $index => $item) {
            $component = null;
            if (!empty($item['product_widget']) && is_array($item['product_widget']) && $resolved < self::MAX_COMPONENTS) {
                $component = self::resolve($item['product_widget']);
                if ($component !== null) { $resolved++; }
            }
            $widgets = isset($item['widgets']) && is_array($item['widgets']) ? $item['widgets'] : array();
            foreach ($widgets as $widget) {
                if ($component !== null || $resolved >= self::MAX_COMPONENTS) { break; }
                $candidate = self::normalise($widget);
                if ($candidate !== null) { $component = self::resolve($candidate); $resolved++; break; }
            }
            if ($component !== null) { $items[$index]['product_component'] = $component; }
        }
        return $items;
    }

    private static function text($value, $maxLength)
    {
        $value = trim(strip_tags((string) $value));
        if (strlen($value) > $maxLength) { $value = substr($value, 0, $maxLength); }
        return $value;
    }
}
