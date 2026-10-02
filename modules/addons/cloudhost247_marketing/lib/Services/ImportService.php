<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\ConsentStatus;
use CloudHost247\Marketing\Domain\SubscriberSource;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Security\InputValidator;
use WHMCS\Database\Capsule;

/**
 * Subscriber import (requirement #7).
 *
 * Import is a two-step operation on purpose: `preview()` reports exactly what
 * would happen and writes nothing, and `apply()` writes the audit row plus the
 * subscribers. Both are pure functions of the parsed rows, so the preview an
 * operator approved is the import that runs.
 *
 * The importer never manufactures consent and never resurrects a suppressed
 * address — those rows are reported as skipped, with the reason, in the import
 * record.
 */
final class ImportService
{
    const IMPORT_TABLE = 'mod_cloudhost247_marketing_imports';
    const MAX_ROWS = 20000;
    const MAX_COLUMNS = 40;
    const MAX_CELL_BYTES = 1000;

    /** Fields an operator can map a column onto. `ignore` is the safe default. */
    public static function fields()
    {
        return array('email', 'first_name', 'last_name', 'company', 'phone', 'country', 'tags', 'ignore');
    }

    private $subscribers;
    private $tags;
    private $subscriptions;

    public function __construct(SubscriberRepository $subscribers = null, TagRepository $tags = null, SubscriptionService $subscriptions = null)
    {
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->tags = $tags ?: new TagRepository();
        $this->subscriptions = $subscriptions ?: new SubscriptionService($this->subscribers, null, null, $this->tags);
    }

    /**
     * Parses CSV / TSV / semicolon-delimited text, or one-address-per-line text.
     * Returns array('ok', 'error', 'delimiter', 'has_header', 'header', 'rows').
     */
    public function parse($raw, $maxRows = self::MAX_ROWS)
    {
        $raw = (string) $raw;
        if (trim($raw) === '') { return $this->parseFailure('Nothing to import — the pasted content or file was empty.'); }
        if (strlen($raw) > 8 * 1024 * 1024) { return $this->parseFailure('The import is larger than 8 MB. Split it into smaller files.'); }

        $lines = preg_split("/\r\n|\n|\r/", $raw);
        $lines = array_values(array_filter($lines, function ($line) { return trim((string) $line) !== ''; }));
        if (!$lines) { return $this->parseFailure('Nothing to import — no non-empty lines were found.'); }
        if (count($lines) > (int) $maxRows + 1) {
            return $this->parseFailure('This file has ' . count($lines) . ' rows; the limit for one import is ' . (int) $maxRows . '. Split it and import the parts.');
        }

        $delimiter = $this->detectDelimiter($lines[0]);
        $rows = array();
        foreach ($lines as $line) {
            $cells = $delimiter === "\n" ? array($line) : $this->splitLine($line, $delimiter);
            $clean = array();
            foreach (array_slice($cells, 0, self::MAX_COLUMNS) as $cell) {
                $cell = trim((string) $cell);
                if (strlen($cell) > self::MAX_CELL_BYTES) { $cell = substr($cell, 0, self::MAX_CELL_BYTES); }
                $clean[] = $cell;
            }
            $rows[] = $clean;
        }

        $hasHeader = $this->looksLikeHeader($rows[0]);
        $header = array();
        $body = $rows;
        if ($hasHeader) {
            $header = $rows[0];
            $body = array_slice($rows, 1);
        }
        if (!$body) { return $this->parseFailure('The file only contains a header row.'); }

        return array('ok' => true, 'error' => '', 'delimiter' => $delimiter, 'has_header' => $hasHeader,
            'header' => $header, 'rows' => $body);
    }

