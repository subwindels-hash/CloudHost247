<?php
/**
 * CloudHost247 Tools - Pure-PHP DNS wire client.
 *
 * A minimal RFC 1035 UDP resolver used by the DNS Propagation Checker so the
 * module can query specific public resolvers (Google, Cloudflare, ...) without
 * shelling out to `dig`. Only the record types the propagation checker needs
 * are implemented: A, AAAA, CNAME, MX, NS, TXT.
 *
 * Design notes:
 *  - no shell execution, no external processes — binary packets over a UDP
 *    socket with a hard receive timeout per server;
 *  - response parsing is bounds-checked throughout; malformed or truncated
 *    packets return a failure instead of throwing;
 *  - query identifiers are random per query, recursion-desired is set;
 *  - EDNS0 is not used and responses larger than 512 bytes are ignored
 *    (classic UDP limit) — resolvers simply fall back to shorter answers,
 *    which is acceptable for propagation checks.
 */

if (!defined('WHMCS')) {
    die('This file cannot be accessed directly');
}

final class CloudHost247ToolsDnsClient
{
    /** Query/response timeout in seconds per server. */
    const TIMEOUT = 2;

    /** Maximum UDP payload we will read (classic DNS limit). */
    const MAX_PACKET = 512;

    /** Supported record types => DNS type numbers. */
    private static $types = array(
        'A'     => 1,
        'NS'    => 2,
        'CNAME' => 5,
        'MX'    => 15,
        'TXT'   => 16,
        'AAAA'  => 28,
    );

