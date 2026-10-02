<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Ip\IpMath;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Subnet calculator (docs section 23): IPv4 and IPv6 network maths, subnet
 * splitting and the binary form. Deterministic and dependency-free.
 */
final class SubnetService extends Service
{
    protected function execute()
    {
        $cidr = $this->input['cidr'];
        list($address, $prefix) = explode('/', $cidr);
        $packed = IpMath::packed($address);
        if ($packed === null) {
            throw new InvalidArgumentException('Enter a valid IPv4 or IPv6 network in CIDR notation.');
        }
        $bits = strlen($packed) * 8;
        $prefix = (int) $prefix;
        $family = $bits === 32 ? 'IPv4' : 'IPv6';
        $network = IpMath::networkAddress($packed, $prefix);
        $last = IpMath::lastAddress($packed, $prefix);
        $count = IpMath::count($prefix, $bits);
        $hostCount = $this->hostCount($prefix, $bits);
        $details = array(
            'family' => $family,
            'cidr' => inet_ntop($network) . '/' . $prefix,
            'input_cidr' => $cidr,
            'network_address' => inet_ntop($network),
            'broadcast_address' => $bits === 32 ? inet_ntop($last) : ($bits - $prefix >= 1 ? inet_ntop($last) : null),
            'last_address' => inet_ntop($last),
            'first_usable' => $this->firstUsable($network, $last, $bits, $prefix),
            'last_usable' => $this->lastUsable($network, $last, $bits, $prefix),
            'address_count' => $count,
            'usable_hosts' => $hostCount,
            'cidr_suffix' => '/' . $prefix,
            'subnet_mask' => IpMath::maskAddress($prefix, $bits),
            'wildcard_mask' => IpMath::wildcardMaskAddress($prefix, $bits),
            'network_binary' => IpMath::binaryString($network),
            'last_binary' => IpMath::binaryString($last),
            'mask_binary' => IpMath::binaryString(IpMath::packed(IpMath::maskAddress($prefix, $bits))),
            'private_range' => $this->isPrivate($network),
            'ipv4_mapped_notice' => $bits === 32 ? 'Broadcast and usable-host figures are IPv4 concepts; IPv6 has no broadcast address and every address in the prefix is usable (excluding the subnet-router anycast for the all-zero interface identifier, which RFC 4291 defines).' : null,
        );
        $split = isset($this->input['split']) ? (int) $this->input['split'] : 0;
        $subnets = array();
        if ($split > 1) {
            $extraBits = (int) ceil(log($split, 2));
            $newPrefix = $prefix + $extraBits;
            if ($newPrefix > $bits) {
                throw new InvalidArgumentException('That prefix cannot be split into ' . $split . ' subnets: it would need /' . $newPrefix . '.');
            }
            $actual = (int) pow(2, $extraBits);
            $current = $network;
            for ($i = 0; $i < $actual; $i++) {
                $subnets[] = array(
                    'cidr' => inet_ntop($current) . '/' . $newPrefix,
                    'network' => inet_ntop($current),
                    'first_usable' => $this->firstUsable($current, IpMath::lastAddress($current, $newPrefix), $bits, $newPrefix),
                    'last_usable' => $this->lastUsable($current, IpMath::lastAddress($current, $newPrefix), $bits, $newPrefix),
                    'address_count' => IpMath::count($newPrefix, $bits),
                );
                if ($i + 1 < $actual) {
                    $current = IpMath::increment(IpMath::lastAddress($current, $newPrefix));
                }
            }
            $details['split'] = array(
                'requested' => $split,
                'produced' => $actual,
                'prefix_length' => '/' . $newPrefix,
                'note' => $actual !== $split ? 'Subnets come in powers of two, so ' . $split . ' was rounded up to ' . $actual . '.' : '',
            );
        }
        return ToolResult::success(array(
            'subnet' => $details,
            'subnets' => $subnets,
            'summary' => $details['cidr'] . ' · ' . $details['address_count'] . ' address(es) · mask ' . $details['subnet_mask'],
        ), $bits === 32 && $prefix >= 31 ? array('A /' . $prefix . ' has no separate network/broadcast pair on modern equipment (RFC 3021 for /31).') : array());
    }

    private function firstUsable($network, $last, $bits, $prefix)
    {
        if ($bits > 32) {
            return inet_ntop($network);
        }
        if ($prefix >= 31) {
            return inet_ntop($network);
        }
        return inet_ntop(IpMath::increment($network));
    }

    private function lastUsable($network, $last, $bits, $prefix)
    {
        if ($bits > 32) {
            return inet_ntop($last);
        }
        if ($prefix >= 31) {
            return inet_ntop($last);
        }
        return inet_ntop(IpMath::decrement($last));
    }

    private function hostCount($prefix, $bits)
    {
        $total = IpMath::count($prefix, $bits);
        if ($bits > 32) {
            return $total;
        }
        if ($prefix >= 31) {
            return $total;
        }
        if (strpos($total, '^') !== false) {
            return $total;
        }
        // total - 2, done on the decimal string so it stays exact.
        $value = $total;
        for ($i = 0; $i < 2; $i++) {
            $value = $this->decrementDecimal($value);
        }
        return $value;
    }

    private function decrementDecimal($decimal)
    {
        $digits = str_split($decimal);
        for ($i = count($digits) - 1; $i >= 0; $i--) {
            if ($digits[$i] > '0') {
                $digits[$i] = (string) ((int) $digits[$i] - 1);
                return ltrim(implode('', $digits), '0') === '' ? '0' : ltrim(implode('', $digits), '0');
            }
            $digits[$i] = '9';
        }
        return '0';
    }

    private function isPrivate($network)
    {
        $address = inet_ntop($network);
        $ranges = array('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16', '127.0.0.0/8', '169.254.0.0/16', '100.64.0.0/10', 'fc00::/7', 'fe80::/10', '::1/128');
        foreach ($ranges as $range) {
            if (\CloudHost247\NetworkTools\Core\Security\SsrfGuard::inCidr($address, $range)) {
                return true;
            }
        }
        return false;
    }
}
