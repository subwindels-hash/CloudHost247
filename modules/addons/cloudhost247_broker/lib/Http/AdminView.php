<?php
namespace CloudHost247\Broker\Http;

use CloudHost247\Broker\Domain\CaseStatus;
use CloudHost247\Broker\Domain\PaymentStatus;
use CloudHost247\Broker\Domain\TransferStatus;
use CloudHost247\Broker\Providers\ConnectionState;
use CloudHost247\Broker\Services\DomainDeliveryService;

/**
 * Super Admin dashboard renderer (requirement #5). Plain PHP output (matches
 * the rest of the platform's addon admin screens) — every dynamic value
 * passes through e(). GET requests never call a provider API; every figure
 * shown here was read straight from the database by AdminController.
 */
final class AdminView
{
    /** @param array $data from AdminController::handle() */
    public function render(array $data)
    {
        $this->nav($data['view']);
        if ($data['notice'] !== '') { echo '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>'; }
        if ($data['error'] !== '') { echo '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>'; }

        $view = $data['view'];
        if ($view === 'case_detail') { $this->renderCaseDetail($data); return; }
        if (isset($data['status_views'][$view])) { $this->renderCaseList($data); return; }

        $method = 'render' . str_replace(' ', '', ucwords(str_replace('_', ' ', $view)));
        if (!method_exists($this, $method)) { $method = 'renderOverview'; }
        $this->{$method}($data);
    }

    private function nav($active)
    {
        $items = array(
            'overview' => 'Overview', 'new_requests' => 'New Requests', 'manual_required' => 'Manual Required',
            'assigned' => 'Assigned', 'negotiations' => 'Negotiations', 'awaiting_customer' => 'Awaiting Customer',
            'awaiting_seller' => 'Awaiting Seller', 'agreements' => 'Agreements', 'payment_pending' => 'Payment Pending',
            'transfer_pending' => 'Transfer Pending', 'transfer_processing' => 'Transfer Processing',
            'completed' => 'Completed', 'cancelled' => 'Cancelled', 'failed' => 'Failed', 'disputed' => 'Disputed',
            'providers' => 'Providers', 'brokers' => 'Brokers', 'settings' => 'Settings', 'fees' => 'Fees',
            'reports' => 'Reports', 'audit_logs' => 'Audit Logs',
        );
        echo '<div class="module-settings"><h2>CloudHost247 Domain Brokerage</h2><ul class="nav nav-tabs" style="flex-wrap:wrap;">';
        foreach ($items as $key => $label) {
            echo '<li' . ($active === $key ? ' class="active"' : '') . '><a href="addonmodules.php?module=cloudhost247_broker&amp;view=' . $this->e($key) . '">' . $this->e($label) . '</a></li>';
        }
        echo '</ul><br></div>';
    }

    // ----------------------------------------------------------- overview / reports

    private function renderOverview(array $data)
    {
        $counts = $data['status_counts'];
        echo '<div class="row">';
        foreach (array('request_submitted' => 'New', 'negotiation' => 'Negotiating', 'payment_pending' => 'Payment Pending', 'transfer_processing' => 'Transferring', 'completed' => 'Completed', 'disputed' => 'Disputed') as $key => $label) {
            echo '<div class="col-sm-2"><div class="panel panel-' . ($key === 'disputed' && !empty($counts[$key]) ? 'danger' : 'info') . '"><div class="panel-heading"><h3 class="panel-title">' . $this->e($label) . '</h3></div><div class="panel-body"><h1>' . (int) (isset($counts[$key]) ? $counts[$key] : 0) . '</h1></div></div></div>';
        }
        echo '</div>';
        $rev = $data['revenue'];
        echo '<div class="row"><div class="col-sm-4"><div class="panel panel-default"><div class="panel-heading">Brokerage revenue (paid)</div><div class="panel-body"><h2>$' . number_format($rev['brokerage_revenue'], 2) . '</h2></div></div></div>';
        echo '<div class="col-sm-4"><div class="panel panel-default"><div class="panel-heading">Transfer fee revenue (paid)</div><div class="panel-body"><h2>$' . number_format($rev['transfer_revenue'], 2) . '</h2></div></div></div>';
        echo '<div class="col-sm-4"><div class="panel panel-default"><div class="panel-heading">Average requested budget</div><div class="panel-body"><h2>$' . number_format($data['average_acquisition'], 2) . '</h2></div></div></div></div>';
        echo '<h3>Recent cases</h3>';
        $this->casesTable($data['recent']['rows']);
    }

