<?php

/**
 * WHMCS DNS Checker Addon Module
 *
 * Checks DNS propagation across multiple global DNS servers.
 * Compatible with WHMCS 8.9.x, PHP 5.6 - 7.4
 * No external dependencies. Pure PHP with shell fallbacks.
 *
 * @package    WHMCS
 * @author     DNS Checker Module
 * @copyright  Copyright (c) WHMCS Limited 2005-2023
 * @license    http://www.whmcs.com/license/ WHMCS Eula
 * @version    1.0
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

/**
 * Module configuration
 *
 * @return array
 */
function dnschecker_config()
{
    return array(
        'name' => 'DNS Checker',
        'description' => 'Check DNS propagation across multiple global DNS servers from the client area.',
        'version' => '1.0',
        'author' => 'DNS Checker Module',
        'language' => 'english',
        'fields' => array(
            'recordtypes' => array(
                'FriendlyName' => 'Record Types to Check',
                'Type' => 'dropdown',
                'Options' => 'A,MX,NS,TXT,CNAME|A,MX,NS,TXT|A,MX,NS|A,MX|A|MX|NS|TXT|CNAME',
                'Default' => 'A,MX,NS,TXT,CNAME',
                'Description' => 'Select the DNS record types to check by default in the client area',
            ),
        )
    );
}

/**
 * Activate module
 *
 * @return array
 */
function dnschecker_activate()
{
    try {
        return array(
            'status' => 'success',
            'description' => 'DNS Checker activated successfully. Configure record types in the module settings above.'
        );
    } catch (Exception $e) {
        return array(
            'status' => 'error',
            'description' => 'Activation failed: ' . $e->getMessage()
        );
    }
}

/**
 * Deactivate module
 *
 * @return array
 */
function dnschecker_deactivate()
{
    try {
        return array(
            'status' => 'success',
            'description' => 'DNS Checker deactivated successfully.'
        );
    } catch (Exception $e) {
        return array(
            'status' => 'error',
            'description' => 'Deactivation failed: ' . $e->getMessage()
        );
    }
}

/**
 * Admin area output
 *
 * @param array $vars Module configuration variables
 * @return void
 */
function dnschecker_output($vars)
{
    $recordtypes = isset($vars['recordtypes']) ? $vars['recordtypes'] : 'A,MX,NS,TXT,CNAME';

    $canShell = dnschecker_can_shell_exec();
    $canDNS = function_exists('dns_get_record');

    echo '<div class="panel panel-default">';
    echo '<div class="panel-heading"><h3 class="panel-title">DNS Checker</h3></div>';
    echo '<div class="panel-body">';

    echo '<div class="row">';
    echo '<div class="col-md-6">';
    echo '<p><strong>Status:</strong> <span class="label label-success">Active</span></p>';
    echo '<p><strong>Version:</strong> ' . htmlspecialchars($vars['version']) . '</p>';
    echo '<p><strong>Record Types:</strong> <span class="label label-info">' . htmlspecialchars($recordtypes) . '</span></p>';
    echo '</div>';
    echo '<div class="col-md-6">';
    echo '<div class="alert alert-info">';
    echo '<p><i class="fas fa-info-circle"></i> <strong>Client Access:</strong></p>';
    echo '<p>Clients can access the DNS Checker at:<br><code>index.php?m=dnschecker</code></p>';
    echo '<p>Use the <strong>Configure</strong> tab above to change record types.</p>';
    echo '</div>';
    echo '</div>';
    echo '</div>';

    echo '<hr><h4>Server Capabilities</h4>';
    echo '<ul class="list-unstyled">';
    echo '<li><i class="fas ' . ($canShell ? 'fa-check text-success' : 'fa-times text-danger') . '"></i> Shell execution (dig / nslookup) for multi-server queries</li>';
    echo '<li><i class="fas ' . ($canDNS ? 'fa-check text-success' : 'fa-times text-danger') . '"></i> PHP DNS functions (local fallback)</li>';
    echo '</ul>';

    if (!$canShell && $canDNS) {
        echo '<div class="alert alert-warning"><strong>Note:</strong> Shell functions are disabled. The module will use PHP DNS functions, which query the local resolver only. Results from all listed servers may appear identical.</div>';
    } elseif (!$canShell && !$canDNS) {
        echo '<div class="alert alert-danger"><strong>Warning:</strong> No DNS lookup functions are available on this server. The module will not be able to check DNS records.</div>';
    }

    echo '</div></div>';
}

/**
 * Client area output
 *
 * @param array $vars Module configuration variables
 * @return array
 */