    /** Best-effort column mapping from a header row; every column defaults to `ignore`. */
    public function suggestMapping(array $header)
    {
        $map = array();
        foreach ($header as $index => $label) {
            $label = strtolower(trim((string) $label));
            $normalised = preg_replace('/[^a-z]/', '', $label);
            $field = 'ignore';
            if (in_array($normalised, array('email', 'emailaddress', 'mail', 'e-mail'), true)) { $field = 'email'; }
            elseif (in_array($normalised, array('firstname', 'first', 'fname', 'givenname'), true)) { $field = 'first_name'; }
            elseif (in_array($normalised, array('lastname', 'last', 'surname', 'lname', 'familyname'), true)) { $field = 'last_name'; }
            elseif (in_array($normalised, array('company', 'organisation', 'organization', 'business'), true)) { $field = 'company'; }
            elseif (in_array($normalised, array('phone', 'phonenumber', 'mobile', 'telephone'), true)) { $field = 'phone'; }
            elseif (in_array($normalised, array('country', 'countrycode'), true)) { $field = 'country'; }
            elseif (in_array($normalised, array('tags', 'tag', 'labels'), true)) { $field = 'tags'; }
            $map[(int) $index] = $field;
        }
        return $map;
    }

    /**
     * Dry run. Writes nothing at all — not even a draft import row — so an
     * operator can look at the numbers before deciding.
     */
    public function preview(array $rows, array $mapping, array $options = array())
    {
        return $this->evaluate($rows, $mapping, $options);
    }

    /**
     * Applies the import and writes the audit record. Returns the totals plus
     * the import id so the UI can link to the record.
     */
    public function apply(array $rows, array $mapping, array $options = array())
    {
        if (count($rows) > self::MAX_ROWS) {
            throw new \InvalidArgumentException('This import exceeds ' . self::MAX_ROWS . ' rows; split it into smaller files.');
        }
        $totals = $this->evaluate($rows, $mapping, $options);
        if (!$totals['mapping_has_email']) {
            throw new \InvalidArgumentException('No column is mapped to the email field.');
        }

        $now = date('Y-m-d H:i:s');
        $importId = Capsule::table(self::IMPORT_TABLE)->insertGetId(array(
            'source_label' => InputValidator::shortText(isset($options['source_label']) ? $options['source_label'] : 'Pasted content', 190, 'Source label'),
            'mapping_json' => json_encode($mapping),
            'totals_json' => json_encode($totals['counts']),
            'status' => 'started',
            'admin_id' => isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0,
            'created_at' => $now,
            'finished_at' => null,
        ));

        $counts = $totals['counts'];
        // The preview reported what *would* happen; the applied totals are the
        // real outcome, so reset these two and count them from the run.
        $counts['created'] = 0;
        $counts['updated'] = 0;
        $listIds = isset($options['list_ids']) ? array_map('intval', (array) $options['list_ids']) : array();
        $defaultTags = isset($options['default_tags']) ? (array) $options['default_tags'] : array();
        $consent = isset($options['consent_status']) && ConsentStatus::isValid($options['consent_status']) ? (string) $options['consent_status'] : ConsentStatus::UNKNOWN;
        $consentSource = isset($options['consent_source']) ? (string) $options['consent_source'] : '';

        foreach ($totals['planned'] as $plan) {
            if ($plan['action'] !== 'create' && $plan['action'] !== 'update') { continue; }
            $data = $plan['data'];
            $data['list_ids'] = $listIds;
            $data['tags'] = array_merge($defaultTags, $plan['tags']);
            $data['consent_status'] = $consent;
            $data['consent_source'] = $consentSource;
            $result = $this->subscriptions->subscribe($data, SubscriberSource::IMPORT, false);
            if ($result['ok']) {
                if ($plan['action'] === 'create') { $counts['created']++; } else { $counts['updated']++; }
            } else {
                // Raced: the address was suppressed between preview and apply.
                $counts['skipped_suppressed']++;
            }
        }

        Capsule::table(self::IMPORT_TABLE)->where('id', (int) $importId)->update(array(
            'status' => 'imported',
            'totals_json' => json_encode($counts),
            'finished_at' => date('Y-m-d H:i:s'),
        ));
        AuditLogger::record('cloudhost247_marketing', 'subscribers.imported', 'marketing_import', (int) $importId,
            array(), array('counts' => $counts, 'source_label' => isset($options['source_label']) ? $options['source_label'] : ''), 'success');

        return array('import_id' => (int) $importId, 'counts' => $counts);
    }