    private function renderReports(array $data)
    {
        echo '<h3>Status distribution</h3><table class="table table-striped"><tr><th>Status</th><th>Count</th></tr>';
        foreach (CaseStatus::all() as $status) {
            echo '<tr><td>' . $this->e(CaseStatus::label($status)) . '</td><td>' . (int) (isset($data['status_counts'][$status]) ? $data['status_counts'][$status] : 0) . '</td></tr>';
        }
        echo '</table>';
        $rev = $data['revenue'];
        echo '<h3>Revenue (from real, paid WHMCS invoices only)</h3><table class="table"><tr><th>Metric</th><th>Value</th></tr>'
            . '<tr><td>Brokerage fees collected</td><td>$' . number_format($rev['brokerage_revenue'], 2) . '</td></tr>'
            . '<tr><td>Transfer fees collected</td><td>$' . number_format($rev['transfer_revenue'], 2) . '</td></tr>'
            . '<tr><td>Total acquisition value paid</td><td>$' . number_format($rev['acquisition_total'], 2) . '</td></tr>'
            . '<tr><td>Paid cases</td><td>' . (int) $rev['paid_count'] . '</td></tr></table>';
        echo '<h3>Provider activity (case count by acquisition route)</h3><table class="table"><tr><th>Provider</th><th>Cases</th></tr>';
        foreach ($data['provider_activity'] as $key => $count) { echo '<tr><td>' . $this->e($key) . '</td><td>' . (int) $count . '</td></tr>'; }
        if (!$data['provider_activity']) { echo '<tr><td colspan="2"><em>No provider-routed cases yet — all cases have used the manual broker route.</em></td></tr>'; }
        echo '</table>';
    }

    // ----------------------------------------------------------- case list / detail

    private function renderCaseList(array $data)
    {
        $this->filterForm($data);
        $this->casesTable($data['results']['rows']);
        $this->pagination($data['results'], $data['view']);
    }

    private function filterForm(array $data)
    {
        $f = $data['filters'];
        echo '<form method="get" class="form-inline" style="margin-bottom:15px;"><input type="hidden" name="module" value="cloudhost247_broker"><input type="hidden" name="view" value="' . $this->e($data['view']) . '">';
        echo '<input class="form-control" name="case_number" placeholder="Case #" value="' . $this->e($f['case_number']) . '"> ';
        echo '<input class="form-control" name="domain" placeholder="Domain" value="' . $this->e($f['domain']) . '"> ';
        echo '<input class="form-control" name="q" placeholder="Search" value="' . $this->e($f['q']) . '"> ';
        echo '<button class="btn btn-default" type="submit">Filter</button></form>';
    }

    private function casesTable($rows)
    {
        echo '<table class="table table-striped"><thead><tr><th>Case #</th><th>Domain</th><th>Client</th><th>Status</th><th>Route</th><th>Budget</th><th>Payment</th><th>Transfer</th><th>Created</th><th></th></tr></thead><tbody>';
        $any = false;
        foreach ($rows as $case) {
            $any = true;
            echo '<tr' . (!empty($case->disputed) ? ' class="danger"' : '') . '>'
                . '<td>' . $this->e($case->case_number) . '</td><td>' . $this->e($case->domain) . '</td><td>' . (int) $case->client_id . '</td>'
                . '<td>' . $this->e(CaseStatus::label($case->status)) . '</td><td>' . $this->e($case->acquisition_route) . '</td>'
                . '<td>' . $this->e($case->currency) . ' ' . number_format($case->max_budget, 2) . '</td>'
                . '<td>' . $this->e(PaymentStatus::label($case->payment_status)) . '</td><td>' . $this->e(TransferStatus::label($case->transfer_status)) . '</td>'
                . '<td>' . $this->e($case->created_at) . '</td>'
                . '<td><a class="btn btn-xs btn-primary" href="addonmodules.php?module=cloudhost247_broker&amp;view=case_detail&amp;id=' . (int) $case->id . '">Open</a></td></tr>';
        }
        if (!$any) { echo '<tr><td colspan="10"><em>No cases match this view.</em></td></tr>'; }
        echo '</tbody></table>';
    }

