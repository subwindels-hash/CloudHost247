<?php
namespace CloudHost247\Builder\Catalog;

/**
 * The real WHMCS commerce URLs.
 *
 * Order, cart, checkout, client area, login and registration all point at
 * WHMCS itself. The builder never re-implements a basket, a checkout or an
 * authentication form; it links to the ones the platform already runs, so
 * pricing, tax, promotions, fraud checks and sessions keep working exactly as
 * before.
 */
final class CartLinks
{
    public static function product($productId, $cycle = '')
    {
        $productId = (int) $productId;
        if ($productId <= 0) { return self::cart(); }
        $url = 'cart.php?a=add&pid=' . $productId;
        if ($cycle !== '' && preg_match('/^[a-z]{4,14}$/', (string) $cycle) === 1) {
            $url .= '&billingcycle=' . $cycle;
        }
        return $url;
    }

    public static function group($groupId)
    {
        $groupId = (int) $groupId;
        return $groupId > 0 ? 'cart.php?gid=' . $groupId : 'cart.php';
    }

    public static function cart() { return 'cart.php?a=view'; }

    public static function checkout() { return 'cart.php?a=checkout'; }

    public static function domainChecker() { return 'domainchecker.php'; }

    public static function clientArea() { return 'clientarea.php'; }

    public static function login() { return 'clientarea.php'; }

    public static function register() { return 'register.php'; }
}
