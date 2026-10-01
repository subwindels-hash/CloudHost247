<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\Marketing\Domain\SegmentField;
use CloudHost247\Marketing\Domain\SegmentOperator;
use CloudHost247\Marketing\Repositories\ClientDirectoryRepository;
use CloudHost247\Marketing\Repositories\ListRepository;
use CloudHost247\Marketing\Repositories\SegmentRepository;
use CloudHost247\Marketing\Repositories\SubscriberRepository;
use CloudHost247\Marketing\Repositories\TagRepository;
use CloudHost247\Marketing\Security\InputValidator;

/**
 * Segment definitions and live evaluation (requirement #8).
 *
 * The rules this service is built around:
 *
 *   1. A segment is a question, not a list. Nothing is copied into membership
 *      tables; every evaluation reads the current subscribers, list memberships,
 *      tags and read-only customer facts.
 *   2. Definitions are validated against closed catalogs on the way in and on
 *      the way out, so an unknown field or operator can never be stored and a
 *      stored one can never be reinterpreted silently.
 *   3. Evaluation fails closed. When a customer-side condition cannot be
 *      verified the subscriber is *not* matched, and the caller is told how many
 *      rows that affected — an honest undercount, never an invented recipient.
 *   4. A cached count is a displayed convenience, never a send list. The send
 *      path resolves ids again and refuses when the evaluation was truncated.
 */
final class SegmentService
{
    const MAX_RULES = 20;
    const MAX_VALUES = 50;
    const MAX_VALUE_LENGTH = 64;
    /** Evaluation stops after this many subscribers and says so. */
    const MAX_SCAN = 50000;
    const BATCH = 500;

    private $segments;
    private $subscribers;
    private $lists;
    private $tags;
    private $clients;

    public function __construct(
        SegmentRepository $segments = null,
        SubscriberRepository $subscribers = null,
        ListRepository $lists = null,
        TagRepository $tags = null,
        ClientDirectoryRepository $clients = null
    ) {
        $this->segments = $segments ?: new SegmentRepository();
        $this->subscribers = $subscribers ?: new SubscriberRepository();
        $this->lists = $lists ?: new ListRepository();
        $this->tags = $tags ?: new TagRepository();
        $this->clients = $clients ?: new ClientDirectoryRepository();
    }

    /** The segment store, for screens that only need rows and never evaluation. */
    public function repository()
    {
        return $this->segments;
    }

    // ------------------------------------------------------------ definitions

    /**
     * Validates and canonicalises a definition (array or JSON string).
     *
     * @param array|string $definition
     * @param bool $strict true on save (reference keys must exist), false when
     *                     re-validating a stored definition for evaluation
     * @return array{match:string,rules:array}
     */
    public function normaliseDefinition($definition, $strict = true)
    {
        if (is_string($definition)) {
            $decoded = json_decode($definition, true);
            if (!is_array($decoded)) { throw new \InvalidArgumentException('The segment definition is not valid JSON.'); }
            $definition = $decoded;
        }
        if (!is_array($definition)) { throw new \InvalidArgumentException('The segment definition must be a rule set.'); }

        $match = 'all';
        if (isset($definition['match'])) {
            $match = strtolower((string) $definition['match']);
            if (!in_array($match, array('all', 'any'), true)) {
                throw new \InvalidArgumentException('A segment must require all or any of its rules.');
            }
        }
        $rules = isset($definition['rules']) ? $definition['rules'] : $definition;
        if (!is_array($rules)) { throw new \InvalidArgumentException('The segment definition carries no rules.'); }
        $rules = array_values(array_filter($rules, function ($rule) { return is_array($rule); }));
        if (!$rules) { throw new \InvalidArgumentException('A segment needs at least one rule.'); }
        if (count($rules) > self::MAX_RULES) {
            throw new \InvalidArgumentException('A segment may carry at most ' . self::MAX_RULES . ' rules.');
        }

        $canonical = array();
        foreach ($rules as $index => $rule) {
            $number = $index + 1;

            // A blank rule row coming from the admin form is an omission, not an
            // error — the caller drops it before validation. Anything else must
            // name a real field and operator.
            if (!isset($rule['field']) || $rule['field'] === '' || !isset($rule['operator']) || $rule['operator'] === '') {
                throw new \InvalidArgumentException('Rule ' . $number . ' needs both a field and an operator.');
            }
            $field = strtolower((string) $rule['field']);
            $operator = strtolower((string) $rule['operator']);
            if (!SegmentField::isValid($field)) {
                throw new \InvalidArgumentException('Rule ' . $number . ': "' . $field . '" is not a field this build can segment on.');
            }
            if (!SegmentOperator::isValid($operator)) {
                throw new \InvalidArgumentException('Rule ' . $number . ': unknown operator "' . $operator . '".');
            }
            $type = SegmentField::type($field);
            if (!SegmentOperator::allowedOn($operator, $type)) {
                throw new \InvalidArgumentException('Rule ' . $number . ': "' . SegmentOperator::label($operator) . '" cannot be used with ' . SegmentField::label($field) . '.');
            }

            $value = isset($rule['value']) ? $rule['value'] : null;
            $canonical[] = array(
                'field' => $field,
                'operator' => $operator,
                'value' => SegmentOperator::takesValue($operator)
                    ? $this->normaliseValue($number, $field, $type, $operator, $value, $strict)
                    : null,
            );
        }

        return array('match' => $match, 'rules' => $canonical);
    }

