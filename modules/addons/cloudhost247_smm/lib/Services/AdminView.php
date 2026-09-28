<?php
namespace CloudHost247\Smm\Services;

use CloudHost247\Smm\Support\StatusMap;

/**
 * Renders the admin UI. Every dynamic value passes through e() (htmlspecialchars).
 * GET pages never call a provider API — they only read the local database.
 */
final class AdminView
{
    /** @param array $data from AdminController::handle() */
    public function render(array $data)
    {
        $this->nav($data['view']);
        if ($data['notice'] !== '') {
            echo '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>';
        }
        if ($data['error'] !== '') {
            echo '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>';
        }
        $method = 'render' . str_replace(' ', '', ucwords(str_replace('_', ' ', $data['view'])));
        if (!method_exists($this, $method)) {
            $method = 'renderDashboard';
        }
        $this->{$method}($data);
    }

    private function nav($active)
    {
        $items = array(
            'dashboard' => 'Dashboard',
            'providers' => 'Providers',
            'services' => 'Services',
            'mappings' => 'Mappings',
            'orders' => 'Orders',
            'logs' => 'API Logs',
            'settings' => 'Settings',
        );
        echo '<div class="module-settings"><h2>CloudHost247 SMM Marketplace</h2><ul class="nav nav-tabs">';
        foreach ($items as $key => $label) {
            echo '<li' . ($active === $key ? ' class="active"' : '') . '><a href="addonmodules.php?module=cloudhost247_smm&amp;view=' . $this->e($key) . '">' . $this->e($label) . '</a></li>';
        }
        echo '</ul><br></div>';
    }

    // ----------------------------------------------------------- dashboard

    private function renderDashboard(array $data)
    {
        echo '<div class="row">';
        echo '<div class="col-sm-3"><div class="panel panel-info"><div class="panel-heading"><h3 class="panel-title">Total orders</h3></div><div class="panel-body"><h1>' . $this->e($data['total_orders']) . '</h1></div></div></div>';
        $uncertain = count($data['uncertain']);
        $review = count($data['needs_review']);
        echo '<div class="col-sm-3"><div class="panel' . ($uncertain > 0 ? ' panel-warning' : ' panel-default') . '"><div class="panel-heading"><h3 class="panel-title">Awaiting reconciliation</h3></div><div class="panel-body"><h1>' . $this->e($uncertain) . '</h1>'
            . ($uncertain > 0 ? '<a class="btn btn-xs btn-warning" href="addonmodules.php?module=cloudhost247_smm&amp;view=orders&amp;status=reconciliation">Review</a>' : '') . '</div></div></div>';
        echo '<div class="col-sm-3"><div class="panel' . ($review > 0 ? ' panel-warning' : ' panel-default') . '"><div class="panel-heading"><h3 class="panel-title">Flagged for review</h3></div><div class="panel-body"><h1>' . $this->e($review) . '</h1><small>terminal-status conflicts / provider refused status queries</small></div></div></div>';
        $providers = is_array($data['providers']) ? $data['providers'] : array();
        $enabled = 0;
        foreach ($providers as $p) {
            if ((int) $p->enabled === 1) { $enabled++; }
        }
        echo '<div class="col-sm-3"><div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Providers</h3></div><div class="panel-body"><h1>' . $this->e(count($providers)) . '</h1><small>' . $this->e($enabled) . ' enabled</small></div></div></div>';
        echo '</div>';

        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Order status distribution</h3></div><div class="panel-body">';
        $counts = $data['status_counts'];
        if (array() === $counts) {
            echo '<p class="text-muted">No orders yet.</p>';
        } else {
            echo '<table class="table table-condensed"><tr><th>Status</th><th>Orders</th></tr>';
            foreach ($counts as $status => $n) {
                echo '<tr><td>' . $this->e($status === 'unverified' ? 'not yet verified' : $status) . '</td><td>' . $this->e($n) . '</td></tr>';
            }
            echo '</table>';
        }
        echo '<p class="text-muted small">Last status sync: ' . $this->e($data['runtime']['last_status_sync_at'] ?: 'never')
            . ' &middot; Last catalog sync: ' . $this->e($data['runtime']['last_catalog_sync_at'] ?: 'never') . '</p>';
        echo '</div></div>';

        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Recent orders</h3></div>';
        echo '<table class="table table-striped table-hover"><tr><th>ID</th><th>Client</th><th>Service</th><th>Provider</th><th>Qty</th><th>Status</th><th>State</th><th>Updated</th></tr>';
        foreach ($data['recent_orders'] as $o) {
            echo '<tr><td><a href="addonmodules.php?module=cloudhost247_smm&amp;view=order_view&amp;id=' . $this->e($o->id) . '">#' . $this->e($o->id) . '</a></td>'
                . '<td>' . $this->e($o->whmcs_client_id) . '</td><td>' . $this->e($o->service_name) . '</td>'
                . '<td>' . $this->e($o->provider_name) . '</td><td>' . $this->e($o->quantity) . '</td>'
                . '<td>' . $this->e($o->order_status ?: 'unverified') . '</td><td>' . $this->e($o->submission_state) . '</td>'
                . '<td>' . $this->e($o->updated_at) . '</td></tr>';
        }
        if (array() === $data['recent_orders']) {
            echo '<tr><td colspan="8" class="text-muted">No orders yet. Orders appear after WHMCS payment + provisioning.</td></tr>';
        }
        echo '</table></div>';
    }

