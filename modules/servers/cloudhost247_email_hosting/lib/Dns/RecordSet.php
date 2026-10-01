<?php
/**
 * DNS record presentation.
 *
 * Records are only ever built from data the provider returned or an
 * administrator configured. The module never invents MX hostnames, priorities,
 * DKIM selectors or verification tokens; when nothing authoritative is
 * available the record set is empty and the UI says so.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Dns;

use CloudHost247\Email\Support\Validator;

final class RecordSet
{
    const SOURCE_PROVIDER = 'provider';
    const SOURCE_CONFIG   = 'config';

    const PURPOSE_VERIFICATION = 'verification';
    const PURPOSE_MAIL         = 'mail';
    const PURPOSE_SPF          = 'spf';
    const PURPOSE_DKIM         = 'dkim';
    const PURPOSE_DMARC        = 'dmarc';
    const PURPOSE_OTHER        = 'other';

    /** @var array<int,array<string,mixed>> */
    private $records = [];

    /** @var string */
    private $source;

    /** @var bool|null Provider-reported verification state; null = unknown. */
    private $verified;

    public function __construct(string $source = self::SOURCE_PROVIDER, ?bool $verified = null)
    {
        $this->source = $source;
        $this->verified = $verified;
    }

    /**
     * Add a record. Malformed entries are dropped rather than displayed.
     */
    public function add(string $type, string $host, string $value, ?int $priority = null, ?int $ttl = null, string $purpose = self::PURPOSE_OTHER): self
    {
        $type = strtoupper(trim($type));
        $value = trim($value);

        if ($type === '' || $value === '') {
            return $this;
        }

        if (!in_array($type, ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS'], true)) {
            return $this;
        }

        $this->records[] = [
            'type'     => $type,
            'host'     => $host === '' ? '@' : Validator::text($host, 191),
            'value'    => Validator::text($value, 1000),
            'priority' => $priority !== null ? max(0, min(65535, $priority)) : null,
            'ttl'      => $ttl !== null ? max(60, min(604800, $ttl)) : null,
            'purpose'  => $purpose,
            'source'   => $this->source,
        ];

        return $this;
    }

    /**
     * Classify a record by its content, so SPF/DKIM/DMARC can be labelled
     * without guessing values.
     */
    public static function classify(string $type, string $host, string $value): string
    {
        $type = strtoupper($type);
        $host = strtolower($host);
        $value = strtolower($value);

        if ($type === 'MX') {
            return self::PURPOSE_MAIL;
        }

        if ($type === 'TXT') {
            if (strpos($value, 'v=spf1') === 0) {
                return self::PURPOSE_SPF;
            }

            if (strpos($host, '_dmarc') === 0) {
                return self::PURPOSE_DMARC;
            }

            if (strpos($value, 'v=dkim1') !== false || strpos($host, '_domainkey') !== false) {
                return self::PURPOSE_DKIM;
            }

            if (strpos($value, 'verification') !== false
                || strpos($value, 'ms=') === 0
                || strpos($value, 'google-site-verification=') === 0) {
                return self::PURPOSE_VERIFICATION;
            }
        }

        if ($type === 'CNAME' && strpos($host, '_domainkey') !== false) {
            return self::PURPOSE_DKIM;
        }

        return self::PURPOSE_OTHER;
    }

    /**
     * @return array<int,array<string,mixed>>
     */
    public function all(): array
    {
        return $this->records;
    }

    public function isEmpty(): bool
    {
        return $this->records === [];
    }

    public function count(): int
    {
        return count($this->records);
    }

    public function source(): string
    {
        return $this->source;
    }

    public function verified(): ?bool
    {
        return $this->verified;
    }

    public function setVerified(?bool $verified): self
    {
        $this->verified = $verified;

        return $this;
    }

    /**
     * Clipboard text for a single record: exactly what a customer pastes into
     * their DNS editor.
     *
     * @param array<string,mixed> $record
     */
    public static function toClipboard(array $record): string
    {
        $parts = [
            'Type: ' . ($record['type'] ?? ''),
            'Host: ' . ($record['host'] ?? '@'),
            'Value: ' . ($record['value'] ?? ''),
        ];

        if (isset($record['priority']) && $record['priority'] !== null) {
            $parts[] = 'Priority: ' . $record['priority'];
        }

        if (isset($record['ttl']) && $record['ttl'] !== null) {
            $parts[] = 'TTL: ' . $record['ttl'];
        }

        return implode('  |  ', $parts);
    }

    /**
     * Clipboard text for the whole set.
     */
    public function toClipboardAll(): string
    {
        $lines = [];

        foreach ($this->records as $record) {
            $lines[] = self::toClipboard($record);
        }

        return implode("\n", $lines);
    }

    /**
     * @param  array<int,array<string,mixed>> $rows
     */
    public static function fromRows(array $rows, string $source = self::SOURCE_PROVIDER, ?bool $verified = null): self
    {
        $set = new self($source, $verified);

        foreach ($rows as $row) {
            $set->add(
                (string) ($row['type'] ?? ''),
                (string) ($row['host'] ?? '@'),
                (string) ($row['value'] ?? ''),
                isset($row['priority']) && $row['priority'] !== null ? (int) $row['priority'] : null,
                isset($row['ttl']) && $row['ttl'] !== null ? (int) $row['ttl'] : null,
                (string) ($row['purpose'] ?? self::PURPOSE_OTHER)
            );
        }

        return $set;
    }
}
