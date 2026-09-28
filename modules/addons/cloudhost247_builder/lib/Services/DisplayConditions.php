<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Support\BuilderException;

/**
 * Where a theme part applies.
 *
 * A part carries include rules and exclude rules. A part applies when at least
 * one include rule matches and no exclude rule does; exclusion always wins.
 * Rules are evaluated against a small, explicit context, so a display
 * condition can never reach into the request or the session to decide.
 */
final class DisplayConditions
{
    const RULE_TYPES = array(
        'all' => 'The whole site',
        'front_page' => 'The builder front page',
        'page' => 'One specific page',
        'slug_prefix' => 'Pages whose address starts with',
        'page_type' => 'A page type',
    );

    const PAGE_TYPES = array('page', 'landing', 'blog', 'archive', 'service', 'error404', 'auth');

    public static function normalize($conditions)
    {
        if (is_string($conditions)) {
            $decoded = json_decode($conditions, true);
            $conditions = is_array($decoded) ? $decoded : array();
        }
        if (!is_array($conditions)) { $conditions = array(); }
        $clean = array('include' => array(), 'exclude' => array());
        foreach (array('include', 'exclude') as $bucket) {
            $rules = isset($conditions[$bucket]) && is_array($conditions[$bucket]) ? $conditions[$bucket] : array();
            foreach ($rules as $rule) {
                $normalized = self::normalizeRule($rule);
                if ($normalized !== null) { $clean[$bucket][] = $normalized; }
                if (count($clean[$bucket]) >= 25) { break; }
            }
        }
        if (!$clean['include']) { $clean['include'][] = array('type' => 'all', 'value' => ''); }
        return $clean;
    }

    private static function normalizeRule($rule)
    {
        if (!is_array($rule)) { return null; }
        $type = isset($rule['type']) ? (string) $rule['type'] : '';
        if (!isset(self::RULE_TYPES[$type])) { return null; }
        $value = isset($rule['value']) && is_scalar($rule['value']) ? (string) $rule['value'] : '';
        switch ($type) {
            case 'page':
                $value = (string) (int) $value;
                if ($value === '0') { return null; }
                break;
            case 'slug_prefix':
                $value = strtolower(preg_replace('/[^a-z0-9\/_-]/i', '', $value));
                if ($value === '') { return null; }
                break;
            case 'page_type':
                if (!in_array($value, self::PAGE_TYPES, true)) { return null; }
                break;
            default:
                $value = '';
        }
        return array('type' => $type, 'value' => $value);
    }

    /**
     * @param array $conditions normalised rules
     * @param array $context    array('page_id', 'slug', 'page_type', 'is_front_page')
     */
    public static function matches($conditions, array $context)
    {
        $conditions = self::normalize($conditions);
        foreach ($conditions['exclude'] as $rule) {
            if (self::ruleMatches($rule, $context)) { return false; }
        }
        foreach ($conditions['include'] as $rule) {
            if (self::ruleMatches($rule, $context)) { return true; }
        }
        return false;
    }

    private static function ruleMatches(array $rule, array $context)
    {
        switch ($rule['type']) {
            case 'all':
                return true;
            case 'front_page':
                return !empty($context['is_front_page']);
            case 'page':
                return (int) $rule['value'] === (int) (isset($context['page_id']) ? $context['page_id'] : 0);
            case 'slug_prefix':
                $slug = isset($context['slug']) ? (string) $context['slug'] : '';
                return $slug !== '' && strncmp($slug, $rule['value'], strlen($rule['value'])) === 0;
            case 'page_type':
                return isset($context['page_type']) && (string) $context['page_type'] === $rule['value'];
            default:
                return false;
        }
    }

    /** Human summary for the theme builder list. */
    public static function describe($conditions)
    {
        $conditions = self::normalize($conditions);
        $parts = array();
        foreach ($conditions['include'] as $rule) { $parts[] = self::describeRule($rule); }
        $summary = 'Shown on: ' . implode(', ', $parts);
        if ($conditions['exclude']) {
            $excluded = array();
            foreach ($conditions['exclude'] as $rule) { $excluded[] = self::describeRule($rule); }
            $summary .= '. Except: ' . implode(', ', $excluded);
        }
        return $summary . '.';
    }

    private static function describeRule(array $rule)
    {
        switch ($rule['type']) {
            case 'all': return 'every builder page';
            case 'front_page': return 'the front page';
            case 'page': return 'page #' . (int) $rule['value'];
            case 'slug_prefix': return 'addresses starting with "' . $rule['value'] . '"';
            case 'page_type': return $rule['value'] . ' pages';
            default: return 'unknown rule';
        }
    }

    /** Parse rules submitted by the theme builder form. */
    public static function fromInput(array $input)
    {
        $conditions = array('include' => array(), 'exclude' => array());
        foreach (array('include', 'exclude') as $bucket) {
            $types = isset($input[$bucket . '_type']) && is_array($input[$bucket . '_type']) ? $input[$bucket . '_type'] : array();
            $values = isset($input[$bucket . '_value']) && is_array($input[$bucket . '_value']) ? $input[$bucket . '_value'] : array();
            foreach ($types as $index => $type) {
                $rule = array('type' => $type, 'value' => isset($values[$index]) ? $values[$index] : '');
                $normalized = self::normalizeRule($rule);
                if ($normalized !== null) { $conditions[$bucket][] = $normalized; }
            }
        }
        if (!$conditions['include'] && !$conditions['exclude']) {
            throw BuilderException::validation('Choose at least one display condition.');
        }
        return self::normalize($conditions);
    }
}
