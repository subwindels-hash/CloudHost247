<?php
namespace CloudHost247\NetworkTools\Services\Security;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Password tools (docs section 41).
 *
 * Everything happens in this request. The submitted value is marked sensitive,
 * so the runner stores no history entry, no log target and no cache record for
 * it, and the service itself never writes it anywhere. Strength analysis is an
 * estimate with a published method and it says plainly that it is not a breach
 * corpus lookup and not a guarantee.
 */
final class PasswordService extends Service
{
    /**
     * A very small sample of the most frequently leaked passwords. It is a
     * heuristic, not a dictionary: the absence of a password from this list
     * says nothing about whether it has appeared in a breach.
     */
    private static $common = array(
        '123456', 'password', '123456789', '12345678', '12345', 'qwerty', '1234567', '111111', '123123',
        'abc123', '1234567890', 'iloveyou', 'welcome', 'monkey', 'dragon', 'admin', 'letmein', 'sunshine',
        'princess', 'football', 'charlie', 'aa123456', 'donald', 'password1', 'qwerty123', 'zaq12wsx',
        'trustno1', 'master', 'hello', 'freedom', 'whatever', 'qazwsx', '121212', '000000', '654321',
        'superman', 'batman', 'shadow', 'michael', 'jennifer', 'hunter2', 'passw0rd', 'p@ssw0rd',
    );

    protected function execute()
    {
        $operation = $this->input['operation'];
        switch ($operation) {
            case 'generate':
                return $this->generate();
            case 'strength':
                $value = (string) (isset($this->input['value']) ? $this->input['value'] : '');
                if ($value === '') {
                    throw new InvalidArgumentException('Type the password you want assessed. It is used for this request only and is never stored.');
                }
                return $this->strength($value);
            case 'hash':
                $value = (string) (isset($this->input['value']) ? $this->input['value'] : '');
                if ($value === '') {
                    throw new InvalidArgumentException('Type the value you want hashed. It is used for this request only and is never stored.');
                }
                return $this->hash($value);
            case 'verify':
                return $this->verify();
            default:
                return ToolResult::invalid('That password operation is not supported.');
        }
    }

    private function generate()
    {
        $length = max(8, min(128, (int) (isset($this->input['length']) ? $this->input['length'] : 20)));
        $excludeAmbiguous = !empty($this->input['exclude_ambiguous']);
        $pools = array(
            'lowercase' => 'abcdefghijklmnopqrstuvwxyz',
            'uppercase' => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            'numbers' => '0123456789',
            'symbols' => '!@#$%^&*()-_=+[]{};:,.?/',
        );
        if ($excludeAmbiguous) {
            $pools['lowercase'] = str_replace(array('l', 'i', 'o'), '', $pools['lowercase']);
            $pools['uppercase'] = str_replace(array('I', 'O', 'L'), '', $pools['uppercase']);
            $pools['numbers'] = str_replace(array('0', '1'), '', $pools['numbers']);
            $pools['symbols'] = str_replace(array('|', '`', '\'', '"'), '', $pools['symbols']);
        }
        $selected = array();
        foreach ($pools as $key => $characters) {
            if (!empty($this->input[$key])) {
                $selected[$key] = $characters;
            }
        }
        if (!$selected) {
            return ToolResult::invalid('Select at least one character type for the password generator.');
        }
        if ($length < count($selected)) {
            return ToolResult::invalid('The requested length is shorter than the number of character types selected.');
        }
        $all = implode('', array_values($selected));
        $characters = array();
        foreach ($selected as $pool) {
            $characters[] = $pool[random_int(0, strlen($pool) - 1)];
        }
        while (count($characters) < $length) {
            $characters[] = $all[random_int(0, strlen($all) - 1)];
        }
        for ($index = count($characters) - 1; $index > 0; $index--) {
            $swap = random_int(0, $index);
            $temporary = $characters[$index];
            $characters[$index] = $characters[$swap];
            $characters[$swap] = $temporary;
        }
        $password = implode('', $characters);
        $entropy = (int) round(strlen($password) * (log(strlen($all)) / log(2)));
        return ToolResult::success(array(
            'operation' => 'generate',
            'password' => $password,
            'length' => strlen($password),
            'character_types' => array_keys($selected),
            'excluded_ambiguous' => $excludeAmbiguous,
            'entropy_bits' => $entropy,
            'generator' => 'PHP random_int() (CSPRNG)',
            'advice' => 'Store this in a password manager now. This page will not show it again, and nothing about it was stored on the server.',
            'summary' => 'Generated a ' . strlen($password) . '-character password with an estimated ' . $entropy . ' bits of entropy.',
        ), array(), array('sensitive_output' => true));
    }

