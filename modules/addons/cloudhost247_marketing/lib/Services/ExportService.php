<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TagRepository;

/**
 * Subscriber export (requirement #8).
 *
 * Two properties matter more than the CSV itself:
 *   - spreadsheet formula injection is neutralised (a cell that starts with
 *     =, +, - or @ is prefixed with an apostrophe), so exporting a subscriber
 *     whose company is literally "=cmd|..." cannot execute in Excel; and
 *   - the export is audited (who, which filter, how many rows) because a
 *     subscriber export is a personal-data event, while the data itself is
 *     never written to the audit log.
 */
final class ExportService
{
    const MAX_ROWS = 20000;

    private $subscribers;
    private $lists;
    private $tags;

    public function __construct(SubscriberRepository $subscribers = null, ListRepository $lists = null, TagRepository $tags = null)
    {
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->lists = $lists ?: new ListRepository();
        $this->tags = $tags ?: new TagRepository();
    }

    /**
     * CSV of the subscriber rows matching $filters (status, consent_status,
     * source, search, list_id, tag_id). Columns are the honest, non-secret set:
     * no bounce internals, no sync tokens.
     */
    public function subscribersCsv(array $filters = array(), $max = self::MAX_ROWS)
    {
        $rows = $this->subscribers->collect($filters, (int) $max);
        $listNames = array();
        $tagNames = array();
        $lines = array();
        $lines[] = $this->line(array('email', 'first_name', 'last_name', 'company', 'phone', 'country', 'status', 'consent_status', 'consent_source', 'lists', 'tags', 'created_at', 'last_activity_at'));

        foreach ($rows as $row) {
            $subscriberLists = $this->lists->idsForSubscriber((int) $row->id);
            $listLabels = array();
            foreach ($subscriberLists as $listId) {
                if (!isset($listNames[$listId])) {
                    $list = $this->lists->find($listId);
                    $listNames[$listId] = $list ? (string) $list->name : '';
                }
                if ($listNames[$listId] !== '') { $listLabels[] = $listNames[$listId]; }
            }
            $tagLabels = array();
            foreach ($this->tags->forSubscriber((int) $row->id) as $tag) { $tagLabels[] = (string) $tag->name; }

            $lines[] = $this->line(array(
                $this->value($row, 'email'),
                $this->value($row, 'first_name'),
                $this->value($row, 'last_name'),
                $this->value($row, 'company'),
                $this->value($row, 'phone'),
                $this->value($row, 'country'),
                $this->value($row, 'status'),
                $this->value($row, 'consent_status'),
                $this->value($row, 'consent_source'),
                implode('; ', $listLabels),
                implode('; ', $tagLabels),
                $this->value($row, 'created_at'),
                $this->value($row, 'last_activity_at'),
            ));
        }

        AuditLogger::record('cloudhost247_marketing', 'subscribers.exported', 'marketing_subscriber', 'filter',
            array(), array('rows' => count($rows), 'filters' => $this->safeFilters($filters)), 'success');

        return implode("\r\n", $lines) . "\r\n";
    }

    /** Only the filter keys the UI has — never an arbitrary payload. */
    private function safeFilters(array $filters)
    {
        $safe = array();
        foreach (array('status', 'consent_status', 'source', 'search', 'list_id', 'tag_id') as $key) {
            if (!empty($filters[$key])) { $safe[$key] = is_numeric($filters[$key]) ? (int) $filters[$key] : substr((string) $filters[$key], 0, 64); }
        }
        return $safe;
    }

    /** Reads a column that exists in the schema, tolerating a partial row object. */
    private function value($row, $key)
    {
        return isset($row->$key) ? (string) $row->$key : '';
    }

    private function line(array $cells)
    {
        $out = array();
        foreach ($cells as $cell) { $out[] = $this->cell((string) $cell); }
        return implode(',', $out);
    }

    private function cell($value)
    {
        // Excel/LibreOffice formula injection: neutralise by prefixing a quote.
        // Leading tab/CR/LF count too — a spreadsheet trims them and then runs the
        // formula, which is the whole trick.
        if ($value !== '' && preg_match('/^[=+\-@\t\r\n]/', $value)) { $value = "'" . $value; }
        $value = str_replace('"', '""', $value);
        return '"' . $value . '"';
    }
}
