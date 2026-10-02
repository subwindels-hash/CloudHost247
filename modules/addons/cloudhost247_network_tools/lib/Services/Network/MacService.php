<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * MAC address lookup and generator (docs sections 27, 28).
 *
 * The vendor table is a bundled subset of the IEEE OUI registry covering the
 * prefixes most often seen in practice (network vendors, virtualisation,
 * randomised-address OUI). It is documented as a subset: when a prefix is not in
 * it the answer is "unknown prefix", never a guess. Generation uses
 * random_int() (a CSPRNG) and sets the correct administration bit.
 */
final class MacService extends Service
{
    /** Prefix => organisation (subset of the IEEE registry, documented as such). */
    private static $oui = array(
        '000C29' => 'VMware', '005056' => 'VMware', '000569' => 'VMware',
        '080027' => 'Oracle VirtualBox', '0A0027' => 'Oracle VirtualBox',
        '525400' => 'QEMU / KVM (Red Hat)',
        '00155D' => 'Microsoft Hyper-V', '000D3A' => 'Microsoft',
        '001C42' => 'Parallels', '00163E' => 'Xensource',
        '001B44' => 'SanDisk', '001E64' => 'Intel', '001B21' => 'Intel', '0024D7' => 'Intel',
        '3C970E' => 'Wistron (Intel laptops)',
        'FCFBFB' => 'Cisco', '001A2F' => 'Cisco', '0025B4' => 'Cisco', '001B0C' => 'Cisco',
        '00000C' => 'Cisco', '001BD4' => 'Cisco (Linksys)', 'C0C1C0' => 'Cisco (Linksys)',
        '00095B' => 'Netgear', '204E7F' => 'Netgear', 'A040A0' => 'Netgear', '9C3DCF' => 'Netgear',
        '001CF0' => 'D-Link', '1CBDB9' => 'D-Link', '00265A' => 'D-Link',
        '001D0F' => 'TP-Link', '50C7BF' => 'TP-Link', 'A42BB0' => 'TP-Link', '9C5322' => 'TP-Link',
        '002275' => 'Belkin', '944452' => 'Belkin',
        '001636' => 'Sagemcom', '001A2B' => 'Sagemcom', '7C03D8' => 'Sagemcom',
        'DC4427' => 'Sagemcom', '0019A9' => 'Sagemcom',
        '001349' => 'ZyXEL', '5CE28C' => 'ZyXEL',
        '000895' => 'Dell', 'B88584' => 'Dell', 'F8BC12' => 'Dell', '18DBF2' => 'Dell',
        '001C23' => 'ASUSTek', '2C56DC' => 'ASUSTek', '1C872C' => 'ASUSTek',
        '001D7E' => 'ASUSTek (routers)', 'F832E4' => 'ASUSTek',
        '00248C' => 'ASUSTek Computer', '08606E' => 'ASUSTek', '001E8C' => 'ASUSTek',
        '0016CB' => 'Apple', '002500' => 'Apple', 'F0DBE2' => 'Apple', 'DC2B2A' => 'Apple',
        '3C0754' => 'Apple', '64B9E8' => 'Apple', 'A45E60' => 'Apple', 'F4F15A' => 'Apple',
        '9C04EB' => 'Apple', '8863DF' => 'Apple', '6C4008' => 'Apple',
        '0017F2' => 'Apple', '7CD1C3' => 'Apple', '0026BB' => 'Apple', 'A8667F' => 'Apple',
        'AC61EA' => 'Apple', '001E52' => 'Apple', 'B8E856' => 'Apple', '5CF938' => 'Apple',
        '001A11' => 'Google', '3C5AB4' => 'Google', 'F4F5D8' => 'Google', '641666' => 'Google',
        '54600D' => 'Google (Nest)', '18B430' => 'Google (Nest)',
        '001CC4' => 'HP', '0025B3' => 'HP', '3464A9' => 'HP', '9457A5' => 'HP',
        '000D9D' => 'HP', 'B0C090' => 'HP', '9CDA3E' => 'HP',
        '002481' => 'Hewlett Packard Enterprise', 'EC8EB5' => 'Hewlett Packard Enterprise',
        '001125' => 'IBM', '6C0E0D' => 'IBM', '5CF3FC' => 'IBM',
        '0024D4' => 'Lenovo', '0894EF' => 'Lenovo', '6C5F1C' => 'Lenovo',
        '5CE0C5' => 'Lenovo', 'A48CDB' => 'Lenovo',
        '001B38' => 'Compal', '0024BE' => 'Sony', 'FC0FE6' => 'Sony',
        '002232' => 'Samsung', '8425DB' => 'Samsung', '3C5A37' => 'Samsung',
        '0017C9' => 'Samsung', '7C0BC6' => 'Samsung', '5001BB' => 'Samsung',
        '002454' => 'Samsung', 'E8508B' => 'Samsung', '00166F' => 'Samsung',
        'F409D8' => 'Samsung', '0018AF' => 'Samsung', 'D0176A' => 'Samsung',
        'F8E61A' => 'Samsung', 'C8BA94' => 'Samsung', 'B47443' => 'Samsung',
        '001DD9' => 'Hon Hai (Foxconn)', '0026B9' => 'Hon Hai (Foxconn)', '9C4E36' => 'Hon Hai (Foxconn)',
        '002241' => 'Apple (AirPort)', '68A86D' => 'Apple', 'B8098A' => 'Apple',
        'E0C9D6' => 'TP-Link', '48DF37' => 'Hewlett Packard Enterprise',
        'C4E984' => 'TP-Link', '38D547' => 'ASUSTek',
        '00E04C' => 'Realtek', '000C42' => 'Routerboard (MikroTik)', '4C5E0C' => 'Routerboard (MikroTik)',
        '6C3B6B' => 'Routerboard (MikroTik)', '744D28' => 'Routerboard (MikroTik)',
        '186472' => 'Ubiquiti', '24A43C' => 'Ubiquiti', '788A20' => 'Ubiquiti', 'FCEFB9' => 'Ubiquiti',
        '0418D6' => 'Ubiquiti', 'E063DA' => 'Ubiquiti', '00156D' => 'Ubiquiti', 'B4FBE4' => 'Ubiquiti',
    );

