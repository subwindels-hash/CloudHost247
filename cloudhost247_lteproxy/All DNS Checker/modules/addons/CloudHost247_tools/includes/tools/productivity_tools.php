<?php
/**
 * CloudHost247 Tools - Productivity Tools Implementation
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

require_once __DIR__ . '/../functions.php';

function CloudHost247_tool_qr_generator($post)
{
    $text = CloudHost247_tools_sanitize($post['text'] ?? '', 'string');
    $size = min(max((int) ($post['size'] ?? 300), 100), 1000);

    if (empty($text)) {
        return ['error' => 'Please enter text or URL for QR code'];
    }

    // Use Google Chart API for QR generation
    $apiUrl = 'https://chart.googleapis.com/chart?cht=qr&chs=' . $size . 'x' . $size . '&chl=' . urlencode($text) . '&chld=H|0';

    return [
        'text' => $text,
        'qr_url' => $apiUrl,
        'size' => $size,
    ];
}

function CloudHost247_tool_qr_scanner($post)
{
    // QR Scanner is JS-based on frontend, backend just returns success
    return ['message' => 'QR Scanner requires camera access. Use the frontend scanner.'];
}

function CloudHost247_tool_lorem_ipsum($post)
{
    $count = min(max((int) ($post['count'] ?? 5), 1), 50);
    $type = CloudHost247_tools_sanitize($post['type'] ?? 'paragraphs', 'string');

    $words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit', 'sed', 'do',
        'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore', 'magna', 'aliqua', 'ut', 'enim',
        'ad', 'minim', 'veniam', 'quis', 'nostrud', 'exercitation', 'ullamco', 'laboris', 'nisi', 'ut',
        'aliquip', 'ex', 'ea', 'commodo', 'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit',
        'voluptate', 'velit', 'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint',
        'occaecat', 'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
        'mollit', 'anim', 'id', 'est', 'laborum'];

    $output = [];

    if ($type === 'paragraphs') {
        for ($p = 0; $p < $count; $p++) {
            $sentences = mt_rand(3, 8);
            $paragraph = '';
            for ($s = 0; $s < $sentences; $s++) {
                $sentenceWords = mt_rand(8, 20);
                $sentence = '';
                for ($w = 0; $w < $sentenceWords; $w++) {
                    $sentence .= $words[array_rand($words)] . ' ';
                }
                $sentence = ucfirst(trim($sentence)) . '.';
                $paragraph .= $sentence . ' ';
            }
            $output[] = trim($paragraph);
        }
    } elseif ($type === 'sentences') {
        for ($s = 0; $s < $count; $s++) {
            $sentenceWords = mt_rand(8, 20);
            $sentence = '';
            for ($w = 0; $w < $sentenceWords; $w++) {
                $sentence .= $words[array_rand($words)] . ' ';
            }
            $output[] = ucfirst(trim($sentence)) . '.';
        }
    } elseif ($type === 'words') {
        $wordList = [];
        for ($w = 0; $w < $count; $w++) {
            $wordList[] = $words[array_rand($words)];
        }
        $output[] = implode(' ', $wordList);
    }

    return ['type' => $type, 'count' => $count, 'content' => $output];
}

function CloudHost247_tool_time_calculator($post)
{
    $start = CloudHost247_tools_sanitize($post['start'] ?? '', 'string');
    $end = CloudHost247_tools_sanitize($post['end'] ?? '', 'string');
    $format = CloudHost247_tools_sanitize($post['format'] ?? 'hours', 'string');

    $startTime = strtotime($start);
    $endTime = strtotime($end);

    if ($startTime === false || $endTime === false) {
        return ['error' => 'Invalid date format. Use YYYY-MM-DD HH:MM'];
    }

    $diff = abs($endTime - $startTime);

    $results = [
        'seconds' => $diff,
        'minutes' => round($diff / 60, 2),
        'hours' => round($diff / 3600, 2),
        'days' => round($diff / 86400, 2),
        'weeks' => round($diff / 604800, 2),
        'months' => round($diff / 2592000, 2),
        'years' => round($diff / 31536000, 2),
    ];

    return [
        'start' => date('Y-m-d H:i:s', $startTime),
        'end' => date('Y-m-d H:i:s', $endTime),
        'difference' => $results[$format] ?? $results['hours'],
        'all_units' => $results,
    ];
}

function CloudHost247_tool_bin_checker($post)
{
    $bin = CloudHost247_tools_sanitize($post['bin'] ?? '', 'string');
    $bin = preg_replace('/[^0-9]/', '', $bin);

    if (strlen($bin) < 6) {
        return ['error' => 'BIN must be at least 6 digits'];
    }

    $bin6 = substr($bin, 0, 6);

    // Small built-in BIN database
    $bins = [
        '4' => ['network' => 'Visa', 'type' => 'Credit/Debit'],
        '5' => ['network' => 'Mastercard', 'type' => 'Credit/Debit'],
        '37' => ['network' => 'American Express', 'type' => 'Credit'],
        '34' => ['network' => 'American Express', 'type' => 'Credit'],
        '6011' => ['network' => 'Discover', 'type' => 'Credit'],
        '622' => ['network' => 'China UnionPay', 'type' => 'Credit/Debit'],
        '35' => ['network' => 'JCB', 'type' => 'Credit'],
        '30' => ['network' => 'Diners Club', 'type' => 'Credit'],
        '36' => ['network' => 'Diners Club', 'type' => 'Credit'],
        '38' => ['network' => 'Diners Club', 'type' => 'Credit'],
    ];

    $network = 'Unknown';
    $type = 'Unknown';

    foreach ($bins as $prefix => $data) {
        if (strpos($bin6, $prefix) === 0) {
            $network = $data['network'];
            $type = $data['type'];
            break;
        }
    }

    // Try external API
    $apiResult = CloudHost247_tools_curl("https://lookup.binlist.net/{$bin6}", null, [], 10);
    if ($apiResult['code'] === 200) {
        $data = json_decode($apiResult['body'], true);
        if ($data) {
            $network = $data['scheme'] ?? $network;
            $type = $data['type'] ?? $type;
            $bank = $data['bank']['name'] ?? 'Unknown';
            $country = $data['country']['name'] ?? 'Unknown';
        }
    }

    return [
        'bin' => $bin6,
        'network' => ucfirst($network),
        'type' => ucfirst($type),
        'bank' => $bank ?? 'Unknown',
        'country' => $country ?? 'Unknown',
    ];
}

function CloudHost247_tool_credit_card_validator($post)
{
    $number = CloudHost247_tools_sanitize($post['number'] ?? '', 'string');
    $number = preg_replace('/[^0-9]/', '', $number);

    if (empty($number)) {
        return ['error' => 'Please enter a card number'];
    }

    // Luhn algorithm
    $sum = 0;
    $alt = false;
    for ($i = strlen($number) - 1; $i >= 0; $i--) {
        $n = (int) $number[$i];
        if ($alt) {
            $n *= 2;
            if ($n > 9) $n -= 9;
        }
        $sum += $n;
        $alt = !$alt;
    }

    $valid = $sum % 10 === 0;
    $cardType = 'Unknown';

    if (preg_match('/^4/', $number)) $cardType = 'Visa';
    elseif (preg_match('/^5[1-5]/', $number)) $cardType = 'Mastercard';
    elseif (preg_match('/^3[47]/', $number)) $cardType = 'American Express';
    elseif (preg_match('/^6011/', $number)) $cardType = 'Discover';
    elseif (preg_match('/^35/', $number)) $cardType = 'JCB';
    elseif (preg_match('/^3[068]/', $number)) $cardType = 'Diners Club';

    return [
        'valid' => $valid,
        'luhn_passed' => $valid,
        'card_type' => $cardType,
        'length' => strlen($number),
        'number_masked' => substr($number, 0, 4) . ' **** **** ' . substr($number, -4),
    ];
}

function CloudHost247_tool_reverse_image_search($post)
{
    $url = CloudHost247_tools_sanitize($post['url'] ?? '', 'url');
    if (!CloudHost247_tools_validate_url($url)) {
        return ['error' => 'Invalid image URL'];
    }

    $engines = [
        ['name' => 'Google Images', 'url' => 'https://www.google.com/searchbyimage?image_url=' . urlencode($url)],
        ['name' => 'TinEye', 'url' => 'https://tineye.com/search?url=' . urlencode($url)],
        ['name' => 'Bing Visual Search', 'url' => 'https://www.bing.com/images/search?view=detailv2&iss=sbi&FORM=SBIVSP&selectedindex=0&mediaurl=' . urlencode($url)],
        ['name' => 'Yandex Images', 'url' => 'https://yandex.com/images/search?rpt=imageview&url=' . urlencode($url)],
    ];

    return [
        'image_url' => $url,
        'engines' => $engines,
    ];
}

function CloudHost247_tool_username_checker($post)
{
    $username = CloudHost247_tools_sanitize($post['username'] ?? '', 'string');
    if (empty($username) || strlen($username) < 3) {
        return ['error' => 'Username must be at least 3 characters'];
    }

    // Simulate checking common platforms
    $platforms = [
        ['name' => 'Twitter/X', 'url' => 'https://twitter.com/' . $username, 'available' => mt_rand(0, 1) === 1],
        ['name' => 'Instagram', 'url' => 'https://instagram.com/' . $username, 'available' => mt_rand(0, 1) === 1],
        ['name' => 'GitHub', 'url' => 'https://github.com/' . $username, 'available' => mt_rand(0, 1) === 1],
        ['name' => 'Reddit', 'url' => 'https://reddit.com/user/' . $username, 'available' => mt_rand(0, 1) === 1],
        ['name' => 'TikTok', 'url' => 'https://tiktok.com/@' . $username, 'available' => mt_rand(0, 1) === 1],
    ];

    // Note: Real availability checking would require APIs or scraping
    return [
        'username' => $username,
        'note' => 'These are simulated results for demonstration. Real username checking requires platform APIs.',
        'platforms' => $platforms,
    ];
}

function CloudHost247_tool_online_notepad($post)
{
    $content = $_POST['content'] ?? '';
    $action = CloudHost247_tools_sanitize($post['notepad_action'] ?? 'save', 'string');

    if ($action === 'save') {
        // Store in session for temporary persistence
        $_SESSION['CloudHost247_notepad'] = $content;
        return ['saved' => true, 'length' => strlen($content), 'words' => str_word_count($content)];
    } else {
        $content = $_SESSION['CloudHost247_notepad'] ?? '';
        return ['content' => $content, 'length' => strlen($content), 'words' => str_word_count($content)];
    }
}

function CloudHost247_tool_small_text($post)
{
    $text = CloudHost247_tools_sanitize($post['text'] ?? '', 'string');
    if (empty($text)) {
        return ['error' => 'Please enter text'];
    }

    $smallCaps = '';
    $superscript = '';
    $subscript = '';
    $tiny = '';

    $smallMap = [
        'a' => 'ᴀ', 'b' => 'ʙ', 'c' => 'ᴄ', 'd' => 'ᴅ', 'e' => 'ᴇ', 'f' => 'ғ', 'g' => 'ɢ',
        'h' => 'ʜ', 'i' => 'ɪ', 'j' => 'ᴊ', 'k' => 'ᴋ', 'l' => 'ʟ', 'm' => 'ᴍ', 'n' => 'ɴ',
        'o' => 'ᴏ', 'p' => 'ᴘ', 'q' => 'q', 'r' => 'ʀ', 's' => 's', 't' => 'ᴛ', 'u' => 'ᴜ',
        'v' => 'ᴠ', 'w' => 'ᴡ', 'x' => 'x', 'y' => 'ʏ', 'z' => 'ᴢ',
        'A' => 'ᴀ', 'B' => 'ʙ', 'C' => 'ᴄ', 'D' => 'ᴅ', 'E' => 'ᴇ', 'F' => 'ғ', 'G' => 'ɢ',
        'H' => 'ʜ', 'I' => 'ɪ', 'J' => 'ᴊ', 'K' => 'ᴋ', 'L' => 'ʟ', 'M' => 'ᴍ', 'N' => 'ɴ',
        'O' => 'ᴏ', 'P' => 'ᴘ', 'Q' => 'Q', 'R' => 'ʀ', 'S' => 'S', 'T' => 'ᴛ', 'U' => 'ᴜ',
        'V' => 'ᴠ', 'W' => 'ᴡ', 'X' => 'X', 'Y' => 'ʏ', 'Z' => 'ᴢ',
    ];

    $tinyMap = [
        'a' => 'ₐ', 'b' => 'b', 'c' => 'c', 'd' => 'd', 'e' => 'ₑ', 'f' => 'f', 'g' => 'g',
        'h' => 'ₕ', 'i' => 'ᵢ', 'j' => 'ⱼ', 'k' => 'ₖ', 'l' => 'ₗ', 'm' => 'ₘ', 'n' => 'ₙ',
        'o' => 'ₒ', 'p' => 'ₚ', 'q' => 'q', 'r' => 'ᵣ', 's' => 'ₛ', 't' => 'ₜ', 'u' => 'ᵤ',
        'v' => 'ᵥ', 'w' => 'w', 'x' => 'ₓ', 'y' => 'y', 'z' => 'z',
    ];

    for ($i = 0; $i < strlen($text); $i++) {
        $char = $text[$i];
        $smallCaps .= $smallMap[$char] ?? $char;
        $tiny .= $tinyMap[$char] ?? $char;
        $superscript .= '^' . $char;
        $subscript .= '_' . $char;
    }

    return [
        'original' => $text,
        'small_caps' => $smallCaps,
        'tiny' => $tiny,
        'superscript' => $superscript,
        'subscript' => $subscript,
    ];
}

function CloudHost247_tool_word_counter($post)
{
    $text = $_POST['text'] ?? '';
    $characters = strlen($text);
    $charactersNoSpaces = strlen(preg_replace('/\s/', '', $text));
    $words = str_word_count($text);
    $lines = substr_count($text, "\n") + 1;
    $sentences = preg_match_all('/[.!?]+/', $text, $matches) ? count($matches[0]) : 0;
    $paragraphs = count(array_filter(explode("\n\n", $text)));

    return [
        'characters' => $characters,
        'characters_no_spaces' => $charactersNoSpaces,
        'words' => $words,
        'sentences' => $sentences,
        'paragraphs' => $paragraphs,
        'lines' => $lines,
        'average_word_length' => $words > 0 ? round($charactersNoSpaces / $words, 1) : 0,
    ];
}

function CloudHost247_tool_domain_availability($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain format'];
    }

    $tld = substr(strrchr($domain, '.'), 1);
    $whois = CloudHost247_tools_whois($domain);
    $result = $whois['result'] ?? '';

    $available = stripos($result, 'No match') !== false ||
        stripos($result, 'NOT FOUND') !== false ||
        stripos($result, 'not found') !== false ||
        stripos($result, 'No entries found') !== false ||
        stripos($result, 'Domain Status: free') !== false;

    return [
        'domain' => $domain,
        'available' => $available,
        'tld' => $tld,
        'whois_server' => $whois['server'] ?? 'Unknown',
    ];
}

function CloudHost247_tool_rot13($post)
{
    $text = $_POST['text'] ?? '';
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'encode', 'string');

    if (empty($text)) {
        return ['error' => 'Please enter text'];
    }

    $result = str_rot13($text);
    return ['original' => $text, 'result' => $result, 'mode' => $mode];
}

function CloudHost247_tool_morse_code($post)
{
    $text = CloudHost247_tools_sanitize($post['text'] ?? '', 'string');
    $mode = CloudHost247_tools_sanitize($post['mode'] ?? 'encode', 'string');

    if (empty($text)) {
        return ['error' => 'Please enter text'];
    }

    $morse = [
        'A' => '.-', 'B' => '-...', 'C' => '-.-.', 'D' => '-..', 'E' => '.', 'F' => '..-.',
        'G' => '--.', 'H' => '....', 'I' => '..', 'J' => '.---', 'K' => '-.-', 'L' => '.-..',
        'M' => '--', 'N' => '-.', 'O' => '---', 'P' => '.--.', 'Q' => '--.-', 'R' => '.-.',
        'S' => '...', 'T' => '-', 'U' => '..-', 'V' => '...-', 'W' => '.--', 'X' => '-..-',
        'Y' => '-.--', 'Z' => '--..', '1' => '.----', '2' => '..---', '3' => '...--',
        '4' => '....-', '5' => '.....', '6' => '-....', '7' => '--...', '8' => '---..',
        '9' => '----.', '0' => '-----', ' ' => ' / ', '.' => '.-.-.-', ',' => '--..--',
        '?' => '..--..', '!' => '-.-.--', '/' => '-..-.', '@' => '.--.-.',
    ];

    $reverse = array_flip($morse);

    if ($mode === 'encode') {
        $result = '';
        $upper = strtoupper($text);
        for ($i = 0; $i < strlen($upper); $i++) {
            $char = $upper[$i];
            $result .= ($morse[$char] ?? $char) . ' ';
        }
        return ['original' => $text, 'morse' => trim($result), 'mode' => 'encode'];
    } else {
        $result = '';
        $words = explode(' / ', $text);
        foreach ($words as $word) {
            $chars = explode(' ', trim($word));
            foreach ($chars as $char) {
                $result .= $reverse[trim($char)] ?? '?';
            }
            $result .= ' ';
        }
        return ['original' => $text, 'decoded' => trim($result), 'mode' => 'decode'];
    }
}

function CloudHost247_tool_bimi_checker($post)
{
    $domain = CloudHost247_tools_sanitize($post['domain'] ?? '', 'domain');
    if (!CloudHost247_tools_validate_domain($domain)) {
        return ['error' => 'Invalid domain'];
    }

    $records = CloudHost247_tools_dns_query('default._bimi.' . $domain, 'TXT');
    $found = false;
    $record = '';

    foreach ($records as $r) {
        $txt = $r['txt'] ?? '';
        if (stripos($txt, 'v=BIMI1') !== false) {
            $found = true;
            $record = $txt;
            break;
        }
    }

    return [
        'domain' => $domain,
        'found' => $found,
        'record' => $record,
    ];
}

function CloudHost247_tool_image_to_text($post)
{
    return [
        'note' => 'OCR functionality requires a third-party OCR API key configured in module settings.',
        'status' => 'placeholder',
        'instructions' => 'Upload an image to extract text using OCR technology.',
    ];
}
