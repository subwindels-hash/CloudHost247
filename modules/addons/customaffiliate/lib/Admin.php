<?php
/**
 * Admin area controller.
 *
 * Four pages: Dashboard, Settings, Commissions (payout log) and Ledger
 * (per-service state). Templates are plain PHP includes under templates/admin
 * and receive already-prepared variables.
 *
 * @package    WHMCS
 * @subpackage CustomAffiliate
 */

namespace CustomAffiliate;

use WHMCS\Database\Capsule;

class Admin
{
    /** @var array<string,string> action => page title */
    const PAGES = [
        'dashboard'   => 'Dashboard',
        'settings'    => 'Settings',
        'commissions' => 'Commissions',
        'ledger'      => 'Service ledger',
        'logs'        => 'Audit log',
    ];

    /** @var array<string,mixed> */
    private $vars;

    /**
     * @param array<string,mixed> $vars WHMCS addon module vars
     */
    public function __construct(array $vars)
    {
        $this->vars = $vars;
    }

    public function render(): string
    {
        $action = (string) ($_GET['action'] ?? 'dashboard');

        if (!array_key_exists($action, self::PAGES)) {
            $action = 'dashboard';
        }

        $notice = null;

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            $notice = $this->handlePost($action);
        }

        $data = ['vars' => $this->vars, 'action' => $action, 'notice' => $notice];

        switch ($action) {
            case 'settings':
                $data += $this->settingsData();
                break;

            case 'commissions':
                $data += $this->commissionsData();
                break;

            case 'ledger':
                $data += $this->ledgerData();
                break;

            case 'logs':
                $data += $this->logsData();
                break;

            default:
                $data += $this->dashboardData();
                break;
        }