    public function history($limit = 25)
    {
        return Capsule::table(self::IMPORT_TABLE)->orderBy('id', 'desc')->limit(max(1, (int) $limit))->get()->all();
    }

    /**
     * One pass over the parsed rows that decides, for each row, exactly what
     * would happen. Both preview() and apply() use it, which is why the
     * approved preview and the executed import cannot disagree.
     */
    private function evaluate(array $rows, array $mapping, array $options)
    {
        $counts = array(
            'total' => 0, 'created' => 0, 'updated' => 0, 'skipped_invalid' => 0,
            'skipped_duplicate' => 0, 'skipped_suppressed' => 0, 'skipped_empty' => 0,
        );
        $planned = array();
        $seen = array();
        $mappingHasEmail = false;
        foreach ($mapping as $field) { if ($field === 'email') { $mappingHasEmail = true; } }

        foreach ($rows as $row) {
            $counts['total']++;
            $data = array('fields' => array());
            $tags = array();
            $email = null;

            foreach ($mapping as $index => $field) {
                $value = isset($row[(int) $index]) ? trim((string) $row[(int) $index]) : '';
                if ($field === 'ignore' || $value === '') { continue; }
                if ($field === 'tags') {
                    foreach (preg_split('/[;,|]/', $value) as $tag) {
                        if (trim($tag) !== '') { $tags[] = trim($tag); }
                    }
                    continue;
                }
                if ($field === 'email') { $email = $value; continue; }
                $data[$field] = $value;
            }

            if ($email === null || $email === '') { $counts['skipped_empty']++; continue; }
            if (!InputValidator::isPlausibleEmail($email)) { $counts['skipped_invalid']++; continue; }
            $email = InputValidator::email($email);

            if (isset($seen[$email])) { $counts['skipped_duplicate']++; continue; }
            $seen[$email] = true;

            if ($this->subscriptions->suppressions()->isSuppressed($email)) { $counts['skipped_suppressed']++; continue; }
            $existing = $this->subscribers->findByEmail($email);

            $data['email'] = $email;
            $planned[] = array(
                'action' => $existing ? 'update' : 'create',
                'email' => $email,
                'tags' => $tags,
                'data' => $data,
            );
            $counts[$existing ? 'updated' : 'created']++;
        }

        return array('counts' => $counts, 'planned' => $planned, 'mapping_has_email' => $mappingHasEmail);
    }

    private function parseFailure($message)
    {
        return array('ok' => false, 'error' => $message, 'delimiter' => ',', 'has_header' => false, 'header' => array(), 'rows' => array());
    }

    private function detectDelimiter($line)
    {
        $candidates = array(',' => substr_count($line, ','), ';' => substr_count($line, ';'), "\t" => substr_count($line, "\t"));
        $best = '';
        $bestCount = 0;
        foreach ($candidates as $delimiter => $count) {
            if ($count > $bestCount) { $best = $delimiter; $bestCount = $count; }
        }
        if ($bestCount === 0) { return "\n"; } // one column per line (plain address list)
        return $best;
    }

    /** CSV field splitting with double-quote support ("" escapes a quote). */
    private function splitLine($line, $delimiter)
    {
        $cells = array();
        $current = '';
        $inQuotes = false;
        $length = strlen($line);
        for ($i = 0; $i < $length; $i++) {
            $char = $line[$i];
            if ($char === '"') {
                if ($inQuotes && $i + 1 < $length && $line[$i + 1] === '"') { $current .= '"'; $i++; continue; }
                $inQuotes = !$inQuotes;
                continue;
            }
            if ($char === $delimiter && !$inQuotes) { $cells[] = $current; $current = ''; continue; }
            $current .= $char;
        }
        $cells[] = $current;
        return $cells;
    }

    /** A header row is present when no cell in the first row looks like an address. */
    private function looksLikeHeader(array $firstRow)
    {
        foreach ($firstRow as $cell) {
            if (InputValidator::isPlausibleEmail($cell)) { return false; }
        }
        return true;
    }
}
