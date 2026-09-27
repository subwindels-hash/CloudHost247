<?php
/**
 * WHMCS Digital Products Module - Hooks
 *
 * Hooks into WHMCS core events for automatic activation,
 * license generation and email delivery.
 *
 * @package    DigitalProducts
 * @version    1.0.0
 */

use WHMCS\Database\Capsule;

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/lib/Core.php';
require_once __DIR__ . '/lib/License.php';

/**
 * Hook: Order Paid
 * Automatically activates download access when order is paid
 */
add_hook('OrderPaid', 1, function($vars) {
    $orderId = $vars['orderId'];

    if (!$orderId) {
        return;
    }

    try {
        $core = new DigitalProducts\Core();
        $licenseManager = new DigitalProducts\License();

        // Get all products in this order that are digital products
        $items = Capsule::table('tblhosting')
            ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.product_id', '=', 'tblhosting.packageid')
            ->where('tblhosting.orderid', $orderId)
            ->where('mod_digitalproducts_products.status', 'active')
            ->select(
                'tblhosting.id as service_id',
                'tblhosting.userid as client_id',
                'tblhosting.packageid as product_id',
                'mod_digitalproducts_products.id as dp_product_id',
                'mod_digitalproducts_products.license_enabled',
                'mod_digitalproducts_products.current_file_id',
                'tblhosting.domain'
            )
            ->get();

        foreach ($items as $item) {
            if (empty($item->current_file_id)) {
                continue;
            }

            // Generate license key if enabled
            if ($item->license_enabled) {
                $licenseKey = $licenseManager->generateLicense([
                    'product_id' => $item->dp_product_id,
                    'service_id' => $item->service_id,
                    'client_id' => $item->client_id,
                    'domain' => $item->domain,
                ]);
            }

            // Log activation
            logActivity(
                "DigitalProducts: Download access activated for service #{$item->service_id} " .
                "(Order #{$orderId}, Client #{$item->client_id})"
            );

            // Send email notification if enabled
            $moduleSettings = $core->getSettings();
            if ($moduleSettings['email_delivery'] == 'on') {
                digitalproducts_sendDownloadEmail($item, $licenseKey ?? null);
            }
        }
    } catch (Exception $e) {
        logActivity('DigitalProducts OrderPaid Hook Error: ' . $e->getMessage());
    }
});

/**
 * Hook: After Module Create
 * Alternative hook for product activation
 */
add_hook('AfterModuleCreate', 1, function($vars) {
    $serviceId = $vars['params']['serviceid'] ?? null;

    if (!$serviceId) {
        return;
    }

    try {
        $core = new DigitalProducts\Core();
        $licenseManager = new DigitalProducts\License();

        $service = Capsule::table('tblhosting')
            ->join('mod_digitalproducts_products', 'mod_digitalproducts_products.product_id', '=', 'tblhosting.packageid')
            ->where('tblhosting.id', $serviceId)
            ->where('mod_digitalproducts_products.status', 'active')
            ->select(
                'tblhosting.id as service_id',
                'tblhosting.userid as client_id',
                'tblhosting.packageid as product_id',
                'mod_digitalproducts_products.id as dp_product_id',
                'mod_digitalproducts_products.license_enabled',
                'mod_digitalproducts_products.current_file_id',
                'tblhosting.domain'
            )
            ->first();

        if (!$service || empty($service->current_file_id)) {
            return;
        }

        // Generate license key if enabled
        if ($service->license_enabled) {
            $licenseManager->generateLicense([
                'product_id' => $service->dp_product_id,
                'service_id' => $service->service_id,
                'client_id' => $service->client_id,
                'domain' => $service->domain,
            ]);
        }
    } catch (Exception $e) {
        logActivity('DigitalProducts AfterModuleCreate Hook Error: ' . $e->getMessage());
    }
});

/**
 * Hook: Client Area Page Output
 * Add "My Downloads" link to client area sidebar
 */
add_hook('ClientAreaPrimarySidebar', 1, function($sidebar) {
    if (!isset($sidebar->getChildren()['My Account'])) {
        return;
    }

    $myAccount = $sidebar->getChildren()['My Account'];

    $myAccount->addChild('My Downloads', [
        'label' => 'My Downloads',
        'uri' => 'index.php?m=digitalproducts&action=downloads',
        'icon' => 'fa-download',
        'order' => 50,
    ]);
});

/**
 * Hook: Daily Cron Job
 * Clean expired download tokens and license checks
 */