    private function strength($value)
    {
        $length = function_exists('mb_strlen') ? mb_strlen($value, 'UTF-8') : strlen($value);
        $poolSize = 0;
        $used = array();
        if (preg_match('/[a-z]/', $value)) { $poolSize += 26; $used[] = 'lowercase'; }
        if (preg_match('/[A-Z]/', $value)) { $poolSize += 26; $used[] = 'uppercase'; }
        if (preg_match('/[0-9]/', $value)) { $poolSize += 10; $used[] = 'numbers'; }
        if (preg_match('/[^a-zA-Z0-9]/', $value)) { $poolSize += 33; $used[] = 'symbols'; }
        if (preg_match('/[^\x00-\x7f]/', $value)) { $poolSize += 100; $used[] = 'non-ASCII characters'; }
        $entropy = $poolSize > 1 && $length > 0 ? (int) round($length * (log($poolSize) / log(2))) : 0;
        $finding = array();
        $penalty = 0;
        if (in_array(strtolower($value), self::$common, true)) {
            $finding[] = array('severity' => 'CRITICAL', 'message' => 'This is one of the most commonly used passwords. It would be tried first in any credential attack.');
            $penalty += 60;
        }
        if ($length < 12) {
            $finding[] = array('severity' => 'WARNING', 'message' => 'Length ' . $length . ' is below the 12-character minimum recommended for an account password.');
            $penalty += 15;
        } elseif ($length < 16) {
            $finding[] = array('severity' => 'INFO', 'message' => 'Length ' . $length . ' is acceptable; 16 or more is preferable, especially for accounts without second-factor protection.');
        }
        if (count($used) <= 2 && $length > 0) {
            $finding[] = array('severity' => 'WARNING', 'message' => 'Only ' . count($used) . ' character class(es) are used. Mixing classes raises the search space.');
            $penalty += 10;
        }
        if (preg_match('/(.)\1{2,}/', $value)) {
            $finding[] = array('severity' => 'WARNING', 'message' => 'A character repeats three or more times in a row, which most cracking rules account for.');
            $penalty += 15;
        }
        if (preg_match('/(0123|1234|2345|3456|4567|5678|6789|abcd|bcde|cdef|qwer|wert|erty|asdf|sdfg|zxcv|xcvb)/i', $value)) {
            $finding[] = array('severity' => 'WARNING', 'message' => 'A sequential keyboard or alphabet run was found; these are tried early.');
            $penalty += 15;
        }
        if (preg_match('/^(19|20)\d{2}$/', $value) || preg_match('/(19|20)\d{2}/', $value)) {
            $finding[] = array('severity' => 'INFO', 'message' => 'A four-digit year is present. Years are among the first patterns a cracking tool tries.');
            $penalty += 8;
        }
        if (preg_match('/[@4][a-z]*[!1]$/i', $value) && $length < 16) {
            $finding[] = array('severity' => 'INFO', 'message' => 'A trailing symbol or digit is a common append pattern that cracking rules already include.');
            $penalty += 5;
        }
        $adjusted = max(0, $entropy - $penalty);
        $label = 'Very weak';
        if ($adjusted >= 100) { $label = 'Very strong'; }
        elseif ($adjusted >= 70) { $label = 'Strong'; }
        elseif ($adjusted >= 50) { $label = 'Reasonable'; }
        elseif ($adjusted >= 30) { $label = 'Weak'; }
        if (!$finding) {
            $finding[] = array('severity' => 'INFO', 'message' => 'No common weakness pattern from the module\'s rule set was detected.');
        }
        return ToolResult::success(array(
            'operation' => 'strength',
            'length' => $length,
            'character_classes' => $used,
            'search_space_bits' => $entropy,
            'adjusted_bits' => $adjusted,
            'penalty_bits' => $penalty,
            'rating' => $label,
            'findings' => $finding,
            'method' => 'Entropy is estimated as length × log2(character-pool size), then reduced by penalties for patterns (repeated characters, sequences, years, common passwords, short length). This is a documented estimate, not a guarantee.',
            'limitations' => 'This analysis uses the rules listed above and a small built-in sample of common passwords. It does not query any breach corpus, does not know dictionary words or personal data, and cannot tell you whether this password has already leaked. Check the account provider for breach notifications, and use a password manager with unique passwords everywhere.',
            'summary' => 'Estimated ' . $adjusted . ' bits after penalties (' . $label . ').',
        ), $label === 'Weak' || $label === 'Very weak' ? array('This password rates ' . strtolower($label) . '. Consider generating a longer random password instead.') : array(), array('stored' => false));
    }

