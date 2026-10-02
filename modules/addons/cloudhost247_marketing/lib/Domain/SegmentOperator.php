<?php
namespace CloudHost247\Marketing\Domain;

/**
 * The closed operator set a segment rule may use, and which field types each
 * operator is allowed on. Validation happens on the way in (a definition is
 * normalised before it is stored) and again on the way out (evaluation refuses
 * anything that is not in the catalog), so a definition written by an older
 * build can never be silently reinterpreted.
 */
final class SegmentOperator
{
    const IS = 'is';
    const IS_NOT = 'is_not';
    const IN = 'in';
    const NOT_IN = 'not_in';
    const CONTAINS = 'contains';
    const NOT_CONTAINS = 'not_contains';
    const BEFORE = 'before';
    const AFTER = 'after';
    const WITHIN_DAYS = 'within_days';
    const OLDER_THAN_DAYS = 'older_than_days';
    const GREATER_THAN = 'greater_than';
    const LESS_THAN = 'less_than';
    const IS_SET = 'is_set';
    const IS_NOT_SET = 'is_not_set';

    /** @var array<string,array> operator => allowed field types */
    private static $operators = array(
        self::IS => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_BOOL, SegmentField::TYPE_NUMBER),
        self::IS_NOT => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_BOOL, SegmentField::TYPE_NUMBER),
        self::IN => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_REFERENCE),
        self::NOT_IN => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_REFERENCE),
        self::CONTAINS => array(SegmentField::TYPE_STRING),
        self::NOT_CONTAINS => array(SegmentField::TYPE_STRING),
        self::BEFORE => array(SegmentField::TYPE_DATE),
        self::AFTER => array(SegmentField::TYPE_DATE),
        self::WITHIN_DAYS => array(SegmentField::TYPE_DATE),
        self::OLDER_THAN_DAYS => array(SegmentField::TYPE_DATE),
        self::GREATER_THAN => array(SegmentField::TYPE_NUMBER),
        self::LESS_THAN => array(SegmentField::TYPE_NUMBER),
        self::IS_SET => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_DATE, SegmentField::TYPE_REFERENCE),
        self::IS_NOT_SET => array(SegmentField::TYPE_ENUM, SegmentField::TYPE_STRING, SegmentField::TYPE_DATE, SegmentField::TYPE_REFERENCE),
    );

    /** @return string[] */
    public static function all()
    {
        return array_keys(self::$operators);
    }

    public static function isValid($operator)
    {
        return is_string($operator) && isset(self::$operators[$operator]);
    }

    /** @return string[] operator labels for the admin rule builder */
    public static function forType($type)
    {
        $out = array();
        foreach (self::$operators as $operator => $types) {
            if (in_array($type, $types, true)) { $out[] = $operator; }
        }
        return $out;
    }

    public static function allowedOn($operator, $type)
    {
        if (!self::isValid($operator)) {
            throw new \InvalidArgumentException('Unknown segment operator: ' . (string) $operator);
        }
        return in_array($type, self::$operators[$operator], true);
    }

    /** `is_set` / `is_not_set` take no value; everything else does. */
    public static function takesValue($operator)
    {
        return !in_array($operator, array(self::IS_SET, self::IS_NOT_SET), true);
    }

    /** True when the operator needs a comma-separated list of values. */
    public static function takesList($operator)
    {
        return in_array($operator, array(self::IN, self::NOT_IN), true);
    }

    public static function label($operator)
    {
        $labels = array(
            self::IS => 'is',
            self::IS_NOT => 'is not',
            self::IN => 'is one of',
            self::NOT_IN => 'is none of',
            self::CONTAINS => 'contains',
            self::NOT_CONTAINS => 'does not contain',
            self::BEFORE => 'is before',
            self::AFTER => 'is after',
            self::WITHIN_DAYS => 'is within the last (days)',
            self::OLDER_THAN_DAYS => 'is older than (days)',
            self::GREATER_THAN => 'is greater than',
            self::LESS_THAN => 'is less than',
            self::IS_SET => 'is present',
            self::IS_NOT_SET => 'is missing',
        );
        return isset($labels[$operator]) ? $labels[$operator] : $operator;
    }

    /** Value hint shown next to the input (keeps the admin honest about formats). */
    public static function valueHint($operator)
    {
        if (self::takesList($operator)) { return 'comma-separated'; }
        if ($operator === self::WITHIN_DAYS || $operator === self::OLDER_THAN_DAYS) { return 'whole days, e.g. 30'; }
        if ($operator === self::BEFORE || $operator === self::AFTER) { return 'YYYY-MM-DD'; }
        return '';
    }

    /**
     * Human sentence for one rule, used in the segment list and preview
     * ("Subscriber status is one of subscribed, pending").
     */
    public static function describe(array $rule)
    {
        $field = SegmentField::label($rule['field']);
        $operator = self::label($rule['operator']);
        if (!self::takesValue($rule['operator'])) { return $field . ' ' . $operator; }
        $value = is_array($rule['value']) ? implode(', ', $rule['value']) : (string) $rule['value'];
        return $field . ' ' . $operator . ' ' . $value;
    }
}
