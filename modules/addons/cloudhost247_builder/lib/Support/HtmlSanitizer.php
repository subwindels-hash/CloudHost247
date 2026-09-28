<?php
namespace CloudHost247\Builder\Support;

use DOMDocument;
use DOMElement;
use DOMNode;

/**
 * The single gate for rich text entering a page.
 *
 * Administrators can write formatted copy, but the stored markup is reduced to
 * a fixed allowlist of tags and attributes before it is saved and again before
 * it is rendered. Script, style, iframe, object, form and event-handler
 * attributes are removed outright, and every href or src is passed through
 * UrlPolicy. There is no configuration switch that widens this: an
 * administrator who can edit a page still cannot publish executable markup.
 *
 * DOM parsing is used when ext-dom is available because it normalises the
 * hostile input first; the regex path is a conservative fallback that keeps
 * even less.
 */
final class HtmlSanitizer
{
    /** tag => allowed attributes */
    const ALLOWED = array(
        'p' => array(), 'br' => array(), 'strong' => array(), 'b' => array(), 'em' => array(), 'i' => array(),
        'u' => array(), 's' => array(), 'small' => array(), 'sup' => array(), 'sub' => array(),
        'ul' => array(), 'ol' => array('start'), 'li' => array(), 'blockquote' => array(),
        'h2' => array(), 'h3' => array(), 'h4' => array(), 'h5' => array(), 'h6' => array(),
        'a' => array('href', 'title', 'target', 'rel'), 'code' => array(), 'pre' => array(),
        'hr' => array(), 'img' => array('src', 'alt', 'title', 'width', 'height', 'loading'),
        'span' => array(), 'div' => array(), 'table' => array(), 'thead' => array(), 'tbody' => array(),
        'tr' => array(), 'th' => array('scope'), 'td' => array(),
    );

    /** Elements removed together with everything inside them. */
    const STRIPPED = array(
        'script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'textarea',
        'select', 'option', 'link', 'meta', 'base', 'svg', 'math', 'template', 'noscript', 'frame', 'frameset',
    );

    const VOID = array('br', 'hr', 'img');

    public function clean($html, $maxLength = 20000)
    {
        $html = (string) $html;
        if ($html === '') { return ''; }
        if (strlen($html) > $maxLength) { $html = substr($html, 0, $maxLength); }
        $html = str_replace("\0", '', $html);

        $pattern = implode('|', self::STRIPPED);
        $html = preg_replace('#<(' . $pattern . ')\b[^>]*>.*?</\1\s*>#is', '', $html);
        $html = preg_replace('#</?(' . $pattern . ')\b[^>]*>#i', '', $html);
        $html = preg_replace('#<!--.*?-->#s', '', $html);
        $html = preg_replace('#<!\[CDATA\[.*?\]\]>#s', '', $html);

        if (class_exists('DOMDocument')) {
            $cleaned = $this->withDom($html);
            if ($cleaned !== null) { return trim($cleaned); }
        }
        return trim($this->withoutDom($html));
    }

    /** Plain text: no markup at all, control characters removed, length capped. */
    public function text($value, $maxLength = 500, $allowNewlines = false)
    {
        $value = (string) $value;
        $value = strip_tags($value);
        $value = str_replace("\0", '', $value);
        $value = $allowNewlines
            ? preg_replace('/[^\P{C}\n]+/u', '', $value)
            : preg_replace('/[^\P{C}]+/u', ' ', $value);
        if ($value === null) { return ''; }
        if (!$allowNewlines) { $value = preg_replace('/\s+/u', ' ', $value); }
        $value = trim((string) $value);
        if (function_exists('mb_substr')) {
            return mb_substr($value, 0, (int) $maxLength, 'UTF-8');
        }
        return substr($value, 0, (int) $maxLength);
    }

    /* ---------------------------------------------------------------- DOM */

    private function withDom($html)
    {
        $previous = libxml_use_internal_errors(true);
        $document = new DOMDocument('1.0', 'UTF-8');
        $wrapped = '<?xml encoding="UTF-8"?><div id="ch247-root">' . $html . '</div>';
        $flags = 0;
        if (defined('LIBXML_HTML_NOIMPLIED')) { $flags |= LIBXML_HTML_NOIMPLIED; }
        if (defined('LIBXML_HTML_NODEFDTD')) { $flags |= LIBXML_HTML_NODEFDTD; }
        if (defined('LIBXML_NONET')) { $flags |= LIBXML_NONET; }
        $loaded = $document->loadHTML($wrapped, $flags);
        libxml_clear_errors();
        libxml_use_internal_errors($previous);
        if (!$loaded) { return null; }

        $root = $document->getElementById('ch247-root');
        if (!$root) {
            $divs = $document->getElementsByTagName('div');
            $root = $divs->length ? $divs->item(0) : null;
        }
        if (!$root) { return null; }

        $this->scrub($root);

        $out = '';
        foreach ($root->childNodes as $child) {
            $out .= $document->saveHTML($child);
        }
        return $out;
    }