    private function pagination($results, $view)
    {
        if ($results['pages'] <= 1) { return; }
        echo '<nav><ul class="pagination">';
        for ($p = 1; $p <= $results['pages']; $p++) {
            echo '<li' . ($p === $results['page'] ? ' class="active"' : '') . '><a href="addonmodules.php?module=cloudhost247_broker&amp;view=' . $this->e($view) . '&amp;page=' . $p . '">' . $p . '</a></li>';
        }
        echo '</ul></nav>';
    }

    private function renderCaseDetail(array $data)
    {
        $case = $data['case'];
        if (!$case) { echo '<div class="alert alert-warning">Case not found.</div>'; return; }
        $token = $data['token'];
        echo '<h3>' . $this->e($case->case_number) . ' — ' . $this->e($case->domain) . '</h3>';
        echo '<p><strong>Status:</strong> ' . $this->e(CaseStatus::label($case->status)) . ($case->disputed ? ' <span class="label label-danger">DISPUTED</span>' : '')
            . ' &nbsp; <strong>Route:</strong> ' . $this->e($case->acquisition_route) . ($case->provider_key ? ' (' . $this->e($case->provider_key) . ')' : '')
            . ' &nbsp; <strong>Registrar:</strong> ' . $this->e($case->registrar ?: 'Unknown')
            . ' &nbsp; <strong>Domain state:</strong> ' . $this->e($case->domain_status) . '</p>';
        echo '<p><strong>Max budget (confidential — never disclosed to the seller without consent):</strong> ' . $this->e($case->currency) . ' ' . number_format($case->max_budget, 2)
            . ($case->disclose_budget_to_seller ? ' <span class="label label-warning">customer authorized disclosure</span>' : ' <span class="label label-default">not authorized for disclosure</span>') . '</p>';
        echo '<p><strong>Payment status:</strong> ' . $this->e(PaymentStatus::label($case->payment_status)) . ' &nbsp; <strong>Transfer status:</strong> ' . $this->e(TransferStatus::label($case->transfer_status)) . '</p>';

        $this->actionForms($case, $token);

        echo '<h4>Timeline</h4><table class="table table-condensed"><tr><th>When</th><th>Actor</th><th>Event</th></tr>';
        foreach ($data['events'] as $event) {
            echo '<tr><td>' . $this->e($event->created_at) . '</td><td>' . $this->e($event->actor_type) . '</td><td>' . $this->e($event->summary) . ($event->visibility === 'internal' ? ' <span class="label label-default">internal</span>' : '') . '</td></tr>';
        }
        echo '</table>';

        echo '<h4>Offers &amp; counteroffers (immutable ledger)</h4><table class="table table-condensed"><tr><th>#</th><th>Kind</th><th>From</th><th>To</th><th>Amount</th><th>Status</th></tr>';
        foreach ($data['offers'] as $offer) {
            echo '<tr><td>' . (int) $offer->id . '</td><td>' . $this->e($offer->kind) . '</td><td>' . $this->e($offer->from_party) . '</td><td>' . $this->e($offer->to_party) . '</td>'
                . '<td>' . $this->e($offer->currency) . ' ' . number_format($offer->amount, 2) . '</td><td>' . $this->e($offer->derived_status) . '</td></tr>';
        }
        if (!$data['offers']) { echo '<tr><td colspan="6"><em>No offers recorded yet.</em></td></tr>'; }
        echo '</table>';

        echo '<h4>Messages</h4><table class="table table-condensed"><tr><th>When</th><th>Author</th><th>Visibility</th><th>Message</th></tr>';
        foreach ($data['messages'] as $message) {
            echo '<tr><td>' . $this->e($message->created_at) . '</td><td>' . $this->e($message->author_type) . '</td><td>' . $this->e($message->visibility) . '</td><td>' . $this->e($message->body) . '</td></tr>';
        }
        echo '</table>';

        echo '<h4>Payments</h4><table class="table table-condensed"><tr><th>Invoice</th><th>Acquisition</th><th>Brokerage fee</th><th>Transfer fee</th><th>Service fee</th><th>Total</th><th>Status</th></tr>';
        foreach ($data['payments'] as $payment) {
            echo '<tr><td>' . (int) $payment->whmcs_invoice_id . '</td><td>' . number_format($payment->acquisition_price, 2) . '</td><td>' . number_format($payment->brokerage_fee, 2) . '</td>'
                . '<td>' . number_format($payment->transfer_fee, 2) . '</td><td>' . number_format($payment->service_fee, 2) . '</td><td>' . number_format($payment->amount_total, 2) . '</td>'
                . '<td>' . $this->e(PaymentStatus::label($payment->status)) . '</td></tr>';
        }
        if (!$data['payments']) { echo '<tr><td colspan="7"><em>No invoice created yet.</em></td></tr>'; }
        echo '</table>';

        echo '<h4>Transfers &amp; delivery</h4><table class="table table-condensed"><tr><th>Status</th><th>Registrar</th><th>Provider ref.</th><th>Initiated</th><th>Verified</th><th>Completed</th><th>Delivery</th></tr>';
        foreach ($data['transfers'] as $transfer) {
            $deliveryStatus = DomainDeliveryService::statusOf($transfer);
            echo '<tr><td>' . $this->e(TransferStatus::label($transfer->status)) . '</td><td>' . $this->e($transfer->registrar) . '</td><td>' . $this->e($transfer->provider_reference) . '</td>'
                . '<td>' . $this->e($transfer->initiated_at) . '</td><td>' . $this->e($transfer->verified_at) . '</td><td>' . $this->e($transfer->completed_at) . '</td>'
                . '<td>' . $this->e(DomainDeliveryService::label($deliveryStatus))
                . (!empty($transfer->whmcs_domain_id) ? ' <small>(WHMCS domain #' . (int) $transfer->whmcs_domain_id . ')</small>' : '')
                . (!empty($transfer->delivery_note) && $deliveryStatus !== DomainDeliveryService::STATUS_ASSOCIATED ? '<br><small>' . $this->e($transfer->delivery_note) . '</small>' : '')
                . '</td></tr>';
        }
        if (!$data['transfers']) { echo '<tr><td colspan="7"><em>No transfer authorized yet.</em></td></tr>'; }
        echo '</table>';

        echo '<h4>Assignment history</h4><table class="table table-condensed"><tr><th>When</th><th>Admin</th><th>Action</th><th>By</th></tr>';
        foreach ($data['assignment_history'] as $row) {
            echo '<tr><td>' . $this->e($row->created_at) . '</td><td>' . (int) $row->admin_id . '</td><td>' . $this->e($row->action) . '</td><td>' . (int) $row->assigned_by_admin_id . '</td></tr>';
        }
        echo '</table>';
    }