    private function normaliseValue($number, $field, $type, $operator, $value, $strict)
    {
        $list = SegmentOperator::takesList($operator);
        $values = $list
            ? preg_split('/\s*,\s*/', is_array($value) ? implode(',', $value) : (string) $value, -1, PREG_SPLIT_NO_EMPTY)
            : array(is_array($value) ? '' : $value);
        $values = array_values(array_filter(array_map(function ($item) { return is_scalar($item) ? trim((string) $item) : ''; }, $values), function ($item) { return $item !== ''; }));
        if (!$values) { throw new \InvalidArgumentException('Rule ' . $number . ' needs a value.'); }
        if (count($values) > self::MAX_VALUES) {
            throw new \InvalidArgumentException('Rule ' . $number . ' may compare against at most ' . self::MAX_VALUES . ' values.');
        }

        $out = array();
        foreach ($values as $item) {
            if (strlen($item) > self::MAX_VALUE_LENGTH) {
                throw new \InvalidArgumentException('Rule ' . $number . ': each value must be at most ' . self::MAX_VALUE_LENGTH . ' characters.');
            }
            switch ($type) {
                case SegmentField::TYPE_ENUM:
                    $lower = strtolower($item);
                    if (!in_array($lower, SegmentField::values($field), true)) {
                        throw new \InvalidArgumentException('Rule ' . $number . ': "' . $item . '" is not one of ' . implode(', ', SegmentField::values($field)) . '.');
                    }
                    $out[] = $lower;
                    break;

                case SegmentField::TYPE_BOOL:
                    $bool = filter_var($item, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
                    if ($bool === null) { throw new \InvalidArgumentException('Rule ' . $number . ': expected yes or no.'); }
                    $out[] = $bool;
                    break;

                case SegmentField::TYPE_NUMBER:
                    if (!preg_match('/^-?\d+$/', $item)) { throw new \InvalidArgumentException('Rule ' . $number . ': expected a whole number.'); }
                    $out[] = (int) $item;
                    break;

                case SegmentField::TYPE_DATE:
                    if ($operator === SegmentOperator::WITHIN_DAYS || $operator === SegmentOperator::OLDER_THAN_DAYS) {
                        if (!preg_match('/^\d+$/', $item) || (int) $item > 36500) {
                            throw new \InvalidArgumentException('Rule ' . $number . ': expected a number of days (0-36500).');
                        }
                        $out[] = (int) $item;
                    } else {
                        if (!preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $item, $m) || !checkdate((int) $m[2], (int) $m[3], (int) $m[1])) {
                            throw new \InvalidArgumentException('Rule ' . $number . ': expected a date formatted YYYY-MM-DD.');
                        }
                        $out[] = $item;
                    }
                    break;

                case SegmentField::TYPE_REFERENCE:
                    $key = strtolower($item);
                    if (!preg_match('/^[a-z0-9][a-z0-9_-]{0,63}$/', $key)) {
                        throw new \InvalidArgumentException('Rule ' . $number . ': "' . $item . '" is not a valid key.');
                    }
                    if ($strict) { $this->assertReferenceExists($number, $field, $key); }
                    $out[] = $key;
                    break;

                default:
                    $out[] = $item;
            }
        }

        return $list ? array_values(array_unique($out)) : $out[0];
    }

    private function assertReferenceExists($number, $field, $key)
    {
        if ($field === 'list' && !$this->lists->findByKey($key)) {
            throw new \InvalidArgumentException('Rule ' . $number . ': no list has the key "' . $key . '".');
        }
        if ($field === 'tag' && !$this->tags->findByKey($key)) {
            throw new \InvalidArgumentException('Rule ' . $number . ': no tag has the key "' . $key . '".');
        }
    }

