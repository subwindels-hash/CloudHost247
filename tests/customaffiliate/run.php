<?php
/**
 * Custom Affiliate Commission - behaviour diagnostics.
 *
 * Same style as the other harnesses in tests/: no PHPUnit, no database, no
 * WHMCS runtime. The commission rules are pure functions, so the money logic
 * itself is fully covered here.
 */

$root = dirname(__DIR__, 2);
$module = $root . '/modules/addons/customaffiliate';

require_once $module . '/bootstrap.php';

use CustomAffiliate\Installer;
use CustomAffiliate\Rules;
use CustomAffiliate\Settings;

/**
 * Baseline context: a referred, brand new client paying their first hosting
 * invoice of 100.00 with the module configured as the brief describes.
 *
 * @param  array<string,mixed> $overrides
 * @return array<string,mixed>
 */
function ca_context(array $overrides = []): array
{
    return array_merge([
        'enabled'          => true,
        'allowedGroups'    => [2],
        'productGroupId'   => 2,
        'serviceId'        => 1001,
        'affiliateId'      => 7,
        'baseAmount'       => 100.00,
        'minimumBase'      => 0.01,
        'alreadyPaid'      => false,
        'firstPaid'        => false,
        'clientWasNew'     => true,
        'requireNewClient' => true,
        'firstRate'        => 50.0,
        'recurringRate'    => 20.0,
    ], $overrides);
}

$tests = [];

/* ------------------------------------------------------------------ rules */

$tests['first payment on hosting earns 50%'] = static function () {
    $decision = Rules::decide(ca_context());

    return $decision['eligible']
        && $decision['type'] === Rules::TYPE_FIRST
        && $decision['rate'] === 50.0
        && $decision['amount'] === 50.00
        ?: 'got ' . json_encode($decision);
};

$tests['renewal of the same service earns 20%'] = static function () {
    $decision = Rules::decide(ca_context(['firstPaid' => true]));

    return $decision['eligible']
        && $decision['type'] === Rules::TYPE_RECURRING
        && $decision['amount'] === 20.00
        ?: 'got ' . json_encode($decision);
};

$tests['configured rates are honoured, not hardcoded'] = static function () {
    $first = Rules::decide(ca_context(['firstRate' => 35.5]));
    $recurring = Rules::decide(ca_context(['firstPaid' => true, 'recurringRate' => 12.25]));

    return $first['amount'] === 35.50 && $recurring['amount'] === 12.25
        ?: 'got ' . $first['amount'] . ' / ' . $recurring['amount'];
};

$tests['products outside the configured group earn nothing'] = static function () {
    // Domain (group 1), RDP (group 5), SSL (group 9) while only group 2 pays.
    foreach ([1, 5, 9, 0] as $groupId) {
        $decision = Rules::decide(ca_context(['productGroupId' => $groupId]));

        if ($decision['eligible'] || $decision['reason'] !== Rules::REASON_GROUP_EXCLUDED) {
            return 'group ' . $groupId . ' should be excluded, got ' . json_encode($decision);
        }
    }

    return true;
};

$tests['multiple hosting groups can be commissionable'] = static function () {
    $decision = Rules::decide(ca_context(['allowedGroups' => [2, 4, 11], 'productGroupId' => 11]));

    return $decision['eligible'] ?: 'group 11 should be allowed';
};

