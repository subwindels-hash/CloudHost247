<?php
/** CloudHost247 Digital Products client area controller. */
namespace DigitalProducts;

use WHMCS\Database\Capsule;

if (!defined('WHMCS')) { die('This file cannot be accessed directly'); }

class Client
{
    protected $vars;
    protected $core;
    protected $clientId;

    public function __construct($vars)
    {
        $this->vars = $vars;
        $this->core = new Core();
        $this->clientId = (int) ($_SESSION['uid'] ?? 0);
    }

    public function render($action)
    {
        if (!$this->clientId) { return '<div class="alert alert-danger">Please sign in to access your downloads.</div>'; }
        ob_start();
        echo '<div class="digitalproducts-client ch247-downloads">';
        switch ($action) {
            case 'detail': $this->renderDetail((int) ($_GET['id'] ?? 0)); break;
            case 'downloads':
            default: $this->renderDownloads(); break;
        }
        echo '</div>';
        return ob_get_clean();
    }

    protected function renderDownloads()
    {
        $downloads = $this->core->getClientDownloads($this->clientId);
        echo '<div class="dp-client-hero"><h2><i class="fa fa-download"></i> My Downloads</h2><p>Secure access to your CloudHost247 digital products, license keys, release history and checksums.</p></div>';
        if (count($downloads) === 0) {
            echo '<div class="panel panel-default"><div class="panel-body text-center text-muted"><p><i class="fa fa-inbox fa-3x"></i></p><p>You do not currently have active digital product downloads.</p><p><a class="btn btn-primary" href="cart.php">Browse products</a></p></div></div>';
            return;
        }
        echo '<div class="dp-download-grid">';
        foreach ($downloads as $item) { $this->renderDownloadCard($item); }
        echo '</div>';
    }

    protected function renderDownloadCard($item)
    {
        $limit = (int) $item->download_limit_effective;
        $used = (int) $item->download_count;
        $remaining = $limit === 0 ? 'Unlimited' : max(0, $limit - $used);
        $canDownload = $limit === 0 || $used < $limit;
        echo '<div class="dp-download-card panel panel-default"><div class="panel-body"><div class="row"><div class="col-sm-8"><h3>' . $this->h($item->product_name) . '</h3><p class="text-muted">' . $this->h($item->short_description ?: '') . '</p><p><span class="label label-info">Version ' . $this->h($item->version) . '</span> ' . $this->statusLabel($item->status) . '</p></div><div class="col-sm-4 text-sm-right"><p><strong>Purchased:</strong><br>' . $this->h($this->date($item->purchase_date)) . '</p></div></div>';
        echo '<div class="row dp-download-meta"><div class="col-sm-3"><strong>License</strong><br>' . ($item->license_key_display ? '<code>' . $this->h($item->license_key_display) . '</code>' : '<span class="text-muted">Not required</span>') . '</div><div class="col-sm-3"><strong>Downloads</strong><br>' . ($limit === 0 ? $used . ' / Unlimited' : $used . ' / ' . $limit) . '</div><div class="col-sm-3"><strong>Remaining</strong><br>' . $this->h($remaining) . '</div><div class="col-sm-3"><strong>Checksum</strong><br><code class="dp-checksum">' . $this->h($item->file_hash) . '</code></div></div>';
        echo '<div class="dp-download-actions">';
        if ($canDownload) {
            echo '<form method="post" action="modules/addons/digitalproducts/download.php" style="display:inline">' . $this->tokenField() . '<input type="hidden" name="service_id" value="' . (int) $item->service_id . '"><input type="hidden" name="file_id" value="' . (int) $item->file_id . '"><button class="btn btn-success"><i class="fa fa-download"></i> Download</button></form> ';
        } else {
            echo '<button class="btn btn-default" disabled><i class="fa fa-ban"></i> Download limit reached</button> ';
        }
        echo '<a class="btn btn-default" href="index.php?m=digitalproducts&action=detail&id=' . (int) $item->id . '">View Details</a></div>';
        if ($item->release_notes || $item->changelog) { echo '<hr><p><strong>Latest changes:</strong><br>' . nl2br($this->h($item->release_notes ?: $item->changelog)) . '</p>'; }
        echo '</div></div>';
    }

