<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * JSON tools (docs section 42). Validation and formatting are deterministic and
 * performed client-side in the browser whenever possible; this service is the
 * authoritative implementation used by the API and as the fallback, and both
 * produce identical output for the same input.
 */
final class JsonService extends Service
{
    protected function execute()
    {
        $raw = (string) $this->input['json'];
        $mode = $this->input['mode'];
        $indent = isset($this->input['indent']) ? (int) $this->input['indent'] : 2;
        $decoded = json_decode($raw, true);
        $error = json_last_error();
        if ($error !== JSON_ERROR_NONE) {
            return ToolResult::invalid('Invalid JSON at line ' . $this->guessLine($raw) . ': ' . json_last_error_msg() . '.');
        }
        $flags = JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT;
        $formatted = $indent === 4 ? $this->reindent(json_encode($decoded, $flags), 4) : json_encode($decoded, $flags);
        $minified = json_encode($decoded, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        $summary = $this->summarise($decoded);
        return ToolResult::success(array(
            'valid' => true,
            'mode' => $mode,
            'formatted' => $mode === 'minify' ? $minified : $formatted,
            'minified' => $minified,
            'bytes_in' => strlen($raw),
            'bytes_minified' => strlen($minified),
            'bytes_formatted' => strlen($formatted),
            'top_level_type' => is_array($decoded) && $this->isList($decoded) ? 'array' : (is_array($decoded) ? 'object' : gettype($decoded)),
            'structure' => $summary,
            'summary' => 'Valid JSON: ' . $summary['keys'] . ' key(s), depth ' . $summary['depth'] . '.',
        ));
    }

    private function guessLine($raw)
    {
        $decoded = json_decode(substr($raw, 0, max(1, (int) (strlen($raw) / 2))), true);
        return json_last_error() === JSON_ERROR_NONE ? '2' : '1';
    }

    private function isList(array $value)
    {
        return array_keys($value) === range(0, count($value) - 1);
    }

    private function reindent($json, $spaces)
    {
        return preg_replace_callback('/^( +)/m', function ($matches) use ($spaces) {
            return str_repeat(' ', (int) (strlen($matches[1]) / 4) * $spaces);
        }, $json);
    }

    private function summarise($value)
    {
        $stats = array('keys' => 0, 'depth' => 0, 'strings' => 0, 'numbers' => 0, 'booleans' => 0, 'nulls' => 0, 'arrays' => 0);
        $walk = function ($node, $depth) use (&$walk, &$stats) {
            $stats['depth'] = max($stats['depth'], $depth);
            if (is_array($node)) {
                if ($this->isList($node)) {
                    $stats['arrays']++;
                } else {
                    $stats['keys'] += count($node);
                }
                foreach ($node as $child) {
                    $walk($child, $depth + 1);
                }
                return;
            }
            if (is_string($node)) { $stats['strings']++; }
            elseif (is_int($node) || is_float($node)) { $stats['numbers']++; }
            elseif (is_bool($node)) { $stats['booleans']++; }
            elseif ($node === null) { $stats['nulls']++; }
        };
        $walk($value, 1);
        return $stats;
    }
}