add_hook('DailyCronJob', 1, function() {
    try {
        $expiryHours = 48;
        $settings = Capsule::table('tbladdonmodules')
            ->where('module', 'digitalproducts')
            ->where('setting', 'link_expiry_hours')
            ->value('value');

        if ($settings) {
            $expiryHours = (int)$settings;
        }

        // We don't delete tokens immediately - they just expire for validation
        // But we can clean old download logs after 90 days
        $cutoffDate = date('Y-m-d H:i:s', strtotime('-90 days'));

        Capsule::table('mod_digitalproducts_downloads')
            ->where('created_at', '<', $cutoffDate)
            ->delete();

        logActivity('DigitalProducts: Cleaned old download logs older than 90 days.');
    } catch (Exception $e) {
        logActivity('DigitalProducts DailyCronJob Hook Error: ' . $e->getMessage());
    }
});

/**
 * Hook: Admin Area Head Output
 * Add custom CSS/JS for module
 */
add_hook('AdminAreaHeadOutput', 1, function($vars) {
    $filename = $vars['filename'] ?? '';

    if ($filename === 'addonmodules' && isset($_GET['module']) && $_GET['module'] === 'digitalproducts') {
        return <<<HTML
<style>
.dp-file-dropzone {
    border: 2px dashed #ccc;
    border-radius: 8px;
    padding: 40px 20px;
    text-align: center;
    background: #fafafa;
    transition: all 0.3s;
}
.dp-file-dropzone:hover, .dp-file-dropzone.dragover {
    border-color: #5cb85c;
    background: #f0f9f0;
}
.dp-upload-progress {
    margin-top: 15px;
    display: none;
}
.dp-version-badge {
    display: inline-block;
    padding: 3px 8px;
    background: #337ab7;
    color: white;
    border-radius: 4px;
    font-size: 12px;
}
.dp-stat-card {
    text-align: center;
    padding: 20px;
    border-radius: 6px;
    background: #fff;
    border: 1px solid #ddd;
    margin-bottom: 20px;
}
.dp-stat-card .number {
    font-size: 28px;
    font-weight: bold;
    color: #337ab7;
}
.dp-stat-card .label {
    font-size: 13px;
    color: #666;
    text-transform: uppercase;
}
</style>
<script>
(function() {
    document.addEventListener('DOMContentLoaded', function() {
        // Initialize dropzone if present
        var dropzone = document.getElementById('dp-dropzone');
        if (dropzone) {
            dropzone.addEventListener('dragover', function(e) {
                e.preventDefault();
                this.classList.add('dragover');
            });
            dropzone.addEventListener('dragleave', function(e) {
                e.preventDefault();
                this.classList.remove('dragover');
            });
            dropzone.addEventListener('drop', function(e) {
                e.preventDefault();
                this.classList.remove('dragover');
                var files = e.dataTransfer.files;
                if (files.length) {
                    document.getElementById('dp-file-input').files = files;
                    updateFileInfo(files[0]);
                }
            });
        }
    });

    function updateFileInfo(file) {
        var info = document.getElementById('dp-file-info');
        if (info) {
            info.innerHTML = '<strong>Selected:</strong> ' + file.name + ' (' + formatBytes(file.size) + ')';
        }
    }

    function formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        var k = 1024;
        var sizes = ['Bytes', 'KB', 'MB', 'GB'];
        var i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
})();
</script>
HTML;
    }

    return '';
});

/**
 * Helper: Send Download Email to Client
 *
 * @param object $service
 * @param string|null $licenseKey
 */
function digitalproducts_sendDownloadEmail($service, $licenseKey = null)
{
    try {
        $client = Capsule::table('tblclients')
            ->where('id', $service->client_id)
            ->select('email', 'firstname', 'lastname')
            ->first();

        if (!$client) {
            return;
        }

        $product = Capsule::table('mod_digitalproducts_products')
            ->where('id', $service->dp_product_id)
            ->first();

        $file = Capsule::table('mod_digitalproducts_files')
            ->where('id', $service->current_file_id)
            ->first();

        if (!$product || !$file) {
            return;
        }

        $downloadLink = digitalproducts_generateClientDownloadLink($service->service_id, $service->current_file_id);

        $emailTemplate = Capsule::table('tblemailtemplates')
            ->where('name', 'Digital Product Download Info')
            ->first();

        // If template doesn't exist, create it or use default WHMCS messaging
        if (!$emailTemplate) {
            // Use WHMCS send message function with custom content
            $subject = 'Your Digital Product Download is Ready - ' . $product->product_name;
            $message = digitalproducts_buildEmailContent($product, $file, $downloadLink, $licenseKey, $client);

            Mailer::send($client->email, $subject, $message);
        } else {
            // Use template with merge fields
            $mergeFields = [
                'client_name' => $client->firstname . ' ' . $client->lastname,
                'product_name' => $product->product_name,
                'product_version' => $file->version,
                'download_link' => $downloadLink,
                'license_key' => $licenseKey ?: 'N/A',
            ];

            sendMessage('Digital Product Download Info', $service->service_id, $mergeFields);
        }
    } catch (Exception $e) {
        logActivity('DigitalProducts Email Error: ' . $e->getMessage());
    }
}