function dnschecker_clientarea($vars)
{
    $modulelink = $vars['modulelink'];
    $version = $vars['version'];
    $recordtypes = isset($vars['recordtypes']) ? $vars['recordtypes'] : 'A,MX,NS,TXT,CNAME';

    $action = isset($_REQUEST['action']) ? $_REQUEST['action'] : '';

    if ($action === 'check' && $_SERVER['REQUEST_METHOD'] === 'POST') {
        return dnschecker_ajax_check($vars);
    }

    return array(
        'pagetitle' => 'DNS Propagation Checker',
        'breadcrumb' => array('index.php?m=dnschecker' => 'DNS Propagation Checker'),
        'templatefile' => 'clientarea',
        'requirelogin' => false,
        'vars' => array(
            'modulelink' => $modulelink,
            'version' => $version,
            'recordtypes' => explode(',', $recordtypes),
        ),
    );
}

/**
 * Handle AJAX DNS check request
 *
 * @param array $vars
 * @return void
 */
function dnschecker_ajax_check($vars)
{
    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    $domain = isset($_POST['domain']) ? trim($_POST['domain']) : '';

    if (!dnschecker_validate_domain($domain)) {
        header('Content-Type: application/json');
        echo json_encode(array('error' => 'Please enter a valid domain name (e.g., example.com).'));
        exit;
    }

    $canShell = dnschecker_can_shell_exec();
    $canDNS = function_exists('dns_get_record');

    if (!$canShell && !$canDNS) {
        header('Content-Type: application/json');
        echo json_encode(array('error' => 'DNS lookup functions are not available on this server. Please contact the administrator.'));
        exit;
    }

    $recordTypes = explode(',', $vars['recordtypes']);
    $recordTypes = array_map('trim', $recordTypes);
    $recordTypes = array_filter($recordTypes);

    $results = array();
    $servers = dnschecker_get_dns_servers();

    foreach ($servers as $serverName => $serverIp) {
        $serverResults = array(
            'name' => $serverName,
            'ip' => $serverIp,
            'records' => array(),
        );

        foreach ($recordTypes as $type) {
            $type = strtoupper(trim($type));
            if (empty($type)) {
                continue;
            }
            $records = dnschecker_get_records($domain, $type, $serverIp);
            $serverResults['records'][$type] = $records;
        }

        $results[] = $serverResults;
    }

    $localResults = array(
        'name' => 'System Default',
        'ip' => 'Local Resolver',
        'records' => array(),
    );

    foreach ($recordTypes as $type) {
        $type = strtoupper(trim($type));
        if (empty($type)) {
            continue;
        }
        $records = dnschecker_get_records_local($domain, $type);
        $localResults['records'][$type] = $records;
    }

    array_unshift($results, $localResults);

    header('Content-Type: application/json');
    echo json_encode(array(
        'domain' => $domain,
        'results' => $results,
    ));
    exit;
}

/**
 * Validate domain name input
 *
 * @param string $domain
 * @return bool
 */
function dnschecker_validate_domain($domain)
{
    if (empty($domain)) {
        return false;
    }

    $domain = trim($domain);
    $domain = preg_replace('#^https?://#i', '', $domain);
    $domain = preg_replace('#^www\.#i', '', $domain);
    $domain = preg_replace('#/.*$#', '', $domain);
    $domain = preg_replace('#:\d+$#', '', $domain);

    if (empty($domain) || strlen($domain) > 253) {
        return false;
    }

    if (function_exists('idn_to_ascii')) {
        $ascii = @idn_to_ascii($domain, 0, INTL_IDNA_VARIANT_UTS46);
        if ($ascii !== false && !empty($ascii)) {
            $domain = $ascii;
        }
    }

    if (!preg_match('/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]$/', $domain)) {
        return false;
    }

    return true;
}

/**
 * Get list of public DNS servers
 *
 * @return array
 */
function dnschecker_get_dns_servers()
{
    return array(
        'Google DNS' => '8.8.8.8',
        'Cloudflare' => '1.1.1.1',
        'Quad9' => '9.9.9.9',
        'OpenDNS' => '208.67.222.222',
        'Level3' => '209.244.0.3',
    );
}

/**
 * Check if shell_exec is usable
 *
 * @return bool
 */
function dnschecker_can_shell_exec()
{
    if (!function_exists('shell_exec') || !function_exists('escapeshellarg')) {
        return false;
    }

    $test = @shell_exec('echo test');
    return ($test !== null && trim($test) === 'test');
}

/**
 * Get DNS record constant value for dns_get_record()
 *
 * @param string $type
 * @return int
 */
function dnschecker_get_record_constant($type)
{
    $constant = 'DNS_' . strtoupper($type);
    if (defined($constant)) {
        return constant($constant);
    }
    if (defined('DNS_ANY')) {
        return DNS_ANY;
    }
    return 1;
}

/**
 * Get DNS records using local PHP resolver
 *
 * @param string $domain
 * @param string $type
 * @return array
 */
