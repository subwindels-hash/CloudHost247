<?php
/** CloudHost247 Digital Products admin controller/view. */
namespace DigitalProducts;

use DigitalProducts\Security\CapabilityPolicy;
use DigitalProducts\Services\EntitlementService;
use DigitalProducts\Support\Audit;
use WHMCS\Database\Capsule;

if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

class Admin
{
    protected $vars;
    protected $core;
    protected $moduleLink;
    protected $action;
    protected $error = '';
    protected $success = '';

    public function __construct($vars)
    {
        $this->vars = $vars;
        $this->core = new Core();
        $this->moduleLink = isset($vars['modulelink']) ? (string) $vars['modulelink'] : 'addonmodules.php?module=digitalproducts';
        $this->action = isset($_GET['action']) ? preg_replace('/[^a-z-]/', '', (string) $_GET['action']) : 'dashboard';
    }

    public function render()
    {
        try {
            CapabilityPolicy::requireCapability($this->viewCapability($this->action));
            $this->handlePost();
        } catch (\Throwable $e) {
            $this->error = $e->getMessage();
            Audit::record('admin.request.failed', 'admin', $this->action, array(), array(), 'failed', $e->getMessage());
        }

        ob_start();
        echo '<div class="digitalproducts-admin">';
        $this->renderHeader();
        if ($this->error) { echo '<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' . $this->h($this->error) . '</div>'; }
        if ($this->success) { echo '<div class="alert alert-success"><i class="fa fa-check-circle"></i> ' . $this->h($this->success) . '</div>'; }
        try {
            switch ($this->action) {
                case 'products': $this->renderProducts(); break;
                case 'product-edit': $this->renderProductEdit(); break;
                case 'upload': $this->renderUpload(); break;
                case 'versions': $this->renderVersions(); break;
                case 'entitlements': $this->renderEntitlements(); break;
                case 'licenses': $this->renderLicenses(); break;
                case 'downloads': $this->renderDownloads(); break;
                case 'customers': $this->renderCustomers(); break;
                case 'api': $this->renderApi(); break;
                case 'settings': $this->renderSettings(); break;
                case 'audit': $this->renderAudit(); break;
                case 'dashboard':
                default: $this->renderDashboard(); break;
            }
        } catch (\Throwable $e) {
            echo '<div class="alert alert-danger">The Digital Products page could not be rendered safely. ' . $this->h($e->getMessage()) . '</div>';
        }
        echo '</div>';
        return ob_get_clean();
    }

    protected function handlePost()
    {
        if (strtoupper(isset($_SERVER['REQUEST_METHOD']) ? $_SERVER['REQUEST_METHOD'] : '') !== 'POST') { return; }
        switch ($this->action) {
            case 'product-edit': CapabilityPolicy::requirePost('digitalproducts.products.manage'); $this->handleProductEdit(); break;
            case 'products': CapabilityPolicy::requirePost('digitalproducts.products.manage'); if (isset($_POST['retire_product'])) { $this->handleRetireProduct(); } break;
            case 'upload': CapabilityPolicy::requirePost('digitalproducts.files.upload'); $this->handleUpload(); break;
            case 'versions': CapabilityPolicy::requirePost('digitalproducts.versions.manage'); $this->handleVersionPost(); break;
            case 'entitlements': CapabilityPolicy::requirePost('digitalproducts.entitlements.manage'); $this->handleEntitlementPost(); break;
            case 'licenses': CapabilityPolicy::requirePost('digitalproducts.licenses.manage'); $this->handleLicensePost(); break;
            case 'settings': CapabilityPolicy::requirePost('digitalproducts.settings.manage'); $this->handleSettings(); break;
        }
    }

    protected function renderHeader()
    {
        echo '<div class="dp-header"><h2><i class="fa fa-cloud-download"></i> CloudHost247 Digital Products</h2><p class="text-muted">Native WHMCS product-linked downloads, private storage, entitlements, licensing, secure tokens and audit logging.</p></div>';
        echo '<ul class="nav nav-tabs" style="margin-bottom:20px;">';
        $items = array('dashboard'=>'Dashboard','products'=>'Products','upload'=>'Upload File','versions'=>'Versions','entitlements'=>'Entitlements','licenses'=>'Licenses','downloads'=>'Downloads','customers'=>'Customers','api'=>'API','settings'=>'Settings','audit'=>'Audit Log');
        foreach ($items as $key => $label) {
            $active = $this->action === $key ? ' class="active"' : '';
            echo '<li' . $active . '><a href="' . $this->url($key) . '">' . $this->h($label) . '</a></li>';
        }
        echo '</ul>';
    }

