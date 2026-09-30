<?php
/**
 * Cryptocurrency transactions admin view (spec §25–§26).
 *
 * Read-only listing over the EXISTING blockonomics_orders table joined to the existing WHMCS
 * invoice/client/payment records — no duplicate transaction store. Statuses are normalized
 * through StatusMapper; "Paid" is only shown when a WHMCS payment record actually exists.
 * There is deliberately NO "mark as paid" control here (spec §27): financial adjustments go
 * through the existing WHMCS accounting workflows, never through this screen.
 */

namespace CloudHost247\Payments\Services;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Payments\Support\StatusMapper;
use Blockonomics\GatewaySettings;
use WHMCS\Database\Capsule;

final class TransactionsView
{
    const MODULE = 'cloudhost247_payments';
    const PER_PAGE = 50;

    public function handle()
    {
        AdminGuard::requireCapability(self::MODULE, 'payments.crypto.view');

        $e = function ($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); };
        $settings = GatewaySettings::loadSettings();
        $confirmations = isset($settings['Confirmations']) && $settings['Confirmations'] !== '' ? (int) $settings['Confirmations'] : 2;
        $timePeriod = isset($settings['TimePeriod']) && $settings['TimePeriod'] !== '' ? (int) $settings['TimePeriod'] : 10;