function dnschecker_get_records_local($domain, $type)
{
    $type = strtoupper($type);
    $dnsType = dnschecker_get_record_constant($type);

    $records = @dns_get_record($domain, $dnsType);

    if (empty($records) || !is_array($records)) {
        return array();
    }

    $results = array();

    foreach ($records as $record) {
        $value = '';

        switch ($type) {
            case 'A':
                $value = isset($record['ip']) ? $record['ip'] : '';
                break;
            case 'AAAA':
                $value = isset($record['ipv6']) ? $record['ipv6'] : '';
                break;
            case 'MX':
                $pri = isset($record['pri']) ? $record['pri'] : '0';
                $value = isset($record['target']) ? $record['target'] . ' (Priority: ' . $pri . ')' : '';
                break;
            case 'NS':
                $value = isset($record['target']) ? $record['target'] : '';
                break;
            case 'TXT':
                $value = isset($record['txt']) ? $record['txt'] : '';
                break;
            case 'CNAME':
                $value = isset($record['target']) ? $record['target'] : '';
                break;
            case 'SOA':
                $value = isset($record['mname']) ? $record['mname'] : '';
                break;
            case 'SRV':
                $port = isset($record['port']) ? $record['port'] : '0';
                $pri = isset($record['pri']) ? $record['pri'] : '0';
                $value = isset($record['target']) ? $record['target'] . ':' . $port . ' (Priority: ' . $pri . ')' : '';
                break;
            default:
                $value = isset($record['target']) ? $record['target'] : (isset($record['ip']) ? $record['ip'] : '');
                break;
        }

        if (!empty($value)) {
            $results[] = $value;
        }
    }

    return array_values(array_unique($results));
}

/**
 * Get DNS records from a specific nameserver
 *
 * @param string $domain
 * @param string $type
 * @param string $nameserver
 * @return array
 */
function dnschecker_get_records($domain, $type, $nameserver)
{
    $results = array();
    $type = strtoupper($type);

    if (dnschecker_can_shell_exec()) {
        $escDomain = escapeshellarg($domain);
        $escType = escapeshellarg($type);
        $escNs = escapeshellarg($nameserver);

        // Try dig first
        $digCmd = "dig @{$escNs} {$escDomain} {$escType} +short +time=5 +tries=1 2>&1";
        $digOutput = @shell_exec($digCmd);

        if ($digOutput !== null) {
            if (stripos($digOutput, 'command not found') !== false || stripos($digOutput, 'not installed') !== false) {
                // dig not available, proceed to nslookup fallback
            } else {
                $lines = explode("\n", trim($digOutput));
                foreach ($lines as $line) {
                    $line = trim($line);
                    if (empty($line)) {
                        continue;
                    }
                    if (strpos($line, ';;') === 0) {
                        continue;
                    }
                    if (stripos($line, 'connection timed out') !== false || stripos($line, 'no servers could be reached') !== false) {
                        continue;
                    }
                    $line = rtrim($line, '.');
                    $results[] = $line;
                }

                // dig is installed: trust its output even if empty
                return array_values(array_unique($results));
            }
        }

        // Fallback to nslookup
        $nslookupCmd = "nslookup -type={$escType} {$escDomain} {$escNs} 2>&1";
        $nsOutput = @shell_exec($nslookupCmd);

        if ($nsOutput !== null) {
            $parsed = dnschecker_parse_nslookup($nsOutput, $type);
            if (!empty($parsed)) {
                return $parsed;
            }
        }
    }

    return dnschecker_get_records_local($domain, $type);
}

/**
 * Parse nslookup command output
 *
 * @param string $output
 * @param string $type
 * @return array
 */
function dnschecker_parse_nslookup($output, $type)
{
    $results = array();
    $lines = explode("\n", $output);
    $type = strtoupper($type);

    foreach ($lines as $line) {
        $line = trim($line);

        if (empty($line)) {
            continue;
        }

        if (stripos($line, 'Non-existent domain') !== false || stripos($line, 'NXDOMAIN') !== false) {
            continue;
        }
        if (stripos($line, "server can't find") !== false) {
            continue;
        }

        $value = '';

        switch ($type) {
            case 'A':
                if (preg_match('/Address:\s*([\d\.]+)/', $line, $matches)) {
                    $value = $matches[1];
                }
                break;
            case 'MX':
                if (preg_match('/mail exchanger\s*=\s*(.+)/i', $line, $matches)) {
                    $value = trim($matches[1]);
                } elseif (preg_match('/MX preference\s*=\s*(\d+).*mail exchanger\s*=\s*(.+)/i', $line, $matches)) {
                    $value = trim($matches[2]) . ' (Priority: ' . $matches[1] . ')';
                }
                break;
            case 'NS':
                if (preg_match('/nameserver\s*=\s*(.+)/i', $line, $matches)) {
                    $value = trim($matches[1]);
                }
                break;
            case 'TXT':
                if (preg_match('/text\s*=\s*"(.+?)"/i', $line, $matches)) {
                    $value = $matches[1];
                } elseif (preg_match('/text\s*=\s*(.+)/i', $line, $matches)) {
                    $value = trim($matches[1]);
                }
                break;
            case 'CNAME':
                if (preg_match('/canonical name\s*=\s*(.+)/i', $line, $matches)) {
                    $value = trim($matches[1]);
                }
                break;
        }

        if (!empty($value)) {
            $results[] = rtrim($value, '.');
        }
    }

    return array_values(array_unique($results));
}