    protected function renderDashboard()
    {
        $stats = $this->core->getDashboardStats();
        $cards = array(
            'products' => 'Total Digital Products', 'active_products' => 'Active Products', 'versions' => 'Total Versions', 'entitlements' => 'Total Purchases',
            'active_licenses' => 'Active Licenses', 'today_downloads' => 'Downloads Today', 'month_downloads' => 'Downloads This Month', 'failed_downloads' => 'Failed Downloads', 'expired_tokens' => 'Expired Tokens'
        );
        echo '<div class="row">';
        foreach ($cards as $key => $label) {
            echo '<div class="col-sm-4 col-md-3"><div class="dp-stat-card"><div class="number">' . (int) ($stats[$key] ?? 0) . '</div><div class="label">' . $this->h($label) . '</div></div></div>';
        }
        echo '</div>';
        $storage = $this->core->storage();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Production readiness</h3></div><div class="panel-body"><ul>';
        echo '<li>Private storage: <code>' . $this->h($storage->root()) . '</code> (' . $this->h($storage->describeSource()) . ')' . ($storage->available() ? ' <span class="label label-success">Writable</span>' : ' <span class="label label-danger">Unavailable</span>') . '</li>';
        if ($storage->isInsideDocumentRoot()) { echo '<li><span class="label label-warning">Warning</span> storage is inside WHMCS_ROOT. .htaccess protection is written, but moving storage outside the webroot is recommended.</li>'; }
        echo '<li>Secure download tokens are stored hashed in <code>mod_digitalproducts_download_tokens</code>.</li><li>Administrative events are recorded through CloudHost247 Foundation audit when available.</li></ul></div></div>';

        $logs = $this->core->getDownloadLogs(1, 10);
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Recent download activity</h3></div>';
        $this->renderDownloadTable($logs['data'], false);
        echo '<div class="panel-footer text-right"><a class="btn btn-default btn-sm" href="' . $this->url('downloads') . '">View all downloads</a></div></div>';
    }

    protected function renderProducts()
    {
        $products = $this->core->getAllProducts(null);
        echo '<div class="panel panel-default"><div class="panel-heading clearfix"><h3 class="panel-title pull-left">Digital Products</h3><a class="btn btn-success btn-sm pull-right" href="' . $this->url('upload') . '"><i class="fa fa-upload"></i> Upload Version</a></div><div class="table-responsive"><table class="table table-striped table-hover"><thead><tr><th>ID</th><th>Product</th><th>WHMCS Product</th><th>Type</th><th>Current</th><th>Status</th><th>Access</th><th>Actions</th></tr></thead><tbody>';
        foreach ($products as $product) {
            $current = $product->current_version_id ?: $product->current_file_id;
            $file = $current ? $this->core->getFileById($current) : null;
            echo '<tr><td>' . (int) $product->id . '</td><td><strong>' . $this->h($product->product_name) . '</strong><br><small>' . $this->h($product->slug) . '</small></td><td>' . $this->h($product->whmcs_product_name ?: ('#' . ($product->whmcs_product_id ?: $product->product_id))) . '</td><td>' . $this->h($product->product_type) . '</td><td>' . ($file ? '<span class="dp-version-badge">' . $this->h($file->version) . '</span>' : '<span class="text-muted">None</span>') . '</td><td>' . $this->statusLabel($product->status) . '</td><td>' . $this->h($product->access_mode) . '</td><td><a class="btn btn-primary btn-xs" href="' . $this->url('product-edit', array('id' => $product->id)) . '">Edit</a> <a class="btn btn-default btn-xs" href="' . $this->url('versions', array('product_id' => $product->id)) . '">Versions</a> ';
            echo '<form method="post" style="display:inline" onsubmit="return confirm(\'Retire this product? Existing files are preserved and entitlements are revoked.\');">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="retire_product" value="' . (int) $product->id . '"><button class="btn btn-warning btn-xs">Retire</button></form></td></tr>';
        }
        if (count($products) === 0) { echo '<tr><td colspan="8" class="text-center text-muted">No digital products configured.</td></tr>'; }
        echo '</tbody></table></div></div>';

        $unlinked = $this->core->getUnlinkedWhmcsProducts();
        echo '<div class="panel panel-info"><div class="panel-heading"><h3 class="panel-title">Link Existing WHMCS Product</h3></div><div class="panel-body"><form method="post" action="' . $this->url('product-edit') . '" class="form-inline">' . CapabilityPolicy::tokenField() . '<select name="whmcs_product_id" class="form-control" required><option value="">Select WHMCS Product...</option>';
        foreach ($unlinked as $p) { echo '<option value="' . (int) $p->id . '">' . $this->h($p->name) . ' (' . $this->h($p->type) . ')</option>'; }
        echo '</select> <select name="product_type" class="form-control"><option value="software">Software</option><option value="module">WHMCS Module</option><option value="plugin">Plugin</option><option value="theme">Theme</option><option value="script">Script</option><option value="template">Template</option><option value="document">Document</option><option value="other">Other</option></select> <button name="create_product" value="1" class="btn btn-info"><i class="fa fa-link"></i> Link Product</button></form></div></div>';
    }

