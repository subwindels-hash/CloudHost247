<?php
/**
 * Sanitised snapshot of the WHMCS shopping cart.
 *
 * WHMCS remains the source of truth for the live cart; this class only keeps
 * an allow-listed, JSON-encodable copy of the fields required to rebuild
 * $_SESSION['cart'] and to describe the cart in an email or the admin UI.
 * Nothing sensitive (card data, CVV, passwords, tokens, gateway secrets) is
 * ever copied: keys are allow-listed and a deny pattern is applied on top.
 */

namespace CloudHost247\CartRecovery;

final class CartSnapshot
{
    const VERSION = 1;
    const MAX_DEPTH = 6;
    const MAX_STRING = 2000;

    /** Cart-level keys WHMCS uses in $_SESSION['cart']. */
    private static $topLevelKeys = array(
        'products', 'domains', 'addons', 'renewals', 'gid', 'promocode', 'promotype', 'promovalue', 'currency',
    );

    /** Item-level keys that are safe and sufficient to reconstruct a cart line. */
    private static $itemKeys = array(
        'pid', 'gid', 'productname', 'productgroup', 'product', 'domain', 'domaintype', 'domainoption',
        'billingcycle', 'qty', 'quantity', 'regperiod', 'dnsmanagement', 'emailforwarding', 'idprotection',
        'eppcode', 'nameservers', 'addons', 'addonids', 'configoptions', 'customfields', 'server',
        'noinvoice', 'noemail', 'recurring', 'setupfee', 'price', 'pricing', 'subtotal', 'total', 'currency',
    );

    /** Anything matching this never leaves the session, whatever the key list says. */
    const DENY_PATTERN = '/pass|secret|token|cvv|cvc|card|cc_?num|iban|bank|api[_-]?key|credential|session|auth|gateway|signature|nonce/i';

    /**
     * @param array  $cart     raw $_SESSION['cart'] style array
     * @param string $currency currency code for display
     * @param array  $totals   optional authoritative-ish display totals (subtotal/discount/total)
     */
    public static function capture($cart, $currency = '', array $totals = array())
    {
        $clean = self::sanitise(is_array($cart) ? $cart : array(), 0, true);
        $snapshot = array(
            'version' => self::VERSION,
            'cart' => $clean,
            'currency' => substr((string) $currency, 0, 8),
            'items' => self::describe($clean),
            'totals' => self::totals($totals, $clean),
            'captured_at' => gmdate('c'),
        );
        return $snapshot;
    }

    public static function encode(array $snapshot)
    {
        $json = json_encode($snapshot, JSON_UNESCAPED_SLASHES);
        return $json === false ? json_encode(array('version' => self::VERSION, 'cart' => array(), 'items' => array())) : $json;
    }

    public static function decode($json)
    {
        if (is_array($json)) {
            return $json;
        }
        $decoded = json_decode((string) $json, true);
        return is_array($decoded) ? $decoded : array();
    }

    /** Cart array ready to be written back into $_SESSION['cart']. */
    public static function restore($json)
    {
        $snapshot = self::decode($json);
        if (!isset($snapshot['cart']) || !is_array($snapshot['cart'])) {
            return array();
        }
        // Re-sanitise on the way out: the stored row is trusted, but a second
        // pass guarantees a tampered row can never inject session keys.
        return self::sanitise($snapshot['cart'], 0, true);
    }

    public static function isEmpty($cart)
    {
        if (!is_array($cart)) {
            return true;
        }
        foreach (array('products', 'domains', 'addons', 'renewals') as $group) {
            if (!empty($cart[$group]) && is_array($cart[$group])) {
                return false;
            }
        }
        // Some cart shapes are a flat list of items.
        foreach ($cart as $key => $value) {
            if (is_int($key) && is_array($value) && (isset($value['pid']) || isset($value['domain']))) {
                return false;
            }
        }
        return true;
    }

    /** Human readable item list used by emails and the admin table. */
    public static function items($json)
    {
        $snapshot = self::decode($json);
        if (isset($snapshot['items']) && is_array($snapshot['items'])) {
            return $snapshot['items'];
        }
        return self::describe(self::restore($json));
    }

    public static function label($json, $limit = 8)
    {
        $labels = array();
        foreach (self::items($json) as $item) {
            $text = isset($item['name']) ? $item['name'] : '';
            if (!empty($item['domain'])) {
                $text = trim($text . ' (' . $item['domain'] . ')');
            }
            if (!empty($item['billingcycle'])) {
                $text .= ' — ' . $item['billingcycle'];
            }
            if ($text !== '') {
                $labels[] = $text;
            }
        }
        $labels = array_slice(array_values(array_unique($labels)), 0, (int) $limit);
        return implode(', ', $labels);
    }

    /** Display total stored with the snapshot, or null when unknown. */
    public static function total($json)
    {
        $snapshot = self::decode($json);
        if (isset($snapshot['totals']['total']) && is_numeric($snapshot['totals']['total'])) {
            return round((float) $snapshot['totals']['total'], 2);
        }
        if (isset($snapshot['totals']['subtotal']) && is_numeric($snapshot['totals']['subtotal'])) {
            return round((float) $snapshot['totals']['subtotal'], 2);
        }
        return null;
    }

