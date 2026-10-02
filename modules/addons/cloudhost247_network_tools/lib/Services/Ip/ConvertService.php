<?php
namespace CloudHost247\NetworkTools\Services\Ip;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * IP converters (docs section 22). Pure arithmetic through IpMath: no network
 * access, no external provider, and the same input always produces the same
 * output. An operation that is not technically applicable (IPv6 to IPv4 for a
 * non-mapped address) says so instead of returning a made-up address.
 */
final class ConvertService extends Service
{
    protected function execute()
    {
        $operation = $this->input['operation'];
        $value = trim((string) $this->input['value']);
        switch ($operation) {
            case 'ip_to_decimal':
                return $this->ipToDecimal($value);
            case 'decimal_to_ip':
                return $this->decimalToIp($value);
            case 'ipv4_to_ipv6':
                return $this->ipv4ToIpv6($value);
            case 'ipv6_to_ipv4':
                return $this->ipv6ToIpv4($value);
            case 'ipv6_compress':
                return $this->ipv6Form($value, 'compress');
            case 'ipv6_expand':
                return $this->ipv6Form($value, 'expand');
            case 'ipv6_cidr_to_range':
                return $this->cidrToRange($value);
            case 'ipv6_range_to_cidr':
                return $this->rangeToCidr($value);
            default:
                return ToolResult::invalid('That conversion is not supported.');
        }
    }

    private function ipToDecimal($value)
    {
        $packed = IpMath::packed($value);
        if ($packed === null) {
            throw new InvalidArgumentException('Enter a valid IPv4 or IPv6 address.');
        }
        $bits = strlen($packed) * 8;
        return ToolResult::success(array(
            'operation' => 'ip_to_decimal',
            'input' => $value,
            'normalised' => inet_ntop($packed),
            'family' => $bits === 32 ? 'IPv4' : 'IPv6',
            'decimal' => IpMath::binaryToDecimal($packed),
            'hex' => '0x' . strtoupper(bin2hex($packed)),
            'binary' => IpMath::binaryString($packed),
            'summary' => inet_ntop($packed) . ' = ' . IpMath::binaryToDecimal($packed),
        ));
    }

    private function decimalToIp($value)
    {
        $input = $value;
        if (stripos($value, '0x') === 0) {
            $hex = substr($value, 2);
            if (!preg_match('/^[0-9a-f]{1,32}$/i', $hex)) {
                throw new InvalidArgumentException('That hexadecimal value is not an address-sized integer.');
            }
            $value = IpMath::binaryToDecimal(hex2bin(str_pad($hex, strlen($hex) % 2 === 0 ? strlen($hex) : strlen($hex) + 1, '0', STR_PAD_LEFT)));
        }
        if (!preg_match('/^\d{1,39}$/', $value)) {
            throw new InvalidArgumentException('Enter a decimal integer, or a hexadecimal value with a 0x prefix.');
        }
        $value = ltrim($value, '0');
        if ($value === '') {
            $value = '0';
        }
        // 4294967295 is 2^32-1: anything up to it is an IPv4 address, anything
        // above is interpreted as a 128-bit IPv6 value. The rule is stated in
        // the result so the conversion is never ambiguous.
        $asIpv4 = IpMath::decimalToBinary($value, 4);
        if ($asIpv4 !== null) {
            return ToolResult::success(array(
                'operation' => 'decimal_to_ip',
                'input' => $input,
                'family' => 'IPv4',
                'ip' => inet_ntop($asIpv4),
                'binary' => IpMath::binaryString($asIpv4),
                'rule' => 'Values up to 4294967295 (2^32-1) are interpreted as IPv4; larger values as 128-bit IPv6.',
                'summary' => $value . ' = ' . inet_ntop($asIpv4),
            ));
        }
        $asIpv6 = IpMath::decimalToBinary($value, 16);
        if ($asIpv6 === null) {
            throw new InvalidArgumentException('That number is larger than a 128-bit IPv6 address (2^128-1).');
        }
        return ToolResult::success(array(
            'operation' => 'decimal_to_ip',
            'input' => $input,
            'family' => 'IPv6',
            'ip' => inet_ntop($asIpv6),
            'compressed' => IpMath::compress($asIpv6),
            'expanded' => IpMath::expand($asIpv6),
            'binary' => IpMath::binaryString($asIpv6),
            'rule' => 'Values up to 4294967295 (2^32-1) are interpreted as IPv4; larger values as 128-bit IPv6.',
            'summary' => $value . ' = ' . inet_ntop($asIpv6),
        ));
    }