    /** One-line summary for the admin list, e.g. "3 rules · all must match". */
    public function describeDefinition($definition)
    {
        $definition = $this->normaliseDefinition($definition, false);
        $count = count($definition['rules']);
        return $count . ' rule' . ($count === 1 ? '' : 's') . ' · '
            . ($definition['match'] === 'any' ? 'any may match' : 'all must match');
    }

    /** @return string[] one sentence per rule, in stored order */
    public function ruleSentences($definition)
    {
        $definition = $this->normaliseDefinition($definition, false);
        $out = array();
        foreach ($definition['rules'] as $rule) { $out[] = SegmentOperator::describe($rule); }
        return $out;
    }

    // ------------------------------------------------------------ persistence

    /** Creates (id = 0) or updates a segment. Audited either way. */
    public function save(array $input, $id = 0)
    {
        $definition = $this->normaliseDefinition(isset($input['definition']) ? $input['definition'] : array());
        $before = array();
        if ((int) $id > 0) {
            $existing = $this->segments->find((int) $id);
            if (!$existing) { throw new \InvalidArgumentException('Unknown segment.'); }
            $before = array('name' => $existing->name, 'definition' => (string) $existing->definition_json);
            $segment = $this->segments->update((int) $id, array(
                'name' => isset($input['name']) ? $input['name'] : $existing->name,
                'description' => isset($input['description']) ? $input['description'] : $existing->description,
                'definition' => $definition,
            ));
            $action = 'segment.updated';
        } else {
            $segment = $this->segments->create(array(
                'segment_key' => isset($input['segment_key']) ? $input['segment_key'] : '',
                'name' => isset($input['name']) ? $input['name'] : '',
                'description' => isset($input['description']) ? $input['description'] : '',
                'definition' => $definition,
            ));
            $action = 'segment.created';
        }

        AuditLogger::record('cloudhost247_marketing', $action, 'marketing_segment', (int) $segment->id, $before, array(
            'key' => (string) $segment->segment_key,
            'name' => (string) $segment->name,
            'match' => $definition['match'],
            'rules' => count($definition['rules']),
            'definition' => $definition,
        ), 'success');

        return $segment;
    }

    public function archive($id)
    {
        $segment = $this->segments->find((int) $id);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        if ($segment->status === 'archived') { return $segment; }
        $segment = $this->segments->archive((int) $id);
        AuditLogger::record('cloudhost247_marketing', 'segment.archived', 'marketing_segment', (int) $segment->id,
            array('status' => 'active'), array('status' => 'archived', 'key' => (string) $segment->segment_key), 'success');
        return $segment;
    }

    public function activate($id)
    {
        $segment = $this->segments->find((int) $id);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        if ($segment->status === 'active') { return $segment; }
        $segment = $this->segments->activate((int) $id);
        AuditLogger::record('cloudhost247_marketing', 'segment.reactivated', 'marketing_segment', (int) $segment->id,
            array('status' => 'archived'), array('status' => 'active', 'key' => (string) $segment->segment_key), 'success');
        return $segment;
    }

    /**
     * Evaluates a stored segment and records the fresh count. The count is a
     * display cache; the audit row records that the refresh happened.
     */
    public function refreshCount($id)
    {
        $segment = $this->segments->find((int) $id);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        $result = $this->evaluate(SegmentRepository::definitionOf($segment));
        $segment = $this->segments->cacheCount((int) $segment->id, $result['count']);
        AuditLogger::record('cloudhost247_marketing', 'segment.count_refreshed', 'marketing_segment', (int) $segment->id,
            array('cached_count' => null), array(
                'count' => $result['count'], 'checked' => $result['checked'],
                'unverified' => $result['unverified'], 'truncated' => $result['truncated'],
                'warning' => $result['error'],
            ), 'success');
        return array('segment' => $segment, 'result' => $result);
    }

    // ------------------------------------------------------------- evaluation

