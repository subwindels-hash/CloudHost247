<?php
/**
 * DigitalProducts Admin Class
 *
 * Handles all admin area rendering and functionality.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

namespace DigitalProducts;

use WHMCS\Database\Capsule;
use Exception;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

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
        $this->moduleLink = $vars['modulelink'];
        $this->action = $_GET['action'] ?? 'dashboard';
    }

    public function render()
    {
        $this->handlePost();

        ob_start();
        echo '<div class="digitalproducts-admin">';

        if ($this->error) {
            echo '<div class="alert alert-danger"><i class="fa fa-exclamation-circle"></i> ' . $this->escape($this->error) . '</div>';
        }
        if ($this->success) {
            echo '<div class="alert alert-success"><i class="fa fa-check-circle"></i> ' . $this->escape($this->success) . '</div>';
        }

        switch ($this->action) {
            case 'dashboard':
                $this->renderDashboard();
                break;
            case 'products':
                $this->renderProducts();
                break;
            case 'product-edit':
                $this->renderProductEdit();
                break;
            case 'upload':
                $this->renderUpload();
                break;
            case 'versions':
                $this->renderVersions();
                break;
            case 'licenses':
                $this->renderLicenses();
                break;
            case 'downloads':
                $this->renderDownloads();
                break;
            case 'settings':
                $this->renderSettings();
                break;
            default:
                $this->renderDashboard();
        }

        echo '</div>';
        return ob_get_clean();
    }

    protected function handlePost()
    {
        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            return;
        }

        try {
            switch ($this->action) {
                case 'product-edit':
                    $this->handleProductEdit();
                    break;
                case 'upload':
                    $this->handleUpload();
                    break;
                case 'settings':
                    $this->handleSettings();
                    break;
                case 'products':
                    if (isset($_POST['delete_product'])) {
                        $this->handleDeleteProduct();
                    }
                    break;
                case 'versions':
                    if (isset($_POST['delete_file'])) {
                        $this->handleDeleteFile();
                    }
                    if (isset($_POST['set_active'])) {
                        $this->handleSetActiveFile();
                    }
                    break;
            }
        } catch (Exception $e) {
            $this->error = $e->getMessage();
        }
    }

    protected function renderDashboard()
    {
        $stats = $this->core->getDashboardStats();
        $recentDownloads = $this->core->getDownloadLogs(1, 10)['data'];
        $recentProducts = Capsule::table('mod_digitalproducts_products')
            ->orderBy('created_at', 'desc')
            ->limit(5)
            ->get();

        echo '<div class="row">';
        foreach ([
            ['products', 'Digital Products'],
            ['files', 'Files Uploaded'],
            ['downloads', 'Total Downloads'],
            ['today_downloads', 'Downloads Today']
        ] as $stat) {
            echo '<div class="col-sm-3"><div class="dp-stat-card">';
            echo '<div class="number">' . $stats[$stat[0]] . '</div>';
            echo '<div class="label">' . $stat[1] . '</div>';
            echo '</div></div>';
        }
        echo '</div>';

        echo '<div class="row">';
        echo '<div class="col-sm-8">';
        echo '<div class="panel panel-default"><div class="panel-heading">';
        echo '<h3 class="panel-title"><i class="fa fa-download"></i> Recent Downloads</h3></div>';
        echo '<div class="table-responsive"><table class="table table-striped">';
        echo '<thead><tr><th>Client</th><th>Product</th><th>Version</th><th>Status</th><th>Date</th></tr></thead><tbody>';
        foreach ($recentDownloads as $dl) {
            $statusClass = $dl->status === 'success' ? 'label-success' : ($dl->status === 'failed' ? 'label-danger' : 'label-warning');
            $clientName = $dl->firstname ? $dl->firstname . ' ' . $dl->lastname : 'Guest';
            echo '<tr><td>' . $this->escape($clientName) . '</td><td>' . $this->escape($dl->product_name) . '</td>';
            echo '<td>' . $this->escape($dl->version) . '</td>';
            echo '<td><span class="label ' . $statusClass . '">' . ucfirst($dl->status) . '</span></td>';
            echo '<td>' . $dl->created_at . '</td></tr>';
        }
        echo '</tbody></table></div>';
        echo '<div class="panel-footer text-right">';
        echo '<a href="' . $this->moduleLink . '&action=downloads" class="btn btn-default btn-sm">View All Downloads</a></div></div></div>';

        echo '<div class="col-sm-4">';
        echo '<div class="panel panel-default"><div class="panel-heading">';
        echo '<h3 class="panel-title"><i class="fa fa-cubes"></i> Recent Products</h3></div>';
        echo '<div class="list-group">';
        foreach ($recentProducts as $product) {
            $statusLabel = $product->status === 'active'
                ? '<span class="label label-success pull-right">Active</span>'
                : '<span class="label label-default pull-right">' . ucfirst($product->status) . '</span>';
            echo '<a href="' . $this->moduleLink . '&action=product-edit&id=' . $product->id . '" class="list-group-item">';
            echo $this->escape($product->product_name) . ' ' . $statusLabel . '</a>';
        }
        echo '</div>';
        echo '<div class="panel-footer text-right">';
        echo '<a href="' . $this->moduleLink . '&action=products" class="btn btn-default btn-sm">Manage Products</a></div></div></div>';
        echo '</div>';
    }

    protected function renderProducts()
    {
        $products = $this->core->getAllProducts(null);
        $unlinked = $this->core->getUnlinkedWhmcsProducts();

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading clearfix">';
        echo '<h3 class="panel-title pull-left"><i class="fa fa-cubes"></i> Digital Products</h3>';
        echo '<div class="pull-right">';
        echo '<a href="' . $this->moduleLink . '&action=upload" class="btn btn-success btn-sm"><i class="fa fa-upload"></i> Upload File</a>';
        echo '</div></div>';
        echo '<div class="table-responsive">';
        echo '<table class="table table-striped table-hover">';
        echo '<thead><tr><th>ID</th><th>Product Name</th><th>WHMCS Product</th><th>Current Version</th><th>Status</th><th>Downloads</th><th>Actions</th></tr></thead>';
        echo '<tbody>';

        foreach ($products as $product) {
            $currentFile = $product->current_file_id ? $this->core->getFileById($product->current_file_id) : null;
            $version = $currentFile ? $currentFile->version : '-';
            $statusClass = $product->status === 'active' ? 'label-success' : ($product->status === 'inactive' ? 'label-warning' : 'label-default');
            $totalDownloads = Capsule::table('mod_digitalproducts_downloads')
                ->where('product_id', $product->id)
                ->where('status', 'success')
                ->count();

            echo '<tr>';
            echo '<td>' . $product->id . '</td>';
            echo '<td><strong>' . $this->escape($product->product_name) . '</strong></td>';
            echo '<td>' . $this->escape($product->whmcs_product_name ?? 'N/A') . '</td>';
            echo '<td><span class="dp-version-badge">' . $this->escape($version) . '</span></td>';
            echo '<td><span class="label ' . $statusClass . '">' . ucfirst($product->status) . '</span></td>';
            echo '<td>' . $totalDownloads . '</td>';
            echo '<td>';
            echo '<a href="' . $this->moduleLink . '&action=product-edit&id=' . $product->id . '" class="btn btn-primary btn-xs"><i class="fa fa-edit"></i> Edit</a> ';
            echo '<form method="post" style="display:inline;" onsubmit="return confirm(\'Delete this product and all related files?\');">';
            echo '<input type="hidden" name="delete_product" value="' . $product->id . '">';
            echo '<button type="submit" class="btn btn-danger btn-xs"><i class="fa fa-trash"></i> Delete</button>';
            echo '</form>';
            echo '</td>';
            echo '</tr>';
        }

        if (count($products) === 0) {
            echo '<tr><td colspan="7" class="text-center text-muted">No digital products configured yet.</td></tr>';
        }

        echo '</tbody></table></div></div>';

        echo '<div class="panel panel-info">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-plus-circle"></i> Link New WHMCS Product</h3></div>';
        echo '<div class="panel-body">';
        echo '<form method="post" action="' . $this->moduleLink . '&action=product-edit" class="form-inline">';
        echo '<div class="form-group"><select name="whmcs_product_id" class="form-control" required>';
        echo '<option value="">Select WHMCS Product...</option>';
        foreach ($unlinked as $p) {
            echo '<option value="' . $p->id . '">' . $this->escape($p->name) . ' (' . ucfirst($p->type) . ')</option>';
        }
        echo '</select></div> ';
        echo '<button type="submit" name="create_product" class="btn btn-info"><i class="fa fa-link"></i> Link Product</button>';
        echo '</form>';
        echo '</div></div>';
    }

    protected function renderProductEdit()
    {
        $id = (int)($_GET['id'] ?? 0);
        if (!$id) {
            echo '<div class="alert alert-warning">Product ID required.</div>';
            return;
        }

        $product = Capsule::table('mod_digitalproducts_products')
            ->where('id', $id)
            ->first();

        if (!$product) {
            echo '<div class="alert alert-danger">Product not found.</div>';
            return;
        }

        $files = $this->core->getProductFiles($id);
        $currentFile = $product->current_file_id ? $this->core->getFileById($product->current_file_id) : null;

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-edit"></i> Edit Product: ' . $this->escape($product->product_name) . '</h3></div>';
        echo '<div class="panel-body">';
        echo '<form method="post" class="form-horizontal">';
        echo '<input type="hidden" name="product_id" value="' . $id . '">';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Product Name</label>';
        echo '<div class="col-sm-6"><input type="text" name="product_name" class="form-control" value="' . $this->escape($product->product_name) . '" required></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Description</label>';
        echo '<div class="col-sm-6"><textarea name="description" class="form-control" rows="3">' . $this->escape($product->description ?? '') . '</textarea></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Status</label>';
        echo '<div class="col-sm-6"><select name="status" class="form-control">';
        foreach (['active' => 'Active', 'inactive' => 'Inactive', 'retired' => 'Retired'] as $val => $label) {
            $selected = $product->status === $val ? ' selected' : '';
            echo '<option value="' . $val . '"' . $selected . '>' . $label . '</option>';
        }
        echo '</select></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Current File</label>';
        echo '<div class="col-sm-6"><select name="current_file_id" class="form-control">';
        echo '<option value="">-- No File --</option>';
        foreach ($files as $file) {
            $selected = $product->current_file_id == $file->id ? ' selected' : '';
            echo '<option value="' . $file->id . '"' . $selected . '>' . $this->escape($file->original_name) . ' (v' . $file->version . ')</option>';
        }
        echo '</select></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Download Limit</label>';
        echo '<div class="col-sm-6"><input type="number" name="download_limit" class="form-control" value="' . (int)$product->download_limit . '" min="0">';
        echo '<span class="help-block">0 = unlimited</span></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Link Expiry (hours)</label>';
        echo '<div class="col-sm-6"><input type="number" name="link_expiry_hours" class="form-control" value="' . (int)$product->link_expiry_hours . '" min="1"></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">License Keys</label>';
        echo '<div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="license_enabled" value="1"' . ($product->license_enabled ? ' checked' : '') . '> Enable license key generation</label></div></div>';

        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button type="submit" name="save_product" class="btn btn-primary"><i class="fa fa-save"></i> Save Changes</button></div></div>';
        echo '</form></div></div>';

        // Versions section
        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-code-fork"></i> Versions & Files</h3></div>';
        echo '<div class="table-responsive"><table class="table table-striped">';
        echo '<thead><tr><th>Version</th><th>Filename</th><th>Size</th><th>Downloads</th><th>Status</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>';
        foreach ($files as $file) {
            $isActive = $product->current_file_id == $file->id;
            $statusLabel = $isActive
                ? '<span class="label label-success">Active</span>'
                : '<span class="label label-default">Inactive</span>';
            echo '<tr>';
            echo '<td><span class="dp-version-badge">' . $this->escape($file->version) . '</span></td>';
            echo '<td>' . $this->escape($file->original_name) . '</td>';
            echo '<td>' . $this->formatBytes($file->file_size) . '</td>';
            echo '<td>' . $file->download_count . '</td>';
            echo '<td>' . $statusLabel . '</td>';
            echo '<td>' . $file->created_at . '</td>';
            echo '<td>';
            if (!$isActive) {
                echo '<form method="post" style="display:inline;">';
                echo '<input type="hidden" name="set_active" value="' . $file->id . '">';
                echo '<input type="hidden" name="product_id" value="' . $id . '">';
                echo '<button type="submit" class="btn btn-success btn-xs"><i class="fa fa-check"></i> Set Active</button></form> ';
            }
            echo '<form method="post" style="display:inline;" onsubmit="return confirm(\'Delete this file?\');">';
            echo '<input type="hidden" name="delete_file" value="' . $file->id . '">';
            echo '<input type="hidden" name="product_id" value="' . $id . '">';
            echo '<button type="submit" class="btn btn-danger btn-xs"><i class="fa fa-trash"></i> Delete</button></form>';
            echo '</td></tr>';
        }
        if (count($files) === 0) {
            echo '<tr><td colspan="7" class="text-center text-muted">No files uploaded yet. <a href="' . $this->moduleLink . '&action=upload&product_id=' . $id . '">Upload one now</a>.</td></tr>';
        }
        echo '</tbody></table></div></div>';
    }

    protected function renderUpload()
    {
        $products = $this->core->getAllProducts('active');
        $preselectedProduct = (int)($_GET['product_id'] ?? 0);

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-upload"></i> Upload New File</h3></div>';
        echo '<div class="panel-body">';
        echo '<form method="post" enctype="multipart/form-data" class="form-horizontal">';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Select Product</label>';
        echo '<div class="col-sm-6"><select name="product_id" class="form-control" required>';
        echo '<option value="">-- Select Product --</option>';
        foreach ($products as $p) {
            $selected = $preselectedProduct == $p->id ? ' selected' : '';
            echo '<option value="' . $p->id . '"' . $selected . '>' . $this->escape($p->product_name) . '</option>';
        }
        echo '</select></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Version</label>';
        echo '<div class="col-sm-6"><input type="text" name="version" class="form-control" value="1.0.0" placeholder="e.g. 2.1.0" required>';
        echo '<span class="help-block">Semantic versioning recommended (e.g. 1.0.0)</span></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Changelog</label>';
        echo '<div class="col-sm-6"><textarea name="changelog" class="form-control" rows="3" placeholder="What changed in this version?"></textarea></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">File</label>';
        echo '<div class="col-sm-6">';
        echo '<div class="dp-file-dropzone" id="dp-dropzone">';
        echo '<p><i class="fa fa-cloud-upload fa-3x" style="color:#ccc;"></i></p>';
        echo '<p>Drag & drop your file here or click to browse</p>';
        echo '<input type="file" name="file" id="dp-file-input" style="display:none;" required>';
        echo '<p class="text-muted small">Max: 500MB. ZIP, PHP, JS, modules preferred.</p>';
        echo '</div>';
        echo '<div id="dp-file-info" class="help-block text-success"></div>';
        echo '</div></div>';

        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button type="submit" class="btn btn-primary"><i class="fa fa-upload"></i> Upload File</button></div></div>';
        echo '</form></div></div>';

        echo '<script>';
        echo 'document.getElementById("dp-dropzone").addEventListener("click", function() { document.getElementById("dp-file-input").click(); });';
        echo 'document.getElementById("dp-file-input").addEventListener("change", function(e) {';
        echo 'if(e.target.files.length) { document.getElementById("dp-file-info").innerHTML = "<strong>Selected:</strong> " + e.target.files[0].name + " (" + formatBytes(e.target.files[0].size) + ")"; }';
        echo '});';
        echo 'function formatBytes(b){ if(b===0)return"0 Bytes"; var k=1024,s=["Bytes","KB","MB","GB"],i=Math.floor(Math.log(b)/Math.log(k)); return parseFloat((b/Math.pow(k,i)).toFixed(2))+" "+s[i]; }';
        echo '</script>';
    }

    protected function renderVersions()
    {
        $productId = (int)($_GET['product_id'] ?? 0);

        if ($productId) {
            $product = Capsule::table('mod_digitalproducts_products')->where('id', $productId)->first();
            $files = $this->core->getProductFiles($productId);

            echo '<div class="panel panel-default">';
            echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-code-fork"></i> Versions: ' . $this->escape($product->product_name ?? 'Unknown') . '</h3></div>';
            echo '<div class="table-responsive"><table class="table table-striped">';
            echo '<thead><tr><th>Version</th><th>Filename</th><th>Size</th><th>Downloads</th><th>Status</th><th>Uploaded</th><th>Actions</th></tr></thead><tbody>';
            foreach ($files as $file) {
                $isActive = $product && $product->current_file_id == $file->id;
                $statusLabel = $isActive ? '<span class="label label-success">Active</span>' : '<span class="label label-default">Inactive</span>';
                echo '<tr>';
                echo '<td><span class="dp-version-badge">' . $this->escape($file->version) . '</span></td>';
                echo '<td>' . $this->escape($file->original_name) . '</td>';
                echo '<td>' . $this->formatBytes($file->file_size) . '</td>';
                echo '<td>' . $file->download_count . '</td>';
                echo '<td>' . $statusLabel . '</td>';
                echo '<td>' . $file->created_at . '</td>';
                echo '<td>';
                if (!$isActive) {
                    echo '<form method="post" style="display:inline;">';
                    echo '<input type="hidden" name="set_active" value="' . $file->id . '">';
                    echo '<input type="hidden" name="product_id" value="' . $productId . '">';
                    echo '<button type="submit" class="btn btn-success btn-xs"><i class="fa fa-check"></i> Set Active</button></form> ';
                }
                echo '<form method="post" style="display:inline;" onsubmit="return confirm(\'Delete this file?\');">';
                echo '<input type="hidden" name="delete_file" value="' . $file->id . '">';
                echo '<input type="hidden" name="product_id" value="' . $productId . '">';
                echo '<button type="submit" class="btn btn-danger btn-xs"><i class="fa fa-trash"></i> Delete</button></form>';
                echo '</td></tr>';
            }
            echo '</tbody></table></div></div>';
        } else {
            $products = $this->core->getAllProducts();
            echo '<div class="panel panel-default">';
            echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-code-fork"></i> Version Management</h3></div>';
            echo '<div class="list-group">';
            foreach ($products as $product) {
                $fileCount = Capsule::table('mod_digitalproducts_files')->where('product_id', $product->id)->count();
                echo '<a href="' . $this->moduleLink . '&action=versions&product_id=' . $product->id . '" class="list-group-item">';
                echo '<h4 class="list-group-item-heading">' . $this->escape($product->product_name) . '</h4>';
                echo '<p class="list-group-item-text">' . $fileCount . ' file(s) uploaded</p>';
                echo '</a>';
            }
            echo '</div></div>';
        }
    }

    protected function renderLicenses()
    {
        $page = (int)($_GET['page'] ?? 1);
        $perPage = 25;

        $query = Capsule::table('mod_digitalproducts_licenses')
            ->select(
                'mod_digitalproducts_licenses.*',
                'mod_digitalproducts_products.product_name',
                'tblhosting.domain',
                'tblclients.firstname',
                'tblclients.lastname',
                'tblclients.email'
            )
            ->leftJoin('mod_digitalproducts_products', 'mod_digitalproducts_products.id', '=', 'mod_digitalproducts_licenses.product_id')
            ->leftJoin('tblhosting', 'tblhosting.id', '=', 'mod_digitalproducts_licenses.service_id')
            ->leftJoin('tblclients', 'tblclients.id', '=', 'mod_digitalproducts_licenses.client_id')
            ->orderBy('mod_digitalproducts_licenses.created_at', 'desc');

        $total = $query->count();
        $licenses = $query->forPage($page, $perPage)->get();

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-key"></i> License Keys</h3></div>';
        echo '<div class="table-responsive"><table class="table table-striped">';
        echo '<thead><tr><th>License Key</th><th>Product</th><th>Client</th><th>Domain</th><th>Activations</th><th>Status</th><th>Created</th></tr></thead><tbody>';
        foreach ($licenses as $lic) {
            $statusClass = $lic->status === 'active' ? 'label-success' : ($lic->status === 'suspended' ? 'label-warning' : 'label-default');
            $clientName = $lic->firstname ? $lic->firstname . ' ' . $lic->lastname : 'Unknown';
            echo '<tr>';
            echo '<td><code>' . $this->escape($lic->license_key) . '</code></td>';
            echo '<td>' . $this->escape($lic->product_name ?? 'N/A') . '</td>';
            echo '<td>' . $this->escape($clientName) . '</td>';
            echo '<td>' . $this->escape($lic->domain ?? '-') . '</td>';
            echo '<td>' . $lic->activations_count . '/' . ($lic->activations_limit ?: 'unlimited') . '</td>';
            echo '<td><span class="label ' . $statusClass . '">' . ucfirst($lic->status) . '</span></td>';
            echo '<td>' . $lic->created_at . '</td>';
            echo '</tr>';
        }
        if (count($licenses) === 0) {
            echo '<tr><td colspan="7" class="text-center text-muted">No licenses generated yet.</td></tr>';
        }
        echo '</tbody></table></div>';

        // Pagination
        $lastPage = max(1, ceil($total / $perPage));
        if ($lastPage > 1) {
            echo '<div class="panel-footer"><ul class="pagination pagination-sm" style="margin:0;">';
            for ($i = 1; $i <= $lastPage; $i++) {
                $active = $i === $page ? ' class="active"' : '';
                echo '<li' . $active . '><a href="' . $this->moduleLink . '&action=licenses&page=' . $i . '">' . $i . '</a></li>';
            }
            echo '</ul></div>';
        }
        echo '</div>';
    }

    protected function renderDownloads()
    {
        $page = (int)($_GET['page'] ?? 1);
        $perPage = 25;
        $filters = [
            'client_id' => $_GET['client_id'] ?? '',
            'product_id' => $_GET['product_id'] ?? '',
            'status' => $_GET['status'] ?? '',
            'date_from' => $_GET['date_from'] ?? '',
            'date_to' => $_GET['date_to'] ?? '',
        ];

        $logs = $this->core->getDownloadLogs($page, $perPage, array_filter($filters));
        $products = $this->core->getAllProducts();

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-download"></i> Download Logs</h3></div>';
        echo '<div class="panel-body">';
        echo '<form method="get" class="form-inline">';
        echo '<input type="hidden" name="module" value="digitalproducts">';
        echo '<input type="hidden" name="action" value="downloads">';
        echo '<div class="form-group"><select name="product_id" class="form-control"><option value="">All Products</option>';
        foreach ($products as $p) {
            $selected = $filters['product_id'] == $p->id ? ' selected' : '';
            echo '<option value="' . $p->id . '"' . $selected . '>' . $this->escape($p->product_name) . '</option>';
        }
        echo '</select></div> ';
        echo '<div class="form-group"><select name="status" class="form-control"><option value="">All Statuses</option>';
        foreach (['success', 'failed', 'expired', 'limit'] as $s) {
            $selected = $filters['status'] === $s ? ' selected' : '';
            echo '<option value="' . $s . '"' . $selected . '>' . ucfirst($s) . '</option>';
        }
        echo '</select></div> ';
        echo '<div class="form-group"><input type="date" name="date_from" class="form-control" value="' . $this->escape($filters['date_from']) . '" placeholder="From"></div> ';
        echo '<div class="form-group"><input type="date" name="date_to" class="form-control" value="' . $this->escape($filters['date_to']) . '" placeholder="To"></div> ';
        echo '<button type="submit" class="btn btn-default"><i class="fa fa-filter"></i> Filter</button>';
        echo '</form></div>';

        echo '<div class="table-responsive"><table class="table table-striped">';
        echo '<thead><tr><th>ID</th><th>Client</th><th>Product</th><th>Version</th><th>IP Address</th><th>Status</th><th>Date</th></tr></thead><tbody>';
        foreach ($logs['data'] as $dl) {
            $statusClass = $dl->status === 'success' ? 'label-success' : ($dl->status === 'failed' ? 'label-danger' : 'label-warning');
            $clientName = $dl->firstname ? $dl->firstname . ' ' . $dl->lastname : 'Guest';
            echo '<tr>';
            echo '<td>' . $dl->id . '</td>';
            echo '<td>' . $this->escape($clientName) . ' <small class="text-muted">' . $this->escape($dl->email ?? '') . '</small></td>';
            echo '<td>' . $this->escape($dl->product_name ?? 'N/A') . '</td>';
            echo '<td>' . $this->escape($dl->version ?? '-') . '</td>';
            echo '<td>' . $this->escape($dl->ip_address ?? '-') . '</td>';
            echo '<td><span class="label ' . $statusClass . '">' . ucfirst($dl->status) . '</span></td>';
            echo '<td>' . $dl->created_at . '</td>';
            echo '</tr>';
        }
        if (count($logs['data']) === 0) {
            echo '<tr><td colspan="7" class="text-center text-muted">No download logs found.</td></tr>';
        }
        echo '</tbody></table></div>';

        if ($logs['last_page'] > 1) {
            echo '<div class="panel-footer"><ul class="pagination pagination-sm" style="margin:0;">';
            for ($i = 1; $i <= $logs['last_page']; $i++) {
                $active = $i === $page ? ' class="active"' : '';
                $url = $this->moduleLink . '&action=downloads&page=' . $i;
                foreach ($filters as $k => $v) {
                    if ($v) $url .= '&' . $k . '=' . urlencode($v);
                }
                echo '<li' . $active . '><a href="' . $url . '">' . $i . '</a></li>';
            }
            echo '</ul></div>';
        }
        echo '</div>';
    }

    protected function renderSettings()
    {
        $settings = $this->core->getSettings();

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-cog"></i> Module Settings</h3></div>';
        echo '<div class="panel-body">';
        echo '<form method="post" class="form-horizontal">';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Default Download Limit</label>';
        echo '<div class="col-sm-6"><input type="number" name="download_limit" class="form-control" value="' . (int)($settings['download_limit'] ?? 5) . '" min="0">';
        echo '<span class="help-block">Max downloads per purchase (0 = unlimited)</span></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Link Expiry (hours)</label>';
        echo '<div class="col-sm-6"><input type="number" name="link_expiry_hours" class="form-control" value="' . (int)($settings['link_expiry_hours'] ?? 48) . '" min="1"></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Enable License Keys</label>';
        echo '<div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="license_enabled" value="on"' . (($settings['license_enabled'] ?? 'on') === 'on' ? ' checked' : '') . '> Generate license keys for purchases</label></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">File Storage Path</label>';
        echo '<div class="col-sm-6"><input type="text" name="storage_path" class="form-control" value="' . $this->escape($settings['storage_path'] ?? '') . '" placeholder="Absolute path (leave empty for default)">';
        echo '<span class="help-block">Leave empty to use default: WHMCS_ROOT/storage/digitalproducts/</span></div></div>';

        echo '<div class="form-group"><label class="col-sm-3 control-label">Email Delivery</label>';
        echo '<div class="col-sm-6"><label class="checkbox-inline"><input type="checkbox" name="email_delivery" value="on"' . (($settings['email_delivery'] ?? 'on') === 'on' ? ' checked' : '') . '> Send download info email after purchase</label></div></div>';

        echo '<div class="form-group"><div class="col-sm-offset-3 col-sm-6"><button type="submit" name="save_settings" class="btn btn-primary"><i class="fa fa-save"></i> Save Settings</button></div></div>';
        echo '</form></div></div>';
    }

    // -- POST Handlers --

    protected function handleProductEdit()
    {
        if (isset($_POST['create_product'])) {
            $whmcsProductId = (int)$_POST['whmcs_product_id'];
            if (!$whmcsProductId) {
                throw new Exception("Please select a WHMCS product.");
            }
            $this->core->createDigitalProduct($whmcsProductId);
            $this->success = "Product linked successfully.";
            header("Location: " . $this->moduleLink . "&action=products");
            exit;
        }

        if (isset($_POST['save_product'])) {
            $id = (int)$_POST['product_id'];
            $data = [
                'product_name' => $_POST['product_name'] ?? '',
                'description' => $_POST['description'] ?? '',
                'status' => $_POST['status'] ?? 'active',
                'current_file_id' => !empty($_POST['current_file_id']) ? (int)$_POST['current_file_id'] : null,
                'download_limit' => (int)($_POST['download_limit'] ?? 0),
                'link_expiry_hours' => (int)($_POST['link_expiry_hours'] ?? 48),
                'license_enabled' => isset($_POST['license_enabled']) ? true : false,
            ];
            $this->core->updateDigitalProduct($id, $data);
            $this->success = "Product updated successfully.";
        }
    }

    protected function handleUpload()
    {
        if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
            throw new Exception("File upload failed. Error code: " . ($_FILES['file']['error'] ?? 'No file'));
        }

        $productId = (int)$_POST['product_id'];
        $version = trim($_POST['version'] ?? '1.0.0');
        $changelog = $_POST['changelog'] ?? '';

        if (!$productId) {
            throw new Exception("Please select a product.");
        }

        $product = Capsule::table('mod_digitalproducts_products')->where('id', $productId)->first();
        if (!$product) {
            throw new Exception("Product not found.");
        }

        $file = $_FILES['file'];
        $originalName = basename($file['name']);
        $fileExt = pathinfo($originalName, PATHINFO_EXTENSION);
        $fileHash = hash_file('sha256', $file['tmp_name']);
        $fileSize = $file['size'];

        $storagePath = $this->core->getStoragePath();
        $safeName = preg_replace('/[^a-zA-Z0-9_-]/', '_', $product->product_name);
        $newFilename = $safeName . '_v' . preg_replace('/[^0-9.]/', '_', $version) . '_' . substr($fileHash, 0, 12) . '.' . $fileExt;
        $destination = $storagePath . '/' . $newFilename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            throw new Exception("Failed to move uploaded file to storage.");
        }

        $fileId = Capsule::table('mod_digitalproducts_files')->insertGetId([
            'product_id' => $productId,
            'version' => $version,
            'filename' => $newFilename,
            'original_name' => $originalName,
            'file_path' => $destination,
            'file_hash' => $fileHash,
            'file_size' => $fileSize,
            'changelog' => $changelog,
            'status' => 'active',
            'created_at' => date('Y-m-d H:i:s'),
            'updated_at' => date('Y-m-d H:i:s'),
        ]);

        // Auto-set as current if no current file exists
        if (!$product->current_file_id) {
            Capsule::table('mod_digitalproducts_products')
                ->where('id', $productId)
                ->update([
                    'current_file_id' => $fileId,
                    'updated_at' => date('Y-m-d H:i:s'),
                ]);
        }

        $this->success = "File uploaded successfully. Version {$version}";
    }

    protected function handleDeleteProduct()
    {
        $id = (int)$_POST['delete_product'];
        $this->core->deleteDigitalProduct($id);
        $this->success = "Product deleted successfully.";
        header("Location: " . $this->moduleLink . "&action=products");
        exit;
    }

    protected function handleDeleteFile()
    {
        $fileId = (int)$_POST['delete_file'];
        $productId = (int)$_POST['product_id'];

        $file = Capsule::table('mod_digitalproducts_files')->where('id', $fileId)->first();
        if ($file && file_exists($file->file_path)) {
            unlink($file->file_path);
        }

        Capsule::table('mod_digitalproducts_files')->where('id', $fileId)->delete();

        // If this was the current file, clear it
        Capsule::table('mod_digitalproducts_products')
            ->where('current_file_id', $fileId)
            ->update([
                'current_file_id' => null,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);

        $this->success = "File deleted.";
        if ($productId) {
            header("Location: " . $this->moduleLink . "&action=product-edit&id=" . $productId);
            exit;
        }
    }

    protected function handleSetActiveFile()
    {
        $fileId = (int)$_POST['set_active'];
        $productId = (int)$_POST['product_id'];

        Capsule::table('mod_digitalproducts_products')
            ->where('id', $productId)
            ->update([
                'current_file_id' => $fileId,
                'updated_at' => date('Y-m-d H:i:s'),
            ]);

        $this->success = "Version updated successfully.";
        if ($productId) {
            header("Location: " . $this->moduleLink . "&action=product-edit&id=" . $productId);
            exit;
        }
    }

    protected function handleSettings()
    {
        if (!isset($_POST['save_settings'])) {
            return;
        }

        $settings = [
            'download_limit' => (int)($_POST['download_limit'] ?? 5),
            'link_expiry_hours' => (int)($_POST['link_expiry_hours'] ?? 48),
            'license_enabled' => isset($_POST['license_enabled']) ? 'on' : '',
            'storage_path' => trim($_POST['storage_path'] ?? ''),
            'email_delivery' => isset($_POST['email_delivery']) ? 'on' : '',
        ];

        foreach ($settings as $key => $value) {
            Capsule::table('tbladdonmodules')
                ->updateOrInsert(
                    ['module' => 'digitalproducts', 'setting' => $key],
                    ['value' => $value]
                );
        }

        $this->success = "Settings saved successfully.";
    }

    // -- Utilities --

    protected function escape($text)
    {
        return htmlspecialchars($text ?? '', ENT_QUOTES, 'UTF-8');
    }

    protected function formatBytes($bytes)
    {
        if ($bytes === 0 || $bytes === null) return '0 Bytes';
        $k = 1024;
        $sizes = ['Bytes', 'KB', 'MB', 'GB'];
        $i = floor(log($bytes) / log($k));
        return round($bytes / pow($k, $i), 2) . ' ' . $sizes[$i];
    }
}