    public function lookup(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    public function generate(array $input, array $context = array())
    {
        return $this->run($input, $context);
    }

    protected function execute()
    {
        $slug = $this->tool() ? $this->tool()->slug() : 'network/mac-lookup';
        if ($slug === 'network/mac-generator') {
            return $this->generateAddresses();
        }
        return $this->lookupAddress();
    }

    private function lookupAddress()
    {
        $mac = $this->input['mac'];
        $hex = str_replace(':', '', $mac);
        $firstByte = hexdec(substr($hex, 0, 2));
        $individual = ($firstByte & 1) === 1;
        $universal = ($firstByte & 2) === 0;
        $prefix = strtoupper(substr($hex, 0, 6));
        $organisation = $this->organisation($prefix);
        $warnings = array();
        if (!$universal) {
            $warnings[] = 'This is a locally administered address (the U/L bit is set). It was assigned by software, so no vendor can be identified — that is by design.';
        }
        if (!$organisation && $universal) {
            $warnings[] = 'The prefix ' . $prefix . ' is not in the bundled OUI subset shipped with the platform. No vendor is claimed rather than guessing one.';
        }
        return ToolResult::success(array(
            'mac' => $mac,
            'normalised' => $mac,
            'oui' => $prefix,
            'organisation' => $organisation,
            'address_type' => $universal ? 'Universally administered (assigned by the manufacturer)' : 'Locally administered (software assigned)',
            'unicast_multicast' => $individual ? 'Multicast/broadcast-bit set' : 'Unicast',
            'oui_database_notice' => 'The vendor table is a bundled subset of the IEEE OUI registry covering common prefixes. A prefix outside it is reported as unknown.',
            'summary' => $mac . ($organisation ? ' — ' . $organisation : ' — vendor prefix not in the bundled subset.'),
        ), $warnings);
    }

    private function generateAddresses()
    {
        $count = isset($this->input['count']) ? (int) $this->input['count'] : 5;
        $count = max(1, min(20, $count));
        $kind = isset($this->input['kind']) ? $this->input['kind'] : 'universal';
        $separator = isset($this->input['separator']) ? $this->input['separator'] : ':';
        $addresses = array();
        for ($i = 0; $i < $count; $i++) {
            $bytes = array();
            for ($b = 0; $b < 6; $b++) {
                $bytes[] = random_int(0, 255);
            }
            $first = $bytes[0] & 0xfe; // unicast
            if ($kind === 'local') {
                $first |= 0x02;
            } elseif ($kind === 'universal') {
                $first &= ~0x02 & 0xff;
            } else {
                $first = random_int(0, 255) & 0xfe;
            }
            $bytes[0] = $first;
            $formatted = $this->format($bytes, $separator);
            $addresses[] = array(
                'mac' => $formatted,
                'oui' => strtoupper(implode('', array_map(function ($byte) {
                    return str_pad(dechex($byte), 2, '0', STR_PAD_LEFT);
                }, array_slice($bytes, 0, 3)))),
                'administration' => ($first & 0x02) ? 'locally administered' : 'universally administered',
                'organisation' => $this->organisation(strtoupper(implode('', array_map(function ($byte) {
                    return str_pad(dechex($byte), 2, '0', STR_PAD_LEFT);
                }, array_slice($bytes, 0, 3))))),
            );
        }
        return ToolResult::success(array(
            'generated' => $addresses,
            'count' => count($addresses),
            'kind' => $kind,
            'separator' => $separator,
            'randomness' => 'Each octet comes from random_int(), the platform CSPRNG.',
            'usage_notice' => 'These addresses are structurally valid. Do not use them to impersonate a device on a network you do not own.',
            'summary' => $count . ' ' . $kind . ' MAC address(es) generated.',
        ));
    }

    private function format(array $bytes, $separator)
    {
        $hex = implode('', array_map(function ($byte) {
            return str_pad(dechex($byte), 2, '0', STR_PAD_LEFT);
        }, $bytes));
        if ($separator === '-') {
            return implode('-', str_split($hex, 2));
        }
        if ($separator === '.') {
            return implode('.', str_split($hex, 4));
        }
        return implode(':', str_split($hex, 2));
    }

    private function organisation($prefix)
    {
        if (isset(self::$oui[$prefix])) {
            return self::$oui[$prefix];
        }
        // A locally administered prefix has no vendor by definition.
        $firstByte = hexdec(substr($prefix, 0, 2));
        if (($firstByte & 2) === 2) {
            return 'Locally administered (randomised or software-assigned)';
        }
        return '';
    }
}