    /**
     * Evaluates a definition against the live data.
     *
     * @param array|string $definition
     * @param array $options ids_limit (0 = count only), max_scan
     * @return array{count:int,ids:int[],checked:int,truncated:bool,unverified:int,error:string}
     */
    public function evaluate($definition, array $options = array())
    {
        $definition = $this->normaliseDefinition($definition, false);
        $maxScan = isset($options['max_scan']) ? max(1, (int) $options['max_scan']) : self::MAX_SCAN;
        $idsLimit = isset($options['ids_limit']) ? max(0, (int) $options['ids_limit']) : 0;
        $clientFields = SegmentField::clientFieldsFor($definition['rules']);

        $memberships = array('list' => array(), 'tag' => array());
        foreach ($definition['rules'] as $rule) {
            if ($rule['field'] !== 'list' && $rule['field'] !== 'tag') { continue; }
            $keys = (array) $rule['value'];
            // "is present" / "is missing" carry no keys: they ask about *any*
            // membership, so every existing key is indexed for that rule.
            if (!$keys) { $keys = $this->allReferenceKeys($rule['field']); }
            foreach ($keys as $key) {
                if (array_key_exists($key, $memberships[$rule['field']])) { continue; }
                $memberships[$rule['field']][$key] = $this->membershipIds($rule['field'], $key);
            }
        }

        $checked = 0;
        $matched = 0;
        $unverified = 0;
        $ids = array();
        $truncated = false;
        $error = '';
        $page = 1;

        while (true) {
            $batch = $this->subscribers->paginate(array(), $page, self::BATCH);
            $rows = $batch['rows'];
            if (!$rows) { break; }

            $facts = array();
            if ($clientFields) {
                $emails = array();
                foreach ($rows as $row) { $emails[] = (string) $row->email; }
                $lookup = $this->clients->factsByEmail($emails, $clientFields);
                $facts = $lookup['facts'];
                if ($lookup['error'] !== '' && $error === '') { $error = $lookup['error']; }
            }

            foreach ($rows as $row) {
                if ($checked >= $maxScan) { $truncated = true; break 2; }
                $checked++;
                $email = strtolower((string) $row->email);
                $rowFacts = isset($facts[$email]) ? $facts[$email] : array();
                $verdict = $this->matchRow($row, $rowFacts, $definition, $memberships);
                if ($verdict === null) { $unverified++; continue; }
                if ($verdict) {
                    $matched++;
                    if ($idsLimit > 0 && count($ids) < $idsLimit) { $ids[] = (int) $row->id; }
                }
            }

            if (empty($batch['pages']) || $page >= (int) $batch['pages']) { break; }
            $page++;
        }

        return array(
            'count' => $matched,
            'ids' => $ids,
            'checked' => $checked,
            'truncated' => $truncated,
            'unverified' => $unverified,
            'error' => $error,
        );
    }

    /**
     * Resolves the recipient ids for a send. Unlike the admin count, this is
     * strict: an archived segment, a truncated scan or an unreadable customer
     * table refuses outright rather than risk mailing the wrong people.
     *
     * @return int[]
     */
    public function subscriberIds($segmentId, $limit = 10000)
    {
        $segment = $this->segments->find((int) $segmentId);
        if (!$segment) { throw new \InvalidArgumentException('Unknown segment.'); }
        if ($segment->status !== 'active') { throw new \RuntimeException('Segment "' . $segment->name . '" is archived.'); }
        $result = $this->evaluate(SegmentRepository::definitionOf($segment), array('ids_limit' => max(1, (int) $limit)));
        if ($result['truncated']) {
            throw new \RuntimeException('Segment "' . $segment->name . '" exceeds the evaluation scan limit; refine it before sending.');
        }
        if ($result['error'] !== '') {
            throw new \RuntimeException('Segment "' . $segment->name . '" cannot be resolved: ' . $result['error']);
        }
        if ($result['unverified'] > 0) {
            throw new \RuntimeException('Segment "' . $segment->name . '" has customer conditions that could not be verified; refusing to send.');
        }
        return $result['ids'];
    }

    // ------------------------------------------------------------------ rules

    /** @return string[] every existing list/tag key (archived rows still hold membership history) */
    private function allReferenceKeys($field)
    {
        $keys = array();
        $rows = $field === 'list' ? $this->lists->all() : $this->tags->all();
        foreach ($rows as $row) {
            $key = $field === 'list' ? (string) $row->list_key : (string) $row->tag_key;
            if ($key !== '') { $keys[] = $key; }
        }
        return $keys;
    }

    /** @return int[] subscriber ids in the given list/tag key (empty when unknown) */
    private function membershipIds($field, $key)
    {
        if ($field === 'list') {
            $list = $this->lists->findByKey($key);
            return $list ? $this->subscribers->memberIds((int) $list->id) : array();
        }
        $tag = $this->tags->findByKey($key);
        return $tag ? $this->subscribers->taggedIds((int) $tag->id) : array();
    }