        return $this->nav($action) . $this->template($action, $data);
    }

    /* ==================================================================
     | Page data
     * ================================================================= */

    /**
     * @return array<string,mixed>
     */
    private function dashboardData(): array
    {
        $groups = Catalog::productGroups();
        $selected = Settings::productGroupIds();
        $names = [];

        foreach ($selected as $groupId) {
            $names[] = ($groups[$groupId] ?? 'Unknown') . ' (#' . $groupId . ')';
        }

        return [
            'totals'         => CommissionEngine::totals(),
            'warnings'       => Installer::healthWarnings(),
            'groupNames'     => $names,
            'firstRate'      => Settings::firstRate(),
            'recurringRate'  => Settings::recurringRate(),
            'delayDays'      => Settings::commissionDelayDays(),
            'exclusive'      => Settings::isExclusive(),
            'enabled'        => Settings::isEnabled(),
            'recentPayouts'  => CommissionEngine::payouts([], 15),
            'tables'         => Installer::tableStatus(),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function settingsData(): array
    {
        return [
            'settings'      => Settings::all(),
            'groups'        => Catalog::productGroups(),
            'selected'      => Settings::productGroupIds(),
            'whmcsDelay'    => Settings::commissionDelayDays(),
            'affiliatesOn'  => Affiliates::systemEnabled(),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function commissionsData(): array
    {
        $filters = [
            'affiliate_id'    => (int) ($_GET['affiliate_id'] ?? 0),
            'service_id'      => (int) ($_GET['service_id'] ?? 0),
            'invoice_id'      => (int) ($_GET['invoice_id'] ?? 0),
            'commission_type' => in_array($_GET['commission_type'] ?? '', ['first', 'recurring'], true)
                ? (string) $_GET['commission_type']
                : '',
            'status'          => in_array($_GET['status'] ?? '', ['pending', 'credited', 'reversed'], true)
                ? (string) $_GET['status']
                : '',
            'from'            => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['from'] ?? '')) ? (string) $_GET['from'] : '',
            'to'              => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) ($_GET['to'] ?? '')) ? (string) $_GET['to'] : '',
        ];

        return [
            'filters' => $filters,
            'payouts' => CommissionEngine::payouts($filters, 250),
            'totals'  => CommissionEngine::totals($filters),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function ledgerData(): array
    {
        $filters = [
            'affiliate_id' => (int) ($_GET['affiliate_id'] ?? 0),
            'service_id'   => (int) ($_GET['service_id'] ?? 0),
            'first_paid'   => in_array($_GET['first_paid'] ?? '', ['0', '1'], true) ? (string) $_GET['first_paid'] : '',
        ];

        return [
            'filters' => $filters,
            'rows'    => Ledger::search($filters, 250),
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function logsData(): array
    {
        $level = in_array($_GET['level'] ?? '', ['debug', 'info', 'warning', 'error'], true)
            ? (string) $_GET['level']
            : '';

        return [
            'level' => $level,
            'logs'  => Logger::recent(200, $level),
        ];
    }

    /* ==================================================================
     | POST handling
     * ================================================================= */

    /**
     * @return array{type:string,message:string}|null
     */
    private function handlePost(string $action): ?array
    {
        if (!$this->verifyToken()) {
            return ['type' => 'danger', 'message' => 'Security token mismatch - nothing was saved.'];
        }

        if ($action === 'settings') {
            return $this->saveSettings($_POST);
        }

        if ($action === 'ledger' && ($_POST['operation'] ?? '') === 'reset_first') {
            return $this->resetFirstCommission((int) ($_POST['ledger_id'] ?? 0));
        }

        if ($action === 'commissions' && ($_POST['operation'] ?? '') === 'reverse') {
            return $this->reversePayout((int) ($_POST['payout_id'] ?? 0));
        }

        return null;
    }

    /**
     * @param  array<string,mixed> $post
     * @return array{type:string,message:string}
     */
    private function saveSettings(array $post): array
    {
        $groups = array_map('intval', (array) ($post['product_group_ids'] ?? []));
        $groups = array_values(array_filter(array_unique($groups), static function ($id) {
            return $id > 0;
        }));

        Settings::setMany([
            'enabled'                      => isset($post['enabled']) ? '1' : '0',
            'exclusive_mode'               => isset($post['exclusive_mode']) ? '1' : '0',
            'require_new_client'           => isset($post['require_new_client']) ? '1' : '0',
            'apply_discounts'              => isset($post['apply_discounts']) ? '1' : '0',
            'reverse_on_refund'            => isset($post['reverse_on_refund']) ? '1' : '0',
            'reverse_on_cancel'            => isset($post['reverse_on_cancel']) ? '1' : '0',
            'debug_logging'                => isset($post['debug_logging']) ? '1' : '0',
            'product_group_ids'            => implode(',', $groups),
            'first_commission_percent'     => (string) Settings::normaliseRate($post['first_commission_percent'] ?? null, 50.0),
            'recurring_commission_percent' => (string) Settings::normaliseRate($post['recurring_commission_percent'] ?? null, 20.0),
            'minimum_base_amount'          => (string) max(0, round((float) ($post['minimum_base_amount'] ?? 0.01), 2)),
            'commission_delay_days'        => ($post['commission_delay_days'] ?? '') === ''
                ? ''
                : (string) max(0, (int) $post['commission_delay_days']),
            'log_retention_days'           => (string) max(0, (int) ($post['log_retention_days'] ?? 180)),
        ]);

        Settings::clearCache();

        Logger::info('Settings updated', [
            'action' => 'settings_saved',
            'groups' => $groups,
            'first'  => Settings::firstRate(),
            'recur'  => Settings::recurringRate(),
        ]);

        return ['type' => 'success', 'message' => 'Settings saved.'];
    }

    /**
     * @return array{type:string,message:string}
     */
    private function resetFirstCommission(int $ledgerId): array
    {
        if ($ledgerId <= 0) {
            return ['type' => 'danger', 'message' => 'Invalid ledger row.'];
        }

        try {
            Capsule::table(Ledger::TABLE)->where('id', $ledgerId)->update([
                'first_commission_paid'        => 0,
                'first_commission_reversed_at' => date('Y-m-d H:i:s'),
                'updated_at'                   => date('Y-m-d H:i:s'),
            ]);

            Ledger::note($ledgerId, 'First-payment flag reset manually by an administrator.');

            Logger::warning('First commission flag reset by admin', [
                'action'    => 'manual_reset',
                'ledger_id' => $ledgerId,
            ]);

            return [
                'type'    => 'success',
                'message' => 'First-payment flag cleared. The next paid invoice for that service will earn the first-payment rate.',
            ];
        } catch (\Throwable $e) {
            return ['type' => 'danger', 'message' => 'Could not reset the flag: ' . $e->getMessage()];
        }
    }

    /**
     * @return array{type:string,message:string}
     */
    private function reversePayout(int $payoutId): array
    {
        if ($payoutId <= 0) {
            return ['type' => 'danger', 'message' => 'Invalid payout.'];
        }

        try {
            $payout = Capsule::table(CommissionEngine::PAYOUTS_TABLE)->where('id', $payoutId)->first();

            if (!$payout || $payout->status === 'reversed') {
                return ['type' => 'danger', 'message' => 'That payout does not exist or is already reversed.'];
            }

            $ok = (new CommissionEngine())->reversePayout($payout, 'manual admin reversal');

            return $ok
                ? ['type' => 'success', 'message' => 'Commission reversed.']
                : ['type' => 'danger', 'message' => 'Reversal failed - see the audit log.'];
        } catch (\Throwable $e) {
            return ['type' => 'danger', 'message' => 'Reversal failed: ' . $e->getMessage()];
        }
    }

    /* ==================================================================
     | Rendering helpers
     * ================================================================= */

    private function nav(string $active): string
    {
        $link = (string) ($this->vars['modulelink'] ?? '');
        $html = '<ul class="nav nav-tabs admin-tabs" style="margin-bottom:15px;">';

        foreach (self::PAGES as $page => $label) {
            $html .= '<li class="' . ($page === $active ? 'active' : '') . '">'
                . '<a href="' . htmlspecialchars($link, ENT_QUOTES, 'UTF-8') . '&amp;action=' . $page . '">'
                . htmlspecialchars($label, ENT_QUOTES, 'UTF-8')
                . '</a></li>';
        }

        return $html . '</ul>';
    }

    /**
     * @param array<string,mixed> $data
     */
    private function template(string $page, array $data): string
    {
        $file = CUSTOMAFFILIATE_ROOT . '/templates/admin/' . $page . '.tpl';

        if (!is_file($file)) {
            return '<div class="alert alert-danger">Template not found: ' . htmlspecialchars($page, ENT_QUOTES, 'UTF-8') . '</div>';
        }

        extract($data, EXTR_SKIP);

        ob_start();
        include $file;

        return (string) ob_get_clean();
    }

    /* ==================================================================
     | CSRF
     * ================================================================= */

    public static function token(): string
    {
        if (function_exists('generate_token')) {
            return (string) generate_token('plain');
        }

        if (empty($_SESSION['customaffiliate_token'])) {
            $_SESSION['customaffiliate_token'] = bin2hex(random_bytes(16));
        }

        return (string) $_SESSION['customaffiliate_token'];
    }

    public static function tokenField(): string
    {
        return '<input type="hidden" name="token" value="' . htmlspecialchars(self::token(), ENT_QUOTES, 'UTF-8') . '">';
    }

    private function verifyToken(): bool
    {
        $presented = (string) ($_POST['token'] ?? '');

        if ($presented === '') {
            return false;
        }

        return hash_equals(self::token(), $presented);
    }
}
