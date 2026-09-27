<?php
/**
 * CloudHost247 Tools - Network Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_port_checker($post)
{
    $host = CloudHost247_tools_sanitize($post['host'] ?? '', 'domain');
    $port = (int) ($post['port'] ?? 80);
    $timeout = 5;

    if (empty($host)) {
        return ['error' => 'Please enter a host'];
    }
    if ($port < 1 || $port > 65535) {
        return ['error' => 'Port must be 1-65535'];
    }

    $socket = @fsockopen($host, $port, $errno, $errstr, $timeout);
    if ($socket) {
        fclose($socket);
        return ['host' => $host, 'port' => $port, 'open' => true];
    }

    return ['host' => $host, 'port' => $port, 'open' => false, 'error' => $errstr];
}

function CloudHost247_tool_mac_lookup($post)
{
    $mac = CloudHost247_tools_sanitize($post['mac'] ?? '', 'string');
    $mac = strtoupper(preg_replace('/[^a-fA-F0-9]/', '', $mac));

    if (strlen($mac) !== 12) {
        return ['error' => 'Invalid MAC address format'];
    }

    $oui = substr($mac, 0, 6);

    // Built-in small OUI database
    $ouis = [
        '000000' => 'XEROX CORPORATION',
        '00000C' => 'Cisco Systems',
        '00000E' => 'FUJITSU LIMITED',
        '000010' => 'Hewlett-Packard',
        '000014' => 'NEC Corporation',
        '000018' => 'Novell',
        '00001B' => 'Novell',
        '000020' => 'Intel Corporation',
        '000022' => 'NEC Corporation',
        '00002A' => 'SMC Networks',
        '000032' => 'Nokia Danmark A/S',
        '00003C' => 'AquaComms',
        '000048' => 'Seiko Epson Corporation',
        '00004C' => 'Nokia Corporation',
        '000050' => 'IBM',
        '00005E' => 'U.S. Department of Defense',
        '000065' => 'Motorola',
        '000068' => 'Hewlett-Packard',
        '00006D' => 'Avaya',
        '000075' => 'Siemens AG',
        '000080' => 'Cray Research',
        '000081' => 'Nortel Networks',
        '000083' => 'Hewlett-Packard',
        '000086' => 'Texas Instruments',
        '000089' => 'Cisco Systems',
        '000093' => 'Apple',
        '0000A0' => 'Intel Corporation',
        '0000A2' => 'Intel Corporation',
        '0000A4' => 'IBM',
        '0000AA' => 'Intel Corporation',
        '0000B0' => 'Hewlett-Packard',
        '0000C0' => 'Western Digital',
        '0000C5' => 'Hawking Technologies',
        '0000D4' => 'Alteon Networks',
        '0000E2' => 'Acer Incorporated',
        '0000E8' => 'Samsung Electronics',
        '0000F0' => 'Samsung Electronics',
        '0000F6' => 'Canon',
        '001B11' => 'Apple',
        '001B63' => 'Apple',
        '0021E9' => 'Apple',
        '00224D' => 'Apple',
        '00236C' => 'Apple',
        '002500' => 'Apple',
        '0026B0' => 'Apple',
        '0026BB' => 'Apple',
        '002F6E' => 'Apple',
        '003EE1' => 'Apple',
        '0050E4' => 'Apple',
        '0056CD' => 'Apple',
        '005B94' => 'Apple',
        '006D52' => 'Apple',
        '007D60' => 'Apple',
        '008865' => 'Apple',
        '00A040' => 'Apple',
        '00BB3A' => 'Apple',
        '00CD3E' => 'Apple',
        '00E3AC' => 'Apple',
        '04D6AA' => 'Apple',
        '080007' => 'Apple',
        '080027' => 'VirtualBox',
        '0C1539' => 'Apple',
        '105932' => 'Apple',
        '1093E9' => 'Apple',
        '109ADD' => 'Apple',
        '14109F' => 'Apple',
        '145A05' => 'Apple',
        '147510' => 'Apple',
        '148FC6' => 'Apple',
        '14B99C' => 'Cisco',
        '14D19E' => 'Apple',
        '183451' => 'Apple',
        '189EFC' => 'Apple',
        '18AF61' => 'Apple',
        '18E7F4' => 'Apple',
        '1C36BB' => 'Apple',
        '1C91FD' => 'Apple',
        '1CB3C9' => 'Apple',
        '20A2E4' => 'Apple',
        '24AB81' => 'Apple',
        '28A02B' => 'Apple',
        '28CFDA' => 'Apple',
        '28E7CF' => 'Apple',
        '2C200B' => 'Apple',
        '2C6BF1' => 'Apple',
        '3010E4' => 'Apple',
        '34AB37' => 'Apple',
        '34C059' => 'Apple',
        '380F4A' => 'Apple',
        '38384F' => 'Apple',
        '38539C' => 'Apple',
        '38862B' => 'Apple',
        '38B54D' => 'Apple',
        '38C986' => 'Apple',
        '3C0754' => 'Apple',
        '3CAB8E' => 'Apple',
        '3CD0F8' => 'Apple',
        '3CE072' => 'Apple',
        '403CFC' => 'Apple',
        '406C8F' => 'Apple',
        '406D9F' => 'Apple',
        '40CABA' => 'Apple',
        '40D32D' => 'Apple',
        '442D24' => 'Apple',
        '44FB42' => 'Apple',
        '482CB7' => 'Apple',
        '485AA5' => 'Apple',
        '485B39' => 'Apple',
        '4C57CA' => 'Apple',
        '502E25' => 'Apple',
        '50BC96' => 'Apple',
        '50EAD6' => 'Apple',
        '542696' => 'Apple',
        '54B802' => 'Apple',
        '54E43A' => 'Apple',
        '58024F' => 'Apple',
        '58B035' => 'Apple',
        '5C518F' => 'Apple',
        '5C9486' => 'Apple',
        '5CF5DA' => 'Apple',
        '5CF938' => 'Apple',
        '60334B' => 'Apple',
        '606944' => 'Apple',
        '609217' => 'Apple',
        '60D9C7' => 'Apple',
        '60FACD' => 'Apple',
        '60F81D' => 'Apple',
        '64A3CB' => 'Apple',
        '64B0A6' => 'Apple',
        '64B9E8' => 'Apple',
        '64E853' => 'Apple',
        '64F0A3' => 'Apple',
        '681893' => 'Apple',
        '6854FD' => 'Apple',
        '68967B' => 'Apple',
        '68FB7E' => 'Apple',
        '6C3E6D' => 'Apple',
        '6C709F' => 'Apple',
        '6C94F8' => 'Apple',
        '6CB1DF' => 'Apple',
        '6CE872' => 'Apple',
        '705681' => 'Apple',
        '7073CB' => 'Apple',
        '70AEE5' => 'Apple',
        '70DEE5' => 'Apple',
        '70ECE4' => 'Apple',
        '74E1B6' => 'Apple',
        '74E2F5' => 'Apple',
        '7823AE' => 'Apple',
        '78CA39' => 'Apple',
        '78D75F' => 'Apple',
        '78F8F1' => 'Apple',
        '7C04D0' => 'Apple',
        '7C6D62' => 'Apple',
        '7C6DF8' => 'Apple',
        '7C8A17' => 'Apple',
        '7CB21B' => 'Apple',
        '7CBE2D' => 'Apple',
        '7CD1C3' => 'Apple',
        '7CF05F' => 'Apple',
        '800A5E' => 'Apple',
        '807A7E' => 'Apple',
        '80B03D' => 'Apple',
        '80E42E' => 'Apple',
        '841B5E' => 'Apple',
        '846883' => 'Apple',
        '84A1D1' => 'Apple',
        '84B1E7' => 'Apple',
        '84D6D0' => 'Apple',
        '84FCAC' => 'Apple',
        '8857EE' => 'Apple',
        '8866DD' => 'Apple',
        '88E87F' => 'Apple',
        '8C006D' => 'Apple',
        '8C5877' => 'Apple',
        '8C7C92' => 'Apple',
        '8C7C92' => 'Apple',
        '8CAB8E' => 'Apple',
        '900117' => 'Apple',
        '90B931' => 'Apple',
        '90DD5D' => 'Apple',
        '90E8C0' => 'Apple',
        '90FD61' => 'Apple',
        '9410D1' => 'Apple',
        '9420BB' => 'Apple',
        '94E96E' => 'Apple',
        '98B8E3' => 'Apple',
        '98D6BB' => 'Apple',
        '98F170' => 'Apple',
        '98FE03' => 'Apple',
        '9C04EB' => 'Apple',
        '9C207A' => 'Apple',
        '9C35EB' => 'Apple',
        '9CF387' => 'Apple',
        'A03BE7' => 'Apple',
        'A03499' => 'Apple',
        'A0EDCD' => 'Apple',
        'A40B28' => 'Apple',
        'A45E60' => 'Apple',
        'A8667F' => 'Apple',
        'A8A7AD' => 'Apple',
        'A8BBC8' => 'Apple',
        'A8FAD8' => 'Apple',
        'AC3C0B' => 'Apple',
        'AC6FBB' => 'Apple',
        'AC7E8F' => 'Apple',
        'AC88FD' => 'Apple',
        'ACBC32' => 'Apple',
        'ACCF5C' => 'Apple',
        'ACE292' => 'Apple',
        'B03495' => 'Apple',
        'B065BD' => 'Apple',
        'B077AC' => 'Apple',
        'B08C75' => 'Apple',
        'B0B1D5' => 'Apple',
        'B0CA68' => 'Apple',
        'B0D59D' => 'Apple',
        'B0EC8E' => 'Apple',
        'B40CE7' => 'Apple',
        'B41F19' => 'Apple',
        'B44BD2' => 'Apple',
        'B44C16' => 'Apple',
        'B4F0AB' => 'Apple',
        'B82410' => 'Apple',
        'B828D2' => 'Apple',
        'B83D4E' => 'Apple',
        'B8653B' => 'Apple',
        'B877C3' => 'Apple',
        'B88198' => 'Apple',
        'B88D12' => 'Apple',
        'B8BC1B' => 'Apple',
        'B8C68E' => 'Apple',
        'B8E856' => 'Apple',
        'B8F87A' => 'Apple',
        'BC3BAF' => 'Apple',
        'BC4CC4' => 'Apple',
        'BC52B7' => 'Apple',
        'BC6C16' => 'Apple',
        'BC9246' => 'Apple',
        'BC9FEF' => 'Apple',
        'BCDE48' => 'Apple',
        'C02C5C' => 'Apple',
        'C05FD6' => 'Apple',
        'C06394' => 'Apple',
        'C0847A' => 'Apple',
        'C09F42' => 'Apple',
        'C42C03' => 'Apple',
        'C4B301' => 'Apple',
        'C82A14' => 'Apple',
        'C82DD2' => 'Apple',
        'C88550' => 'Apple',
        'C88D83' => 'Apple',
        'C8983B' => 'Apple',
        'C8B2B8' => 'Apple',
        'C8B5B7' => 'Apple',
        'C8BCC8' => 'Apple',
        'C8E0EB' => 'Apple',
        'C8F650' => 'Apple',
        'CC08E0' => 'Apple',
        'CC25EF' => 'Apple',
        'CC44AD' => 'Apple',
        'CC668A' => 'Apple',
        'CC785F' => 'Apple',
        'CCE0C3' => 'Apple',
        'D0034B' => 'Apple',
        'D00C1F' => 'Apple',
        'D09FD9' => 'Apple',
        'D0A637' => 'Apple',
        'D0E140' => 'Apple',
        'D45D64' => 'Apple',
        'D49A20' => 'Apple',
        'D4DCCD' => 'Apple',
        'D4F587' => 'Apple',
        'D8160A' => 'Apple',
        'D81C79' => 'Apple',
        'D8287A' => 'Apple',
        'D89EF3' => 'Apple',
        'D8A25E' => 'Apple',
        'D8D1CB' => 'Apple',
        'D8D23C' => 'Apple',
        'D8D43D' => 'Apple',
        'D8D5E0' => 'Apple',
        'D8D7CB' => 'Apple',
        'D8F883' => 'Apple',
        'DC2B2A' => 'Apple',
        'DC5623' => 'Apple',
        'DC86D8' => 'Apple',
        'DC9B9C' => 'Apple',
        'DCA904' => 'Apple',
        'DCAEE5' => 'Apple',
        'DCD0F7' => 'Apple',
        'DCD3A2' => 'Apple',
        'DCF7F4' => 'Apple',
        'E01D0B' => 'Apple',
        'E06678' => 'Apple',
        'E0B9BA' => 'Apple',
        'E0C97A' => 'Apple',
        'E0D55A' => 'Apple',
        'E0E66E' => 'Apple',
        'E0F5C6' => 'Apple',
        'E0F847' => 'Apple',
        'E477D4' => 'Apple',
        'E48B7F' => 'Apple',
        'E4C63D' => 'Apple',
        'E4CE8F' => 'Apple',
        'E4E749' => 'Apple',
        'E8B2AC' => 'Apple',
        'E8040B' => 'Apple',
        'E80462' => 'Apple',
        'E80688' => 'Apple',
        'E86494' => 'Apple',
        'E8802E' => 'Apple',
        'E8B4C8' => 'Apple',
        'E8D11C' => 'Apple',
        'EC3586' => 'Apple',
        'EC852F' => 'Apple',
        'ECADE0' => 'Apple',
        'ECB50B' => 'Apple',
        'ECC882' => 'Apple',
        'ECE092' => 'Apple',
        'F00D0C' => 'Apple',
        'F0761C' => 'Apple',
        'F0B0E7' => 'Apple',
        'F0C1F1' => 'Apple',
        'F0CBA1' => 'Apple',
        'F0D1A9' => 'Apple',
        'F0D2F1' => 'Apple',
        'F0DBE2' => 'Apple',
        'F0DC6E' => 'Apple',
        'F0F61C' => 'Apple',
        'F40F24' => 'Apple',
        'F49F54' => 'Apple',
        'F4B7E2' => 'Apple',
        'F4D488' => 'Apple',
        'F4F15A' => 'Apple',
        'F4F5A2' => 'Apple',
        'F4F545' => 'Apple',
        'F80377' => 'Apple',
        'F81EDE' => 'Apple',
        'F87BC8' => 'Apple',
        'F88E85' => 'Apple',
        'F8A45F' => 'Apple',
        'F8E03E' => 'Apple',
        'FC253F' => 'Apple',
        'FC66CF' => 'Apple',
        'FCA4B7' => 'Apple',
        'FCAAF8' => 'Apple',
    ];

    $vendor = $ouis[$oui] ?? 'Unknown / Not in database';

    return [
        'mac' => implode(':', str_split($mac, 2)),
        'oui' => $oui,
        'vendor' => $vendor,
    ];
}

function CloudHost247_tool_mac_generator($post)
{
    $count = min((int) ($post['count'] ?? 5), 20);
    $format = CloudHost247_tools_sanitize($post['format'] ?? 'colon', 'string');
    $addresses = [];

    for ($i = 0; $i < $count; $i++) {
        $mac = '';
        for ($j = 0; $j < 6; $j++) {
            $mac .= str_pad(dechex(mt_rand(0, 255)), 2, '0', STR_PAD_LEFT);
        }

        switch ($format) {
            case 'colon':
                $addresses[] = implode(':', str_split($mac, 2));
                break;
            case 'hyphen':
                $addresses[] = implode('-', str_split($mac, 2));
                break;
            case 'dot':
                $addresses[] = implode('.', str_split($mac, 4));
                break;
            default:
                $addresses[] = $mac;
        }
    }

    return ['count' => $count, 'format' => $format, 'addresses' => $addresses];
}

function CloudHost247_tool_asn_lookup($post)
{
    $asn = CloudHost247_tools_sanitize($post['asn'] ?? '', 'string');
    $asn = preg_replace('/[^0-9]/', '', $asn);

    if (empty($asn)) {
        return ['error' => 'Please enter an ASN number'];
    }

    $url = "https://api.bgpview.io/asn/AS{$asn}";
    $result = CloudHost247_tools_curl($url, null, [], 15);

    if ($result['code'] === 200) {
        $data = json_decode($result['body'], true);
        if ($data && $data['status'] === 'ok') {
            $as = $data['data'] ?? [];
            return [
                'asn' => $asn,
                'name' => $as['name'] ?? 'N/A',
                'description' => $as['description_short'] ?? 'N/A',
                'country' => $as['country_code'] ?? 'N/A',
                'website' => $as['website'] ?? 'N/A',
                'raw' => $as,
            ];
        }
    }

    return ['asn' => $asn, 'error' => 'Could not retrieve ASN data'];
}