    // ------------------------------------------------------------ providers

    private function renderProviders(array $data)
    {
        $token = $data['token'];
        echo '<p><a class="btn btn-primary" href="addonmodules.php?module=cloudhost247_smm&amp;view=provider_edit">Add provider</a></p>';
        echo '<table class="table table-striped"><tr><th>Name</th><th>Adapter</th><th>Key</th><th>Enabled</th><th>Connection</th><th>Balance</th><th>Last sync</th><th>Actions</th></tr>';
        foreach ($data['providers'] as $p) {
            $toggleLabel = (int) $p->enabled === 1 ? 'Disable' : 'Enable';
            echo '<tr><td>' . $this->e($p->name) . '</td><td>' . $this->e($p->adapter) . '</td><td>' . $this->e($p->api_key_hint ?: '—') . '</td>'
                . '<td>' . ((int) $p->enabled === 1 ? '<span class="label label-success">enabled</span>' : '<span class="label label-default">disabled</span>') . '</td>'
                . '<td>' . $this->e($p->connection_status) . ($p->last_error !== '' ? ' <span class="text-danger" title="' . $this->e($p->last_error) . '">(last error)</span>' : '') . '</td>'
                . '<td>' . $this->e($p->balance !== '' ? $p->balance . ' ' . $p->currency : '—') . '</td>'
                . '<td>' . $this->e($p->last_sync_at ?: 'never') . '</td><td>';
            foreach (array('provider_test' => 'Test', 'provider_sync' => 'Sync services', 'provider_toggle' => $toggleLabel) as $op => $label) {
                echo '<form method="post" style="display:inline"><input type="hidden" name="token" value="' . $this->e($token) . '">'
                    . '<input type="hidden" name="operation" value="' . $this->e($op) . '"><input type="hidden" name="view" value="providers">'
                    . '<input type="hidden" name="id" value="' . $this->e($p->id) . '">'
                    . ($op === 'provider_toggle' ? '<input type="hidden" name="enabled" value="' . ((int) $p->enabled === 1 ? 0 : 1) . '">' : '')
                    . '<button class="btn btn-xs btn-default">' . $this->e($label) . '</button></form> ';
            }
            echo '<a class="btn btn-xs btn-info" href="addonmodules.php?module=cloudhost247_smm&amp;view=provider_edit&amp;id=' . $this->e($p->id) . '">Edit</a> ';
            echo '<form method="post" style="display:inline" onsubmit="return confirm(\'Delete this provider? Blocked while order history exists.\')">'
                . '<input type="hidden" name="token" value="' . $this->e($token) . '"><input type="hidden" name="operation" value="provider_delete">'
                . '<input type="hidden" name="view" value="providers"><input type="hidden" name="id" value="' . $this->e($p->id) . '">'
                . '<label class="small"><input type="checkbox" name="confirm" value="1" required> confirm</label> '
                . '<button class="btn btn-xs btn-danger">Delete</button></form>';
            echo '</td></tr>';
        }
        if (array() === $data['providers']) {
            echo '<tr><td colspan="8" class="text-muted">No providers configured yet.</td></tr>';
        }
        echo '</table><p class="text-muted small">API keys are encrypted at rest and never displayed again after saving (only a masked hint). Deleting a provider is blocked while orders reference it — disable it instead.</p>';
    }