    protected function renderProductEdit()
    {
        $id = (int) ($_GET['id'] ?? 0);
        if (!$id) { echo '<div class="alert alert-info">Choose an existing product or link a WHMCS product from the Products page.</div>'; return; }
        $product = $this->core->getProduct($id);
        if (!$product) { echo '<div class="alert alert-danger">Product not found.</div>'; return; }
        $files = $this->core->getProductFiles($id);
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Edit Product: ' . $this->h($product->product_name) . '</h3></div><div class="panel-body"><form method="post" class="form-horizontal">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="product_id" value="' . (int) $id . '">';
        $this->input('Product Name', 'product_name', $product->product_name, 'text', true);
        $this->input('Slug', 'slug', $product->slug, 'text', true);
        $this->textarea('Short Description', 'short_description', $product->short_description, 2);
        $this->textarea('Description', 'description', $product->description, 5);
        $this->select('Product Type', 'product_type', array('module'=>'Module','plugin'=>'Plugin','theme'=>'Theme','script'=>'Script','software'=>'Software','template'=>'Template','api'=>'API','document'=>'Document','media'=>'Media','other'=>'Other'), $product->product_type);
        $this->select('Status', 'status', array('draft'=>'Draft','active'=>'Active','inactive'=>'Inactive','retired'=>'Retired'), $product->status);
        $this->select('Access Mode', 'access_mode', array('CURRENT_VERSION'=>'Current version','PURCHASE_VERSION'=>'Purchase version'), $product->access_mode);
        echo '<div class="form-group"><label class="col-sm-3 control-label">Current Version</label><div class="col-sm-6"><select name="current_file_id" class="form-control"><option value="">-- No active file --</option>';
        foreach ($files as $file) { if ($file->status !== 'active') { continue; } $selected = ((int) ($product->current_version_id ?: $product->current_file_id) === (int) $file->id) ? ' selected' : ''; echo '<option value="' . (int) $file->id . '"' . $selected . '>v' . $this->h($file->version) . ' - ' . $this->h($file->original_name) . '</option>'; }
        echo '</select></div></div>';
        $this->input('Download Limit', 'download_limit', (int) $product->download_limit, 'number');
        $this->input('Token Expiry Hours', 'download_expiry_hours', (int) ($product->download_expiry_hours ?: $product->link_expiry_hours), 'number');
        echo '<div class="form-group"><label class="col-sm-3 control-label">Licensing</label><div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="license_enabled" value="1"' . ($product->license_enabled ? ' checked' : '') . '> Generate license keys for purchases</label></div></div>';
        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button name="save_product" value="1" class="btn btn-primary">Save Product</button> <a class="btn btn-default" href="' . $this->url('upload', array('product_id' => $id)) . '">Upload New Version</a></div></div></form></div></div>';
        $this->renderVersionsForProduct($product, $files);
    }

    protected function renderUpload()
    {
        $products = $this->core->getAllProducts(null);
        $pre = (int) ($_GET['product_id'] ?? 0);
        $settings = $this->core->getSettings();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Upload Product Version</h3></div><div class="panel-body"><form method="post" enctype="multipart/form-data" class="form-horizontal">' . CapabilityPolicy::tokenField();
        echo '<div class="form-group"><label class="col-sm-3 control-label">Digital Product</label><div class="col-sm-6"><select name="product_id" class="form-control" required><option value="">-- Select Product --</option>';
        foreach ($products as $product) { if ($product->status === 'retired') { continue; } echo '<option value="' . (int) $product->id . '"' . ($pre === (int) $product->id ? ' selected' : '') . '>' . $this->h($product->product_name) . '</option>'; }
        echo '</select></div></div>';
        $this->input('Version', 'version', '1.0.0', 'text', true);
        $this->textarea('Release Notes', 'release_notes', '', 4);
        $this->textarea('Changelog', 'changelog', '', 4);
        $this->input('Minimum PHP', 'minimum_php_version', '', 'text');
        $this->input('Maximum PHP', 'maximum_php_version', '', 'text');
        $this->input('Minimum WHMCS', 'minimum_whmcs_version', '', 'text');
        $this->input('Maximum WHMCS', 'maximum_whmcs_version', '', 'text');
        $this->input('Required Extensions', 'required_extensions', '', 'text');
        $this->input('Required Modules', 'required_modules', '', 'text');
        $this->input('Release Date', 'release_date', date('Y-m-d'), 'date');
        echo '<div class="form-group"><label class="col-sm-3 control-label">File</label><div class="col-sm-6"><input type="file" name="file" class="form-control" required><span class="help-block">Allowed: ' . $this->h($settings['allowed_extensions']) . '. Max: ' . $this->formatBytes((int) $settings['max_upload_size']) . '. Files are stored in private storage and never executed.</span></div></div>';
        echo '<div class="form-group"><label class="col-sm-3 control-label">Publish</label><div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="set_current" value="1" checked> Set as current version after upload</label></div></div>';
        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button class="btn btn-primary"><i class="fa fa-upload"></i> Upload Securely</button></div></div></form></div></div>';
    }

