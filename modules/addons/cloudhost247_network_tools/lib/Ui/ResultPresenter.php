<?php
namespace CloudHost247\NetworkTools\Ui;

use CloudHost247\NetworkTools\Core\Result\ToolResult;

/**
 * Turns any tool result payload into display blocks.
 *
 * Every service returns a different shape, and writing 48 bespoke result views
 * would mean 48 places to fix a leak or a formatting bug. This presenter walks
 * the actual data and produces:
 *
 *   - rows          scalar fields (label, value, tone, hint)
 *   - tables        lists of same-shaped records, with the columns the data
 *                   actually contains
 *   - notices       long explanatory strings
 *   - json          the exact payload, for copy/export and for power users
 *
 * It never adds a field, never fills a gap with a guess and never drops a
 * warning. Ordering follows the service's own key order so a result reads the
 * way its author intended.
 */
final class ResultPresenter
{
    /** Columns that should never be the first column of a table. */
    private static $metaTail = array('raw', 'raw_html');

    public function present(ToolResult $result, $toolSlug = '', array $context = array())
    {
        $data = $result->isOk() ? $result->data() : $result->data();
        $rows = array();
        $notices = array();
        $tables = array();
        $sections = array();
        foreach ($data as $key => $value) {
            if (is_array($value) && $this->isRecordList($value)) {
                $table = $this->table($key, $value);
                if ($table !== null) {
                    $tables[] = $table;
                    continue;
                }
            }
            if (is_array($value) && $this->isAssoc($value) && !$this->isFlat($value)) {
                $nestedRows = array();
                $nestedTables = array();
                foreach ($value as $childKey => $childValue) {
                    if (is_array($childValue) && $this->isRecordList($childValue)) {
                        $inner = $this->table($key . '.' . $childKey, $childValue);
                        if ($inner !== null) {
                            $nestedTables[] = $inner;
                        }
                        continue;
                    }
                    $nestedRows[] = $this->row($key . '.' . $childKey, $childValue);
                }
                if ($nestedRows || $nestedTables) {
                    $sections[] = array(
                        'key' => $key,
                        'label' => Format::label($key),
                        'rows' => $nestedRows,
                        'tables' => $nestedTables,
                    );
                    continue;
                }
            }
            if (is_string($value) && strlen($value) > 180 && (strpos($value, "\n") !== false || strlen($value) > 400)) {
                $notices[] = array('label' => Format::label($key), 'text' => $value);
                continue;
            }
            $rows[] = $this->row($key, $value);
        }
        return array(
            'ok' => $result->isOk(),
            'code' => $result->code(),
            'message' => $result->message(),
            'retryable' => $result->retryable(),
            'rows' => $rows,
            'sections' => $sections,
            'tables' => $tables,
            'notices' => $notices,
            'warnings' => $result->warnings(),
            'meta' => $result->meta(),
            'json' => json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
            'generated_at' => gmdate('c'),
            'tool_slug' => $toolSlug,
            'export' => $this->exports($context, $result),
        );
    }

    public function row($key, $value)
    {
        $isStatus = preg_match('/(status|state|result|rating|severity|confidence|health)$/i', (string) $key) === 1;
        return array(
            'key' => $key,
            'label' => Format::label($key),
            'value' => Format::value($value, $key),
            'raw' => $value,
            'is_status' => $isStatus,
            'tone' => $isStatus ? Format::tone(is_scalar($value) ? $value : '') : 'plain',
            'is_code' => is_string($value) && $this->looksLikeCode($key, $value),
            'is_list' => is_array($value) && !$this->isAssoc($value),
        );
    }

    private function looksLikeCode($key, $value)
    {
        if (preg_match('/(record|value|content|hash|output|json|text|rules|code|body|header|address|ip|hex)/i', (string) $key)) {
            return true;
        }
        return strlen($value) > 60 && strpos($value, ' ') === false;
    }

    private function table($key, array $records)
    {
        if (!$records) {
            return null;
        }
        $columns = array();
        foreach ($records as $record) {
            if (!is_array($record)) {
                return null;
            }
            foreach (array_keys($record) as $column) {
                if (!isset($columns[$column])) {
                    $columns[$column] = true;
                }
            }
        }
        $columns = array_keys($columns);
        if (!$columns) {
            return null;
        }
        // Keep meta/raw columns last so the important information leads.
        usort($columns, function ($a, $b) {
            $aTail = in_array($a, self::$metaTail, true) ? 1 : 0;
            $bTail = in_array($b, self::$metaTail, true) ? 1 : 0;
            if ($aTail !== $bTail) {
                return $aTail - $bTail;
            }
            return 0;
        });
        $nested = false;
        foreach ($columns as $column) {
            foreach ($records as $record) {
                if (isset($record[$column]) && is_array($record[$column])) {
                    $nested = true;
                }
            }
        }
        $rows = array();
        foreach ($records as $record) {
            $cells = array();
            foreach ($columns as $column) {
                $value = array_key_exists($column, $record) ? $record[$column] : null;
                $cells[] = array(
                    'key' => $column,
                    'label' => Format::label($column),
                    'value' => Format::value($value, $column),
                    'is_status' => preg_match('/(status|state)$/i', (string) $column) === 1,
                    'tone' => preg_match('/(status|state)$/i', (string) $column) === 1 ? Format::tone(is_scalar($value) ? $value : '') : 'plain',
                    'is_scalar' => is_scalar($value) || $value === null,
                );
            }
            $rows[] = $cells;
        }
        return array(
            'key' => $key,
            'label' => Format::label($key),
            'columns' => array_map(function ($column) {
                return array('key' => $column, 'label' => Format::label($column));
            }, $columns),
            'rows' => $rows,
            'count' => count($rows),
            'has_nested' => $nested,
        );
    }

    private function isAssoc(array $value)
    {
        if (!$value) {
            return false;
        }
        return array_keys($value) !== range(0, count($value) - 1);
    }

    private function isRecordList(array $value)
    {
        if (!$value || $this->isAssoc($value)) {
            return false;
        }
        foreach ($value as $entry) {
            if (!is_array($entry)) {
                return false;
            }
        }
        return true;
    }

    private function isFlat(array $value)
    {
        foreach ($value as $entry) {
            if (is_array($entry)) {
                return false;
            }
        }
        return true;
    }

    private function exports(array $context, ToolResult $result)
    {
        $slug = isset($context['slug']) ? (string) $context['slug'] : '';
        if ($slug === '' || !$result->isOk()) {
            return array();
        }
        $declared = isset($context['exports']) && is_array($context['exports']) ? $context['exports'] : array('json');
        $formats = array();
        foreach ($declared as $format) {
            $formats[$format] = array(
                'format' => $format,
                'label' => strtoupper($format),
                'url' => 'tools.php?tool=' . rawurlencode($slug) . '&export=' . rawurlencode($format),
            );
        }
        return $formats;
    }
}