    private function renderProviderEdit(array $data)
    {
        $token = $data['token'];
        $p = isset($data['provider']) && $data['provider'] !== null ? $data['provider'] : null;
        $isNew = $p === null;
        echo '<form method="post" class="form-horizontal"><input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="provider_save"><input type="hidden" name="view" value="providers">'
            . '<input type="hidden" name="id" value="' . $this->e($p !== null ? $p->id : 0) . '">';
        $this->field('Name', '<input class="form-control" name="name" maxlength="120" required value="' . $this->e($p !== null ? $p->name : '') . '">');
        $this->field('Adapter', '<select class="form-control" name="adapter">' . $this->options($data['adapters'], $p !== null ? $p->adapter : 'generic') . '</select>');
        $this->field('API URL (HTTPS)', '<input class="form-control" name="api_url" maxlength="2048" placeholder="https://panel.example.com/api/v2" required value="' . $this->e($p !== null ? $p->api_url : '') . '">');
        $this->field('API key', '<input class="form-control" type="password" name="api_key" autocomplete="new-password" placeholder="' . ($isNew ? 'required' : 'leave empty to keep the stored key') . '">');
        $this->field('Priority', '<input class="form-control" type="number" name="priority" min="0" max="1000" value="' . $this->e($p !== null ? $p->priority : 100) . '">');
        $this->field('Request timeout (s)', '<input class="form-control" type="number" name="request_timeout" min="5" max="60" value="' . $this->e($p !== null ? $p->request_timeout : 20) . '">');
        $this->field('Currency', '<input class="form-control" name="currency" maxlength="8" value="' . $this->e($p !== null ? $p->currency : '') . '">');
        echo '<div class="form-group"><div class="col-sm-10 col-sm-offset-2"><button class="btn btn-primary">Save provider</button> '
            . '<a class="btn btn-default" href="addonmodules.php?module=cloudhost247_smm&amp;view=providers">Back</a></div></div></form>';
        if (!$isNew) {
            echo '<div class="alert alert-info">Stored key hint: <strong>' . $this->e($p->api_key_hint ?: 'none') . '</strong>. Connection: ' . $this->e($p->connection_status)
                . ($p->last_error !== '' ? ' — last error: ' . $this->e($p->last_error) : '') . '</div>';
        }
    }

    // ------------------------------------------------------------- services

    private function renderServices(array $data)
    {
        $f = $data['filters'];
        echo '<form method="get" class="form-inline"><input type="hidden" name="module" value="cloudhost247_smm"><input type="hidden" name="view" value="services">'
            . '<select class="form-control" name="provider_id"><option value="0">All providers</option>' . $this->providerOptions($data['providers'], $f['provider_id']) . '</select> '
            . '<select class="form-control" name="available"><option value="">Available + unavailable</option><option value="1"' . ($f['available'] === '1' ? ' selected' : '') . '>Available only</option><option value="0"' . ($f['available'] === '0' ? ' selected' : '') . '>Unavailable only</option></select> '
            . '<input class="form-control" name="q" placeholder="Search name/id" value="' . $this->e($f['q']) . '"> '
            . '<button class="btn btn-default">Filter</button></form><br>';
        echo '<table class="table table-striped table-condensed"><tr><th>Provider</th><th>Provider ID</th><th>Name</th><th>Category</th><th>Min/Max</th><th>Rate</th><th>Refill</th><th>Cancel</th><th>Available</th><th>Action</th></tr>';
        foreach ($data['services'] as $s) {
            echo '<tr><td>' . $this->e($s->provider_name) . '</td><td>' . $this->e($s->provider_service_id) . '</td><td>' . $this->e($s->name) . '</td>'
                . '<td>' . $this->e($s->category) . '</td><td>' . $this->e($s->min_quantity) . ' / ' . $this->e($s->max_quantity) . '</td>'
                . '<td>' . $this->e($s->rate) . ' ' . $this->e($s->currency) . '</td>'
                . '<td>' . ((int) $s->refill === 1 ? 'yes' : 'no') . '</td><td>' . ((int) $s->cancel === 1 ? 'yes' : 'no') . '</td>'
                . '<td>' . ((int) $s->available === 1 ? '<span class="label label-success">yes</span>' : '<span class="label label-default">no</span>') . '</td>'
                . '<td><form method="post" style="display:inline"><input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
                . '<input type="hidden" name="operation" value="service_toggle"><input type="hidden" name="view" value="services">'
                . '<input type="hidden" name="id" value="' . $this->e($s->id) . '"><input type="hidden" name="available" value="' . ((int) $s->available === 1 ? 0 : 1) . '">'
                . '<button class="btn btn-xs btn-default">' . ((int) $s->available === 1 ? 'Mark unavailable' : 'Mark available') . '</button></form></td></tr>';
        }
        if (array() === $data['services']) {
            echo '<tr><td colspan="10" class="text-muted">No services. Run "Sync services" on the Providers tab.</td></tr>';
        }
        echo '</table>';
        $this->pagination($data, 'services', $f);
        echo '<p class="text-muted small">Deleting catalog rows is unnecessary: services missing from the provider are marked unavailable automatically, and history always keeps its reference.</p>';
    }