    private function actionForms($case, $token)
    {
        $id = (int) $case->id;
        echo '<div class="panel panel-default"><div class="panel-heading">Case actions</div><div class="panel-body">';

        echo $this->form($id, $token, 'assign_broker', 'case_detail', '<input class="form-control" style="display:inline-block;width:140px;" name="admin_id" placeholder="Admin ID" required> <button class="btn btn-sm btn-primary" type="submit">Assign broker</button>');
        echo $this->form($id, $token, 'record_contact', 'case_detail', '<input class="form-control" style="display:inline-block;width:340px;" name="summary" placeholder="How the owner/registrar was contacted"> <button class="btn btn-sm btn-default" type="submit">Record contact attempt</button>');
        echo $this->form($id, $token, 'record_owner_response', 'case_detail', '<input class="form-control" style="display:inline-block;width:340px;" name="summary" placeholder="Summary of the response"> <button class="btn btn-sm btn-default" type="submit">Record owner response</button>');

        echo '<form method="post" style="margin-top:6px;">' . $this->hidden($id, $token, 'submit_offer', 'case_detail')
            . '<select name="kind" class="form-control" style="display:inline-block;width:120px;"><option value="offer">Offer</option><option value="counteroffer">Counteroffer</option></select> '
            . '<select name="from_party" class="form-control" style="display:inline-block;width:110px;"><option value="broker">Broker</option><option value="seller">Seller</option></select> '
            . '<select name="to_party" class="form-control" style="display:inline-block;width:110px;"><option value="customer">Customer</option><option value="seller">Seller</option></select> '
            . '<input name="amount" class="form-control" style="display:inline-block;width:120px;" placeholder="Amount" required> '
            . '<input name="currency" class="form-control" style="display:inline-block;width:80px;" value="' . $this->e($case->currency) . '"> '
            . '<button class="btn btn-sm btn-default" type="submit">Record offer</button></form>';

        echo $this->form($id, $token, 'add_note', 'case_detail', '<input class="form-control" style="display:inline-block;width:340px;" name="body" placeholder="Internal note"> <input type="hidden" name="visibility" value="internal"> <button class="btn btn-sm btn-default" type="submit">Add internal note</button>');

        if ($case->status === CaseStatus::OFFER_ACCEPTED) {
            echo $this->form($id, $token, 'create_invoice', 'case_detail', '<input class="form-control" style="display:inline-block;width:160px;" name="acquisition_price" placeholder="Acquisition price" required> <button class="btn btn-sm btn-success" type="submit">Create WHMCS invoice</button>');
        }
        if ($case->status === CaseStatus::PAYMENT_PENDING) {
            echo $this->form($id, $token, 'sync_payment', 'case_detail', '<button class="btn btn-sm btn-default" type="submit">Refresh payment status from WHMCS</button>');
            echo $this->form($id, $token, 'refund_payment', 'case_detail', '<input class="form-control" style="display:inline-block;width:280px;" name="reason" placeholder="Refund reason"> <button class="btn btn-sm btn-warning" type="submit">Mark refunded</button>');
        }
        if ($case->status === CaseStatus::TRANSFER_PENDING) {
            echo $this->form($id, $token, 'transfer_authorize', 'case_detail', '<button class="btn btn-sm btn-primary" type="submit">Authorize transfer</button>');
            echo $this->form($id, $token, 'transfer_initiate', 'case_detail', '<input class="form-control" style="display:inline-block;width:220px;" name="provider_reference" placeholder="Provider reference"> <button class="btn btn-sm btn-default" type="submit">Mark initiated</button>');
        }
        if ($case->transfer_status === TransferStatus::INITIATED || $case->transfer_status === TransferStatus::AUTHORIZED) {
            echo $this->form($id, $token, 'transfer_provider_confirmed', 'case_detail', '<button class="btn btn-sm btn-default" type="submit">Provider confirmed</button>');
        }
        if ($case->transfer_status === TransferStatus::PROVIDER_CONFIRMED) {
            echo $this->form($id, $token, 'transfer_processing', 'case_detail', '<button class="btn btn-sm btn-default" type="submit">Mark processing</button>');
        }
        if ($case->transfer_status === TransferStatus::PROCESSING) {
            echo $this->form($id, $token, 'transfer_verify', 'case_detail', '<button class="btn btn-sm btn-default" type="submit">Verify transfer</button>');
        }
        if ($case->transfer_status === TransferStatus::VERIFIED) {
            echo $this->form($id, $token, 'transfer_complete', 'case_detail', '<input class="form-control" style="display:inline-block;width:220px;" name="destination_account" placeholder="Destination account"> <button class="btn btn-sm btn-success" type="submit">Complete case</button>');
        }
        if (($case->transfer_status === TransferStatus::VERIFIED || $case->transfer_status === TransferStatus::COMPLETED) && !$case->disputed) {
            echo $this->form($id, $token, 'deliver_domain', 'case_detail', '<button class="btn btn-sm btn-primary" type="submit" title="Associates the domain with the customer account through WHMCS; a retry never creates a duplicate domain record">Deliver / re-check domain delivery</button>');
        }
        if (!CaseStatus::isTerminal($case->status)) {
            echo $this->form($id, $token, 'transfer_fail', 'case_detail', '<input class="form-control" style="display:inline-block;width:280px;" name="reason" placeholder="Failure reason"> <button class="btn btn-sm btn-danger" type="submit">Mark transfer failed</button>');
            echo $this->form($id, $token, 'cancel_case', 'case_detail', '<input class="form-control" style="display:inline-block;width:280px;" name="reason" placeholder="Cancellation reason"> <button class="btn btn-sm btn-danger" type="submit">Cancel case</button>');
            if (!$case->disputed) {
                echo $this->form($id, $token, 'mark_disputed', 'case_detail', '<input class="form-control" style="display:inline-block;width:280px;" name="reason" placeholder="Dispute reason"> <button class="btn btn-sm btn-danger" type="submit">Mark disputed</button>');
            } else {
                echo $this->form($id, $token, 'resolve_dispute', 'case_detail', '<input class="form-control" style="display:inline-block;width:200px;" name="note" placeholder="Resolution note"> <input class="form-control" style="display:inline-block;width:180px;" name="resume_status" value="' . $this->e($case->status) . '"> <button class="btn btn-sm btn-success" type="submit">Resolve dispute</button>');
            }
        }
        echo '</div></div>';
    }

