<?php
/**
 * Security Tools Module
 * SSL checker, password utilities, encryption
 */

class SecurityTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * SSL Certificate Checker
     */
    public function sslChecker($params) {
        $host = $params['host'] ?? '';
        $port = (int)($params['port'] ?? 443);
        
        if (empty($host)) {
            throw new Exception('Host is required');
        }
        
        $host = $this->sanitizeHost($host);
        
        // Check SSL/TLS connection
        $context = stream_context_create([
            'ssl' => [
                'capture_peer_cert' => true,
                'verify_peer' => false,
                'verify_peer_name' => false,
                'SNI_enabled' => true,
                'disable_compression' => true,
            ]
        ]);
        
        $socket = @stream_socket_client(
            "ssl://{$host}:{$port}",
            $errno,
            $errstr,
            30,
            STREAM_CLIENT_CONNECT,
            $context
        );
        
        if (!$socket) {
            return [
                'host' => $host,
                'port' => $port,
                'ssl_available' => false,
                'error' => $errstr ?: 'SSL connection failed',
            ];
        }
        
        $contextParams = stream_context_get_params($socket);
        $cert = $contextParams['options']['ssl']['peer_certificate'] ?? null;
        fclose($socket);
        
        if (!$cert) {
            return [
                'host' => $host,
                'port' => $port,
                'ssl_available' => true,
                'error' => 'Could not retrieve certificate',
            ];
        }
        
        $certInfo = openssl_x509_parse($cert);
        
        if (!$certInfo) {
            return [
                'host' => $host,
                'port' => $port,
                'ssl_available' => true,
                'error' => 'Could not parse certificate',
            ];
        }
        
        // Calculate days until expiry
        $validTo = $certInfo['validTo_time_t'] ?? time();
        $validFrom = $certInfo['validFrom_time_t'] ?? time();
        $daysUntilExpiry = floor(($validTo - time()) / 86400);
        $daysSinceIssued = floor((time() - $validFrom) / 86400);
        
        // Check certificate chain
        $chain = [];
        if (isset($contextParams['options']['ssl']['peer_certificate_chain'])) {
            foreach ($contextParams['options']['ssl']['peer_certificate_chain'] as $chainCert) {
                $parsed = openssl_x509_parse($chainCert);
                if ($parsed) {
                    $chain[] = [
                        'subject' => $parsed['subject']['CN'] ?? 'Unknown',
                        'issuer' => $parsed['issuer']['CN'] ?? 'Unknown',
                        'valid_to' => date('Y-m-d', $parsed['validTo_time_t'] ?? time()),
                    ];
                }
            }
        }
        
        // SSL/TLS protocol version
        $protocol = $contextParams['options']['ssl']['peer_certificate'] ? 'TLS' : 'Unknown';
        
        // Cipher info
        $cipher = [];
        if (function_exists('openssl_get_cipher_methods')) {
            $cipher = [
                'available_methods' => count(openssl_get_cipher_methods()),
            ];
        }
        
        // SSL Labs grade estimation
        $grade = 'A+';
        if ($daysUntilExpiry < 7) $grade = 'F';
        elseif ($daysUntilExpiry < 30) $grade = 'C';
        
        $subjectAltNames = [];
        if (isset($certInfo['extensions']['subjectAltName'])) {
            $san = $certInfo['extensions']['subjectAltName'];
            $subjectAltNames = array_map('trim', explode(',', $san));
        }
        
        return [
            'host' => $host,
            'port' => $port,
            'ssl_available' => true,
            'certificate' => [
                'subject' => $certInfo['subject']['CN'] ?? 'Unknown',
                'issuer' => [
                    'organization' => $certInfo['issuer']['O'] ?? 'Unknown',
                    'common_name' => $certInfo['issuer']['CN'] ?? 'Unknown',
                    'country' => $certInfo['issuer']['C'] ?? 'Unknown',
                ],
                'serial_number' => $certInfo['serialNumber'] ?? 'Unknown',
                'valid_from' => date('Y-m-d H:i:s', $validFrom),
                'valid_to' => date('Y-m-d H:i:s', $validTo),
                'days_until_expiry' => $daysUntilExpiry,
                'days_since_issued' => $daysSinceIssued,
                'is_expired' => $daysUntilExpiry < 0,
                'is_expiring_soon' => $daysUntilExpiry < 30,
                'subject_alt_names' => $subjectAltNames,
                'signature_algorithm' => $certInfo['signatureTypeSN'] ?? 'Unknown',
                'public_key_algorithm' => $certInfo['subjectPublicKeyInfo']['algorithm'] ?? 'Unknown',
                'key_bits' => $certInfo['subjectPublicKeyInfo']['bits'] ?? null,
            ],
            'chain' => $chain,
            'grade' => $grade,
            'warnings' => array_filter([
                $daysUntilExpiry < 0 ? 'Certificate has EXPIRED!' : null,
                $daysUntilExpiry < 30 ? 'Certificate expires in less than 30 days' : null,
                $daysUntilExpiry < 7 ? 'Certificate expires in less than 7 days - URGENT!' : null,
                (isset($certInfo['subjectPublicKeyInfo']['bits']) && $certInfo['subjectPublicKeyInfo']['bits'] < 2048) ? 'Weak key size (under 2048 bits)' : null,
            ]),
            'security_score' => $daysUntilExpiry < 0 ? 0 : max(0, min(100, $daysUntilExpiry)),
        ];
    }
    
    /**
     * Password Encryption Utility
     */
    public function passwordEncrypt($params) {
        $password = $params['password'] ?? '';
        $algorithm = $params['algorithm'] ?? 'bcrypt';
        
        if (empty($password)) {
            throw new Exception('Password is required');
        }
        
        if (strlen($password) > 1000) {
            throw new Exception('Password too long (max 1000 chars)');
        }
        
        $results = [];
        
        switch ($algorithm) {
            case 'bcrypt':
                $results['hash'] = password_hash($password, PASSWORD_BCRYPT);
                $results['algorithm'] = 'bcrypt';
                $results['cost'] = 'default';
                break;
            
            case 'argon2':
                if (defined('PASSWORD_ARGON2ID')) {
                    $results['hash'] = password_hash($password, PASSWORD_ARGON2ID);
                    $results['algorithm'] = 'argon2id';
                } elseif (defined('PASSWORD_ARGON2I')) {
                    $results['hash'] = password_hash($password, PASSWORD_ARGON2I);
                    $results['algorithm'] = 'argon2i';
                } else {
                    $results['hash'] = password_hash($password, PASSWORD_BCRYPT);
                    $results['algorithm'] = 'bcrypt (argon2 not available)';
                }
                break;
            
            case 'sha256':
                $salt = bin2hex(random_bytes(16));
                $results['hash'] = hash('sha256', $password . $salt);
                $results['salt'] = $salt;
                $results['algorithm'] = 'SHA-256 with salt';
                break;
            
            case 'sha512':
                $salt = bin2hex(random_bytes(16));
                $results['hash'] = hash('sha512', $password . $salt);
                $results['salt'] = $salt;
                $results['algorithm'] = 'SHA-512 with salt';
                break;
            
            case 'md5':
                $results['hash'] = md5($password);
                $results['algorithm'] = 'MD5 (NOT RECOMMENDED)';
                $results['warning'] = 'MD5 is cryptographically broken and should not be used for passwords';
                break;
            
            default:
                throw new Exception('Invalid algorithm. Use: bcrypt, argon2, sha256, sha512');
        }
        
        $results['verify_test'] = password_verify($password, $results['hash']);
        
        return $results;
    }
    
    /**
     * Password Generator
     */
    public function passwordGenerator($params) {
        $length = min(max((int)($params['length'] ?? 16), 4), 128);
        $includeUppercase = (bool)($params['uppercase'] ?? true);
        $includeLowercase = (bool)($params['lowercase'] ?? true);
        $includeNumbers = (bool)($params['numbers'] ?? true);
        $includeSymbols = (bool)($params['symbols'] ?? true);
        $excludeSimilar = (bool)($params['exclude_similar'] ?? false);
        $count = min((int)($params['count'] ?? 5), 50);
        
        $chars = '';
        $passwords = [];
        
        $lowercase = 'abcdefghijklmnopqrstuvwxyz';
        $uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        $numbers = '0123456789';
        $symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
        
        if ($excludeSimilar) {
            $lowercase = str_replace(['l', 'o'], '', $lowercase);
            $uppercase = str_replace(['I', 'O'], '', $uppercase);
            $numbers = str_replace(['0', '1'], '', $numbers);
        }
        
        if ($includeLowercase) $chars .= $lowercase;
        if ($includeUppercase) $chars .= $uppercase;
        if ($includeNumbers) $chars .= $numbers;
        if ($includeSymbols) $chars .= $symbols;
        
        if (empty($chars)) {
            throw new Exception('At least one character type must be selected');
        }
        
        for ($i = 0; $i < $count; $i++) {
            $password = '';
            
            // Ensure at least one of each selected type
            if ($includeLowercase) $password .= $lowercase[random_int(0, strlen($lowercase) - 1)];
            if ($includeUppercase) $password .= $uppercase[random_int(0, strlen($uppercase) - 1)];
            if ($includeNumbers) $password .= $numbers[random_int(0, strlen($numbers) - 1)];
            if ($includeSymbols) $password .= $symbols[random_int(0, strlen($symbols) - 1)];
            
            // Fill remaining length
            for ($j = strlen($password); $j < $length; $j++) {
                $password .= $chars[random_int(0, strlen($chars) - 1)];
            }
            
            // Shuffle
            $password = str_shuffle($password);
            
            $passwords[] = [
                'password' => $password,
                'length' => strlen($password),
                'entropy' => $this->calculateEntropy($password),
            ];
        }
        
        return [
            'generated_passwords' => $passwords,
            'settings' => [
                'length' => $length,
                'uppercase' => $includeUppercase,
                'lowercase' => $includeLowercase,
                'numbers' => $includeNumbers,
                'symbols' => $includeSymbols,
                'exclude_similar' => $excludeSimilar,
            ],
        ];
    }
    
    /**
     * Password Strength Checker
     */
    public function passwordStrength($params) {
        $password = $params['password'] ?? '';
        
        if (empty($password)) {
            throw new Exception('Password is required');
        }
        
        $length = strlen($password);
        $score = 0;
        $maxScore = 100;
        $feedback = [];
        
        // Length scoring
        if ($length < 8) {
            $score += 5;
            $feedback[] = 'Password is too short (minimum 8 characters)';
        } elseif ($length < 12) {
            $score += 20;
            $feedback[] = 'Consider using at least 12 characters';
        } elseif ($length < 16) {
            $score += 35;
        } else {
            $score += 45;
        }
        
        // Character variety
        $hasLower = preg_match('/[a-z]/', $password);
        $hasUpper = preg_match('/[A-Z]/', $password);
        $hasNumber = preg_match('/[0-9]/', $password);
        $hasSymbol = preg_match('/[^a-zA-Z0-9]/', $password);
        
        $varietyCount = ($hasLower ? 1 : 0) + ($hasUpper ? 1 : 0) + ($hasNumber ? 1 : 0) + ($hasSymbol ? 1 : 0);
        $score += $varietyCount * 10;
        
        if (!$hasLower) $feedback[] = 'Add lowercase letters';
        if (!$hasUpper) $feedback[] = 'Add uppercase letters';
        if (!$hasNumber) $feedback[] = 'Add numbers';
        if (!$hasSymbol) $feedback[] = 'Add special characters';
        
        // Patterns and common passwords
        if (preg_match('/^(password|123456|qwerty|admin|letmein|welcome)/i', $password)) {
            $score -= 40;
            $feedback[] = 'Avoid common passwords';
        }
        
        if (preg_match('/(.)\1{2,}/', $password)) {
            $score -= 10;
            $feedback[] = 'Avoid repeating characters';
        }
        
        if (preg_match('/(012|123|234|345|456|567|678|789|890|abc|bcd|cde|def)/i', $password)) {
            $score -= 10;
            $feedback[] = 'Avoid sequential characters';
        }
        
        // Dictionary words (basic check)
        $commonWords = ['password', 'secret', 'login', 'admin', 'user', 'test', 'demo'];
        foreach ($commonWords as $word) {
            if (stripos($password, $word) !== false) {
                $score -= 15;
                $feedback[] = 'Avoid using common words like "' . $word . '"';
            }
        }
        
        $score = max(0, min(100, $score));
        
        // Crack time estimation
        $entropy = $this->calculateEntropy($password);
        $crackTime = $this->estimateCrackTime($entropy);
        
        return [
            'password_length' => $length,
            'strength_score' => $score,
            'strength_label' => $score >= 80 ? 'STRONG' : ($score >= 60 ? 'MODERATE' : ($score >= 40 ? 'WEAK' : 'VERY WEAK')),
            'character_analysis' => [
                'lowercase' => (bool)$hasLower,
                'uppercase' => (bool)$hasUpper,
                'numbers' => (bool)$hasNumber,
                'symbols' => (bool)$hasSymbol,
                'variety_count' => $varietyCount,
            ],
            'entropy_bits' => round($entropy, 2),
            'estimated_crack_time' => $crackTime,
            'feedback' => array_values(array_unique($feedback)),
            'suggestions' => $this->getPasswordSuggestions($password),
        ];
    }
    
    private function calculateEntropy($password) {
        $length = strlen($password);
        $poolSize = 0;
        
        if (preg_match('/[a-z]/', $password)) $poolSize += 26;
        if (preg_match('/[A-Z]/', $password)) $poolSize += 26;
        if (preg_match('/[0-9]/', $password)) $poolSize += 10;
        if (preg_match('/[^a-zA-Z0-9]/', $password)) $poolSize += 33;
        
        if ($poolSize === 0) return 0;
        
        return $length * log($poolSize, 2);
    }
    
    private function estimateCrackTime($entropy) {
        // Assume 10 billion guesses per second (powerful GPU cluster)
        $guessesPerSecond = 10e9;
        $totalGuesses = pow(2, $entropy);
        $seconds = $totalGuesses / $guessesPerSecond / 2; // average case
        
        if ($seconds < 1) return 'Instant';
        if ($seconds < 60) return round($seconds) . ' seconds';
        if ($seconds < 3600) return round($seconds / 60) . ' minutes';
        if ($seconds < 86400) return round($seconds / 3600) . ' hours';
        if ($seconds < 31536000) return round($seconds / 86400) . ' days';
        if ($seconds < 3153600000) return round($seconds / 31536000) . ' years';
        return 'Centuries';
    }
    
    private function getPasswordSuggestions($password) {
        $suggestions = [];
        
        if (strlen($password) < 12) {
            $suggestions[] = 'Use at least 12 characters';
        }
        
        if (!preg_match('/[A-Z]/', $password)) {
            $suggestions[] = 'Add uppercase letters';
        }
        
        if (!preg_match('/[^a-zA-Z0-9]/', $password)) {
            $suggestions[] = 'Add special characters (!@#$%^&*)';
        }
        
        return $suggestions;
    }
    
    private function sanitizeHost($host) {
        $host = strtolower(trim($host));
        $host = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $host);
        $host = preg_replace('/\/.*$/', '', $host);
        return preg_replace('/[^a-z0-9.\-]/', '', $host);
    }
}