    /** @return bool|null true/false when decided, null when a condition could not be verified */
    private function matchRow($row, array $facts, array $definition, array $memberships)
    {
        $unknown = false;
        foreach ($definition['rules'] as $rule) {
            $verdict = $this->matchRule($rule, $row, $facts, $memberships);
            if ($verdict === null) { $unknown = true; continue; }
            if ($definition['match'] === 'any') {
                if ($verdict) { return true; }
            } elseif (!$verdict) {
                return false;
            }
        }
        if ($definition['match'] === 'any') { return $unknown ? null : false; }
        return $unknown ? null : true;
    }

    /** @return bool|null */
    private function matchRule(array $rule, $row, array $facts, array $memberships)
    {
        $field = $rule['field'];

        if (SegmentField::isClientField($field)) {
            if (!array_key_exists($field, $facts)) { return null; } // fail closed
            $actual = $facts[$field];
            if (is_bool($actual)) {
                return $rule['operator'] === SegmentOperator::IS ? $actual === (bool) $rule['value'] : $actual !== (bool) $rule['value'];
            }
            return $this->compareValue($rule, $actual);
        }

        if ($field === 'list' || $field === 'tag') {
            $keys = (array) $rule['value'];
            if (!$keys) { $keys = array_keys($memberships[$field]); }
            $member = false;
            foreach ($keys as $key) {
                $ids = isset($memberships[$field][$key]) ? $memberships[$field][$key] : array();
                if ($ids && in_array((int) $row->id, $ids, true)) { $member = true; break; }
            }
            if ($rule['operator'] === SegmentOperator::IN) { return $member; }
            if ($rule['operator'] === SegmentOperator::NOT_IN) { return !$member; }
            if ($rule['operator'] === SegmentOperator::IS_SET) { return $member; }
            return !$member;
        }

        $column = SegmentField::column($field);
        return $this->compareValue($rule, isset($row->{$column}) ? $row->{$column} : null);
    }

    private function compareValue(array $rule, $actual)
    {
        $operator = $rule['operator'];
        $value = isset($rule['value']) ? $rule['value'] : null;
        $present = $actual !== null && $actual !== '' && $actual !== false;

        if ($operator === SegmentOperator::IS_SET) { return $present; }
        if ($operator === SegmentOperator::IS_NOT_SET) { return !$present; }
        if (!$present) { return false; }

        switch ($operator) {
            case SegmentOperator::IS:
                return $this->scalarEquals($rule['field'], $actual, $value);
            case SegmentOperator::IS_NOT:
                return !$this->scalarEquals($rule['field'], $actual, $value);
            case SegmentOperator::IN:
                return in_array($this->comparable($rule['field'], $actual), (array) $value, true);
            case SegmentOperator::NOT_IN:
                return !in_array($this->comparable($rule['field'], $actual), (array) $value, true);
            case SegmentOperator::CONTAINS:
                return stripos((string) $actual, (string) $value) !== false;
            case SegmentOperator::NOT_CONTAINS:
                return stripos((string) $actual, (string) $value) === false;
            case SegmentOperator::GREATER_THAN:
                return $this->numeric($actual) > (float) $value;
            case SegmentOperator::LESS_THAN:
                return $this->numeric($actual) < (float) $value;
            case SegmentOperator::BEFORE:
                return $this->timestamp($actual) > 0 && $this->timestamp($actual) < $this->timestamp($value . ' 00:00:00');
            case SegmentOperator::AFTER:
                return $this->timestamp($actual) > $this->timestamp($value . ' 23:59:59');
            case SegmentOperator::WITHIN_DAYS:
                return $this->timestamp($actual) >= time() - ((int) $value) * 86400;
            case SegmentOperator::OLDER_THAN_DAYS:
                return $this->timestamp($actual) > 0 && $this->timestamp($actual) < time() - ((int) $value) * 86400;
        }
        return false;
    }

    private function scalarEquals($field, $actual, $value)
    {
        if (SegmentField::type($field) === SegmentField::TYPE_BOOL) { return (bool) $actual === (bool) $value; }
        return $this->comparable($field, $actual) === $this->comparable($field, $value);
    }

    private function comparable($field, $value)
    {
        $type = SegmentField::type($field);
        if ($type === SegmentField::TYPE_ENUM || $type === SegmentField::TYPE_REFERENCE) { return strtolower((string) $value); }
        if ($type === SegmentField::TYPE_STRING) { return (string) $value; }
        return $value;
    }

    private function numeric($value)
    {
        return is_numeric($value) ? (float) $value : 0.0;
    }

    private function timestamp($value)
    {
        if ($value === null || $value === '') { return 0; }
        $stamp = strtotime((string) $value);
        return $stamp === false ? 0 : (int) $stamp;
    }
}