    private function form($caseId, $token, $operation, $view, $inner)
    {
        return '<form method="post" style="margin-top:6px;">' . $this->hidden($caseId, $token, $operation, $view) . $inner . '</form>';
    }

    private function hidden($caseId, $token, $operation, $view)
    {
        return '<input type="hidden" name="token" value="' . $this->e($token) . '"><input type="hidden" name="case_id" value="' . (int) $caseId . '">'
            . '<input type="hidden" name="operation" value="' . $this->e($operation) . '"><input type="hidden" name="view" value="' . $this->e($view) . '">';
    }

    // ----------------------------------------------------------- providers

    private function renderProviders(array $data)
    {
        echo '<p>Every provider here draws its real connection state from Super Admin -&gt; API &amp; Integrations. A "Connected" status is only ever shown after that provider\'s own credentials have been saved and its Test Connection has recently succeeded — nothing here fabricates a working integration.</p>';
        echo '<table class="table table-striped"><tr><th>Provider</th><th>Type</th><th>Status</th><th>Capabilities (declared / active)</th><th>Environment</th><th>Last check</th><th>Routing policy</th><th>Actions</th></tr>';
        foreach ($data['provider_rows'] as $row) {
            $adapter = $row['adapter'];
            $config = $row['config'];
            $state = $adapter->connectionState();
            $summary = $adapter->integrationSummary();
            $badge = $state === ConnectionState::CONNECTED ? 'success' : ($state === ConnectionState::MANUAL ? 'default' : 'warning');
            echo '<tr><td>' . $this->e($adapter->label()) . '<div><small>' . $this->e($adapter->connectionDetail()) . '</small></div>'
                . '<div><small><em>' . $this->e($adapter->accessRequirements()) . '</em></small></div></td>'
                . '<td>' . ($adapter->isManual() ? 'Manual' : 'API integration') . '</td>'
                . '<td><span class="label label-' . $badge . '">' . $this->e(ConnectionState::label($state)) . '</span></td>'
                . '<td><small><strong>Declared:</strong> ' . $this->e(implode(', ', $adapter->declaredCapabilities())) . '<br><strong>Active:</strong> ' . $this->e(implode(', ', $adapter->activeCapabilities()) ?: 'None') . '</small></td>'
                . '<td>' . $this->e($summary['environment']) . '</td>'
                . '<td>' . ($summary['last_checked_at'] !== '' ? $this->e($summary['last_checked_at']) : '<em>Never tested</em>') . '</td>'
                . '<td><small>Priority ' . (int) $config->priority . ' · Routing ' . ($config->enabled ? 'enabled' : 'disabled') . ' · Agreement ' . ($config->partner_agreement_confirmed ? 'confirmed' : 'not confirmed') . '</small></td>'
                . '<td>' . $this->providerActions($adapter) . '</td></tr>';
            if (!$adapter->isManual()) {
                echo '<tr><td colspan="8"><form method="post" class="form-inline">' . $this->hidden(0, $data['token'], 'provider_save', 'providers')
                    . '<input type="hidden" name="provider_key" value="' . $this->e($adapter->key()) . '">'
                    . 'Priority <input class="form-control" style="width:80px;display:inline-block;" name="priority" value="' . (int) $config->priority . '"> '
                    . '<label><input type="checkbox" name="enabled" value="1"' . ($config->enabled ? ' checked' : '') . '> Enabled for routing</label> '
                    . '<label><input type="checkbox" name="partner_agreement_confirmed" value="1"' . ($config->partner_agreement_confirmed ? ' checked' : '') . '> Partner agreement confirmed</label> '
                    . '<input class="form-control" name="agreement_reference" placeholder="Agreement reference" value="' . $this->e($config->agreement_reference) . '"> '
                    . '<button class="btn btn-sm btn-primary" type="submit">Save</button></form></td></tr>';
            }
        }
        echo '</table>';
        echo '<p><em>Credentials are managed exclusively in Super Admin -&gt; API &amp; Integrations (Configure / Test Connection / View logs / Rotate credentials). This screen only controls whether the brokerage engine may route cases to an already-configured provider, and records the commercial agreement a provider\'s aftermarket capabilities require.</em></p>';
    }