    private function hash($value)
    {
        $algorithm = isset($this->input['algorithm']) ? $this->input['algorithm'] : 'default';
        if ($algorithm === 'argon2id' && !defined('PASSWORD_ARGON2ID')) {
            throw new InvalidArgumentException('Argon2id is not available in this PHP build (it requires PHP 7.2+ compiled with Argon2 support). Choose bcrypt or the PHP default.');
        }
        $options = array();
        if ($algorithm === 'bcrypt') {
            $options['cost'] = defined('PASSWORD_BCRYPT_DEFAULT_COST') ? PASSWORD_BCRYPT_DEFAULT_COST : 10;
        } elseif ($algorithm === 'argon2id') {
            $options['memory_cost'] = 65536;
            $options['time_cost'] = 4;
            $options['threads'] = 2;
        }
        $started = microtime(true);
        $hash = password_hash($value, $this->algorithmConstant($algorithm), $options);
        if (!is_string($hash) || $hash === '') {
            return ToolResult::failure('SERVICE_UNAVAILABLE', 'The password hashing function returned no hash. Check the PHP password hashing configuration.');
        }
        $usedAlgorithm = password_get_info($hash);
        return ToolResult::success(array(
            'operation' => 'hash',
            'hash' => $hash,
            'algorithm' => isset($usedAlgorithm['algoName']) ? $usedAlgorithm['algoName'] : 'unknown',
            'options' => isset($usedAlgorithm['options']) ? $usedAlgorithm['options'] : array(),
            'duration_ms' => (int) round((microtime(true) - $started) * 1000),
            'verification_hint' => 'Use the verification operation (or password_verify() in your own code) to compare a value against this hash. Hashing is one-way and this value was not stored.',
            'summary' => 'Hashed with ' . (isset($usedAlgorithm['algoName']) ? $usedAlgorithm['algoName'] : 'the configured algorithm') . '.',
        ), array(), array('stored' => false, 'sensitive_output' => true));
    }

    private function verify()
    {
        $value = (string) (isset($this->input['value']) ? $this->input['value'] : '');
        $hash = trim((string) (isset($this->input['hash_to_verify']) ? $this->input['hash_to_verify'] : ''));
        if ($value === '' || $hash === '') {
            throw new InvalidArgumentException('Enter both the value and the hash it should be checked against.');
        }
        $info = password_get_info($hash);
        if (!isset($info['algoName']) || $info['algoName'] === 'unknown') {
            throw new InvalidArgumentException('That does not look like a recognisable password hash. Supported formats include bcrypt ($2y$) and Argon2id ($argon2id$).');
        }
        $matches = password_verify($value, $hash);
        return ToolResult::success(array(
            'operation' => 'verify',
            'matches' => (bool) $matches,
            'algorithm' => $info['algoName'],
            'needs_rehash' => password_needs_rehash($hash, $this->algorithmConstant('default')),
            'summary' => $matches ? 'The value matches this hash.' : 'The value does not match this hash.',
            'note' => 'The value and the hash were used for this comparison only and were not stored.',
        ), array(), array('stored' => false));
    }

    private function algorithmConstant($algorithm)
    {
        if ($algorithm === 'bcrypt') {
            return PASSWORD_BCRYPT;
        }
        if ($algorithm === 'argon2id' && defined('PASSWORD_ARGON2ID')) {
            return PASSWORD_ARGON2ID;
        }
        return PASSWORD_DEFAULT;
    }
}
