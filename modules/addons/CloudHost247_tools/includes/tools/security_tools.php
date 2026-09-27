<?php
/**
 * CloudHost247 Tools - Cyber Security Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_ssl_checker($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain name'];
    }

    $context = stream_context_create([
        'ssl' => [
            'capture_peer_cert' => true,
            'verify_peer' => false,
            'verify_peer_name' => false,
        ],
    ]);

    $socket = @stream_socket_client("ssl://{$domain}:443", $errno, $errstr, 10, STREAM_CLIENT_CONNECT, $context);
    if (!$socket) {
        return ['domain' => $domain, 'ssl_enabled' => false, 'error' => $errstr];
    }

    $params = stream_context_get_params($socket);
    $cert = openssl_x509_parse($params['options']['ssl']['peer_certificate']);
    fclose($socket);

    if (!$cert) {
        return ['domain' => $domain, 'ssl_enabled' => false, 'error' => 'Could not parse certificate'];
    }

    $validFrom = $cert['validFrom_time_t'] ?? 0;
    $validTo = $cert['validTo_time_t'] ?? 0;
    $now = time();
    $daysLeft = floor(($validTo - $now) / 86400);

    return [
        'domain' => $domain,
        'ssl_enabled' => true,
        'issuer' => $cert['issuer']['O'] ?? 'Unknown',
        'subject' => $cert['subject']['CN'] ?? 'Unknown',
        'valid_from' => date('Y-m-d', $validFrom),
        'valid_to' => date('Y-m-d', $validTo),
        'days_remaining' => $daysLeft,
        'expired' => $daysLeft < 0,
        'expiring_soon' => $daysLeft >= 0 && $daysLeft <= 30,
        'serial_number' => $cert['serialNumber'] ?? 'N/A',
    ];
}

function CloudHost247_tool_password_encryptor($post)
{
    $password = $_POST['password'] ?? '';
    $algorithm = CloudHost247_tools_sanitize($post['algorithm'] ?? 'md5', 'string');

    if (empty($password)) {
        return ['error' => 'Please enter a password'];
    }

    $result = [];
    switch ($algorithm) {
        case 'md5':
            $result['hash'] = md5($password);
            break;
        case 'sha1':
            $result['hash'] = sha1($password);
            break;
        case 'sha256':
            $result['hash'] = hash('sha256', $password);
            break;
        case 'sha512':
            $result['hash'] = hash('sha512', $password);
            break;
        case 'bcrypt':
            $result['hash'] = password_hash($password, PASSWORD_BCRYPT);
            break;
        case 'argon2':
            if (defined('PASSWORD_ARGON2ID')) {
                $result['hash'] = password_hash($password, PASSWORD_ARGON2ID);
            } elseif (defined('PASSWORD_ARGON2I')) {
                $result['hash'] = password_hash($password, PASSWORD_ARGON2I);
            } else {
                return ['error' => 'Argon2 not available on this server'];
            }
            break;
        default:
            return ['error' => 'Unknown algorithm'];
    }

    return array_merge($result, ['algorithm' => $algorithm, 'input_length' => strlen($password)]);
}

function CloudHost247_tool_password_generator($post)
{
    $length = min(max((int) ($post['length'] ?? 16), 4), 128);
    $upper = isset($post['uppercase']);
    $lower = isset($post['lowercase']);
    $numbers = isset($post['numbers']);
    $symbols = isset($post['symbols']);
    $count = min((int) ($post['count'] ?? 5), 20);

    $charset = '';
    if ($upper) $charset .= 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if ($lower) $charset .= 'abcdefghijklmnopqrstuvwxyz';
    if ($numbers) $charset .= '0123456789';
    if ($symbols) $charset .= '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (empty($charset)) {
        $charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    }

    $passwords = [];
    for ($i = 0; $i < $count; $i++) {
        $password = '';
        for ($j = 0; $j < $length; $j++) {
            $password .= $charset[random_int(0, strlen($charset) - 1)];
        }
        $passwords[] = $password;
    }

    return ['length' => $length, 'count' => $count, 'passwords' => $passwords];
}

function CloudHost247_tool_password_strength($post)
{
    $password = $_POST['password'] ?? '';
    if (empty($password)) {
        return ['error' => 'Please enter a password'];
    }

    $score = 0;
    $feedback = [];
    $length = strlen($password);

    if ($length >= 8) $score += 10;
    if ($length >= 12) $score += 15;
    if ($length >= 16) $score += 15;
    if ($length < 8) $feedback[] = 'Password is too short (minimum 8 characters)';

    if (preg_match('/[a-z]/', $password)) $score += 10;
    else $feedback[] = 'Add lowercase letters';

    if (preg_match('/[A-Z]/', $password)) $score += 10;
    else $feedback[] = 'Add uppercase letters';

    if (preg_match('/[0-9]/', $password)) $score += 10;
    else $feedback[] = 'Add numbers';

    if (preg_match('/[^a-zA-Z0-9]/', $password)) $score += 15;
    else $feedback[] = 'Add special characters';

    if (preg_match('/(.+)\1{2,}/', $password)) {
        $score -= 10;
        $feedback[] = 'Avoid repeating characters';
    }

    $score = max(0, min(100, $score));

    if ($score < 30) $strength = 'Very Weak';
    elseif ($score < 50) $strength = 'Weak';
    elseif ($score < 70) $strength = 'Moderate';
    elseif ($score < 85) $strength = 'Strong';
    else $strength = 'Very Strong';

    // Check against common passwords
    $common = ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome', 'monkey', 'dragon'];
    if (in_array(strtolower($password), $common)) {
        $score = 0;
        $strength = 'Very Weak';
        $feedback[] = 'This is a commonly used password';
    }

    return [
        'score' => $score,
        'strength' => $strength,
        'length' => $length,
        'feedback' => $feedback,
        'estimated_crack_time' => $score > 80 ? 'Centuries' : ($score > 60 ? 'Years' : ($score > 40 ? 'Months' : 'Minutes')),
    ];
}