    // ------------------------------------------------------------- mappings

    private function renderMappings(array $data)
    {
        $token = $data['token'];
        echo '<p><a class="btn btn-primary" href="addonmodules.php?module=cloudhost247_smm&amp;view=mapping_edit">Add mapping</a></p>';
        echo '<table class="table table-striped"><tr><th>WHMCS product</th><th>Provider</th><th>Provider service</th><th>Name</th><th>Min/Max</th><th>Cost</th><th>Sell</th><th>Margin</th><th>Enabled</th><th>Actions</th></tr>';
        foreach ($data['mappings'] as $m) {
            echo '<tr><td>' . $this->e($this->productName($data, (int) $m->product_id)) . '</td>'
                . '<td>' . $this->e($m->provider_name) . '</td><td>' . $this->e($m->provider_service_id) . '</td>'
                . '<td>' . $this->e($m->name) . '</td><td>' . $this->e($m->min_quantity) . ' / ' . $this->e($m->max_quantity) . '</td>'
                . '<td>' . $this->e($m->provider_cost) . '</td><td>' . $this->e($m->sell_price) . '</td><td>' . $this->e($m->margin_percent) . '%</td>'
                . '<td>' . ((int) $m->enabled === 1 ? '<span class="label label-success">on</span>' : '<span class="label label-default">off</span>') . '</td><td>';
            echo '<form method="post" style="display:inline"><input type="hidden" name="token" value="' . $this->e($token) . '">'
                . '<input type="hidden" name="operation" value="mapping_toggle"><input type="hidden" name="view" value="mappings">'
                . '<input type="hidden" name="id" value="' . $this->e($m->id) . '"><input type="hidden" name="enabled" value="' . ((int) $m->enabled === 1 ? 0 : 1) . '">'
                . '<button class="btn btn-xs btn-default">' . ((int) $m->enabled === 1 ? 'Disable' : 'Enable') . '</button></form> ';
            echo '<a class="btn btn-xs btn-info" href="addonmodules.php?module=cloudhost247_smm&amp;view=mapping_edit&amp;id=' . $this->e($m->id) . '">Edit</a> ';
            echo '<form method="post" style="display:inline" onsubmit="return confirm(\'Delete this mapping? Existing orders are untouched.\')">'
                . '<input type="hidden" name="token" value="' . $this->e($token) . '"><input type="hidden" name="operation" value="mapping_delete">'
                . '<input type="hidden" name="view" value="mappings"><input type="hidden" name="id" value="' . $this->e($m->id) . '">'
                . '<label class="small"><input type="checkbox" name="confirm" value="1" required> confirm</label> '
                . '<button class="btn btn-xs btn-danger">Delete</button></form>';
            echo '</td></tr>';
        }
        if (array() === $data['mappings']) {
            echo '<tr><td colspan="10" class="text-muted">No mappings. A WHMCS product must be mapped to a provider service before orders can submit.</td></tr>';
        }
        echo '</table><p class="text-muted small">One WHMCS product maps to exactly one provider service. The module never creates or edits WHMCS products or pricing — select an existing product.</p>';
    }