    protected function renderDetail($entitlementId)
    {
        $downloads = $this->core->getClientDownloads($this->clientId);
        $item = null;
        foreach ($downloads as $download) { if ((int) $download->id === (int) $entitlementId) { $item = $download; break; } }
        if (!$item) { echo '<div class="alert alert-danger">This download is not available.</div><p><a class="btn btn-default" href="index.php?m=digitalproducts&action=downloads">Back to My Downloads</a></p>'; return; }
        echo '<p><a class="btn btn-default" href="index.php?m=digitalproducts&action=downloads"><i class="fa fa-arrow-left"></i> Back to My Downloads</a></p>';
        echo '<div class="panel panel-default"><div class="panel-heading"><h2 class="panel-title">' . $this->h($item->product_name) . '</h2></div><div class="panel-body"><p>' . nl2br($this->h($item->description)) . '</p><div class="table-responsive"><table class="table table-striped"><tbody>';
        $rows = array('Current version'=>$item->version, 'Purchased'=>$this->date($item->purchase_date), 'File size'=>$this->formatBytes($item->file_size), 'SHA-256 checksum'=>$item->file_hash, 'License key'=>$item->license_key_display ?: 'Not required', 'Downloads used'=>(int)$item->download_count, 'Download limit'=>$item->download_limit_effective ? (int)$item->download_limit_effective : 'Unlimited', 'Minimum PHP'=>$item->minimum_php_version ?: '-', 'Maximum PHP'=>$item->maximum_php_version ?: '-', 'Minimum WHMCS'=>$item->minimum_whmcs_version ?: '-', 'Maximum WHMCS'=>$item->maximum_whmcs_version ?: '-');
        foreach ($rows as $label => $value) { echo '<tr><th style="width:220px">' . $this->h($label) . '</th><td>' . ($label === 'SHA-256 checksum' || $label === 'License key' ? '<code>' . $this->h($value) . '</code>' : $this->h($value)) . '</td></tr>'; }
        echo '</tbody></table></div><h4>Release notes</h4><p>' . nl2br($this->h($item->release_notes ?: $item->changelog ?: 'No release notes were provided.')) . '</p>';
        $versions = Capsule::table('mod_digitalproducts_files')->where('product_id', (int) $item->product_id)->where('status', 'active')->orderBy('created_at','desc')->get();
        echo '<h4>Release history</h4><div class="table-responsive"><table class="table table-condensed"><thead><tr><th>Version</th><th>Date</th><th>Size</th><th>Checksum</th></tr></thead><tbody>';
        foreach ($versions as $v) { echo '<tr><td>' . $this->h($v->version) . '</td><td>' . $this->h($v->release_date ?: $this->date($v->created_at)) . '</td><td>' . $this->formatBytes($v->file_size) . '</td><td><code class="dp-checksum">' . $this->h($v->checksum_sha256 ?: $v->file_hash) . '</code></td></tr>'; }
        echo '</tbody></table></div></div><div class="panel-footer">';
        echo '<form method="post" action="modules/addons/digitalproducts/download.php" style="display:inline">' . $this->tokenField() . '<input type="hidden" name="service_id" value="' . (int) $item->service_id . '"><input type="hidden" name="file_id" value="' . (int) $item->file_id . '"><button class="btn btn-success"><i class="fa fa-download"></i> Download Current Version</button></form>';
        echo '</div></div>';
    }

    protected function tokenField()
    {
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        return '<input type="hidden" name="token" value="' . $this->h($token) . '">';
    }

    protected function statusLabel($status)
    {
        $class = $status === 'active' ? 'label-success' : 'label-warning';
        return '<span class="label ' . $class . '">' . $this->h($status) . '</span>';
    }

    protected function h($text) { return htmlspecialchars((string) $text, ENT_QUOTES, 'UTF-8'); }
    protected function date($value) { $time = strtotime((string) $value); return $time ? date('F j, Y', $time) : '-'; }
    protected function formatBytes($bytes) { $bytes = (int) $bytes; if ($bytes <= 0) return '0 Bytes'; $sizes = array('Bytes','KB','MB','GB','TB'); $i = min(count($sizes)-1, (int) floor(log($bytes, 1024))); return round($bytes / pow(1024, $i), 2) . ' ' . $sizes[$i]; }
}