    protected function renderVersions()
    {
        $productId = (int) ($_GET['product_id'] ?? 0);
        if ($productId) {
            $product = $this->core->getProduct($productId);
            if (!$product) { echo '<div class="alert alert-danger">Product not found.</div>'; return; }
            $this->renderVersionsForProduct($product, $this->core->getProductFiles($productId));
            return;
        }
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Version Management</h3></div><div class="list-group">';
        foreach ($this->core->getAllProducts(null) as $product) {
            $count = Capsule::table('mod_digitalproducts_files')->where('product_id', (int) $product->id)->count();
            echo '<a class="list-group-item" href="' . $this->url('versions', array('product_id' => $product->id)) . '"><h4 class="list-group-item-heading">' . $this->h($product->product_name) . '</h4><p class="list-group-item-text">' . (int) $count . ' version(s), status ' . $this->h($product->status) . '</p></a>';
        }
        echo '</div></div>';
    }

    protected function renderVersionsForProduct($product, $files)
    {
        echo '<div class="panel panel-default"><div class="panel-heading clearfix"><h3 class="panel-title pull-left">Versions: ' . $this->h($product->product_name) . '</h3><a class="btn btn-success btn-xs pull-right" href="' . $this->url('upload', array('product_id' => $product->id)) . '">Upload Version</a></div><div class="table-responsive"><table class="table table-striped"><thead><tr><th>Version</th><th>File</th><th>Size</th><th>SHA-256</th><th>Compatibility</th><th>Status</th><th>Downloads</th><th>Actions</th></tr></thead><tbody>';
        foreach ($files as $file) {
            $isCurrent = (int) ($product->current_version_id ?: $product->current_file_id) === (int) $file->id;
            $compat = array(); if ($file->minimum_php_version) $compat[] = 'PHP ≥ ' . $file->minimum_php_version; if ($file->maximum_php_version) $compat[] = 'PHP ≤ ' . $file->maximum_php_version; if ($file->minimum_whmcs_version) $compat[] = 'WHMCS ≥ ' . $file->minimum_whmcs_version; if ($file->maximum_whmcs_version) $compat[] = 'WHMCS ≤ ' . $file->maximum_whmcs_version;
            echo '<tr><td><span class="dp-version-badge">' . $this->h($file->version) . '</span>' . ($isCurrent ? ' <span class="label label-success">Current</span>' : '') . '</td><td>' . $this->h($file->original_name) . '<br><small>' . $this->h($file->release_date) . '</small></td><td>' . $this->formatBytes($file->file_size) . '</td><td><code style="font-size:10px;">' . $this->h($file->checksum_sha256 ?: $file->file_hash) . '</code></td><td>' . $this->h(implode(', ', $compat) ?: '-') . '</td><td>' . $this->statusLabel($file->status) . '</td><td>' . (int) $file->download_count . '</td><td>';
            if (!$isCurrent && $file->status === 'active') { echo '<form method="post" style="display:inline">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="product_id" value="' . (int) $product->id . '"><input type="hidden" name="set_active" value="' . (int) $file->id . '"><button class="btn btn-success btn-xs">Set Current</button></form> '; }
            if ($file->status !== 'retired') { echo '<form method="post" style="display:inline" onsubmit="return confirm(\'Retire this version? Physical files are preserved.\');">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="product_id" value="' . (int) $product->id . '"><input type="hidden" name="retire_file" value="' . (int) $file->id . '"><button class="btn btn-warning btn-xs">Retire</button></form>'; }
            echo '</td></tr>';
            if ($file->release_notes || $file->changelog) { echo '<tr class="active"><td></td><td colspan="7"><small><strong>Release notes:</strong> ' . nl2br($this->h($file->release_notes ?: $file->changelog)) . '</small></td></tr>'; }
        }
        if (count($files) === 0) { echo '<tr><td colspan="8" class="text-center text-muted">No versions uploaded yet.</td></tr>'; }
        echo '</tbody></table></div></div>';
    }