    /** Deep links into the central API & Integrations screen — the single place credentials are ever managed (requirement #17/#18). */
    private function providerActions($adapter)
    {
        if ($adapter->isManual()) { return '<span class="text-muted">Always available</span>'; }
        $key = urlencode($adapter->key());
        $base = 'addonmodules.php?module=cloudhost247_integrations';
        $links = array(
            '<a class="btn btn-xs btn-default" href="' . $base . '&amp;view=configure&amp;integration=' . $key . '">Configure</a>',
            '<a class="btn btn-xs btn-default" href="' . $base . '&amp;view=configure&amp;integration=' . $key . '" title="Runs server-side from API & Integrations">Test Connection</a>',
            '<a class="btn btn-xs btn-default" href="' . $base . '&amp;view=events&amp;provider_key=' . $key . '">View logs</a>',
            '<a class="btn btn-xs btn-default" href="' . $base . '&amp;view=configure&amp;integration=' . $key . '" title="Credential rotation is performed in API & Integrations">Rotate credentials</a>',
        );
        return implode(' ', $links);
    }

    // ----------------------------------------------------------- brokers

    private function renderBrokers(array $data)
    {
        echo '<table class="table table-striped"><tr><th>ID</th><th>Username</th><th>Name</th><th>Assigned cases</th></tr>';
        foreach ($data['admins'] as $admin) {
            echo '<tr><td>' . (int) $admin->id . '</td><td>' . $this->e($admin->username) . '</td><td>' . $this->e($admin->firstname . ' ' . $admin->lastname) . '</td>'
                . '<td>' . (int) (isset($data['assignment_counts'][$admin->id]) ? $data['assignment_counts'][$admin->id] : 0) . '</td></tr>';
        }
        echo '</table><p><em>Brokers only see and act on cases assigned to them, unless their WHMCS administrator role has been granted the cloudhost247_broker "cases.view_all" capability.</em></p>';
    }