    private function renderMappingEdit(array $data)
    {
        $token = $data['token'];
        $m = isset($data['mapping']) && $data['mapping'] !== null ? $data['mapping'] : null;
        echo '<form method="post" class="form-horizontal"><input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="mapping_save"><input type="hidden" name="view" value="mappings">'
            . '<input type="hidden" name="id" value="' . $this->e($m !== null ? $m->id : 0) . '">';
        $this->field('WHMCS product', '<select class="form-control" name="product_id" required><option value="">— select an existing product —</option>'
            . $this->productOptions($data['products'], $m !== null ? (int) $m->product_id : 0) . '</select>', 'The module never creates products.');
        $serviceOptions = '';
        foreach ($data['catalog'] as $c) {
            $serviceOptions .= '<option value="' . $this->e($c['id']) . '"' . ($m !== null && (int) $m->service_id === $c['id'] ? ' selected' : '')
                . '>' . $this->e($c['provider_name']) . ' — ' . $this->e($c['label']) . ($c['available'] === 1 ? '' : ' (unavailable)') . '</option>';
        }
        $this->field('Provider service', $serviceOptions === '' ? '<p class="text-muted">No catalog services. Sync a provider first.</p>' : '<select class="form-control" name="service_id" required>' . $serviceOptions . '</select>');
        $this->field('Display name', '<input class="form-control" name="name" maxlength="250" required value="' . $this->e($m !== null ? $m->name : '') . '">');
        $this->field('Min quantity', '<input class="form-control" type="number" name="min_quantity" min="1" value="' . $this->e($m !== null ? $m->min_quantity : '') . '">');
        $this->field('Max quantity', '<input class="form-control" type="number" name="max_quantity" min="1" value="' . $this->e($m !== null ? $m->max_quantity : '') . '">');
        $this->field('Provider cost', '<input class="form-control" type="number" step="0.0001" name="provider_cost" value="' . $this->e($m !== null ? $m->provider_cost : '') . '">');
        $this->field('Selling price', '<input class="form-control" type="number" step="0.0001" name="sell_price" value="' . $this->e($m !== null ? $m->sell_price : '') . '">');
        $this->field('Currency', '<input class="form-control" name="currency" maxlength="8" value="' . $this->e($m !== null ? $m->currency : '') . '">');
        $this->field('Enabled', '<label><input type="checkbox" name="enabled" value="1"' . ($m === null || (int) $m->enabled === 1 ? ' checked' : '') . '> Enabled</label>');
        echo '<div class="form-group"><div class="col-sm-10 col-sm-offset-2"><button class="btn btn-primary">Save mapping</button> '
            . '<a class="btn btn-default" href="addonmodules.php?module=cloudhost247_smm&amp;view=mappings">Back</a></div></div></form>';
    }

    // --------------------------------------------------------------- orders

    private function renderOrders(array $data)
    {
        $f = $data['filters'];
        echo '<form method="get" class="form-inline"><input type="hidden" name="module" value="cloudhost247_smm"><input type="hidden" name="view" value="orders">'
            . '<select class="form-control" name="provider_id"><option value="0">All providers</option>' . $this->providerOptions($data['providers'], $f['provider_id']) . '</select> '
            . '<select class="form-control" name="status"><option value="">All statuses</option>';
        foreach (array_merge($data['statuses'], array('reconciliation')) as $s) {
            echo '<option value="' . $this->e($s) . '"' . ($f['status'] === $s ? ' selected' : '') . '>' . $this->e($s) . '</option>';
        }
        echo '</select> <input class="form-control" name="q" placeholder="Order id / URL / service" value="' . $this->e($f['q']) . '"> '
            . '<button class="btn btn-default">Filter</button></form><br>';
        echo '<table class="table table-striped table-condensed"><tr><th>ID</th><th>WHMCS svc</th><th>Client</th><th>Service</th><th>Provider order</th><th>Qty</th><th>Remains</th><th>Status</th><th>State</th><th>Flags</th><th>Updated</th></tr>';
        foreach ($data['orders'] as $o) {
            echo '<tr><td><a href="addonmodules.php?module=cloudhost247_smm&amp;view=order_view&amp;id=' . $this->e($o->id) . '">#' . $this->e($o->id) . '</a></td>'
                . '<td>' . $this->e($o->whmcs_service_id) . '</td><td>' . $this->e($o->whmcs_client_id) . '</td>'
                . '<td>' . $this->e($o->service_name) . '</td><td>' . $this->e($o->provider_order_id ?: '—') . '</td>'
                . '<td>' . $this->e($o->quantity) . '</td><td>' . $this->e($o->remains) . '</td>'
                . '<td>' . $this->e($o->order_status ?: 'unverified') . '</td><td>' . $this->e($o->submission_state) . '</td>'
                . '<td>' . ((int) $o->needs_review === 1 ? '<span class="label label-warning">review</span>' : '') . ((int) $o->suspended === 1 ? ' <span class="label label-default">suspended</span>' : '') . '</td>'
                . '<td>' . $this->e($o->updated_at) . '</td></tr>';
        }
        if (array() === $data['orders']) {
            echo '<tr><td colspan="11" class="text-muted">No orders match.</td></tr>';
        }
        echo '</table>';
        $this->pagination($data, 'orders', $f);
    }

