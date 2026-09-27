<?php
/**
 * DigitalProducts Client Class
 *
 * Handles all client area rendering and functionality.
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

class Client
{
    protected $vars;
    protected $core;
    protected $clientId;

    public function __construct($vars)
    {
        $this->vars = $vars;
        $this->core = new Core();
        $this->clientId = (int)($_SESSION['uid'] ?? 0);
    }

    public function render($action)
    {
        if (!$this->clientId) {
            return '<div class="alert alert-danger">You must be logged in to access this area.</div>';
        }

        ob_start();
        echo '<div class="digitalproducts-client">';

        switch ($action) {
            case 'downloads':
            default:
                $this->renderDownloads();
                break;
        }

        echo '</div>';
        return ob_get_clean();
    }

    protected function renderDownloads()
    {
        $downloads = $this->core->getClientDownloads($this->clientId);

        echo '<div class="panel panel-default">';
        echo '<div class="panel-heading"><h3 class="panel-title"><i class="fa fa-download"></i> My Downloads</h3></div>';
        echo '<div class="panel-body">';
        echo '<p class="text-muted">Your purchased digital products are listed below. Download links are valid for 48 hours.</p>';
        echo '</div>';

        if (count($downloads) === 0) {
            echo '<div class="panel-body text-center text-muted">';
            echo '<p><i class="fa fa-inbox fa-3x" style="color:#ddd;"></i></p>';
            echo '<p>You have no active digital product downloads.</p>';
            echo '<p><a href="cart.php" class="btn btn-primary">Browse Products</a></p>';
            echo '</div>';
        } else {
            echo '<div class="table-responsive">';
            echo '<table class="table table-striped">';
            echo '<thead><tr><th>Product</th><th>Version</th><th>License Key</th><th>Purchased</th><th>Next Due</th><th>Downloads</th><th>Action</th></tr></thead>';
            echo '<tbody>';

            foreach ($downloads as $item) {
                $downloadCount = $this->core->getDownloadCount($this->clientId, $item->service_id, $item->file_id);
                $downloadLimit = (int)($item->download_limit ?? 0);
                $canDownload = $downloadLimit === 0 || $downloadCount < $downloadLimit;
                $licenseStatusLabel = '';

                if ($item->license_key) {
                    $licStatus = $item->license_status ?? 'active';
                    $licClass = $licStatus === 'active' ? 'label-success' : 'label-warning';
                    $licenseStatusLabel = ' <span class="label ' . $licClass . '">' . ucfirst($licStatus) . '</span>';
                }

                $downloadBtn = $canDownload
                    ? '<form method="post" action="modules/addons/digitalproducts/download.php" style="display:inline;">' .
                      '<input type="hidden" name="service_id" value="' . $item->service_id . '">' .
                      '<input type="hidden" name="file_id" value="' . $item->file_id . '">' .
                      '<button type="submit" class="btn btn-success btn-sm"><i class="fa fa-download"></i> Download</button>' .
                      '</form>'
                    : '<button class="btn btn-default btn-sm" disabled title="Download limit reached"><i class="fa fa-ban"></i> Limit Reached</button>';

                $limitText = $downloadLimit === 0 ? 'Unlimited' : ($downloadCount . '/' . $downloadLimit);

                echo '<tr>';
                echo '<td><strong>' . $this->escape($item->product_name) . '</strong></td>';
                echo '<td><span class="badge badge-info">' . $this->escape($item->version) . '</span></td>';
                echo '<td>';
                if ($item->license_key) {
                    echo '<code>' . $this->escape($item->license_key) . '</code>' . $licenseStatusLabel;
                } else {
                    echo '<span class="text-muted">-</span>';
                }
                echo '</td>';
                echo '<td>' . date('Y-m-d', strtotime($item->purchase_date)) . '</td>';
                echo '<td>' . date('Y-m-d', strtotime($item->nextduedate)) . '</td>';
                echo '<td>' . $limitText . '</td>';
                echo '<td>' . $downloadBtn . '</td>';
                echo '</tr>';

                // Show changelog if available
                $file = $this->core->getFileById($item->file_id);
                if ($file && !empty($file->changelog)) {
                    echo '<tr class="active"><td colspan="7" style="padding-left:30px;">';
                    echo '<small class="text-muted"><strong>Changelog:</strong> ' . nl2br($this->escape($file->changelog)) . '</small>';
                    echo '</td></tr>';
                }
            }

            echo '</tbody></table></div>';
        }

        echo '</div>';
    }

    protected function escape($text)
    {
        return htmlspecialchars($text ?? '', ENT_QUOTES, 'UTF-8');
    }
}