    protected function renderEntitlements()
    {
        $rows = Capsule::table('mod_digitalproducts_entitlements as e')
            ->leftJoin('mod_digitalproducts_products as p', 'p.id', '=', 'e.product_id')
            ->leftJoin('tblclients as c', 'c.id', '=', 'e.client_id')
            ->leftJoin('tblhosting as h', 'h.id', '=', 'e.service_id')
            ->select('e.*', 'p.product_name', 'c.firstname', 'c.lastname', 'c.email', 'h.domainstatus')
            ->orderBy('e.updated_at', 'desc')->limit(200)->get();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Customer Entitlements</h3></div><div class="panel-body"><form method="post" class="form-inline">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="entitlement_action" value="grant"><input type="number" min="1" name="service_id" class="form-control" placeholder="WHMCS Service ID" required> <button class="btn btn-success btn-sm">Grant/Recalculate Access</button> <span class="help-block" style="display:inline;margin-left:8px;">Uses the linked WHMCS product and current payment/service state.</span></form></div><div class="table-responsive"><table class="table table-striped"><thead><tr><th>ID</th><th>Customer</th><th>Product</th><th>Service</th><th>Status</th><th>Downloads</th><th>Purchased</th><th>Actions</th></tr></thead><tbody>';
        foreach ($rows as $e) {
            $client = trim(($e->firstname ?: '') . ' ' . ($e->lastname ?: '')) ?: ('Client #' . $e->client_id);
            $limit = $e->download_limit_override === null ? 'product' : (int) $e->download_limit_override;
            echo '<tr><td>' . (int) $e->id . '</td><td>' . $this->h($client) . '<br><small>' . $this->h($e->email) . '</small></td><td>' . $this->h($e->product_name) . '</td><td>#' . (int) $e->service_id . '<br><small>' . $this->h($e->domainstatus) . '</small></td><td>' . $this->statusLabel($e->status) . '</td><td>' . (int) $e->download_count . ' / ' . $this->h($limit) . '</td><td>' . $this->h($e->purchased_at) . '</td><td><form method="post" class="form-inline">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="entitlement_id" value="' . (int) $e->id . '"><select name="entitlement_action" class="form-control input-sm"><option value="reset">Reset downloads</option><option value="active">Restore</option><option value="suspended">Suspend</option><option value="revoked">Revoke</option></select> <button class="btn btn-default btn-xs">Apply</button></form></td></tr>';
        }
        if (count($rows) === 0) { echo '<tr><td colspan="8" class="text-center text-muted">No entitlements yet. They are created automatically from paid WHMCS services.</td></tr>'; }
        echo '</tbody></table></div></div>';
    }

    protected function renderLicenses()
    {
        $rows = Capsule::table('mod_digitalproducts_licenses as l')->leftJoin('mod_digitalproducts_products as p','p.id','=','l.product_id')->leftJoin('tblclients as c','c.id','=','l.client_id')->select('l.*','p.product_name','c.firstname','c.lastname','c.email')->orderBy('l.created_at','desc')->limit(200)->get();
        $licenseManager = new License();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Licenses</h3></div><div class="table-responsive"><table class="table table-striped"><thead><tr><th>ID</th><th>License</th><th>Product</th><th>Customer</th><th>Domains</th><th>Status</th><th>Actions</th></tr></thead><tbody>';
        foreach ($rows as $l) {
            echo '<tr><td>' . (int) $l->id . '</td><td><code>' . $this->h($licenseManager->displayKey($l)) . '</code><br><small>' . $this->h($l->license_prefix) . '</small></td><td>' . $this->h($l->product_name) . '</td><td>' . $this->h(trim(($l->firstname ?: '') . ' ' . ($l->lastname ?: ''))) . '<br><small>' . $this->h($l->email) . '</small></td><td>' . $this->h($l->domains ?: '-') . '</td><td>' . $this->statusLabel($l->status) . '</td><td><form method="post" class="form-inline">' . CapabilityPolicy::tokenField() . '<input type="hidden" name="license_id" value="' . (int) $l->id . '"><select name="license_status" class="form-control input-sm"><option value="active">Active</option><option value="suspended">Suspended</option><option value="expired">Expired</option><option value="cancelled">Cancelled</option></select> <button class="btn btn-default btn-xs">Update</button></form></td></tr>';
        }
        if (count($rows) === 0) { echo '<tr><td colspan="7" class="text-center text-muted">No licenses generated yet.</td></tr>'; }
        echo '</tbody></table></div></div>';
    }