    private function renderOrderView(array $data)
    {
        $o = $data['order'];
        if ($o === null) {
            echo '<div class="alert alert-warning">Order not found.</div>';
            return;
        }
        $token = $data['token'];
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Order #' . $this->e($o->id) . '</h3></div><div class="panel-body">';
        echo '<table class="table table-condensed"><tr><th>WHMCS service / order / client / product</th><td>' . $this->e($o->whmcs_service_id) . ' / ' . $this->e($o->whmcs_order_id) . ' / ' . $this->e($o->whmcs_client_id) . ' / ' . $this->e($o->whmcs_product_id) . '</td></tr>'
            . '<tr><th>Provider</th><td>' . $this->e($o->provider_name) . ' (service ' . $this->e($o->provider_service_id) . ', provider order ' . $this->e($o->provider_order_id ?: '—') . ')</td></tr>'
            . '<tr><th>Service</th><td>' . $this->e($o->service_name) . '</td></tr>'
            . '<tr><th>Target URL</th><td><code>' . $this->e($o->target_url) . '</code></td></tr>'
            . '<tr><th>Quantity / start count / remains</th><td>' . $this->e($o->quantity) . ' / ' . $this->e($o->start_count) . ' / ' . $this->e($o->remains) . '</td></tr>'
            . '<tr><th>Price / cost / currency</th><td>' . $this->e($o->customer_price) . ' / ' . $this->e($o->provider_cost) . ' ' . $this->e($o->currency) . '</td></tr>'
            . '<tr><th>Status</th><td>' . $this->e($o->order_status ?: 'unverified') . ' (raw: ' . $this->e($o->provider_status_raw) . ') &middot; state: ' . $this->e($o->submission_state) . '</td></tr>'
            . '<tr><th>Refill / cancel support</th><td>' . ((int) $o->refill_supported === 1 ? 'refill' : 'no refill') . ' / ' . ((int) $o->cancel_supported === 1 ? 'cancel' : 'no cancel') . '</td></tr>'
            . '<tr><th>Last refill</th><td>' . $this->e($o->last_refill_id !== '' ? $o->last_refill_id . ' (' . $o->last_refill_status . ')' : '—') . '</td></tr>'
            . '<tr><th>Timestamps</th><td>created ' . $this->e($o->created_at) . ' &middot; submitted ' . $this->e($o->submitted_at ?: '—') . ' &middot; last status ' . $this->e($o->last_status_at ?: '—') . ' &middot; last sync ' . $this->e($o->last_sync_at ?: '—') . '</td></tr>'
            . '<tr><th>Correlation id</th><td><code>' . $this->e($o->correlation_id) . '</code></td></tr>'
            . '<tr><th>Error</th><td>' . $this->e($o->error_message ?: '—') . '</td></tr></table>';

        echo '<h4>Actions</h4><div>';
        $this->actionButton($token, $o->id, 'order_sync', 'Sync status now', 'btn-default');
        if ((string) $o->submission_state === 'rejected') {
            $this->actionButton($token, $o->id, 'order_retry', 'Retry submission', 'btn-warning');
        }
        if ((string) $o->submission_state === 'uncertain' && (string) $o->provider_order_id === '') {
            echo '<form method="post" style="display:inline"><input type="hidden" name="token" value="' . $this->e($token) . '">'
                . '<input type="hidden" name="operation" value="order_attach"><input type="hidden" name="view" value="order_view">'
                . '<input type="hidden" name="id" value="' . $this->e($o->id) . '">'
                . '<input class="form-control input-sm" style="display:inline;width:160px" name="provider_order_id" placeholder="Provider order id" required> '
                . '<button class="btn btn-primary btn-sm">Attach (reconcile)</button></form> ';
        }
        if ((int) $o->refill_supported === 1 && in_array((string) $o->order_status, array(StatusMap::COMPLETED, StatusMap::PARTIAL), true)) {
            $this->actionButton($token, $o->id, 'order_refill', 'Request refill', 'btn-info');
        }
        if ((int) $o->cancel_supported === 1 && in_array((string) $o->order_status, array(StatusMap::PENDING, StatusMap::PROCESSING, StatusMap::IN_PROGRESS), true)) {
            $this->actionButton($token, $o->id, 'order_cancel', 'Request cancellation', 'btn-danger');
        }
        echo '</div></div></div>';

        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Order events</h3></div><table class="table table-condensed"><tr><th>When</th><th>Event</th><th>From</th><th>To</th><th>Actor</th><th>Correlation</th><th>Note</th></tr>';
        foreach ($data['events'] as $ev) {
            echo '<tr><td>' . $this->e($ev->created_at) . '</td><td>' . $this->e($ev->event) . '</td><td>' . $this->e($ev->from_status) . '</td><td>' . $this->e($ev->to_status) . '</td>'
                . '<td>' . $this->e($ev->actor) . ' #' . $this->e($ev->actor_id) . '</td><td><code>' . $this->e($ev->correlation_id) . '</code></td><td>' . $this->e($ev->note) . '</td></tr>';
        }
        if (array() === $data['events']) {
            echo '<tr><td colspan="7" class="text-muted">No events recorded.</td></tr>';
        }
        echo '</table></div>';
    }

