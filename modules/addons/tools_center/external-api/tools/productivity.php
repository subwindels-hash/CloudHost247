<?php
/**
 * Productivity Tools Module
 * QR code, OCR, username checker, notepad, generators, and more
 */

class ProductivityTools {
    private $config;
    
    public function __construct($config) {
        $this->config = $config;
    }
    
    /**
     * QR Code Generator
     */
    public function qrGenerator($params) {
        $data = $params['data'] ?? '';
        $size = min((int)($params['size'] ?? 300), 1000);
        $level = $params['level'] ?? 'M'; // L, M, Q, H
        
        if (empty($data)) {
            throw new Exception('Data is required');
        }
        
        if (strlen($data) > 4000) {
            throw new Exception('Data too long (max 4000 characters)');
        }
        
        // Generate QR using Google Chart API (deprecated) or QRServer
        $qrUrl = 'https://api.qrserver.com/v1/create-qr-code/?' . http_build_query([
            'data' => $data,
            'size' => $size . 'x' . $size,
            'ecc' => $level,
            'format' => 'png'
        ]);
        
        return [
            'data' => $data,
            'qr_image_url' => $qrUrl,
            'size' => $size,
            'error_correction' => $level,
            'format' => 'PNG',
            'download_url' => $qrUrl,
        ];
    }
    
    /**
     * QR Scanner (decode from base64 image)
     */
    public function qrScanner($params) {
        $imageBase64 = $params['image'] ?? '';
        $imageUrl = $params['url'] ?? '';
        
        if (empty($imageBase64) && empty($imageUrl)) {
            throw new Exception('QR image (base64) or URL is required');
        }
        
        // This is a placeholder - actual QR decoding requires image processing libraries
        // In production, use a QR decoding API or library like Zxing
        
        return [
            'note' => 'QR decoding requires image processing. Use the QR Server decode API or a local library.',
            'decode_url' => 'https://api.qrserver.com/v1/read-qr-code/?fileurl=' . urlencode($imageUrl),
            'provided_url' => $imageUrl ?: null,
            'has_image_data' => !empty($imageBase64),
        ];
    }
    
    /**
     * Lorem Ipsum Generator
     */
    public function loremIpsum($params) {
        $type = $params['type'] ?? 'paragraphs'; // paragraphs, words, sentences, lists
        $count = min((int)($params['count'] ?? 3), 100);
        $html = (bool)($params['html'] ?? false);
        
        $words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', 'consectetur', 'adipiscing', 'elit',
                  'sed', 'do', 'eiusmod', 'tempor', 'incididunt', 'ut', 'labore', 'et', 'dolore',
                  'magna', 'aliqua', 'enim', 'ad', 'minim', 'veniam', 'quis', 'nostrud',
                  'exercitation', 'ullamco', 'laboris', 'nisi', 'aliquip', 'ex', 'ea', 'commodo',
                  'consequat', 'duis', 'aute', 'irure', 'in', 'reprehenderit', 'voluptate', 'velit',
                  'esse', 'cillum', 'fugiat', 'nulla', 'pariatur', 'excepteur', 'sint', 'occaecat',
                  'cupidatat', 'non', 'proident', 'sunt', 'culpa', 'qui', 'officia', 'deserunt',
                  'mollit', 'anim', 'id', 'est', 'laborum'];
        
        $result = [];
        
        switch ($type) {
            case 'words':
                shuffle($words);
                $result = array_slice($words, 0, $count);
                break;
                
            case 'sentences':
                for ($i = 0; $i < $count; $i++) {
                    $sentenceWords = random_int(8, 20);
                    shuffle($words);
                    $sentence = ucfirst(implode(' ', array_slice($words, 0, $sentenceWords))) . '.';
                    $result[] = $sentence;
                }
                break;
                
            case 'lists':
                for ($i = 0; $i < $count; $i++) {
                    shuffle($words);
                    $itemWords = random_int(5, 12);
                    $result[] = implode(' ', array_slice($words, 0, $itemWords));
                }
                break;
                
            case 'paragraphs':
            default:
                for ($i = 0; $i < $count; $i++) {
                    $sentences = [];
                    $numSentences = random_int(3, 7);
                    for ($j = 0; $j < $numSentences; $j++) {
                        $sentenceWords = random_int(8, 20);
                        shuffle($words);
                        $sentences[] = ucfirst(implode(' ', array_slice($words, 0, $sentenceWords))) . '.';
                    }
                    $result[] = implode(' ', $sentences);
                }
                break;
        }
        
