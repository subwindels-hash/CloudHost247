<?php
namespace CloudHost247\Marketing\Domain;

/**
 * The closed field catalog a segment rule may read (requirement #8).
 *
 * Two families exist and they are treated very differently:
 *
 *   - Module-owned subscriber columns. They live in this addon's own tables and
 *     are read in bulk; nothing outside the marketing schema is touched.
 *   - Read-only WHMCS customer facts (`client.*`). A segment may aggregate six
 *     whitelisted columns of a customer record, but it can never write to one,
 *     never read a password/tax id/address, and never join arbitrary tables. The
 *     rule is deliberate: segmentation answers marketing questions without
 *     becoming a second, unaudited CRM.
 *
 * Anything not in this catalog is rejected when a definition is validated, so a
 * stored definition can never name a column that later code forgot to whitelist.
 */
final class SegmentField
{
    const TYPE_ENUM = 'enum';
    const TYPE_STRING = 'string';
    const TYPE_DATE = 'date';
    const TYPE_BOOL = 'bool';
    const TYPE_NUMBER = 'number';
    const TYPE_REFERENCE = 'reference';

    /** @var array<string,array> */
    private static $fields;

    /**
     * @return array<string,array>
     */
    public static function all()
    {
        if (self::$fields !== null) { return self::$fields; }

        self::$fields = array(
            // --- subscribers (module tables) -----------------------------------
            'status' => array(
                'label' => 'Subscriber status',
                'type' => self::TYPE_ENUM,
                'values' => SubscriberStatus::all(),
                'hint' => 'subscribed / unsubscribed / pending / bounced / suppressed',
            ),
            'consent' => array(
                'label' => 'Consent status',
                'type' => self::TYPE_ENUM,
                'values' => ConsentStatus::all(),
                'hint' => 'Consent evidence recorded when the address was collected.',
            ),
            'source' => array(
                'label' => 'Signup source',
                'type' => self::TYPE_ENUM,
                'values' => SubscriberSource::all(),
                'hint' => 'Where the address came from.',
            ),
            'subscriber.country' => array(
                'label' => 'Subscriber country',
                'type' => self::TYPE_STRING,
                'column' => 'country',
                'hint' => 'Two-letter country code supplied at signup (may be blank).',
            ),
            'created_at' => array(
                'label' => 'Subscribed since',
                'type' => self::TYPE_DATE,
                'hint' => 'When the subscriber row was created.',
            ),
            'last_activity_at' => array(
                'label' => 'Last activity',
                'type' => self::TYPE_DATE,
                'hint' => 'Last send/open/click recorded for this address.',
            ),
            'list' => array(
                'label' => 'List membership',
                'type' => self::TYPE_REFERENCE,
                'reference' => 'list',
                'hint' => 'Comma-separated list keys. Membership is read live, never copied.',
            ),
            'tag' => array(
                'label' => 'Tag membership',
                'type' => self::TYPE_REFERENCE,
                'reference' => 'tag',
                'hint' => 'Comma-separated tag keys.',
            ),

            // --- read-only customer facts (tblclients and friends) -------------
            'client.country' => array(
                'label' => 'Customer country',
                'type' => self::TYPE_STRING,
                'client' => true,
                'hint' => 'tblclients.country — read-only.',
            ),
            'client.status' => array(
                'label' => 'Customer status',
                'type' => self::TYPE_ENUM,
                'values' => array('active', 'inactive', 'closed'),
                'client' => true,
                'hint' => 'tblclients.status — read-only.',
            ),
            'client.created' => array(
                'label' => 'Customer since',
                'type' => self::TYPE_DATE,
                'client' => true,
                'hint' => 'tblclients.datecreated — read-only.',
            ),
            'client.last_login' => array(
                'label' => 'Customer last login',
                'type' => self::TYPE_DATE,
                'client' => true,
                'hint' => 'tblclients.lastlogin — read-only.',
            ),
            'client.has_active_service' => array(
                'label' => 'Has an active service',
                'type' => self::TYPE_BOOL,
                'client' => true,
                'hint' => 'tblhosting.domainstatus = Active — read-only.',
            ),
            'client.has_active_domain' => array(
                'label' => 'Has an active domain',
                'type' => self::TYPE_BOOL,
                'client' => true,
                'hint' => 'tbldomains.status = Active — read-only.',
            ),
        );

        return self::$fields;
    }

    public static function isValid($key)
    {
        $all = self::all();
        return is_string($key) && isset($all[$key]);
    }

    public static function definition($key)
    {
        if (!self::isValid($key)) {
            throw new \InvalidArgumentException('Unknown segment field: ' . (string) $key);
        }
        $all = self::all();
        return $all[$key];
    }

    /** Physical column backing a module-owned field (client facts have none). */
    public static function column($key)
    {
        $field = self::definition($key);
        return isset($field['column']) ? $field['column'] : $key;
    }

    public static function type($key)
    {
        $field = self::definition($key);
        return $field['type'];
    }

    /** @return string[] enum values, lower-cased for canonical comparison */
    public static function values($key)
    {
        $field = self::definition($key);
        $values = isset($field['values']) ? $field['values'] : array();
        return array_map(function ($value) { return strtolower((string) $value); }, $values);
    }

    public static function label($key)
    {
        $field = self::definition($key);
        return $field['label'];
    }

    /** True when the field is a read-only WHMCS customer fact. */
    public static function isClientField($key)
    {
        $field = self::definition($key);
        return !empty($field['client']);
    }

    /**
     * The customer columns a definition needs, in the order they are asked for.
     *
     * @param array $rules canonical rules
     * @return string[] field keys
     */
    public static function clientFieldsFor(array $rules)
    {
        $out = array();
        foreach ($rules as $rule) {
            if (self::isClientField($rule['field']) && !in_array($rule['field'], $out, true)) {
                $out[] = $rule['field'];
            }
        }
        return $out;
    }

    /** Field keys usable where a plain text box is enough (admin help text). */
    public static function keysBySource($client)
    {
        $keys = array();
        foreach (self::all() as $key => $field) {
            if ((bool) $client === !empty($field['client'])) { $keys[] = $key; }
        }
        return $keys;
    }
}