    // ----------------------------------------------------------- settings

    private function renderSettings(array $data)
    {
        $s = $data['settings'];
        echo '<form method="post">' . $this->hidden(0, $data['token'], 'settings_save', 'settings');
        echo '<table class="table"><tr><td>Brokerage enabled</td><td><input type="checkbox" name="brokerage_enabled" value="1"' . ($s['brokerage_enabled'] === '1' ? ' checked' : '') . '></td></tr>';
        echo '<tr><td>Manual broker fallback</td><td><input type="checkbox" name="manual_broker_fallback" value="1"' . ($s['manual_broker_fallback'] === '1' ? ' checked' : '') . '></td></tr>';
        echo '<tr><td>Supported currencies</td><td><input class="form-control" name="supported_currencies" value="' . $this->e($s['supported_currencies']) . '"></td></tr>';
        echo '<tr><td>Contact attempt limit</td><td><input class="form-control" name="contact_attempt_limit" value="' . (int) $s['contact_attempt_limit'] . '"></td></tr>';
        echo '<tr><td>Negotiation expiration (hours)</td><td><input class="form-control" name="negotiation_expiration_hours" value="' . (int) $s['negotiation_expiration_hours'] . '"></td></tr>';
        echo '<tr><td>Customer notifications enabled</td><td><input type="checkbox" name="customer_notifications_enabled" value="1"' . ($s['customer_notifications_enabled'] === '1' ? ' checked' : '') . '></td></tr>';
        echo '<tr><td>Transfer verification required before completion</td><td><input type="checkbox" name="transfer_verification_required" value="1"' . ($s['transfer_verification_required'] === '1' ? ' checked' : '') . '></td></tr>';
        echo '<tr><td>Refund window (days)</td><td><input class="form-control" name="refund_window_days" value="' . (int) $s['refund_window_days'] . '"></td></tr>';
        echo '</table><button class="btn btn-primary" type="submit">Save settings</button></form>';
    }

