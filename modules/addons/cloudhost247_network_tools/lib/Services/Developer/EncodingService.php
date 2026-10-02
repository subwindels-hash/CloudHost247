<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Encoding tools (docs section 43). Local, deterministic conversions. MD5 is
 * offered as a checksum only and the result states, in the payload itself, that
 * it is unsuitable for passwords or modern cryptographic use.
 */
final class EncodingService extends Service
{
    private static $morse = array(
        'A' => '.-', 'B' => '-...', 'C' => '-.-.', 'D' => '-..', 'E' => '.', 'F' => '..-.', 'G' => '--.',
        'H' => '....', 'I' => '..', 'J' => '.---', 'K' => '-.-', 'L' => '.-..', 'M' => '--', 'N' => '-.',
        'O' => '---', 'P' => '.--.', 'Q' => '--.-', 'R' => '.-.', 'S' => '...', 'T' => '-', 'U' => '..-',
        'V' => '...-', 'W' => '.--', 'X' => '-..-', 'Y' => '-.--', 'Z' => '--..',
        '0' => '-----', '1' => '.----', '2' => '..---', '3' => '...--', '4' => '....-', '5' => '.....',
        '6' => '-....', '7' => '--...', '8' => '---..', '9' => '----.', '.' => '.-.-.-', ',' => '--..--',
        '?' => '..--..', "'" => '.----.', '!' => '-.-.--', '/' => '-..-.', '(' => '-.--.', ')' => '-.--.-',
        '&' => '.-...', ':' => '---...', ';' => '-.-.-.', '=' => '-...-', '+' => '.-.-.', '-' => '-....-',
        '_' => '..--.-', '"' => '.-..-.', '$' => '...-..-', '@' => '.--.-.',
    );

    protected function execute()
    {
        $operation = $this->input['operation'];
        $input = (string) $this->input['input'];
        switch ($operation) {
            case 'base64_encode':
                return $this->result('Base64 encode', base64_encode($input), array('input_bytes' => strlen($input)));
            case 'base64_decode':
                $decoded = base64_decode(str_replace(array("\n", "\r", ' '), '', $input), true);
                if ($decoded === false) {
                    throw new InvalidArgumentException('That is not valid Base64.');
                }
                return $this->result('Base64 decode', $decoded, array('output_bytes' => strlen($decoded)));
            case 'md5':
                return $this->result('MD5', md5($input), array(
                    'algorithm' => 'MD5',
                    'warning' => 'MD5 is a checksum, not a security control. It is unsuitable for password storage and for any modern cryptographic purpose; use the Password Tools for password hashing (bcrypt/Argon2).',
                ));
            case 'text_to_binary':
                $bytes = unpack('C*', $input);
                $binary = implode(' ', array_map(function ($byte) {
                    return str_pad(decbin($byte), 8, '0', STR_PAD_LEFT);
                }, $bytes));
                return $this->result('Text to binary', $binary, array('bytes' => strlen($input)));
            case 'binary_to_text':
                $clean = preg_replace('/[^01]/', '', $input);
                if (strlen($clean) % 8 !== 0) {
                    throw new InvalidArgumentException('Binary input must contain complete 8-bit groups (a multiple of eight 0/1 characters).');
                }
                $output = '';
                foreach (str_split($clean, 8) as $group) {
                    $output .= chr(bindec($group));
                }
                return $this->result('Binary to text', $output, array('bytes' => strlen($output)));
            case 'rot13':
                return $this->result('ROT13', str_rot13($input), array('note' => 'ROT13 is a substitution cipher for text, not encryption.'));
            case 'morse_encode':
                $output = array();
                foreach (str_split(strtoupper($input)) as $character) {
                    if ($character === ' ') { $output[] = '/'; continue; }
                    $output[] = isset(self::$morse[$character]) ? self::$morse[$character] : '?';
                }
                return $this->result('Text to Morse', implode(' ', $output), array('unmapped_characters' => substr_count(implode(' ', $output), '?')));
            case 'morse_decode':
                $reverse = array_flip(self::$morse);
                $output = '';
                foreach (preg_split('/\s+/', trim($input)) as $token) {
                    if ($token === '/' || $token === '') { $output .= ' '; continue; }
                    $output .= isset($reverse[$token]) ? $reverse[$token] : '?';
                }
                return $this->result('Morse to text', $output, array('unmapped_tokens' => substr_count($output, '?')));
            default:
                return ToolResult::invalid('That encoding operation is not supported.');
        }
    }

    private function result($label, $output, array $meta = array())
    {
        return ToolResult::success(array(
            'operation' => $label,
            'output' => $output,
            'output_length' => strlen($output),
            'summary' => $label . ' produced ' . strlen($output) . ' character(s).',
        ), array(), $meta);
    }
}