        if ($html) {
            switch ($type) {
                case 'paragraphs':
                    $result = array_map(function($p) { return "<p>{$p}</p>"; }, $result);
                    break;
                case 'lists':
                    $result = '<ul><li>' . implode('</li><li>', $result) . '</li></ul>';
                    break;
            }
        }
        
        return [
            'type' => $type,
            'count' => $count,
            'output' => is_array($result) ? ($html ? implode("\n", $result) : $result) : $result,
            'total_words' => array_sum(array_map(function($t) { return str_word_count($t); }, is_array($result) ? $result : [$result])),
        ];
    }
    
    /**
     * Time Card Calculator
     */
    public function timeCard($params) {
        $entries = $params['entries'] ?? [];
        $hourlyRate = (float)($params['hourly_rate'] ?? 0);
        
        if (empty($entries) || !is_array($entries)) {
            throw new Exception('Time entries are required');
        }
        
        $totalHours = 0;
        $totalMinutes = 0;
        $dayEntries = [];
        
        foreach ($entries as $entry) {
            $date = $entry['date'] ?? 'Unknown';
            $timeIn = $entry['time_in'] ?? '';
            $timeOut = $entry['time_out'] ?? '';
            $breakMinutes = (int)($entry['break'] ?? 0);
            
            if (empty($timeIn) || empty($timeOut)) continue;
            
            $inTimestamp = strtotime($timeIn);
            $outTimestamp = strtotime($timeOut);
            
            if ($inTimestamp === false || $outTimestamp === false) continue;
            
            $diffMinutes = ($outTimestamp - $inTimestamp) / 60 - $breakMinutes;
            $hours = floor($diffMinutes / 60);
            $minutes = $diffMinutes % 60;
            $decimalHours = round($diffMinutes / 60, 2);
            
            $dayEntries[] = [
                'date' => $date,
                'time_in' => $timeIn,
                'time_out' => $timeOut,
                'break_minutes' => $breakMinutes,
                'hours' => $hours,
                'minutes' => $minutes,
                'decimal_hours' => $decimalHours,
            ];
            
            $totalHours += $hours;
            $totalMinutes += $minutes;
        }
        
        // Normalize minutes to hours
        $extraHours = floor($totalMinutes / 60);
        $remainingMinutes = $totalMinutes % 60;
        $totalHours += $extraHours;
        $totalDecimal = $totalHours + round($remainingMinutes / 60, 2);
        
        $grossPay = $hourlyRate > 0 ? round($totalDecimal * $hourlyRate, 2) : 0;
        
        return [
            'entries' => $dayEntries,
            'summary' => [
                'total_hours' => $totalHours,
                'total_minutes' => $remainingMinutes,
                'total_decimal_hours' => $totalDecimal,
                'total_time_formatted' => sprintf('%02d:%02d', $totalHours, $remainingMinutes),
                'hourly_rate' => $hourlyRate,
                'gross_pay' => $grossPay,
            ],
        ];
    }
    
    /**
     * BIN Checker
     */
    public function binChecker($params) {
        $bin = $params['bin'] ?? '';
        
        if (empty($bin)) {
            throw new Exception('BIN (Bank Identification Number) is required');
        }
        
        $bin = preg_replace('/[^0-9]/', '', $bin);
        
        if (strlen($bin) < 6) {
            throw new Exception('BIN must be at least 6 digits');
        }
        
        $bin = substr($bin, 0, 8);
        
        // Card brand detection
        $brand = 'Unknown';
        $type = 'Unknown';
        
        if (preg_match('/^4/', $bin)) {
            $brand = 'Visa';
        } elseif (preg_match('/^5[1-5]/', $bin)) {
            $brand = 'Mastercard';
        } elseif (preg_match('/^3[47]/', $bin)) {
            $brand = 'American Express';
        } elseif (preg_match('/^3(?:0[0-5]|[68])/', $bin)) {
            $brand = 'Diners Club';
        } elseif (preg_match('/^6(?:011|5)/', $bin)) {
            $brand = 'Discover';
        } elseif (preg_match('/^(?:2131|1800|35)/', $bin)) {
            $brand = 'JCB';
        } elseif (preg_match('/^62/', $bin)) {
            $brand = 'UnionPay';
        }
        
        // First digit check
        $firstDigit = (int)substr($bin, 0, 1);
        if ($firstDigit >= 4 && $firstDigit <= 5) {
            $type = 'Credit/Debit';
        } elseif ($firstDigit === 3) {
            $type = 'Credit';
        } elseif ($firstDigit === 6) {
            $type = 'Credit/Debit';
        }
        
        return [
            'bin' => $bin,
            'brand' => $brand,
            'type' => $type,
            'length' => strlen($bin),
            'valid_format' => true,
            'check_digit_note' => 'Full card number required for Luhn validation',
        ];
    }
    
    /**
     * Credit Card Validator
     */
    public function creditCardValidator($params) {
        $number = $params['number'] ?? '';
        
        if (empty($number)) {
            throw new Exception('Credit card number is required');
        }
        
        $number = preg_replace('/[^0-9]/', '', $number);
        
        if (strlen($number) < 13 || strlen($number) > 19) {
            throw new Exception('Invalid credit card length (must be 13-19 digits)');
        }
        
        // Luhn algorithm
        $sum = 0;
        $alternate = false;
        
        for ($i = strlen($number) - 1; $i >= 0; $i--) {
            $n = (int)$number[$i];
            if ($alternate) {
                $n *= 2;
                if ($n > 9) {
                    $n -= 9;
                }
            }
            $sum += $n;
            $alternate = !$alternate;
        }
        
        $valid = ($sum % 10 === 0);
        
        // Detect brand
        $brand = 'Unknown';
        if (preg_match('/^4/', $number)) {
            $brand = 'Visa';
        } elseif (preg_match('/^5[1-5]/', $number)) {
            $brand = 'Mastercard';
        } elseif (preg_match('/^3[47]/', $number)) {
            $brand = 'American Express';
        } elseif (preg_match('/^3(?:0[0-5]|[68])/', $number)) {
            $brand = 'Diners Club';
        } elseif (preg_match('/^6(?:011|5)/', $number)) {
            $brand = 'Discover';
        } elseif (preg_match('/^(?:2131|1800|35)/', $number)) {
            $brand = 'JCB';
        }
        
        // Mask number
        $masked = str_repeat('*', strlen($number) - 4) . substr($number, -4);
        
        return [
            'valid' => $valid,
            'brand' => $brand,
            'number_length' => strlen($number),
            'masked_number' => $masked,
            'luhn_check' => $valid ? 'PASSED' : 'FAILED',
            'warnings' => $valid ? [] : ['Card number failed Luhn algorithm validation'],
            'security_note' => 'Never store or log full credit card numbers',
        ];
    }
    
    /**
     * Reverse Image Search
     */
    public function reverseImageSearch($params) {
        $imageUrl = $params['url'] ?? '';
        
        if (empty($imageUrl)) {
            throw new Exception('Image URL is required');
        }
        
        $encoded = urlencode($imageUrl);
        
        return [
            'original_url' => $imageUrl,
            'search_engines' => [
                'google' => 'https://www.google.com/searchbyimage?image_url=' . $encoded,
                'bing' => 'https://www.bing.com/images/search?q=imgurl:' . $encoded . '&view=detailv2',
                'tineye' => 'https://tineye.com/search/?url=' . $encoded,
                'yandex' => 'https://yandex.com/images/search?url=' . $encoded . '&rpt=imageview',
            ],
            'note' => 'These are search URLs. Redirect your users to these services for reverse image lookup.',
        ];
    }
    
    /**
     * Username Checker
     */
    public function usernameChecker($params) {
        $username = $params['username'] ?? '';
        
        if (empty($username)) {
            throw new Exception('Username is required');
        }
        
        $username = preg_replace('/[^a-zA-Z0-9_.\-]/', '', $username);
        
        if (strlen($username) < 3) {
            throw new Exception('Username must be at least 3 characters');
        }
        
        // Check validity
        $valid = preg_match('/^[a-zA-Z0-9][a-zA-Z0-9_.\-]{2,30}$/', $username);
        
        // Popular platforms check (simulated - actual checks would require API keys)
        $platforms = [
            'twitter' => ['url' => 'https://twitter.com/' . $username, 'check' => 'URL availability'],
            'instagram' => ['url' => 'https://instagram.com/' . $username, 'check' => 'URL availability'],
            'github' => ['url' => 'https://github.com/' . $username, 'check' => 'URL availability'],
            'facebook' => ['url' => 'https://facebook.com/' . $username, 'check' => 'URL availability'],
            'youtube' => ['url' => 'https://youtube.com/@' . $username, 'check' => 'URL availability'],
            'tiktok' => ['url' => 'https://tiktok.com/@' . $username, 'check' => 'URL availability'],
            'reddit' => ['url' => 'https://reddit.com/user/' . $username, 'check' => 'URL availability'],
            'linkedin' => ['url' => 'https://linkedin.com/in/' . $username, 'check' => 'URL availability'],
        ];
        
        return [
            'username' => $username,
            'valid_format' => (bool)$valid,
            'length' => strlen($username),
            'platform_urls' => $platforms,
            'recommendation' => $valid 
                ? 'Visit these URLs to check if the username is available'
                : 'Username contains invalid characters',
            'suggestions' => $valid ? [
                $username . '_official',
                $username . '1',
                'real_' . $username,
                $username . '_hq',
            ] : [],
        ];
    }
    
    /**
     * Notepad Online
     */
    public function notepad($params) {
        $action = $params['action'] ?? 'create';
        $content = $params['content'] ?? '';
        $noteId = $params['note_id'] ?? '';
        
        $storageDir = $this->config['temp_path'] . 'notepad/';
        if (!is_dir($storageDir)) {
            mkdir($storageDir, 0755, true);
        }
        
        switch ($action) {
            case 'create':
                $newId = bin2hex(random_bytes(8));
                file_put_contents($storageDir . $newId . '.txt', $content);
                return [
                    'note_id' => $newId,
                    'content_length' => strlen($content),
                    'created' => true,
                    'expires' => date('Y-m-d H:i:s', time() + 86400), // 24 hours
                ];
                
            case 'read':
                if (empty($noteId)) {
                    throw new Exception('Note ID is required');
                }
                $file = $storageDir . preg_replace('/[^a-f0-9]/', '', $noteId) . '.txt';
                if (!file_exists($file)) {
                    throw new Exception('Note not found');
                }
                return [
                    'note_id' => $noteId,
                    'content' => file_get_contents($file),
                    'exists' => true,
                ];
                
            case 'update':
                if (empty($noteId)) {
                    throw new Exception('Note ID is required');
                }
                $file = $storageDir . preg_replace('/[^a-f0-9]/', '', $noteId) . '.txt';
                file_put_contents($file, $content);
                return [
                    'note_id' => $noteId,
                    'updated' => true,
                    'content_length' => strlen($content),
                ];
                
            default:
                throw new Exception('Invalid action. Use: create, read, update');
        }
    }
    
    /**
     * Small Text Generator
     */
    public function smallText($params) {
        $text = $params['text'] ?? '';
        $style = $params['style'] ?? 'all'; // all, superscript, subscript, smallcaps
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 1000) {
            throw new Exception('Text too long (max 1000 characters)');
        }
        
        $styles = [];
        
        // Superscript
        $superscript = strtr($text, [
            'a' => 'ᵃ', 'b' => 'ᵇ', 'c' => 'ᶜ', 'd' => 'ᵈ', 'e' => 'ᵉ', 'f' => 'ᶠ',
            'g' => 'ᵍ', 'h' => 'ʰ', 'i' => 'ᶦ', 'j' => 'ʲ', 'k' => 'ᵏ', 'l' => 'ˡ',
            'm' => 'ᵐ', 'n' => 'ⁿ', 'o' => 'ᵒ', 'p' => 'ᵖ', 'q' => 'ᑫ', 'r' => 'ʳ',
            's' => 'ˢ', 't' => 'ᵗ', 'u' => 'ᵘ', 'v' => 'ᵛ', 'w' => 'ʷ', 'x' => 'ˣ',
            'y' => 'ʸ', 'z' => 'ᶻ',
            'A' => 'ᴬ', 'B' => 'ᴮ', 'C' => 'ᶜ', 'D' => 'ᴰ', 'E' => 'ᴱ', 'F' => 'ᶠ',
            'G' => 'ᴳ', 'H' => 'ᴴ', 'I' => 'ᴵ', 'J' => 'ᴶ', 'K' => 'ᴷ', 'L' => 'ᴸ',
            'M' => 'ᴹ', 'N' => 'ᴺ', 'O' => 'ᴼ', 'P' => 'ᴾ', 'Q' => 'Q', 'R' => 'ᴿ',
            'S' => 'ˢ', 'T' => 'ᵀ', 'U' => 'ᵁ', 'V' => 'ⱽ', 'W' => 'ᵂ', 'X' => 'ˣ',
            'Y' => 'ʸ', 'Z' => 'ᶻ',
            '0' => '⁰', '1' => '¹', '2' => '²', '3' => '³', '4' => '⁴', '5' => '⁵',
            '6' => '⁶', '7' => '⁷', '8' => '⁸', '9' => '⁹',
        ]);
        
        // Subscript
        $subscript = strtr($text, [
            'a' => 'ₐ', 'e' => 'ₑ', 'h' => 'ₕ', 'i' => 'ᵢ', 'j' => 'ⱼ', 'k' => 'ₖ',
            'l' => 'ₗ', 'm' => 'ₘ', 'n' => 'ₙ', 'o' => 'ₒ', 'p' => 'ₚ', 'r' => 'ᵣ',
            's' => 'ₛ', 't' => 'ₜ', 'u' => 'ᵤ', 'v' => 'ᵥ', 'x' => 'ₓ',
            '0' => '₀', '1' => '₁', '2' => '₂', '3' => '₃', '4' => '₄', '5' => '₅',
            '6' => '₆', '7' => '₇', '8' => '₈', '9' => '₉',
        ]);
        
        // Small caps
        $smallcaps = strtr(strtolower($text), [
            'a' => 'ᴀ', 'b' => 'ʙ', 'c' => 'ᴄ', 'd' => 'ᴅ', 'e' => 'ᴇ', 'f' => 'ғ',
            'g' => 'ɢ', 'h' => 'ʜ', 'i' => 'ɪ', 'j' => 'ᴊ', 'k' => 'ᴋ', 'l' => 'ʟ',
            'm' => 'ᴍ', 'n' => 'ɴ', 'o' => 'ᴏ', 'p' => 'ᴘ', 'q' => 'q', 'r' => 'ʀ',
            's' => 's', 't' => 'ᴛ', 'u' => 'ᴜ', 'v' => 'ᴠ', 'w' => 'ᴡ', 'x' => 'x',
            'y' => 'ʏ', 'z' => 'ᴢ',
        ]);
        
        if ($style === 'all' || $style === 'superscript') {
            $styles['superscript'] = $superscript;
        }
        if ($style === 'all' || $style === 'subscript') {
            $styles['subscript'] = $subscript;
        }
        if ($style === 'all' || $style === 'smallcaps') {
            $styles['small_caps'] = $smallcaps;
        }
        
        return [
            'original' => $text,
            'styles' => $styles,
        ];
    }
    
    /**
     * Word Counter
     */
    public function wordCounter($params) {
        $text = $params['text'] ?? '';
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 100000) {
            throw new Exception('Text too long (max 100,000 characters)');
        }
        
        $words = preg_split('/\s+/', trim($text), -1, PREG_SPLIT_NO_EMPTY);
        $wordCount = count($words);
        $charCount = strlen($text);
        $charCountNoSpaces = strlen(str_replace([' ', "\t", "\n", "\r"], '', $text));
        $sentenceCount = preg_match_all('/[.!?]+/', $text);
        $paragraphCount = count(array_filter(explode("\n\n", $text)));
        $lineCount = count(explode("\n", $text));
        
        // Average
        $avgWordLength = $wordCount > 0 ? round($charCountNoSpaces / $wordCount, 1) : 0;
        $avgSentenceLength = $sentenceCount > 0 ? round($wordCount / $sentenceCount, 1) : 0;
        
        // Reading time (avg 200 words per minute)
        $readingTimeMinutes = ceil($wordCount / 200);
        
        // Top words
        $wordFreq = array_count_values(array_map('strtolower', $words));
        arsort($wordFreq);
        $topWords = array_slice($wordFreq, 0, 10);
        
        return [
            'words' => $wordCount,
            'characters' => $charCount,
            'characters_no_spaces' => $charCountNoSpaces,
            'sentences' => $sentenceCount,
            'paragraphs' => $paragraphCount,
            'lines' => $lineCount,
            'average_word_length' => $avgWordLength,
            'average_sentence_length' => $avgSentenceLength,
            'reading_time_minutes' => $readingTimeMinutes,
            'top_words' => $topWords,
        ];
    }
    
    /**
     * Domain Search (simplified - redirects to search module)
     */
    public function domainSearch($params) {
        $domain = $params['domain'] ?? '';
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $tlds = ['.com', '.net', '.org', '.io', '.co'];
        $results = [];
        
        foreach ($tlds as $tld) {
            $checkDomain = $domain . $tld;
            $records = @dns_get_record($checkDomain, DNS_A);
            $available = empty($records);
            
            $results[] = [
                'domain' => $checkDomain,
                'available' => $available,
                'status' => $available ? 'AVAILABLE' : 'TAKEN',
            ];
        }
        
        return [
            'query' => $domain,
            'results' => $results,
        ];
    }
    
    /**
     * ROT13 Encoder/Decoder
     */
    public function rot13($params) {
        $text = $params['text'] ?? '';
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 10000) {
            throw new Exception('Text too long (max 10,000 characters)');
        }
        
        $encoded = str_rot13($text);
        
        return [
            'original' => $text,
            'encoded' => $encoded,
            'algorithm' => 'ROT13',
            'note' => 'ROT13 is its own inverse - applying twice returns original text',
        ];
    }
    
    /**
     * Morse Code Translator
     */
    public function morseCode($params) {
        $text = $params['text'] ?? '';
        $direction = $params['direction'] ?? 'auto'; // auto, to_morse, to_text
        
        if (empty($text)) {
            throw new Exception('Text is required');
        }
        
        if (strlen($text) > 5000) {
            throw new Exception('Text too long (max 5000 characters)');
        }
        
        $morseCode = [
            'A' => '.-', 'B' => '-...', 'C' => '-.-.', 'D' => '-..', 'E' => '.',
            'F' => '..-.', 'G' => '--.', 'H' => '....', 'I' => '..', 'J' => '.---',
            'K' => '-.-', 'L' => '.-..', 'M' => '--', 'N' => '-.', 'O' => '---',
            'P' => '.--.', 'Q' => '--.-', 'R' => '.-.', 'S' => '...', 'T' => '-',
            'U' => '..-', 'V' => '...-', 'W' => '.--', 'X' => '-..-', 'Y' => '-.--',
            'Z' => '--..',
            '0' => '-----', '1' => '.----', '2' => '..---', '3' => '...--',
            '4' => '....-', '5' => '.....', '6' => '-....', '7' => '--...',
            '8' => '---..', '9' => '----.',
            '.' => '.-.-.-', ',' => '--..--', '?' => '..--..', "'" => '.----.',
            '/' => '-..-.', '!' => '-.-.--', '(' => '-.--.', ')' => '-.--.-',
            '&' => '.-...', ':' => '---...', ';' => '-.-.-.', '=' => '-...-',
            '+' => '.-.-.', '-' => '-....-', '_' => '..--.-', '"' => '.-..-.',
            '$' => '...-..-', '@' => '.--.-.', ' ' => '/',
        ];
        
        $textToMorse = array_change_key_case($morseCode, CASE_UPPER);
        $morseToText = array_flip($textToMorse);
        
        // Auto-detect direction
        if ($direction === 'auto') {
            $direction = preg_match('/^[.\- \/]+$/', trim($text)) ? 'to_text' : 'to_morse';
        }
        
        if ($direction === 'to_morse') {
            $upperText = strtoupper($text);
            $result = '';
            for ($i = 0; $i < strlen($upperText); $i++) {
                $char = $upperText[$i];
                if (isset($textToMorse[$char])) {
                    $result .= $textToMorse[$char] . ' ';
                } else {
                    $result .= $char;
                }
            }
            
            return [
                'original' => $text,
                'direction' => 'text_to_morse',
                'output' => trim($result),
            ];
        } else {
            $words = explode(' / ', trim($text));
            $result = '';
            foreach ($words as $word) {
                $chars = explode(' ', trim($word));
                foreach ($chars as $char) {
                    if (isset($morseToText[$char])) {
                        $result .= $morseToText[$char];
                    }
                }
                $result .= ' ';
            }
            
            return [
                'original' => $text,
                'direction' => 'morse_to_text',
                'output' => trim($result),
            ];
        }
    }
    
    /**
     * BIMI Checker & Generator
     */
    public function bimiChecker($params) {
        $domain = $params['domain'] ?? '';
        $action = $params['action'] ?? 'check'; // check, generate
        
        if (empty($domain)) {
            throw new Exception('Domain is required');
        }
        
        $domain = $this->sanitizeDomain($domain);
        
        if ($action === 'check') {
            // Check for BIMI record
            $bimiDomain = 'default._bimi.' . $domain;
            $records = @dns_get_record($bimiDomain, DNS_TXT);
            
            $bimiRecords = [];
            foreach ($records as $record) {
                if (stripos($record['txt'], 'v=BIMI1') !== false) {
                    $bimiRecords[] = $record['txt'];
                }
            }
            
            return [
                'domain' => $domain,
                'bimi_found' => !empty($bimiRecords),
                'records' => $bimiRecords,
                'recommendations' => empty($bimiRecords) 
                    ? ['Add BIMI record to display brand logo in supported email clients'] 
                    : [],
            ];
        } else {
            // Generate BIMI record
            $svgUrl = $params['svg_url'] ?? '';
            $vmcUrl = $params['vmc_url'] ?? '';
            
            if (empty($svgUrl)) {
                throw new Exception('SVG logo URL is required for BIMI record generation');
            }
            
            $record = 'v=BIMI1; l=' . $svgUrl;
            if (!empty($vmcUrl)) {
                $record .= '; a=' . $vmcUrl;
            }
            
            return [
                'domain' => $domain,
                'record_name' => 'default._bimi.' . $domain,
                'record_type' => 'TXT',
                'record_value' => $record,
                'requirements' => [
                    'svg_must_be_square' => true,
                    'svg_must_be_tiny' => 'SVG file should be as small as possible',
                    'vmc_required' => 'VMC (Verified Mark Certificate) is required by some providers',
                    'dmarc_required' => 'DMARC policy must be set to quarantine or reject',
                ],
            ];
        }
    }
    
    /**
     * Image to Text (OCR)
     */
    public function imageToText($params) {
        $imageBase64 = $params['image'] ?? '';
        $imageUrl = $params['url'] ?? '';
        
        if (empty($imageBase64) && empty($imageUrl)) {
            throw new Exception('Image (base64) or URL is required');
        }
        
        return [
            'note' => 'OCR requires an external OCR engine like Tesseract, Google Vision API, or Azure Computer Vision.',
            'recommendations' => [
                'Google Vision API' => 'https://cloud.google.com/vision',
                'Tesseract OCR' => 'https://github.com/tesseract-ocr/tesseract',
                'Azure Computer Vision' => 'https://azure.microsoft.com/services/cognitive-services/computer-vision/',
                'AWS Textract' => 'https://aws.amazon.com/textract/',
            ],
            'provided_url' => $imageUrl ?: null,
            'has_image_data' => !empty($imageBase64),
        ];
    }
    
    private function sanitizeDomain($domain) {
        $domain = strtolower(trim($domain));
        $domain = preg_replace('/^(https?:\/\/)?(www\.)?/i', '', $domain);
        $domain = preg_replace('/[^a-z0-9.\-]/', '', $domain);
        return substr($domain, 0, 253);
    }
}