    // ----------------------------------------------------------------- logs

    private function renderLogs(array $data)
    {
        $f = $data['filters'];
        echo '<form method="get" class="form-inline"><input type="hidden" name="module" value="cloudhost247_smm"><input type="hidden" name="view" value="logs">'
            . '<select class="form-control" name="provider_id"><option value="0">All providers</option>' . $this->providerOptions($data['providers'], $f['provider_id']) . '</select> '
            . '<select class="form-control" name="operation"><option value="">All operations</option>';
        foreach (array('services', 'add', 'status', 'balance', 'refill', 'refill_status', 'cancel') as $op) {
            echo '<option value="' . $this->e($op) . '"' . ($f['operation'] === $op ? ' selected' : '') . '>' . $this->e($op) . '</option>';
        }
        echo '</select> <select class="form-control" name="result"><option value="">All results</option>';
        foreach (array('success', 'rejected', 'error') as $r) {
            echo '<option value="' . $this->e($r) . '"' . ($f['result'] === $r ? ' selected' : '') . '>' . $this->e($r) . '</option>';
        }
        echo '</select> <input class="form-control" name="q" placeholder="Correlation id" value="' . $this->e($f['q']) . '"> '
            . '<button class="btn btn-default">Filter</button></form><br>';
        echo '<table class="table table-striped table-condensed"><tr><th>ID</th><th>Provider</th><th>Operation</th><th>Result</th><th>HTTP</th><th>Duration</th><th>Correlation</th><th>Request (redacted)</th><th>Response (excerpt)</th><th>When</th></tr>';
        foreach ($data['logs'] as $l) {
            echo '<tr><td>' . $this->e($l->id) . '</td><td>' . $this->e($l->provider_name ?: ($l->provider_id !== null ? '#' . $l->provider_id : '—')) . '</td>'
                . '<td>' . $this->e($l->operation) . '</td><td>' . $this->e($l->result) . '</td><td>' . $this->e($l->http_status) . '</td><td>' . $this->e($l->duration_ms) . ' ms</td>'
                . '<td><code>' . $this->e($l->correlation_id) . '</code></td>'
                . '<td><code style="word-break:break-all">' . $this->e($l->request_json) . '</code></td>'
                . '<td><code style="word-break:break-all">' . $this->e($l->response_json) . '</code></td>'
                . '<td>' . $this->e($l->created_at) . '</td></tr>';
        }
        if (array() === $data['logs']) {
            echo '<tr><td colspan="10" class="text-muted">No API calls logged yet.</td></tr>';
        }
        echo '</table>';
        $this->pagination($data, 'logs', $f);
        echo '<hr><h4>Purge old log rows</h4><form method="post" class="form-inline"><input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="logs_purge"><input type="hidden" name="view" value="logs">'
            . '<label>Older than <input class="form-control" style="width:90px" type="number" name="retention_days" min="7" max="3650" value="90"> days</label> '
            . '<label><input type="checkbox" name="confirm" value="1" required> confirm</label> '
            . '<button class="btn btn-danger">Purge</button></form>';
    }

    // ------------------------------------------------------------- settings