    public static function currency($json)
    {
        $snapshot = self::decode($json);
        return isset($snapshot['currency']) ? (string) $snapshot['currency'] : '';
    }

    /**
     * Stable fingerprint of the cart contents. Used to decide whether a cart
     * change is "meaningful" without doing expensive work on every page load.
     */
    public static function fingerprint($cart)
    {
        $clean = is_array($cart) && isset($cart['cart']) ? $cart['cart'] : $cart;
        $clean = self::sanitise(is_array($clean) ? $clean : array(), 0, true);
        self::ksortRecursive($clean);
        return hash('sha256', (string) json_encode($clean));
    }

    // ---------------------------------------------------------------- internals

    private static function sanitise($value, $depth, $topLevel = false)
    {
        if ($depth > self::MAX_DEPTH) {
            return null;
        }
        if ($value === null || is_bool($value) || is_int($value) || is_float($value)) {
            return $value;
        }
        if (is_string($value)) {
            return substr($value, 0, self::MAX_STRING);
        }
        if (!is_array($value)) {
            return null;
        }
        $out = array();
        foreach ($value as $key => $item) {
            $name = (string) $key;
            if (preg_match(self::DENY_PATTERN, $name)) {
                continue;
            }
            if (!self::keyAllowed($name, $depth, $topLevel)) {
                continue;
            }
            $clean = self::sanitise($item, $depth + 1);
            if ($clean === null && !is_null($item)) {
                continue;
            }
            $out[substr($name, 0, 80)] = $clean;
        }
        return $out;
    }

    private static function keyAllowed($name, $depth, $topLevel)
    {
        if (ctype_digit($name)) {
            return true; // list index
        }
        $lower = strtolower($name);
        if ($topLevel && $depth === 0) {
            return in_array($lower, self::$topLevelKeys, true);
        }
        if (in_array($lower, self::$itemKeys, true)) {
            return true;
        }
        // Configurable options / custom fields are keyed by numeric-ish ids
        // handled above; anything else below item level is dropped.
        return false;
    }

    /** Flatten a sanitised cart into display rows. */
    private static function describe(array $cart)
    {
        $items = array();
        foreach (array('products', 'addons', 'renewals') as $group) {
            if (empty($cart[$group]) || !is_array($cart[$group])) {
                continue;
            }
            foreach ($cart[$group] as $entry) {
                if (!is_array($entry)) {
                    continue;
                }
                $items[] = array(
                    'type' => $group === 'products' ? 'product' : rtrim($group, 's'),
                    'pid' => isset($entry['pid']) ? (int) $entry['pid'] : null,
                    'group' => isset($entry['productgroup']) ? (string) $entry['productgroup'] : '',
                    'name' => self::itemName($entry),
                    'domain' => isset($entry['domain']) ? (string) $entry['domain'] : '',
                    'billingcycle' => isset($entry['billingcycle']) ? (string) $entry['billingcycle'] : '',
                    'quantity' => isset($entry['qty']) ? (int) $entry['qty'] : (isset($entry['quantity']) ? (int) $entry['quantity'] : 1),
                    'price' => isset($entry['price']) && is_numeric($entry['price']) ? round((float) $entry['price'], 2) : null,
                );
            }
        }
        if (!empty($cart['domains']) && is_array($cart['domains'])) {
            foreach ($cart['domains'] as $entry) {
                if (!is_array($entry)) {
                    continue;
                }
                $type = isset($entry['domaintype']) ? (string) $entry['domaintype'] : 'register';
                $items[] = array(
                    'type' => 'domain',
                    'pid' => null,
                    'group' => 'Domains',
                    'name' => ucfirst($type) . ' domain',
                    'domain' => isset($entry['domain']) ? (string) $entry['domain'] : '',
                    'billingcycle' => isset($entry['regperiod']) ? ((int) $entry['regperiod'] . ' year(s)') : '',
                    'quantity' => 1,
                    'price' => isset($entry['price']) && is_numeric($entry['price']) ? round((float) $entry['price'], 2) : null,
                );
            }
        }
        return $items;
    }

    private static function itemName(array $entry)
    {
        foreach (array('productname', 'product') as $key) {
            if (!empty($entry[$key]) && is_string($entry[$key])) {
                return $entry[$key];
            }
        }
        if (!empty($entry['pid'])) {
            return 'Product #' . (int) $entry['pid'];
        }
        return 'Cart item';
    }

    private static function totals(array $given, array $cart)
    {
        $totals = array('subtotal' => null, 'discount' => null, 'total' => null);
        foreach (array_keys($totals) as $key) {
            if (isset($given[$key]) && is_numeric($given[$key])) {
                $totals[$key] = round((float) $given[$key], 2);
            }
        }
        if ($totals['total'] === null) {
            $sum = null;
            foreach (self::describe($cart) as $item) {
                if ($item['price'] !== null) {
                    $sum = ($sum === null ? 0.0 : $sum) + ($item['price'] * max(1, (int) $item['quantity']));
                }
            }
            if ($sum !== null) {
                $totals['total'] = round($sum, 2);
            }
        }
        return $totals;
    }

    private static function ksortRecursive(array &$array)
    {
        ksort($array);
        foreach ($array as &$value) {
            if (is_array($value)) {
                self::ksortRecursive($value);
            }
        }
    }
}
