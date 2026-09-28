<?php
namespace CloudHost247\Builder\Support;

/**
 * Validation for the Custom CSS box.
 *
 * Custom CSS is the one place an administrator supplies raw stylesheet text,
 * so it is capability gated (builder.css) and filtered here. The filter blocks
 * the constructs that turn a stylesheet into code or into a data exfiltration
 * channel -- expression(), behavior:, -moz-binding, javascript: urls, @import,
 * remote url() fetches -- and refuses anything that could break out of the
 * <style> element. Rejected input is reported, never silently published.
 */
final class CssSanitizer
{
    const MAX_LENGTH = 40000;

    /** pattern => human explanation used in the rejection message. */
    const FORBIDDEN = array(
        '#</\s*style#i' => 'a closing style tag',
        '#<\s*script#i' => 'a script tag',
        '#expression\s*\(#i' => 'expression()',
        '#behaviou?r\s*:#i' => 'behavior:',
        '#-moz-binding#i' => '-moz-binding',
        '#javascript\s*:#i' => 'a javascript: URL',
        '#vbscript\s*:#i' => 'a vbscript: URL',
        '#@import#i' => '@import',
        '#@charset#i' => '@charset',
        '#url\s*\(\s*[\'"]?\s*data:(?!image/(png|jpe?g|gif|webp|svg\+xml);base64,)#i' => 'a non-image data: URL',
        '#\\\\[0-9a-f]{2,6}#i' => 'a CSS unicode escape',
        '#/\*\s*\#*\s*sourceMappingURL#i' => 'a source map reference',
    );

    private $errors = array();

    public function errors() { return $this->errors; }

    /**
     * @return string the CSS to store, or '' when the input is rejected
     * @throws \CloudHost247\Builder\Support\BuilderException on rejection
     */
    public function clean($css)
    {
        $this->errors = array();
        $css = (string) $css;
        if (trim($css) === '') { return ''; }
        $css = str_replace("\0", '', $css);

        if (strlen($css) > self::MAX_LENGTH) {
            throw BuilderException::validation('Custom CSS is limited to ' . self::MAX_LENGTH . ' characters.');
        }
        foreach (self::FORBIDDEN as $pattern => $description) {
            if (preg_match($pattern, $css) === 1) {
                throw BuilderException::validation('Custom CSS rejected: it contains ' . $description . '.');
            }
        }
        if (substr_count($css, '{') !== substr_count($css, '}')) {
            throw BuilderException::validation('Custom CSS rejected: braces are unbalanced.');
        }
        // Remote url() references leak the visitor's IP to third parties and are
        // the usual vehicle for tracking pixels in a stylesheet.
        if (preg_match_all('#url\s*\(\s*[\'"]?([^\'")]+)#i', $css, $matches)) {
            foreach ($matches[1] as $url) {
                $url = trim($url);
                if (strncmp($url, 'data:image/', 11) === 0) { continue; }
                if (UrlPolicy::media($url) === null) {
                    throw BuilderException::validation('Custom CSS rejected: unsafe url() reference.');
                }
            }
        }
        return trim($css);
    }

    /** Escape CSS text for safe inclusion inside a <style> element. */
    public static function forStyleElement($css)
    {
        return str_ireplace(array('</style', '<script', '<!--', '-->'), '', (string) $css);
    }
}