    // ----------------------------------------------------------- fees

    private function renderFees(array $data)
    {
        echo '<table class="table table-striped"><tr><th>Name</th><th>Applies to</th><th>Type</th><th>Amount</th><th>Min</th><th>Currency</th><th>Provider</th><th>Enabled</th><th></th></tr>';
        foreach ($data['fee_rows'] as $fee) {
            echo '<tr><td>' . $this->e($fee->name) . '</td><td>' . $this->e($fee->applies_to) . '</td><td>' . $this->e($fee->fee_type) . '</td>'
                . '<td>' . $this->e($fee->amount) . ($fee->fee_type === 'percentage' ? '%' : '') . '</td><td>' . $this->e($fee->min_amount) . '</td>'
                . '<td>' . $this->e($fee->currency ?: 'Any') . '</td><td>' . $this->e($fee->provider_key ?: 'Any') . '</td><td>' . ($fee->enabled ? 'Yes' : 'No') . '</td>'
                . '<td><form method="post" style="display:inline;">' . $this->hidden(0, $data['token'], 'fee_delete', 'fees') . '<input type="hidden" name="fee_id" value="' . (int) $fee->id . '"><button class="btn btn-xs btn-danger" type="submit">Delete</button></form></td></tr>';
        }
        echo '</table>';
        echo '<h4>Add / update a fee rule</h4><form method="post">' . $this->hidden(0, $data['token'], 'fee_save', 'fees');
        echo '<input class="form-control" style="display:inline-block;width:140px;" name="fee_id" placeholder="Fee ID (blank=new)"> ';
        echo '<input class="form-control" style="display:inline-block;width:160px;" name="name" placeholder="Name" required> ';
        echo '<select name="applies_to" class="form-control" style="display:inline-block;width:150px;"><option value="brokerage_fee">Brokerage fee</option><option value="transfer_fee">Transfer fee</option><option value="service_fee">Service fee</option></select> ';
        echo '<select name="fee_type" class="form-control" style="display:inline-block;width:120px;"><option value="fixed">Fixed</option><option value="percentage">Percentage</option></select> ';
        echo '<input class="form-control" style="display:inline-block;width:100px;" name="amount" placeholder="Amount" required> ';
        echo '<input class="form-control" style="display:inline-block;width:100px;" name="min_amount" placeholder="Min (opt.)"> ';
        echo '<input class="form-control" style="display:inline-block;width:90px;" name="currency" placeholder="Currency (opt.)"> ';
        echo '<input class="form-control" style="display:inline-block;width:110px;" name="provider_key" placeholder="Provider (opt.)"> ';
        echo '<label><input type="checkbox" name="enabled" value="1" checked> Enabled</label> ';
        echo '<button class="btn btn-primary" type="submit">Save fee rule</button></form>';
    }

    // ----------------------------------------------------------- audit logs

    private function renderAuditLogs(array $data)
    {
        echo '<table class="table table-striped"><tr><th>When</th><th>Admin</th><th>Action</th><th>Resource</th><th>Result</th><th>Correlation</th></tr>';
        foreach ($data['audit']['rows'] as $row) {
            echo '<tr><td>' . $this->e($row->created_at) . '</td><td>' . $this->e($row->administrator ?: 'system') . '</td><td>' . $this->e($row->action) . '</td>'
                . '<td>' . $this->e($row->resource_type) . ' #' . $this->e($row->resource_id) . '</td>'
                . '<td><span class="label label-' . ($row->result === 'success' ? 'success' : 'danger') . '">' . $this->e($row->result) . '</span></td>'
                . '<td><small>' . $this->e($row->correlation_id) . '</small></td></tr>';
        }
        if (!$data['audit']['rows']) { echo '<tr><td colspan="6"><em>No audit events recorded yet.</em></td></tr>'; }
        echo '</table>';
        $this->pagination(array('pages' => $data['audit']['pages'], 'page' => $data['audit']['page']), 'audit_logs');
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