    protected function renderDownloads()
    {
        $filters = array('client_id'=>$_GET['client_id'] ?? '', 'product_id'=>$_GET['product_id'] ?? '', 'status'=>$_GET['status'] ?? '', 'date_from'=>$_GET['date_from'] ?? '', 'date_to'=>$_GET['date_to'] ?? '');
        $logs = $this->core->getDownloadLogs($_GET['page'] ?? 1, 25, array_filter($filters));
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Download Logs</h3></div><div class="panel-body"><form method="get" class="form-inline"><input type="hidden" name="module" value="digitalproducts"><input type="hidden" name="action" value="downloads"><input name="client_id" class="form-control" placeholder="Client ID" value="' . $this->h($filters['client_id']) . '"><input name="product_id" class="form-control" placeholder="Product ID" value="' . $this->h($filters['product_id']) . '"><select name="status" class="form-control"><option value="">All statuses</option>';
        foreach (array('success','denied','expired','limit_exceeded','invalid_token','not_entitled','file_missing') as $s) { echo '<option value="' . $s . '"' . ($filters['status']===$s?' selected':'') . '>' . $this->h($s) . '</option>'; }
        echo '</select><input type="date" name="date_from" class="form-control" value="' . $this->h($filters['date_from']) . '"><input type="date" name="date_to" class="form-control" value="' . $this->h($filters['date_to']) . '"> <button class="btn btn-default">Filter</button></form></div>';
        $this->renderDownloadTable($logs['data'], true);
        echo '</div>';
    }

    protected function renderDownloadTable($rows, $showFailure)
    {
        echo '<div class="table-responsive"><table class="table table-striped"><thead><tr><th>ID</th><th>Client</th><th>Product</th><th>Version</th><th>IP</th><th>Status</th>' . ($showFailure ? '<th>Reason</th>' : '') . '<th>Date</th></tr></thead><tbody>';
        foreach ($rows as $dl) {
            $client = trim(($dl->firstname ?: '') . ' ' . ($dl->lastname ?: '')) ?: ($dl->client_id ? 'Client #' . $dl->client_id : 'Guest');
            echo '<tr><td>' . (int) $dl->id . '</td><td>' . $this->h($client) . '<br><small>' . $this->h($dl->email) . '</small></td><td>' . $this->h($dl->product_name ?: '-') . '</td><td>' . $this->h($dl->version ?: '-') . '</td><td>' . $this->h($dl->ip_address) . '</td><td>' . $this->statusLabel($dl->status) . '</td>' . ($showFailure ? '<td>' . $this->h($dl->failure_reason) . '</td>' : '') . '<td>' . $this->h($dl->created_at) . '</td></tr>';
        }
        if (count($rows) === 0) { echo '<tr><td colspan="' . ($showFailure ? '8' : '7') . '" class="text-center text-muted">No download logs found.</td></tr>'; }
        echo '</tbody></table></div>';
    }

    protected function renderCustomers()
    {
        $rows = Capsule::table('mod_digitalproducts_entitlements as e')
            ->leftJoin('tblclients as c', 'c.id', '=', 'e.client_id')
            ->select('e.client_id', 'c.firstname', 'c.lastname', 'c.email', Capsule::raw('COUNT(e.id) as entitlement_count'), Capsule::raw("SUM(CASE WHEN e.status = 'active' THEN 1 ELSE 0 END) as active_count"), Capsule::raw('MAX(e.updated_at) as last_activity'))
            ->groupBy('e.client_id', 'c.firstname', 'c.lastname', 'c.email')
            ->orderBy('last_activity', 'desc')
            ->limit(200)
            ->get();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Digital Product Customers</h3></div><div class="table-responsive"><table class="table table-striped"><thead><tr><th>Client ID</th><th>Name</th><th>Email</th><th>Entitlements</th><th>Active</th><th>Last Activity</th></tr></thead><tbody>';
        foreach ($rows as $row) {
            $name = trim(($row->firstname ?: '') . ' ' . ($row->lastname ?: '')) ?: ('Client #' . $row->client_id);
            echo '<tr><td>' . (int) $row->client_id . '</td><td>' . $this->h($name) . '</td><td>' . $this->h($row->email) . '</td><td>' . (int) $row->entitlement_count . '</td><td>' . (int) $row->active_count . '</td><td>' . $this->h($row->last_activity) . '</td></tr>';
        }
        if (count($rows) === 0) { echo '<tr><td colspan="6" class="text-center text-muted">No digital product customers yet.</td></tr>'; }
        echo '</tbody></table></div></div>';
    }