    private function ipv4ToIpv6($value)
    {
        if (filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4) === false) {
            throw new InvalidArgumentException('Enter an IPv4 address to map into IPv6.');
        }
        $mapped = IpMath::ipv4ToMapped($value);
        $packed = IpMath::packed($value);
        $compatible = inet_ntop("\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00\x00" . $packed);
        return ToolResult::success(array(
            'operation' => 'ipv4_to_ipv6',
            'input' => $value,
            'mapped' => $mapped,
            'ipv4_compatible_deprecated' => $compatible,
            'note' => 'Mapped form (::ffff:a.b.c.d) is what dual-stack sockets use on the wire. The IPv4-compatible form (::a.b.c.d) is deprecated by RFC 4291 and is shown only because some tools still print it.',
            'summary' => $value . ' → ' . $mapped,
        ));
    }

    private function ipv6ToIpv4($value)
    {
        if (filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            throw new InvalidArgumentException('Enter an IPv6 address.');
        }
        $ipv4 = IpMath::ipv6ToIpv4($value);
        if ($ipv4 === null) {
            return ToolResult::success(array(
                'operation' => 'ipv6_to_ipv4',
                'input' => $value,
                'applicable' => false,
                'ipv4' => '',
                'note' => 'This address is a native IPv6 address, so it carries no IPv4 address. Only IPv4-mapped (::ffff:0:0/96) and NAT64 (64:ff9b::/96) addresses can be converted, and the tool will not invent one for other addresses.',
                'summary' => 'Not applicable: ' . $value . ' is not an IPv4-mapped or NAT64 address.',
            ));
        }
        return ToolResult::success(array(
            'operation' => 'ipv6_to_ipv4',
            'input' => $value,
            'applicable' => true,
            'ipv4' => $ipv4,
            'summary' => $value . ' carries IPv4 ' . $ipv4 . '.',
        ));
    }

    private function ipv6Form($value, $mode)
    {
        if (filter_var($value, FILTER_VALIDATE_IP, FILTER_FLAG_IPV6) === false) {
            throw new InvalidArgumentException('Enter an IPv6 address.');
        }
        $compressed = IpMath::compress($value);
        $expanded = IpMath::expand($value);
        $packed = IpMath::packed($value);
        return ToolResult::success(array(
            'operation' => 'ipv6_' . $mode,
            'input' => $value,
            'compressed' => $compressed,
            'expanded' => $expanded,
            'binary' => IpMath::binaryString($packed),
            'decimal' => IpMath::binaryToDecimal($packed),
            'summary' => $mode === 'compress' ? $compressed : $expanded,
        ));
    }

    private function cidrToRange($value)
    {
        if (strpos($value, '/') === false) {
            throw new InvalidArgumentException('Use CIDR notation for this conversion, for example 2001:db8::/48.');
        }
        list($address, $prefix) = explode('/', $value, 2);
        if (!ctype_digit($prefix)) {
            throw new InvalidArgumentException('The prefix length must be a number.');
        }
        $packed = IpMath::packed($address);
        if ($packed === null) {
            throw new InvalidArgumentException('Enter a valid IPv4 or IPv6 address before the slash.');
        }
        $bits = strlen($packed) * 8;
        $prefix = (int) $prefix;
        if ($prefix < 0 || $prefix > $bits) {
            throw new InvalidArgumentException('A /' . $bits . ' is the largest prefix for that address family.');
        }
        $first = IpMath::networkAddress($packed, $prefix);
        $last = IpMath::lastAddress($packed, $prefix);
        return ToolResult::success(array(
            'operation' => 'ipv6_cidr_to_range',
            'input' => $value,
            'family' => $bits === 32 ? 'IPv4' : 'IPv6',
            'network' => inet_ntop($first),
            'first' => inet_ntop($first),
            'last' => inet_ntop($last),
            'count' => IpMath::count($prefix, $bits),
            'count_formula' => '2^' . ($bits - $prefix),
            'summary' => inet_ntop($first) . ' – ' . inet_ntop($last) . ' (' . IpMath::count($prefix, $bits) . ' addresses)',
        ));
    }

    private function rangeToCidr($value)
    {
        $parts = preg_split('/\s*(?:-|–|\.\.|\s+)\s*/', $value, -1, PREG_SPLIT_NO_EMPTY);
        if (count($parts) !== 2) {
            throw new InvalidArgumentException('Enter two addresses separated by a hyphen, for example 2001:db8:: – 2001:db8::ff.');
        }
        $start = IpMath::packed($parts[0]);
        $end = IpMath::packed($parts[1]);
        if ($start === null || $end === null || strlen($start) !== strlen($end)) {
            throw new InvalidArgumentException('Both ends of the range must be addresses of the same family.');
        }
        if (IpMath::compare($start, $end) > 0) {
            throw new InvalidArgumentException('The end of the range must not be lower than the start.');
        }
        $blocks = IpMath::rangeToCidrs($start, $end, 512);
        return ToolResult::success(array(
            'operation' => 'ipv6_range_to_cidr',
            'input' => $value,
            'family' => strlen($start) === 4 ? 'IPv4' : 'IPv6',
            'block_count' => count($blocks),
            'blocks' => $blocks,
            'truncated' => count($blocks) >= 512,
            'summary' => count($blocks) . ' CIDR block(s) cover ' . $parts[0] . ' – ' . $parts[1] . '.',
            'note' => count($blocks) >= 512 ? 'The range needed more than 512 blocks; the first 512 are listed.' : '',
        ));
    }
}
