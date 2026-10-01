<?php
namespace CloudHost247\Marketing\Security;

/**
 * The only place marketing copy becomes markup (requirement #12, #30).
 *
 * Two very different inputs meet here:
 *
 *   - Operator copy, which may carry a deliberately tiny rich-text subset
 *     (`b`, `strong`, `i`, `em`, `u`, `a href`, `br`). Everything else is
 *     stripped, so a paste from a word processor or a hostile import cannot
 *     smuggle script, event handlers, styles or iframes into an e-mail.
 *   - URLs, which must be absolute http(s) or mailto. `javascript:`, `data:`,
 *     protocol-relative and malformed values return an empty string, and the
 *     caller decides whether that is a warning or a hard error — never a link.
 */
final class HtmlSanitizer
{
    /** Tags the rich-text subset keeps. Everything else is unwrapped. */
    private static $allowed = array('b', 'strong', 'i', 'em', 'u', 'br', 'a');

    /**
     * Returns an absolute, safe URL or ''.
     *
     * Absolute-only is deliberate: a relative link in an e-mail resolves against
     * whatever the recipient's client happens to think the base is.
     */
    public static function safeUrl($url)
    {
        $url = trim((string) $url);
        if ($url === '' || preg_match('/[\x00-\x1F\x7F\s]/', $url)) { return ''; }
        if (strlen($url) > 500) { return ''; }

        $parts = parse_url($url);
        if (!is_array($parts) || empty($parts['scheme']) || empty($parts['host'])) {
            // scheme-less (including protocol-relative //evil) forms are refused
            return '';
        }
        $scheme = strtolower((string) $parts['scheme']);
        if (!in_array($scheme, array('http', 'https'), true)) { return ''; }
        // parse_url() would happily accept "http://javascript:alert(1)" as host
        // "javascript" — require a dotted host or localhost, with no userinfo.
        if (isset($parts['user']) || isset($parts['pass'])) { return ''; }
        $host = strtolower((string) $parts['host']);
        if ($host !== 'localhost' && strpos($host, '.') === false) { return ''; }

        return $url;
    }

    /** Mailto links are kept separately: a plain address is not http(s). */
    public static function safeMailto($address)
    {
        $address = trim((string) $address);
        if ($address === '') { return ''; }
        if (strlen($address) > 254 || preg_match('/[\x00-\x1F\x7F\s]/', $address)) { return ''; }
        return filter_var($address, FILTER_VALIDATE_EMAIL) ? 'mailto:' . $address : '';
    }

    /**
     * Restricted rich text. Unknown tags lose their markup but keep their text,
     * so a paste degrades cleanly instead of disappearing or executing.
     */
    public static function richText($text)
    {
        $text = (string) $text;
        // Whole elements that must never contribute even their text.
        $text = preg_replace('#<(script|style|iframe|object|embed|template)\b[^>]*>.*?</\1\s*>#is', '', $text);
        $text = preg_replace('#<!--.*?-->#s', '', $text);

        $parts = preg_split('/(<[^>]*>)/', $text, -1, PREG_SPLIT_DELIM_CAPTURE);
        $out = '';
        $openAnchors = 0;
        $openTags = array('b' => 0, 'i' => 0, 'u' => 0);
        foreach ($parts as $part) {
            if ($part === '') { continue; }
            if ($part[0] !== '<' || substr($part, -1) !== '>') { $out .= htmlspecialchars($part, ENT_QUOTES, 'UTF-8'); continue; }

            $inner = trim($part, "<> \t\n\r\0\x0B");
            $closing = (substr($inner, 0, 1) === '/');
            if ($closing) { $inner = ltrim(substr($inner, 1)); }
            $name = preg_split('/[\s\/]/', strtolower($inner), 2);
            $name = $name[0];

            if ($name === 'a') {
                if ($closing) {
                    if ($openAnchors > 0) { $out .= '</a>'; $openAnchors--; }
                    continue;
                }
                $href = '';
                if (preg_match('/href\s*=\s*(?:"([^"]*)"|\'([^\']*)\'|([^\s>]+))/i', $part, $m)) {
                    $raw = isset($m[1]) && $m[1] !== '' ? $m[1] : (isset($m[2]) && $m[2] !== '' ? $m[2] : (isset($m[3]) ? $m[3] : ''));
                    $href = self::safeUrl($raw);
                    if ($href === '' && strpos(strtolower($raw), 'mailto:') === 0) {
                        $href = self::safeMailto(substr($raw, 7));
                    }
                }
                if ($href === '') { continue; } // tag dropped, link text kept
                $out .= '<a href="' . htmlspecialchars($href, ENT_QUOTES, 'UTF-8') . '" style="color:#1f6fb2;">';
                $openAnchors++;
                continue;
            }

            if (!in_array($name, self::$allowed, true)) { continue; }
            if ($name === 'br') { $out .= '<br />'; continue; }
            if ($name === 'strong') { $name = 'b'; }
            if ($name === 'em') { $name = 'i'; }

            if ($closing) {
                if ($openTags[$name] > 0) { $out .= '</' . $name . '>'; $openTags[$name]--; }
                continue;
            }
            $out .= '<' . $name . '>';
            $openTags[$name]++;
        }

        while ($openAnchors-- > 0) { $out .= '</a>'; }
        foreach ($openTags as $tag => $count) {
            while ($count-- > 0) { $out .= '</' . $tag . '>'; }
        }
        return $out;
    }

    /** Plain-text rendering: tags out, entities decoded, tidy spacing. */
    public static function plainText($text)
    {
        $text = preg_replace('#<(script|style)\b[^>]*>.*?</\1\s*>#is', '', (string) $text);
        $text = preg_replace('#<br\s*/?>#i', "\n", $text);
        $text = preg_replace('#</(p|div|tr|li|h[1-6])\s*>#i', "\n", $text);
        $text = html_entity_decode(strip_tags($text), ENT_QUOTES, 'UTF-8');
        $text = preg_replace('/[ \t]+/', ' ', $text);
        $text = preg_replace('/\n{3,}/', "\n\n", $text);
        return trim($text);
    }
}