        // ------------------------------------------------------------------ filters (GET)
        $search = isset($_GET['search']) ? trim((string) $_GET['search']) : '';
        $currency = isset($_GET['currency']) && in_array($_GET['currency'], GatewaySettings::supportedCurrencyCodes(), true)
            ? (string) $_GET['currency'] : '';
        $statusFilter = isset($_GET['status']) && in_array($_GET['status'], StatusMapper::labels(), true)
            ? (string) $_GET['status'] : '';
        $dateFrom = isset($_GET['date_from']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $_GET['date_from']) ? (string) $_GET['date_from'] : '';
        $dateTo = isset($_GET['date_to']) && preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $_GET['date_to']) ? (string) $_GET['date_to'] : '';
        $page = isset($_GET['tx_page']) ? max(1, (int) $_GET['tx_page']) : 1;

        $query = Capsule::table('blockonomics_orders as bo')
            ->leftJoin('tblinvoices as i', 'i.id', '=', 'bo.id_order')
            ->leftJoin('tblclients as c', 'c.id', '=', 'i.userid')
            ->select('bo.*', 'i.userid as client_id', 'i.status as invoice_status', 'c.firstname', 'c.lastname', 'c.email');

        if ($currency !== '') {
            $query->where('bo.blockonomics_currency', $currency);
        }
        if ($dateFrom !== '') {
            $query->where('bo.timestamp', '>=', strtotime($dateFrom . ' 00:00:00'));
        }
        if ($dateTo !== '') {
            $query->where('bo.timestamp', '<=', strtotime($dateTo . ' 23:59:59'));
        }
        if ($search !== '') {
            $like = '%' . str_replace(array('%', '_'), array('\\%', '\\_'), $search) . '%';
            $query->where(function ($q) use ($like, $search) {
                $q->where('bo.txid', 'like', $like)
                    ->orWhere('bo.addr', 'like', $like)
                    ->orWhere('c.email', 'like', $like);
                if (ctype_digit($search)) {
                    $q->orWhere('bo.id_order', (int) $search);
                }
            });
        }

        $rows = $query->orderBy('bo.timestamp', 'desc')
            ->offset(($page - 1) * self::PER_PAGE)
            ->limit(self::PER_PAGE + 1)
            ->get();
        $rows = is_array($rows) ? $rows : iterator_to_array($rows);
        $hasNext = count($rows) > self::PER_PAGE;
        $rows = array_slice($rows, 0, self::PER_PAGE);

        $now = time();
        $networkLabel = GatewaySettings::usdtNetworkLabelFrom($settings);

        $html  = '<h2>Cryptocurrency Transactions</h2>';
        $html .= '<p class="text-muted">Existing Blockonomics order records (read-only). "Paid" reflects a verified WHMCS payment record — never a browser status. '
               . '<a href="addonmodules.php?module=cloudhost247_payments">&larr; Blockonomics settings</a></p>';

        // filter bar
        $html .= '<form method="get" class="form-inline" style="margin-bottom:12px;">'
               . '<input type="hidden" name="module" value="cloudhost247_payments"><input type="hidden" name="view" value="transactions">'
               . '<input class="form-control" name="search" placeholder="Txn ID / address / invoice # / email" value="' . $e($search) . '" style="width:280px;"> '
               . '<select class="form-control" name="currency"><option value="">All currencies</option>';
        foreach (array('btc' => 'BTC', 'bch' => 'BCH', 'usdt' => 'USDT') as $code => $label) {
            $html .= '<option value="' . $code . '"' . ($currency === $code ? ' selected' : '') . '>' . $label . '</option>';
        }
        $html .= '</select> <select class="form-control" name="status"><option value="">All statuses</option>';
        foreach (StatusMapper::labels() as $label) {
            $html .= '<option' . ($statusFilter === $label ? ' selected' : '') . '>' . $label . '</option>';
        }
        $html .= '</select> <input class="form-control" type="date" name="date_from" value="' . $e($dateFrom) . '"> '
               . '<input class="form-control" type="date" name="date_to" value="' . $e($dateTo) . '"> '
               . '<button class="btn btn-default" type="submit">Filter</button></form>';

        $html .= '<table class="table table-striped"><tr>'
               . '<th>Created</th><th>Invoice</th><th>Customer</th><th>Currency</th><th>Network</th>'
               . '<th>Expected</th><th>Received</th><th>Address</th><th>Transaction</th><th>Status</th><th>Invoice state</th></tr>';

        $shown = 0;
        foreach ($rows as $row) {
            $code = (string) $row->blockonomics_currency;
            $decimals = $code === 'usdt' ? 6 : 8;
            $divisor = pow(10, $decimals);
            $hasPayment = $this->hasWhmcsPayment((string) $row->addr);
            $status = StatusMapper::map(
                $row->status,
                (string) $row->txid,
                (int) $row->timestamp,
                $timePeriod,
                $confirmations,
                $hasPayment,
                (float) $row->bits,
                (float) $row->bits_payed,
                $now
            );
            if ($statusFilter !== '' && $status !== $statusFilter) {
                continue;
            }
            $shown++;
            $statusClass = array(
                StatusMapper::PAID => 'label-success',
                StatusMapper::CONFIRMING => 'label-info',
                StatusMapper::PENDING => 'label-default',
                StatusMapper::UNDERPAID => 'label-warning',
                StatusMapper::EXPIRED => 'label-danger',
            );
            $customer = trim((isset($row->firstname) ? $row->firstname : '') . ' ' . (isset($row->lastname) ? $row->lastname : ''));
            $html .= '<tr>'
                . '<td>' . $e(date('Y-m-d H:i', (int) $row->timestamp)) . '</td>'
                . '<td><a href="invoices.php?action=edit&id=' . (int) $row->id_order . '">#' . (int) $row->id_order . '</a></td>'
                . '<td>' . ($customer !== '' ? $e($customer) . '<br><small>' . $e((string) $row->email) . '</small>' : '<em>&mdash;</em>') . '</td>'
                . '<td>' . $e(strtoupper($code)) . '</td>'
                . '<td>' . ($code === 'usdt' ? $e($networkLabel) : '&mdash;') . '</td>'
                . '<td>' . $e(rtrim(rtrim(number_format((float) $row->bits / $divisor, $decimals, '.', ''), '0'), '.')) . '</td>'
                . '<td>' . $e(rtrim(rtrim(number_format((float) $row->bits_payed / $divisor, $decimals, '.', ''), '0'), '.')) . '</td>'
                . '<td><code title="' . $e((string) $row->addr) . '">' . $e($this->truncate((string) $row->addr)) . '</code></td>'
                . '<td>' . ((string) $row->txid !== '' ? '<code title="' . $e((string) $row->txid) . '">' . $e($this->truncate((string) $row->txid)) . '</code>' : '<em>&mdash;</em>') . '</td>'
                . '<td><span class="label ' . (isset($statusClass[$status]) ? $statusClass[$status] : 'label-default') . '">' . $e($status) . '</span></td>'
                . '<td>' . $e((string) ($row->invoice_status ? $row->invoice_status : '&mdash;')) . '</td>'
                . '</tr>';
        }
        if ($shown === 0) {
            $html .= '<tr><td colspan="11"><em>No transactions match the current filters.</em></td></tr>';
        }
        $html .= '</table>';

        // pagination
        $base = 'addonmodules.php?module=cloudhost247_payments&view=transactions'
            . '&search=' . urlencode($search) . '&currency=' . urlencode($currency)
            . '&status=' . urlencode($statusFilter) . '&date_from=' . urlencode($dateFrom) . '&date_to=' . urlencode($dateTo);
        $html .= '<p>';
        if ($page > 1) { $html .= '<a class="btn btn-default btn-sm" href="' . $base . '&tx_page=' . ($page - 1) . '">&larr; Newer</a> '; }
        if ($hasNext) { $html .= '<a class="btn btn-default btn-sm" href="' . $base . '&tx_page=' . ($page + 1) . '">Older &rarr;</a>'; }
        $html .= '</p>';

        return $html;
    }

    /**
     * Whether a WHMCS payment record exists for this order's address. The callback appends the
     * payment address to the transaction id precisely so it is unique per order, which makes a
     * suffix match reliable here.
     */
    private function hasWhmcsPayment($address)
    {
        if ($address === '') {
            return false;
        }
        try {
            $row = Capsule::table('tblaccounts')
                ->where('gateway', GatewaySettings::GATEWAY_MODULE)
                ->where('transid', 'like', '%' . $address)
                ->first();
            return $row !== null;
        } catch (\Throwable $error) {
            return false; // fail closed: never display Paid on a lookup failure
        }
    }

    private function truncate($value)
    {
        return strlen($value) > 24 ? substr($value, 0, 12) . '…' . substr($value, -8) : $value;
    }
}