$tests['no configured group means no commission at all'] = static function () {
    $decision = Rules::decide(ca_context(['allowedGroups' => []]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_NO_GROUPS
        ?: 'fail-closed behaviour missing';
};

$tests['unreferred services earn nothing'] = static function () {
    $decision = Rules::decide(ca_context(['affiliateId' => 0]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_NO_AFFILIATE
        ?: 'got ' . json_encode($decision);
};

$tests['line items that are not services are ignored'] = static function () {
    $decision = Rules::decide(ca_context(['serviceId' => 0]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_NOT_A_SERVICE
        ?: 'got ' . json_encode($decision);
};

$tests['a duplicate payout is refused'] = static function () {
    $decision = Rules::decide(ca_context(['alreadyPaid' => true]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_DUPLICATE
        ?: 'duplicate guard missing';
};

$tests['zero and sub-minimum amounts are refused'] = static function () {
    foreach ([0.0, -25.0, 0.004] as $amount) {
        $decision = Rules::decide(ca_context(['baseAmount' => $amount]));

        if ($decision['eligible']) {
            return 'amount ' . $amount . ' should not earn commission';
        }
    }

    return true;
};

$tests['a disabled module never pays'] = static function () {
    $decision = Rules::decide(ca_context(['enabled' => false]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_DISABLED ?: 'disabled switch ignored';
};

$tests['a zero rate never pays'] = static function () {
    $decision = Rules::decide(ca_context(['firstRate' => 0]));

    return !$decision['eligible'] && $decision['reason'] === Rules::REASON_ZERO_RATE ?: 'zero rate paid out';
};

$tests['existing clients only get the recurring rate when required'] = static function () {
    $strict = Rules::decide(ca_context(['clientWasNew' => false]));
    $relaxed = Rules::decide(ca_context(['clientWasNew' => false, 'requireNewClient' => false]));

    return $strict['type'] === Rules::TYPE_RECURRING
        && $strict['amount'] === 20.00
        && $relaxed['type'] === Rules::TYPE_FIRST
        && $relaxed['amount'] === 50.00
        ?: 'got ' . json_encode([$strict, $relaxed]);
};

$tests['first commission is earned exactly once per service'] = static function () {
    // Payment 1 -> first, payments 2..4 -> recurring.
    $firstPaid = false;
    $sequence = [];

    for ($payment = 1; $payment <= 4; $payment++) {
        $decision = Rules::decide(ca_context(['firstPaid' => $firstPaid]));
        $sequence[] = $decision['type'];

        if ($decision['type'] === Rules::TYPE_FIRST) {
            $firstPaid = true;
        }
    }

    return $sequence === ['first', 'recurring', 'recurring', 'recurring']
        ?: implode(',', $sequence);
};

$tests['an upgrade after the first payment is a recurring payment'] = static function () {
    // The upgrade invoice resolves to the same service, whose ledger already
    // has first_commission_paid = 1.
    $decision = Rules::decide(ca_context(['firstPaid' => true, 'baseAmount' => 40.00]));

    return $decision['type'] === Rules::TYPE_RECURRING && $decision['amount'] === 8.00
        ?: 'got ' . json_encode($decision);
};

$tests['a refunded first payment lets the next payment earn it again'] = static function () {
    // Reversal clears the ledger flag, so the decision reverts to 'first'.
    $afterReversal = Rules::decide(ca_context(['firstPaid' => false]));

    return $afterReversal['type'] === Rules::TYPE_FIRST && $afterReversal['amount'] === 50.00
        ?: 'got ' . json_encode($afterReversal);
};

$tests['commission rounds to cents'] = static function () {
    return Rules::commission(19.99, 20.0) === 4.00
        && Rules::commission(10.01, 20.0) === 2.00
        && Rules::commission(0.02, 50.0) === 0.01
        && Rules::commission(30.00, 50.0) === 15.00
        && Rules::commission(100.0, 0.0) === 0.0
        && Rules::commission(-5.0, 50.0) === 0.0;
};

/* ------------------------------------------------------- discount handling */

$tests['invoice discounts are spread proportionally'] = static function () {
    $adjusted = Rules::distributeDiscount([10 => 75.00, 11 => 25.00], 20.00);

    return $adjusted[10] === 60.00 && $adjusted[11] === 20.00 ?: json_encode($adjusted);
};

$tests['a discount never pushes a base below zero'] = static function () {
    $adjusted = Rules::distributeDiscount([1 => 50.00], 500.00);

    return $adjusted[1] === 0.00 ?: json_encode($adjusted);
};

$tests['no discount leaves the bases untouched'] = static function () {
    $adjusted = Rules::distributeDiscount([1 => 19.99, 2 => 5.00], 0.0);

    return $adjusted[1] === 19.99 && $adjusted[2] === 5.00 ?: json_encode($adjusted);
};

$tests['discounted first payment commissions the discounted amount'] = static function () {
    $bases = Rules::distributeDiscount([1 => 100.00], 30.00);
    $decision = Rules::decide(ca_context(['baseAmount' => $bases[1]]));

    return $decision['amount'] === 35.00 ?: 'got ' . $decision['amount'];
};

/* --------------------------------------------------------------- settings */

$tests['product group ids parse from any CSV shape'] = static function () {
    return Settings::parseGroupIds('2') === [2]
        && Settings::parseGroupIds('2,4, 11') === [2, 4, 11]
        && Settings::parseGroupIds('2,2,4') === [2, 4]
        && Settings::parseGroupIds('') === []
        && Settings::parseGroupIds('abc') === []
        && Settings::parseGroupIds('0,-3,5') === [3, 5];
};

$tests['rates are clamped to 0-100'] = static function () {
    return Settings::normaliseRate('50', 0.0) === 50.0
        && Settings::normaliseRate('150', 0.0) === 100.0
        && Settings::normaliseRate('-10', 0.0) === 0.0
        && Settings::normaliseRate('', 20.0) === 20.0
        && Settings::normaliseRate('not a number', 20.0) === 20.0
        && Settings::normaliseRate('12.345', 0.0) === 12.345;
};

$tests['defaults match the documented commission structure'] = static function () {
    return Settings::DEFAULTS['first_commission_percent'] === '50'
        && Settings::DEFAULTS['recurring_commission_percent'] === '20'
        && Settings::DEFAULTS['exclusive_mode'] === '1'
        && Settings::DEFAULTS['product_group_ids'] === '';
};

/* -------------------------------------------------------------- structure */

$tests['module files are all present'] = static function () use ($module) {
    $files = [
        'customaffiliate.php', 'bootstrap.php', 'hooks.php', 'utilities.php', 'README.md',
        'install/schema.sql',
        'lib/Admin.php', 'lib/Affiliates.php', 'lib/Catalog.php', 'lib/CommissionEngine.php',
        'lib/Installer.php', 'lib/Ledger.php', 'lib/Logger.php', 'lib/Rules.php',
        'lib/ServiceChange.php', 'lib/Settings.php',
    ];

    foreach ($files as $file) {
        if (!is_file($module . '/' . $file)) {
            return 'missing ' . $file;
        }
    }

    return true;
};

$tests['every admin page has a template'] = static function () use ($module) {
    foreach (array_keys(\CustomAffiliate\Admin::PAGES) as $page) {
        if (!is_file($module . '/templates/admin/' . $page . '.tpl')) {
            return 'missing template ' . $page;
        }
    }

    return true;
};

$tests['required WHMCS entry points are declared'] = static function () use ($module) {
    $source = (string) file_get_contents($module . '/customaffiliate.php');

    foreach (['_config', '_activate', '_deactivate', '_upgrade', '_output'] as $suffix) {
        if (strpos($source, 'function customaffiliate' . $suffix . '(') === false) {
            return 'missing customaffiliate' . $suffix . '()';
        }
    }

    return true;
};

$tests['hooks use the documented WHMCS parameter names'] = static function () use ($module) {
    $source = (string) file_get_contents($module . '/hooks.php');

    // WHMCS passes 'invoiceid' (lower case d) - 'invoiceId' silently yields null.
    if (strpos($source, "\$vars['invoiceId']") !== false) {
        return "hooks.php reads \$vars['invoiceId']; WHMCS provides 'invoiceid'";
    }

    foreach (['InvoicePaid', 'InvoiceRefunded', 'InvoiceCancelled', 'AffiliateCommission'] as $hook) {
        if (strpos($source, "add_hook('" . $hook . "'") === false) {
            return 'hook not registered: ' . $hook;
        }
    }

    return true;
};

$tests['AffiliateCommission returns the supported override keys'] = static function () use ($module) {
    $source = (string) file_get_contents($module . '/hooks.php');

    // The hook only accepts boolean skipCommission / payout; returning a float
    // (as the 1.x module did) has no effect at all.
    return strpos($source, "'skipCommission' => true") !== false
        ?: 'AffiliateCommission must return skipCommission to suppress the default rate';
};

$tests['referrals are read from tblaffiliatesaccounts, not guessed'] = static function () use ($module) {
    $gateway = (string) file_get_contents($module . '/lib/Affiliates.php');

    if (strpos($gateway, 'tblaffiliatesaccounts') === false) {
        return 'the affiliate gateway must resolve referrals from tblaffiliatesaccounts';
    }

    foreach (glob($module . '/lib/*.php') as $file) {
        $source = (string) file_get_contents($file);

        // tblclients has no affiliateid column; relying on it silently pays the
        // wrong person (or nobody).
        if (preg_match('/tblclients[^;]{0,200}affiliateid/s', $source)) {
            return basename($file) . ' resolves the affiliate from tblclients';
        }
    }

    return true;
};

$tests['commission is credited to the real WHMCS affiliate tables'] = static function () use ($module) {
    $gateway = (string) file_get_contents($module . '/lib/Affiliates.php');

    foreach (['tblaffiliatespending', 'tblaffiliateshistory', 'tblaffiliates'] as $table) {
        if (strpos($gateway, $table) === false) {
            return 'no integration with ' . $table;
        }
    }

    return true;
};

$tests['the payout table has a duplicate-proof unique key'] = static function () use ($module) {
    $schema = (string) file_get_contents($module . '/install/schema.sql');

    return preg_match('/UNIQUE KEY\s+`invoice_item_unique`\s*\(`invoice_id`,\s*`invoice_item_id`\)/', $schema) === 1
        ?: 'mod_customaffiliate_payouts must be unique on (invoice_id, invoice_item_id)';
};

$tests['the ledger table carries the required columns'] = static function () use ($module) {
    $schema = (string) file_get_contents($module . '/install/schema.sql');

    foreach (['`service_id`', '`affiliate_id`', '`first_commission_paid`'] as $column) {
        if (strpos($schema, $column) === false) {
            return 'schema is missing ' . $column;
        }
    }

    return strpos($schema, 'svc_aff_unique') !== false ?: 'ledger must be unique per service/affiliate';
};

$tests['schema statements split cleanly'] = static function () {
    $statements = Installer::splitStatements(
        "-- comment\nCREATE TABLE a (id INT);\n\n-- another\nALTER TABLE a ADD COLUMN b INT;\n"
    );

    return count($statements) === 2
        && strpos($statements[0], 'CREATE TABLE a') === 0
        && strpos($statements[1], 'ALTER TABLE a') === 0
        ?: json_encode($statements);
};

$tests['no legacy WHMCS database helpers are used'] = static function () use ($module) {
    $banned = ['select_query(', 'full_query(', 'update_query(', 'insert_query(', 'mysql_fetch_assoc(', 'db_escape_string('];

    $iterator = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($module));

    foreach ($iterator as $file) {
        if (!$file->isFile() || !in_array($file->getExtension(), ['php', 'tpl'], true)) {
            continue;
        }

        $source = (string) file_get_contents($file->getPathname());

        foreach ($banned as $needle) {
            if (strpos($source, $needle) !== false) {
                return $needle . ' used in ' . $file->getFilename();
            }
        }
    }

    return true;
};

$tests['every rejection reason has an explanation'] = static function () {
    $reflection = new ReflectionClass(Rules::class);

    foreach ($reflection->getConstants() as $name => $value) {
        if (strpos($name, 'REASON_') !== 0) {
            continue;
        }

        if (Rules::explain($value) === $value) {
            return 'no explanation for ' . $value;
        }
    }

    return true;
};

/* ----------------------------------------------------------------- runner */

$failures = 0;

foreach ($tests as $name => $test) {
    try {
        $result = $test();
    } catch (Throwable $e) {
        $result = 'threw ' . get_class($e) . ': ' . $e->getMessage();
    }

    if ($result === true) {
        echo "PASS  {$name}\n";
        continue;
    }

    $failures++;
    echo "FAIL  {$name}" . (is_string($result) ? " - {$result}" : '') . "\n";
}

echo "\n" . (count($tests) - $failures) . '/' . count($tests) . " customaffiliate checks passed\n";

exit($failures === 0 ? 0 : 1);
