<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * URL tools (docs section 44): rewrite and .htaccess generators plus the
 * multi-URL opener. The opener is client-side only — the server never fetches
 * the URLs it lists, because opening a browser tab is a browser action.
 */
final class UrlService extends Service
{
    protected function execute()
    {
        $operation = $this->input['operation'];
        $value = (string) $this->input['value'];
        $options = array_filter(array_map('trim', explode(',', strtolower((string) (isset($this->input['options']) ? $this->input['options'] : '')))));
        if ($operation === 'multi_open') {
            return $this->multiOpen($value);
        }
        if ($operation === 'rewrite_generator') {
            return $this->rewrite($value, $options);
        }
        return $this->htaccess($options);
    }

    private function multiOpen($value)
    {
        $lines = preg_split('/\r?\n/', $value, -1, PREG_SPLIT_NO_EMPTY);
        $urls = array();
        $rejected = array();
        foreach ($lines as $line) {
            $line = trim($line);
            if ($line === '') { continue; }
            try {
                $parts = \CloudHost247\NetworkTools\Core\Security\TargetValidator::url($line);
                $urls[] = $parts['url'];
            } catch (\InvalidArgumentException $invalid) {
                $rejected[] = array('value' => substr($line, 0, 200), 'reason' => $invalid->getMessage());
            }
        }
        return ToolResult::success(array(
            'operation' => 'multi_open',
            'urls' => $urls,
            'accepted' => count($urls),
            'rejected' => $rejected,
            'client_side' => true,
            'summary' => count($urls) . ' URL(s) validated for opening in your browser.',
            'note' => 'These URLs are opened by your browser, each in its own tab. The CloudHost247 server never fetches them, and pop-up blockers may ask for confirmation after the first few.',
        ), $rejected ? array('Some lines were rejected as unsafe or malformed; they are listed with the reason.') : array());
    }

    private function rewrite($value, array $options)
    {
        $parts = preg_split('/\s*=>\s*|\s*\|\s*/', trim($value), 2);
        if (count($parts) !== 2 || $parts[0] === '' || $parts[1] === '') {
            return ToolResult::invalid('Enter the pattern and the target separated by "=>", for example /old-page => /new-page.');
        }
        $pattern = ltrim($parts[0], '/');
        $target = '/' . ltrim($parts[1], '/');
        $lines = array('RewriteEngine On');
        if (in_array('https_only', $options, true)) {
            $lines[] = 'RewriteCond %{HTTPS} !=on';
            $lines[] = 'RewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]';
        }
        if (in_array('force_www', $options, true) || in_array('www', $options, true)) {
            $lines[] = 'RewriteCond %{HTTP_HOST} !^www\. [NC]';
            $lines[] = 'RewriteRule ^(.*)$ https://www.%{HTTP_HOST}/$1 [R=301,L]';
        }
        $lines[] = 'RewriteRule ^' . preg_quote($pattern, '/') . '$ ' . $target . ' [R=301,L]';
        return ToolResult::success(array(
            'operation' => 'rewrite_generator',
            'rules' => implode("\n", $lines),
            'explanation' => 'A 301 redirect tells clients and search engines that the address moved permanently. Test on a staging copy first: a wrong expression can redirect more than you intended.',
            'summary' => 'Redirect rule generated for /' . $pattern . ' → ' . $target . '.',
        ));
    }

    private function htaccess(array $options)
    {
        $blocks = array();
        $blocks[] = '<IfModule mod_rewrite.c>' . "\nRewriteEngine On\n" . '</IfModule>';
        if (in_array('https_only', $options, true)) {
            $blocks[] = '<IfModule mod_rewrite.c>' . "\nRewriteCond %{HTTPS} !=on\nRewriteRule ^(.*)$ https://%{HTTP_HOST}/$1 [R=301,L]\n" . '</IfModule>';
        }
        if (in_array('no_index', $options, true)) {
            $blocks[] = 'Options -Indexes';
        }
        if (in_array('cache_static', $options, true)) {
            $blocks[] = '<IfModule mod_expires.c>' . "\nExpiresActive On\nExpiresByType image/jpeg \"access plus 1 month\"\nExpiresByType image/png \"access plus 1 month\"\nExpiresByType text/css \"access plus 1 week\"\nExpiresByType application/javascript \"access plus 1 week\"\n" . '</IfModule>';
        }
        if (in_array('security_headers', $options, true)) {
            $blocks[] = '<IfModule mod_headers.c>' . "\nHeader always set X-Content-Type-Options \"nosniff\"\nHeader always set Referrer-Policy \"strict-origin-when-cross-origin\"\nHeader always set X-Frame-Options \"SAMEORIGIN\"\n" . '</IfModule>';
        }
        $blocks[] = '# Deny access to hidden files (for example .env and .git)' . "\n" . 'RedirectMatch 404 /\\.(?!well-known)';
        return ToolResult::success(array(
            'operation' => 'htaccess_generator',
            'content' => implode("\n\n", $blocks),
            'filename' => '.htaccess',
            'explanation' => 'Review every directive before deploying: .htaccess is interpreted per directory and a mistake can take the site offline. Keep a copy of the previous file so you can restore it.',
            'summary' => '.htaccess generated with ' . count($blocks) . ' directive block(s).',
        ));
    }
}