    private function scrub(DOMNode $node)
    {
        $children = array();
        foreach ($node->childNodes as $child) { $children[] = $child; }
        foreach ($children as $child) {
            if ($child->nodeType === XML_COMMENT_NODE) {
                $node->removeChild($child);
                continue;
            }
            if ($child->nodeType === XML_TEXT_NODE) { continue; }
            if (!($child instanceof DOMElement)) {
                $node->removeChild($child);
                continue;
            }
            $tag = strtolower($child->tagName);
            if (in_array($tag, self::STRIPPED, true)) {
                $node->removeChild($child);
                continue;
            }
            if (!isset(self::ALLOWED[$tag])) {
                // Unknown wrapper: keep the readable content, drop the element.
                $this->scrub($child);
                while ($child->firstChild) {
                    $node->insertBefore($child->firstChild, $child);
                }
                $node->removeChild($child);
                continue;
            }
            $this->scrubAttributes($child, $tag);
            $this->scrub($child);
        }
    }

    private function scrubAttributes(DOMElement $element, $tag)
    {
        $allowed = self::ALLOWED[$tag];
        $attributes = array();
        foreach ($element->attributes as $attribute) { $attributes[] = $attribute->nodeName; }
        foreach ($attributes as $name) {
            $lower = strtolower($name);
            if (!in_array($lower, $allowed, true)) {
                $element->removeAttribute($name);
                continue;
            }
            $value = $element->getAttribute($name);
            if ($lower === 'href') {
                $safe = UrlPolicy::link($value);
                if ($safe === null || $safe === '') { $element->removeAttribute($name); continue; }
                $element->setAttribute($name, $safe);
                continue;
            }
            if ($lower === 'src') {
                $safe = UrlPolicy::media($value);
                if ($safe === null || $safe === '') { $element->removeAttribute($name); continue; }
                $element->setAttribute($name, $safe);
                continue;
            }
            if ($lower === 'target') {
                $element->setAttribute('target', $value === '_blank' ? '_blank' : '_self');
                continue;
            }
            if ($lower === 'rel') {
                $element->setAttribute('rel', preg_match('/^[a-z ]{1,64}$/i', $value) === 1 ? $value : 'noopener');
                continue;
            }
            if (in_array($lower, array('width', 'height', 'start'), true)) {
                if (preg_match('/^\d{1,5}$/', $value) !== 1) { $element->removeAttribute($name); }
                continue;
            }
            if ($lower === 'loading') {
                if (!in_array($value, array('lazy', 'eager'), true)) { $element->removeAttribute($name); }
                continue;
            }
            if ($lower === 'scope') {
                if (!in_array($value, array('row', 'col'), true)) { $element->removeAttribute($name); }
                continue;
            }
            // title, alt: plain text only.
            $element->setAttribute($name, $this->text($value, 250));
        }
        if ($element->getAttribute('target') === '_blank') {
            $element->setAttribute('rel', 'noopener noreferrer');
        }
    }

    /* ------------------------------------------------------------ fallback */

    private function withoutDom($html)
    {
        $allowed = '<' . implode('><', array_keys(self::ALLOWED)) . '>';
        $html = strip_tags($html, $allowed);
        // Event handlers, inline styles and any attribute that is not on the list.
        $html = preg_replace_callback('#<([a-z0-9]+)((?:\s[^<>]*)?)(/?)>#i', function ($match) {
            $tag = strtolower($match[1]);
            if (!isset(self::ALLOWED[$tag])) { return ''; }
            $attributes = '';
            if (preg_match_all('/([a-zA-Z-]+)\s*=\s*("[^"]*"|\'[^\']*\'|[^\s"\'>]+)/', $match[2], $found, PREG_SET_ORDER)) {
                foreach ($found as $pair) {
                    $name = strtolower($pair[1]);
                    if (!in_array($name, self::ALLOWED[$tag], true)) { continue; }
                    $value = trim($pair[2], '"\'');
                    if ($name === 'href') { $value = UrlPolicy::link($value); }
                    if ($name === 'src') { $value = UrlPolicy::media($value); }
                    if ($value === null || $value === '') { continue; }
                    $attributes .= ' ' . $name . '="' . htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8') . '"';
                }
            }
            $close = in_array($tag, self::VOID, true) ? ' /' : '';
            return '<' . $tag . $attributes . $close . '>';
        }, $html);
        return (string) $html;
    }
}
