<?php
/**
 * CloudHost247 Tools - Designer Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

// Pantone approximation data (small subset for common colors)
function CloudHost247_tools_nearest_pantone($r, $g, $b)
{
    $pantones = [
        ['code' => 'PANTONE Yellow C', 'r' => 254, 'g' => 223, 'b' => 0],
        ['code' => 'PANTONE Red 032 C', 'r' => 239, 'g' => 51, 'b' => 64],
        ['code' => 'PANTONE Rubine Red C', 'r' => 206, 'g' => 17, 'b' => 38],
        ['code' => 'PANTONE Rhodamine Red C', 'r' => 225, 'g' => 0, 'b' => 152],
        ['code' => 'PANTONE Purple C', 'r' => 187, 'g' => 0, 'b' => 153],
        ['code' => 'PANTONE Violet C', 'r' => 101, 'g' => 0, 'b' => 153],
        ['code' => 'PANTONE Blue 072 C', 'r' => 16, 'g' => 6, 'b' => 159],
        ['code' => 'PANTONE Reflex Blue C', 'r' => 0, 'g' => 36, 'b' => 159],
        ['code' => 'PANTONE Process Blue C', 'r' => 0, 'g' => 133, 'b' => 202],
        ['code' => 'PANTONE Green C', 'r' => 0, 'g' => 173, 'b' => 131],
        ['code' => 'PANTONE Black C', 'r' => 16, 'g' => 5, 'b' => 3],
        ['code' => 'PANTONE 100 C', 'r' => 244, 'g' => 237, 'b' => 124],
        ['code' => 'PANTONE 101 C', 'r' => 244, 'g' => 237, 'b' => 71],
        ['code' => 'PANTONE 102 C', 'r' => 247, 'g' => 234, 'b' => 0],
        ['code' => 'PANTONE 200 C', 'r' => 186, 'g' => 12, 'b' => 47],
        ['code' => 'PANTONE 201 C', 'r' => 165, 'g' => 0, 'b' => 33],
        ['code' => 'PANTONE 202 C', 'r' => 134, 'g' => 0, 'b' => 29],
        ['code' => 'PANTONE 300 C', 'r' => 0, 'g' => 94, 'b' => 184],
        ['code' => 'PANTONE 301 C', 'r' => 0, 'g' => 84, 'b' => 159],
        ['code' => 'PANTONE 302 C', 'r' => 0, 'g' => 63, 'b' => 114],
        ['code' => 'PANTONE 400 C', 'r' => 171, 'g' => 160, 'b' => 150],
        ['code' => 'PANTONE 401 C', 'r' => 152, 'g' => 140, 'b' => 130],
        ['code' => 'PANTONE 402 C', 'r' => 135, 'g' => 124, 'b' => 114],
        ['code' => 'PANTONE 500 C', 'r' => 214, 'g' => 153, 'b' => 165],
        ['code' => 'PANTONE 501 C', 'r' => 197, 'g' => 127, 'b' => 143],
        ['code' => 'PANTONE 502 C', 'r' => 173, 'g' => 102, 'b' => 119],
        ['code' => 'PANTONE 600 C', 'r' => 241, 'g' => 229, 'b' => 172],
        ['code' => 'PANTONE 601 C', 'r' => 239, 'g' => 226, 'b' => 147],
        ['code' => 'PANTONE 602 C', 'r' => 239, 'g' => 224, 'b' => 122],
        ['code' => 'PANTONE 700 C', 'r' => 200, 'g' => 93, 'b' => 32],
        ['code' => 'PANTONE 701 C', 'r' => 181, 'g' => 71, 'b' => 28],
        ['code' => 'PANTONE 702 C', 'r' => 163, 'g' => 54, 'b' => 40],
        ['code' => 'PANTONE 8001 C', 'r' => 132, 'g' => 189, 'b' => 201],
        ['code' => 'PANTONE 8002 C', 'r' => 127, 'g' => 181, 'b' => 194],
        ['code' => 'PANTONE 8003 C', 'r' => 111, 'g' => 160, 'b' => 175],
    ];

    $closest = null;
    $minDistance = PHP_FLOAT_MAX;

    foreach ($pantones as $p) {
        $distance = sqrt(pow($r - $p['r'], 2) + pow($g - $p['g'], 2) + pow($b - $p['b'], 2));
        if ($distance < $minDistance) {
            $minDistance = $distance;
            $closest = $p;
        }
    }

    return $closest;
}

function CloudHost247_tool_rgb_to_pantone($post)
{
    $r = (int) ($post['r'] ?? 0);
    $g = (int) ($post['g'] ?? 0);
    $b = (int) ($post['b'] ?? 0);

    $r = max(0, min(255, $r));
    $g = max(0, min(255, $g));
    $b = max(0, min(255, $b));

    $pantone = CloudHost247_tools_nearest_pantone($r, $g, $b);

    return [
        'input' => "RGB({$r}, {$g}, {$b})",
        'hex' => sprintf('#%02X%02X%02X', $r, $g, $b),
        'pantone' => $pantone['code'] ?? 'N/A',
        'pantone_rgb' => "RGB({$pantone['r']}, {$pantone['g']}, {$pantone['b']})",
    ];
}

function CloudHost247_tool_hex_to_pantone($post)
{
    $hex = CloudHost247_tools_sanitize($post['hex'] ?? '', 'string');
    $hex = preg_replace('/[^a-fA-F0-9]/', '', $hex);

    if (strlen($hex) !== 6 && strlen($hex) !== 3) {
        return ['error' => 'Invalid HEX code. Use format: #RRGGBB'];
    }

    if (strlen($hex) === 3) {
        $hex = $hex[0] . $hex[0] . $hex[1] . $hex[1] . $hex[2] . $hex[2];
    }

    $r = hexdec(substr($hex, 0, 2));
    $g = hexdec(substr($hex, 2, 2));
    $b = hexdec(substr($hex, 4, 2));

    $pantone = CloudHost247_tools_nearest_pantone($r, $g, $b);

    return [
        'input' => '#' . strtoupper($hex),
        'rgb' => "RGB({$r}, {$g}, {$b})",
        'pantone' => $pantone['code'] ?? 'N/A',
        'pantone_rgb' => "RGB({$pantone['r']}, {$pantone['g']}, {$pantone['b']})",
    ];
}

function CloudHost247_tool_cmyk_to_pantone($post)
{
    $c = (int) ($post['c'] ?? 0);
    $m = (int) ($post['m'] ?? 0);
    $y = (int) ($post['y'] ?? 0);
    $k = (int) ($post['k'] ?? 0);

    $c = max(0, min(100, $c));
    $m = max(0, min(100, $m));
    $y = max(0, min(100, $y));
    $k = max(0, min(100, $k));

    $r = round(255 * (1 - $c / 100) * (1 - $k / 100));
    $g = round(255 * (1 - $m / 100) * (1 - $k / 100));
    $b = round(255 * (1 - $y / 100) * (1 - $k / 100));

    $pantone = CloudHost247_tools_nearest_pantone($r, $g, $b);

    return [
        'input' => "CMYK({$c}%, {$m}%, {$y}%, {$k}%)",
        'rgb' => "RGB({$r}, {$g}, {$b})",
        'hex' => sprintf('#%02X%02X%02X', $r, $g, $b),
        'pantone' => $pantone['code'] ?? 'N/A',
    ];
}

function CloudHost247_tool_hsv_to_pantone($post)
{
    $h = (float) ($post['h'] ?? 0);
    $s = (float) ($post['s'] ?? 0);
    $v = (float) ($post['v'] ?? 0);

    $h = fmod($h, 360);
    $s = max(0, min(1, $s / 100));
    $v = max(0, min(1, $v / 100));

    $c = $v * $s;
    $x = $c * (1 - abs(fmod($h / 60, 2) - 1));
    $m = $v - $c;

    if ($h < 60) {
        $r = $c;
        $g = $x;
        $b = 0;
    } elseif ($h < 120) {
        $r = $x;
        $g = $c;
        $b = 0;
    } elseif ($h < 180) {
        $r = 0;
        $g = $c;
        $b = $x;
    } elseif ($h < 240) {
        $r = 0;
        $g = $x;
        $b = $c;
    } elseif ($h < 300) {
        $r = $x;
        $g = 0;
        $b = $c;
    } else {
        $r = $c;
        $g = 0;
        $b = $x;
    }

    $r = round(($r + $m) * 255);
    $g = round(($g + $m) * 255);
    $b = round(($b + $m) * 255);

    $pantone = CloudHost247_tools_nearest_pantone($r, $g, $b);

    return [
        'input' => "HSV({$h}, " . round($s * 100) . "%, " . round($v * 100) . "%)",
        'rgb' => "RGB({$r}, {$g}, {$b})",
        'hex' => sprintf('#%02X%02X%02X', $r, $g, $b),
        'pantone' => $pantone['code'] ?? 'N/A',
    ];
}