/**
 * Helper: Build email content
 */
function digitalproducts_buildEmailContent($product, $file, $downloadLink, $licenseKey, $client)
{
    $licenseSection = '';
    if ($licenseKey) {
        $licenseSection = <<<HTML
<tr>
    <td style="padding:15px; background:#f9f9f9; border-radius:4px; text-align:center;">
        <p style="margin:0 0 10px; font-size:14px; color:#555;"><strong>Your License Key:</strong></p>
        <code style="background:#fff; border:1px dashed #ccc; padding:10px 15px; display:inline-block; font-size:16px; color:#333;">{$licenseKey}</code>
    </td>
</tr>
HTML;
    }

    return <<<HTML
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif; line-height:1.6; color:#333;">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px; margin:0 auto;">
        <tr>
            <td style="padding:20px; background:#337ab7; color:white; text-align:center;">
                <h2 style="margin:0;">Your Download is Ready!</h2>
            </td>
        </tr>
        <tr>
            <td style="padding:20px;">
                <p>Hi {$client->firstname},</p>
                <p>Thank you for your purchase. Your digital product is now available for download.</p>
                <table width="100%" cellpadding="10" cellspacing="0" style="margin:20px 0;">
                    <tr><td style="border-bottom:1px solid #eee;"><strong>Product:</strong></td><td style="border-bottom:1px solid #eee;">{$product->product_name}</td></tr>
                    <tr><td style="border-bottom:1px solid #eee;"><strong>Version:</strong></td><td style="border-bottom:1px solid #eee;">{$file->version}</td></tr>
                    <tr><td><strong>File Size:</strong></td><td>" . digitalproducts_formatBytes($file->file_size) . "</td></tr>
                </table>
                {$licenseSection}
                <tr>
                    <td style="padding:20px; text-align:center;">
                        <a href="{$downloadLink}" style="display:inline-block; background:#5cb85c; color:white; padding:12px 30px; text-decoration:none; border-radius:4px; font-weight:bold;">Download Now</a>
                    </td>
                </tr>
                <tr>
                    <td style="padding:15px; font-size:12px; color:#666; text-align:center;">
                        <p>This download link will expire in 48 hours. You can always access your downloads from the client area "My Downloads" section.</p>
                    </td>
                </tr>
            </td>
        </tr>
    </table>
</body>
</html>
HTML;
}

/**
 * Helper: Generate client download link
 */
function digitalproducts_generateClientDownloadLink($serviceId, $fileId)
{
    $token = digitalproducts_generateDownloadToken($serviceId, $fileId);
    $systemUrl = Capsule::table('tblconfiguration')
        ->where('setting', 'SystemURL')
        ->value('value');

    return rtrim($systemUrl, '/') . '/modules/addons/digitalproducts/download.php?token=' . $token;
}

/**
 * Helper: Generate download token
 */
function digitalproducts_generateDownloadToken($serviceId, $fileId)
{
    $token = bin2hex(random_bytes(32));

    Capsule::table('mod_digitalproducts_downloads')->insert([
        'file_id' => $fileId,
        'product_id' => 0,
        'service_id' => $serviceId,
        'client_id' => 0,
        'download_token' => $token,
        'status' => 'success',
        'ip_address' => '',
        'user_agent' => '',
        'created_at' => date('Y-m-d H:i:s'),
        'updated_at' => date('Y-m-d H:i:s'),
    ]);

    return $token;
}

/**
 * Helper: Format bytes
 */
function digitalproducts_formatBytes($bytes)
{
    if ($bytes === 0 || $bytes === null) return '0 Bytes';
    $k = 1024;
    $sizes = ['Bytes', 'KB', 'MB', 'GB'];
    $i = floor(log($bytes) / log($k));
    return round($bytes / pow($k, $i), 2) . ' ' . $sizes[$i];
}