    protected function renderApi()
    {
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">API</h3></div><div class="panel-body"><p>Digital Products exposes JSON endpoints for authenticated clients and license validation. Use HTTPS and Bearer tokens stored in <code>mod_digitalproducts_api_tokens</code>; plaintext query-string tokens are intentionally not accepted.</p><ul><li><code>GET api.php?endpoint=products</code></li><li><code>GET api.php?endpoint=my-downloads</code> (Bearer token or logged-in session)</li><li><code>POST api.php?endpoint=generate-download-token</code> with <code>service_id</code></li><li><code>POST api.php?endpoint=validate-license</code> with <code>license_key</code>, <code>domain</code>, optional <code>product</code></li><li><code>POST api.php?endpoint=activate-license</code></li></ul><p>Rate limiting and generic license-validation errors are enabled to prevent enumeration.</p></div></div>';
    }

    protected function renderSettings()
    {
        $s = $this->core->getSettings();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Settings</h3></div><div class="panel-body"><form method="post" class="form-horizontal">' . CapabilityPolicy::tokenField();
        $this->input('Default Download Limit', 'download_limit', $s['download_limit'], 'number');
        $this->input('Default Token Expiry Hours', 'download_expiry_hours', $s['download_expiry_hours'], 'number');
        $this->select('Default Access Mode', 'default_access_mode', array('CURRENT_VERSION'=>'Current version','PURCHASE_VERSION'=>'Purchase version'), $s['default_access_mode']);
        $this->input('Allowed Extensions', 'allowed_extensions', $s['allowed_extensions'], 'text');
        $this->input('Max Upload Bytes', 'max_upload_size', $s['max_upload_size'], 'number');
        $this->input('Private Storage Path', 'storage_path', $s['storage_path'], 'text');
        $this->input('API Rate Limit / Hour', 'api_rate_limit', $s['api_rate_limit'], 'number');
        foreach (array('license_enabled'=>'Enable license keys by default','email_delivery'=>'Send purchase/download emails','update_notifications'=>'Notify owners when current version changes','single_use_tokens'=>'Single-use download tokens') as $name => $label) { echo '<div class="form-group"><label class="col-sm-3 control-label">' . $this->h($label) . '</label><div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="' . $this->h($name) . '" value="on"' . (($s[$name] ?? '') === 'on' ? ' checked' : '') . '> Enabled</label></div></div>'; }
        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button name="save_settings" value="1" class="btn btn-primary">Save Settings</button></div></div></form></div></div>';
    }

    protected function renderAudit()
    {
        if (!Capsule::schema()->hasTable('mod_cloudhost247_audit_events')) { echo '<div class="alert alert-warning">CloudHost247 Foundation audit table is not available.</div>'; return; }
        $rows = Capsule::table('mod_cloudhost247_audit_events')->where('module','digitalproducts')->orderBy('id','desc')->limit(100)->get();
        echo '<div class="panel panel-default"><div class="panel-heading"><h3 class="panel-title">Digital Products Audit Events</h3></div><div class="table-responsive"><table class="table table-striped"><thead><tr><th>Time</th><th>Admin</th><th>Action</th><th>Resource</th><th>Result</th><th>Correlation</th></tr></thead><tbody>';
        foreach ($rows as $r) { echo '<tr><td>' . $this->h($r->created_at) . '</td><td>' . $this->h($r->admin_id) . '</td><td>' . $this->h($r->action) . '</td><td>' . $this->h($r->resource_type . ' ' . $r->resource_id) . '</td><td>' . $this->h($r->result) . '</td><td><code>' . $this->h($r->correlation_id) . '</code></td></tr>'; }
        if (count($rows) === 0) { echo '<tr><td colspan="6" class="text-center text-muted">No audit events yet.</td></tr>'; }
        echo '</tbody></table></div></div>';
    }

    protected function handleProductEdit()
    {
        if (isset($_POST['create_product'])) {
            $id = $this->core->createDigitalProduct((int) ($_POST['whmcs_product_id'] ?? 0), $_POST);
            $this->success = 'Product linked. Configure details and upload a version.';
            $this->redirect('product-edit', array('id' => $id));
        }
        if (isset($_POST['save_product'])) {
            $this->core->updateDigitalProduct((int) ($_POST['product_id'] ?? 0), $_POST);
            $this->success = 'Product updated.';
        }
    }

    protected function handleUpload()
    {
        $id = $this->core->uploadVersion((int) ($_POST['product_id'] ?? 0), $_FILES['file'] ?? array(), $_POST);
        $this->success = 'Version uploaded securely (#' . $id . ').';
        $this->redirect('versions', array('product_id' => (int) $_POST['product_id']));
    }

    protected function handleRetireProduct()
    {
        $this->core->deleteDigitalProduct((int) $_POST['retire_product']);
        $this->success = 'Product retired and active entitlements revoked.';
    }

    protected function handleVersionPost()
    {
        $productId = (int) ($_POST['product_id'] ?? 0);
        if (isset($_POST['set_active'])) { $this->core->setCurrentVersion($productId, (int) $_POST['set_active']); $this->success = 'Current version updated.'; }
        if (isset($_POST['retire_file'])) { $this->core->retireFile((int) $_POST['retire_file']); $this->success = 'Version retired. Physical file preserved.'; }
        if ($productId) { $this->redirect('versions', array('product_id' => $productId)); }
    }