    /**
     * Query a specific DNS server for one name/type.
     *
     * @param string $server Resolver IP address (v4).
     * @param string $name   QNAME, pre-validated hostname.
     * @param string $type   One of A, AAAA, CNAME, MX, NS, TXT.
     * @return array array('ok' => bool, 'error' => string, 'records' => array<string>)
     */
    public static function query($server, $name, $type)
    {
        if (!isset(self::$types[$type])) {
            return array('ok' => false, 'error' => 'Unsupported record type', 'records' => array());
        }
        if (filter_var($server, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            return array('ok' => false, 'error' => 'Invalid resolver address', 'records' => array());
        }
        if (!preg_match('/^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*\.?$/i', $name)) {
            return array('ok' => false, 'error' => 'Invalid query name', 'records' => array());
        }

        $socket = @fsockopen('udp://' . $server . ':53', 53, $errno, $errstr, self::TIMEOUT);
        if (!$socket) {
            return array('ok' => false, 'error' => 'connect failed: ' . $errstr, 'records' => array());
        }
        stream_set_timeout($socket, self::TIMEOUT);

        $id = mt_rand(0, 0xffff);
        $packet = self::buildQuery($id, $name, self::$types[$type]);
        if ($packet === null) {
            fclose($socket);
            return array('ok' => false, 'error' => 'bad query name', 'records' => array());
        }

        $written = @fwrite($socket, $packet);
        if ($written === false || $written !== strlen($packet)) {
            fclose($socket);
            return array('ok' => false, 'error' => 'write failed', 'records' => array());
        }

        $response = @fread($socket, self::MAX_PACKET);
        $meta = stream_get_meta_data($socket);
        fclose($socket);

        if ($response === false || $response === '') {
            return array('ok' => false, 'error' => isset($meta['timed_out']) && $meta['timed_out'] ? 'timeout' : 'no response', 'records' => array());
        }

        return self::parseResponse($response, $id, $name, $type);
    }

    /**
     * Build a DNS query packet (header + question section).
     *
     * Header: ID, flags RD=1, QDCOUNT=1, others 0.
     * Question: QNAME labels, QTYPE, QCLASS=IN.
     *
     * @param int    $id   Query identifier (16-bit).
     * @param string $name Hostname.
     * @param int    $type DNS type number.
     * @return string|null Binary packet or null for an over-long name.
     */
    public static function buildQuery($id, $name, $type)
    {
        $labels = explode('.', rtrim($name, '.'));
        if (count($labels) > 127) {
            return null;
        }
        $qname = '';
        foreach ($labels as $label) {
            $len = strlen($label);
            if ($len < 1 || $len > 63) {
                return null;
            }
            $qname .= chr($len) . $label;
        }
        $qname .= "\x00";

        return pack('nnnnnn', $id & 0xffff, 0x0100, 1, 0, 0, 0)
            . $qname
            . pack('nn', $type & 0xffff, 1);
    }

    /**
     * Parse a DNS response packet into a list of value strings.
     *
     * Validates the transaction id, the response flag and the RCODE, walks the
     * answer section with compression-pointer support and only extracts RDATA
     * of the requested type. Every read is bounds-checked.
     *
     * @param string $raw    Raw response bytes.
     * @param int    $id     Expected transaction id.
     * @param string $name   Query name (for context, not strictly matched).
     * @param string $type   Requested type.
     * @return array array('ok' => bool, 'error' => string, 'records' => array<string>, 'rcode' => int)
     */
    public static function parseResponse($raw, $id, $name, $type)
    {
        $fail = function ($error) {
            return array('ok' => false, 'error' => $error, 'records' => array(), 'rcode' => -1);
        };

        $len = strlen($raw);
        if ($len < 12) {
            return $fail('truncated header');
        }

        $header = unpack('nid/nflags/nqd/nan/nsn/narc', substr($raw, 0, 12));
        if ($header === false) {
            return $fail('unparseable header');
        }
        if ($header['id'] !== ($id & 0xffff)) {
            return $fail('transaction id mismatch');
        }
        if (($header['flags'] & 0x8000) === 0) {
            return $fail('not a response');
        }
        $rcode = $header['flags'] & 0x000f;
        if ($rcode !== 0) {
            return array('ok' => false, 'error' => 'rcode ' . $rcode, 'records' => array(), 'rcode' => $rcode);
        }

        $offset = 12;

        // Skip the question section (name + QTYPE + QCLASS).
        $skip = self::skipName($raw, $offset);
        if ($skip === null || $skip + 4 > $len) {
            return $fail('bad question section');
        }
        $offset = $skip + 4;

        $wanted = self::$types[$type];
        $records = array();
        $answers = $header['an'];
        for ($i = 0; $i < $answers; $i++) {
            $nameEnd = self::skipName($raw, $offset);
            if ($nameEnd === null || $nameEnd + 10 > $len) {
                break; // malformed answer — return what we have so far
            }
            // Wire layout: TYPE(16) CLASS(16) TTL(32!) RDLENGTH(16) - the TTL
            // must be 'N' (32-bit); using 'n' here desynchronised every answer
            // and made all records parse as out-of-bounds.
            $fixed = unpack('ntype/nclass/Nttl/nrdlength', substr($raw, $nameEnd, 10));
            if ($fixed === false) {
                break;
            }
            $rdStart = $nameEnd + 10;
            $rdEnd = $rdStart + $fixed['rdlength'];
            if ($rdEnd > $len) {
                break;
            }

            if ($fixed['type'] === $wanted) {
                $value = self::readRdata($raw, $fixed['type'], $rdStart, $fixed['rdlength']);
                if ($value !== null) {
                    $records[] = $value;
                }
            }
            $offset = $rdEnd;
        }

        return array('ok' => true, 'error' => '', 'records' => $records, 'rcode' => 0);
    }

    /**
     * Skip (or follow, to validate) a possibly-compressed domain name.
     * Returns the offset just past the name, or null when out of bounds.
     * Compression pointers are followed one level for validation but never
     * returned as the new working offset (the caller keeps its position).
     *
     * @param string $raw    Packet bytes.
     * @param int    $offset Start offset.
     * @return int|null
     */
    private static function skipName($raw, $offset)
    {
        $len = strlen($raw);
        $jumps = 0;
        $end = null;
        $i = $offset;
        while (true) {
            if ($i >= $len) {
                return null;
            }
            $byte = ord($raw[$i]);
            if ($byte === 0) {
                $end = ($end === null) ? $i + 1 : $end;
                return $end;
            }
            if (($byte & 0xc0) === 0xc0) {
                if ($i + 1 >= $len) {
                    return null;
                }
                if ($end === null) {
                    $end = $i + 2;
                }
                $i = (($byte & 0x3f) << 8) | ord($raw[$i + 1]);
                $jumps++;
                if ($jumps > 8 || $i >= $len) {
                    return null;
                }
                continue;
            }
            if (($byte & 0xc0) !== 0) {
                return null; // reserved label types are not DNS text names
            }
            $i += $byte + 1;
        }
    }

    /**
     * Decode RDATA of a supported type into a display string.
     *
     * @param string $raw     Packet bytes.
     * @param int    $type    Record type number.
     * @param int    $start   RDATA start offset.
     * @param int    $length  RDATA length.
     * @return string|null
     */
    private static function readRdata($raw, $type, $start, $length)
    {
        if ($length < 1) {
            return null;
        }
        switch ($type) {
            case self::$types['A']:
                if ($length !== 4) {
                    return null;
                }
                $parts = unpack('C4', substr($raw, $start, 4));
                return $parts[1] . '.' . $parts[2] . '.' . $parts[3] . '.' . $parts[4];

            case self::$types['AAAA']:
                if ($length !== 16) {
                    return null;
                }
                $groups = array();
                for ($i = 0; $i < 16; $i += 2) {
                    $g = unpack('n', substr($raw, $start + $i, 2));
                    $groups[] = dechex($g[1]);
                }
                return implode(':', $groups);

            case self::$types['CNAME']:
            case self::$types['NS']:
                return self::readName($raw, $start, $start + $length);

            case self::$types['MX']:
                if ($length < 3) {
                    return null;
                }
                $pri = unpack('n', substr($raw, $start, 2));
                $host = self::readName($raw, $start + 2, $start + $length);
                if ($host === null) {
                    return null;
                }
                return $pri[1] . ' ' . $host;

            case self::$types['TXT']:
                $strings = array();
                $i = $start;
                $end = $start + $length;
                while ($i < $end) {
                    $strLen = ord($raw[$i]);
                    if ($i + 1 + $strLen > $end) {
                        return null; // malformed character-string
                    }
                    $strings[] = substr($raw, $i + 1, $strLen);
                    $i += 1 + $strLen;
                }
                return implode('', $strings);
        }
        return null;
    }

    /**
     * Read a possibly-compressed domain name starting at $offset, constrained
     * to end by $limit (the RDATA end); returns the dotted name or null when
     * malformed. After following a compression pointer the constraint becomes
     * the packet end, since the remaining labels live at the pointer target.
     *
     * @param string $raw
     * @param int    $offset
     * @param int    $limit
     * @return string|null
     */
    private static function readName($raw, $offset, $limit)
    {
        $len = strlen($raw);
        if ($limit > $len) {
            $limit = $len;
        }
        $labels = array();
        $i = $offset;
        $jumps = 0;
        while (true) {
            if ($i >= $limit) {
                return null;
            }
            $byte = ord($raw[$i]);
            if ($byte === 0) {
                return $labels ? implode('.', $labels) : '.';
            }
            if (($byte & 0xc0) === 0xc0) {
                if ($i + 1 >= $limit || $jumps >= 8) {
                    return null;
                }
                $limit = $len; // after a jump the constraint is the packet end
                $i = (($byte & 0x3f) << 8) | ord($raw[$i + 1]);
                $jumps++;
                continue;
            }
            if (($byte & 0xc0) !== 0 || $byte > 63) {
                return null;
            }
            if ($i + $byte >= $limit) {
                return null; // label would run past the allowed region
            }
            $labels[] = substr($raw, $i + 1, $byte);
            if (count($labels) > 127) {
                return null;
            }
            $i += $byte + 1;
        }
    }
}