    private function renderSettings(array $data)
    {
        $s = $data['settings'];
        $token = $data['token'];
        echo '<form method="post" class="form-horizontal"><input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="settings_save"><input type="hidden" name="view" value="settings">';
        $this->field('Automation enabled', '<label><input type="checkbox" name="automation_enabled" value="1"' . ((int) $s['automation_enabled'] === 1 ? ' checked' : '') . '> Run scheduled tasks (status sync, reconciliation, catalog sync, cleanup)</label>');
        $this->field('Status sync interval (minutes)', '<input class="form-control" type="number" name="status_sync_minutes" min="5" max="1440" value="' . $this->e($s['status_sync_minutes']) . '">');
        $this->field('Order batch size', '<input class="form-control" type="number" name="order_batch_size" min="1" max="200" value="' . $this->e($s['order_batch_size']) . '">');
        $this->field('Reconciliation interval (minutes)', '<input class="form-control" type="number" name="reconcile_minutes" min="5" max="1440" value="' . $this->e($s['reconcile_minutes']) . '">');
        $this->field('Reconciliation batch size', '<input class="form-control" type="number" name="reconcile_batch_size" min="1" max="200" value="' . $this->e($s['reconcile_batch_size']) . '">');
        $this->field('Catalog sync interval (hours)', '<input class="form-control" type="number" name="catalog_sync_hours" min="1" max="720" value="' . $this->e($s['catalog_sync_hours']) . '">');
        $this->field('API log retention (days)', '<input class="form-control" type="number" name="api_log_retention_days" min="7" max="3650" value="' . $this->e($s['api_log_retention_days']) . '">');
        $this->field('Automation lock timeout (minutes)', '<input class="form-control" type="number" name="cron_lock_minutes" min="1" max="60" value="' . $this->e($s['cron_lock_minutes']) . '">');
        echo '<div class="form-group"><div class="col-sm-10 col-sm-offset-2"><button class="btn btn-primary">Save settings</button></div></div></form>';
        echo '<div class="alert alert-info small">Last status sync: ' . $this->e($data['runtime']['last_status_sync_at'] ?: 'never')
            . ' &middot; last reconciliation: ' . $this->e($data['runtime']['last_reconciliation_at'] ?: 'never')
            . ' &middot; last catalog sync: ' . $this->e($data['runtime']['last_catalog_sync_at'] ?: 'never') . '</div>';
        echo '<hr><h4>Run automation now</h4><form method="post"><input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="automation_run"><input type="hidden" name="view" value="settings">'
            . '<button class="btn btn-success">Run now</button> <span class="text-muted small">(same tasks as cron, behind the same lock)</span></form>';
        echo '<hr><h4>Cron entry (recommended)</h4><p>Add to your scheduler: <code>*/5 * * * * php -q /path/to/whmcs/crons/cloudhost247_smm.php</code> &mdash; or rely on the WHMCS AfterCronJob hook (every WHMCS cron run).</p>';
    }

    // -------------------------------------------------------------- helpers

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }

    private function field($label, $controlHtml, $help = '')
    {
        echo '<div class="form-group"><label class="col-sm-2 control-label">' . $this->e($label) . '</label><div class="col-sm-8">' . $controlHtml
            . ($help !== '' ? '<span class="help-block">' . $this->e($help) . '</span>' : '') . '</div></div>';
    }

    private function actionButton($token, $orderId, $operation, $label, $class)
    {
        echo '<form method="post" style="display:inline"><input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="' . $this->e($operation) . '"><input type="hidden" name="view" value="order_view">'
            . '<input type="hidden" name="id" value="' . $this->e($orderId) . '">'
            . '<button class="btn btn-sm ' . $this->e($class) . '">' . $this->e($label) . '</button></form> ';
    }

    private function options(array $map, $selected)
    {
        $out = '';
        foreach ($map as $key => $label) {
            $out .= '<option value="' . $this->e($key) . '"' . ((string) $key === (string) $selected ? ' selected' : '') . '>' . $this->e($label) . '</option>';
        }
        return $out;
    }

    private function providerOptions($providers, $selected)
    {
        $out = '';
        foreach ($providers as $p) {
            $out .= '<option value="' . $this->e($p->id) . '"' . ((int) $p->id === (int) $selected ? ' selected' : '') . '>' . $this->e($p->name) . '</option>';
        }
        return $out;
    }

    private function productOptions($products, $selected)
    {
        $out = '';
        foreach ($products as $p) {
            $out .= '<option value="' . $this->e($p->id) . '"' . ((int) $p->id === (int) $selected ? ' selected' : '') . '>#' . $this->e($p->id) . ' ' . $this->e($p->name) . '</option>';
        }
        return $out;
    }

    private function productName(array $data, $productId)
    {
        foreach ($data['products'] as $p) {
            if ((int) $p->id === (int) $productId) {
                return '#' . $p->id . ' ' . $p->name;
            }
        }
        return '#' . $productId;
    }

    private function pagination(array $data, $view, array $filters)
    {
        $pages = max(1, (int) ceil((int) $data['total'] / AdminController::PAGE_SIZE));
        if ($pages <= 1) {
            echo '<p class="text-muted small">' . $this->e($data['total']) . ' row(s)</p>';
            return;
        }
        echo '<ul class="pagination">';
        for ($i = 1; $i <= min($pages, 20); $i++) {
            $qs = http_build_query(array_merge(array('module' => 'cloudhost247_smm', 'view' => $view, 'page' => $i), array_filter($filters)));
            echo '<li' . ($i === (int) $data['page'] ? ' class="active"' : '') . '><a href="addonmodules.php?' . $this->e($qs) . '">' . $this->e($i) . '</a></li>';
        }
        echo '</ul><p class="text-muted small">' . $this->e($data['total']) . ' row(s), page ' . $this->e($data['page']) . ' of ' . $this->e($pages) . '</p>';
    }
}