    protected function handleEntitlementPost()
    {
        $id = (int) ($_POST['entitlement_id'] ?? 0); $action = (string) ($_POST['entitlement_action'] ?? ''); $svc = new EntitlementService();
        if ($action === 'grant') { $entitlement = $svc->grantForService((int) ($_POST['service_id'] ?? 0), null, true); if (!$entitlement) { throw new \RuntimeException('No active Digital Product is linked to that WHMCS service.'); } $this->success = 'Entitlement granted or recalculated.'; return; }
        if ($action === 'reset') { $svc->resetDownloadCounter($id); $this->success = 'Download counter reset.'; return; }
        if (in_array($action, array('active','suspended','revoked'), true)) { $svc->updateStatus($id, $action); $this->success = 'Entitlement updated.'; return; }
        throw new \RuntimeException('Invalid entitlement action.');
    }

    protected function handleLicensePost()
    {
        (new License())->updateLicenseStatus((int) ($_POST['license_id'] ?? 0), (string) ($_POST['license_status'] ?? ''));
        $this->success = 'License status updated.';
    }

    protected function handleSettings()
    {
        if (!isset($_POST['save_settings'])) { return; }
        $this->core->saveSettings($_POST);
        $this->success = 'Settings saved.';
    }

    protected function viewCapability($action)
    {
        $map = array('products'=>'digitalproducts.products.view','product-edit'=>'digitalproducts.products.view','upload'=>'digitalproducts.files.upload','versions'=>'digitalproducts.versions.manage','entitlements'=>'digitalproducts.entitlements.manage','licenses'=>'digitalproducts.licenses.manage','downloads'=>'digitalproducts.downloads.view','customers'=>'digitalproducts.downloads.view','settings'=>'digitalproducts.settings.manage','audit'=>'digitalproducts.audit.view','api'=>'digitalproducts.settings.manage');
        return isset($map[$action]) ? $map[$action] : 'digitalproducts.products.view';
    }

    protected function input($label, $name, $value, $type = 'text', $required = false)
    {
        echo '<div class="form-group"><label class="col-sm-3 control-label">' . $this->h($label) . '</label><div class="col-sm-6"><input type="' . $this->h($type) . '" name="' . $this->h($name) . '" class="form-control" value="' . $this->h($value) . '"' . ($required ? ' required' : '') . '></div></div>';
    }

    protected function textarea($label, $name, $value, $rows = 3)
    {
        echo '<div class="form-group"><label class="col-sm-3 control-label">' . $this->h($label) . '</label><div class="col-sm-6"><textarea name="' . $this->h($name) . '" class="form-control" rows="' . (int) $rows . '">' . $this->h($value) . '</textarea></div></div>';
    }

    protected function select($label, $name, array $options, $selected)
    {
        echo '<div class="form-group"><label class="col-sm-3 control-label">' . $this->h($label) . '</label><div class="col-sm-6"><select name="' . $this->h($name) . '" class="form-control">';
        foreach ($options as $value => $labelText) { echo '<option value="' . $this->h($value) . '"' . ((string) $selected === (string) $value ? ' selected' : '') . '>' . $this->h($labelText) . '</option>'; }
        echo '</select></div></div>';
    }

    protected function statusLabel($status)
    {
        $status = (string) $status;
        $class = in_array($status, array('active','success'), true) ? 'label-success' : (in_array($status, array('draft','inactive','suspended','expired'), true) ? 'label-warning' : 'label-default');
        if (in_array($status, array('failed','denied','invalid_token','not_entitled','file_missing','limit_exceeded','revoked','retired','cancelled'), true)) { $class = 'label-danger'; }
        return '<span class="label ' . $class . '">' . $this->h($status) . '</span>';
    }

    protected function h($value) { return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8'); }
    protected function url($action, array $params = array()) { return $this->h($this->moduleLink . '&action=' . $action . ($params ? '&' . http_build_query($params) : '')); }
    protected function redirect($action, array $params = array()) { header('Location: ' . $this->moduleLink . '&action=' . $action . ($params ? '&' . http_build_query($params) : '')); exit; }

    protected function formatBytes($bytes)
    {
        $bytes = (int) $bytes; if ($bytes <= 0) { return '0 Bytes'; }
        $sizes = array('Bytes','KB','MB','GB','TB'); $i = min(count($sizes)-1, (int) floor(log($bytes, 1024)));
        return round($bytes / pow(1024, $i), 2) . ' ' . $sizes[$i];
    }
}
