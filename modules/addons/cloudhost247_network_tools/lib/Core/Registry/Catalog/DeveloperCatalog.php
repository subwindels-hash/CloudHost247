<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Developer tools (docs sections 30-33, 42-44, 50).
 */
final class DeveloperCatalog
{
    public static function definitions()
    {
        return array(
            'developer/http-headers' => array(
                'name' => 'HTTP Headers Checker',
                'category' => 'developer',
                'icon' => 'list',
                'summary' => 'Inspect response status, headers, security headers and the redirect chain.',
                'description' => 'Fetches a URL through the SSRF-guarded fetcher, follows redirects hop by hop, and reports status, headers, cache configuration, TLS information and missing security headers.',
                'explanation' => 'Headers describe how the server and any intermediary in front of it answered this one request. A missing security header is a recommendation, not proof of a vulnerability; the tool links every finding to what it observed.',
                'fields' => array(
                    array('name' => 'url', 'type' => 'url', 'label' => 'URL', 'required' => true, 'placeholder' => 'https://example.com', 'target' => true),
                    array('name' => 'method', 'type' => 'select', 'label' => 'Method', 'required' => false, 'default' => 'GET', 'options' => array('GET' => 'GET', 'HEAD' => 'HEAD')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\HttpHeadersService',
                'target_field' => 'url',
                'cache_seconds' => 120,
                'exports' => array('json', 'csv', 'pdf', 'png'),
                'result_view' => 'headers',
                'capabilities' => array('curl'),
            ),
            'developer/server-os' => array(
                'name' => 'Website Server Checker',
                'category' => 'developer',
                'icon' => 'server',
                'summary' => 'Identify the web server, language and CDN from publicly visible responses.',
                'description' => 'Reads the headers and a small part of the response of a public site and reports server software, detected technology and reverse-proxy clues with an explicit confidence level for each.',
                'explanation' => 'Everything shown is inference from public responses, never certainty. A header can be removed, rewritten or deliberately misleading, so each finding carries Confirmed, Likely or Unknown.',
                'fields' => array(
                    array('name' => 'url', 'type' => 'url', 'label' => 'URL', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\ServerOsService',
                'target_field' => 'url',
                'cache_seconds' => 600,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'fingerprint',
                'capabilities' => array('curl'),
            ),
            'developer/smtp-test' => array(
                'name' => 'SMTP Tester',
                'category' => 'developer',
                'icon' => 'mail',
                'summary' => 'Test SMTP connectivity and authentication without sending mail.',
                'description' => 'Performs a real SMTP handshake — greeting, EHLO, STARTTLS or implicit TLS, AUTH LOGIN — and reports the outcome of each step. No message is ever sent.',
                'explanation' => 'Credentials are used for this request only: they are never written to the database, never logged, never cached, never exported and never included in a support ticket. Prefer testing through the SMTP relay already configured in CloudHost247 when you are signed in.',
                'fields' => array(
                    array('name' => 'mode', 'type' => 'select', 'label' => 'Server to test', 'required' => false, 'default' => 'platform', 'options' => array('platform' => 'CloudHost247 configured SMTP (no credentials needed)', 'custom' => 'Other SMTP server')),
                    array('name' => 'host', 'type' => 'hostname', 'label' => 'SMTP host', 'required' => false, 'placeholder' => 'smtp.example.com'),
                    array('name' => 'port', 'type' => 'port', 'label' => 'Port', 'required' => false, 'default' => 587),
                    array('name' => 'encryption', 'type' => 'select', 'label' => 'Encryption', 'required' => false, 'default' => 'tls', 'options' => array('tls' => 'STARTTLS', 'ssl' => 'Implicit TLS')),
                    array('name' => 'username', 'type' => 'text', 'label' => 'Username', 'required' => false, 'maxlength' => 255),
                    array('name' => 'password', 'type' => 'password', 'label' => 'Password', 'required' => false, 'sensitive' => true),
                    array('name' => 'from_address', 'type' => 'email', 'label' => 'Sender address to verify', 'required' => false),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\SmtpTestService',
                'target_field' => 'host',
                'visibility' => 'customer',
                'rate_tier' => 'high_risk',
                'high_risk' => true,
                'timeout_seconds' => 25,
                'cache_seconds' => 0,
                'exports' => array('json', 'pdf'),
                'result_view' => 'steps',
                'capabilities' => array('tls_client'),
                'notes' => array('Submitted credentials are discarded with the request and are excluded from logs, history, exports, analytics and support tickets.'),
            ),
            'developer/email-header' => array(
                'name' => 'Email Header Analyzer',
                'category' => 'developer',
                'icon' => 'mail-open',
                'summary' => 'Parse a pasted email header: routing, authentication results and timestamps.',
                'description' => 'Parses the Received chain, From/To/Return-Path/Message-ID, SPF, DKIM and DMARC results, the sending IP and the server timeline, and highlights delays and mismatches.',
                'explanation' => 'Analysis happens in memory for this one request. The header is not stored unless you explicitly save the analysis as a report, and addresses are truncated in the summary shown to support.',
                'fields' => array(
                    array('name' => 'headers', 'type' => 'textarea', 'label' => 'Email header', 'required' => true, 'rows' => 12, 'maxlength' => 65536, 'help' => 'Paste the full header including the Return-Path and all Received lines.', 'sensitive' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\EmailHeaderService',
                'visibility' => 'customer',
                'rate_tier' => 'standard',
                'cache_seconds' => 0,
                'exports' => array('json', 'pdf'),
                'result_view' => 'header-analysis',
                'notes' => array('Header content is never written to logs, history or analytics by default.'),
            ),
            'developer/json' => array(
                'name' => 'JSON Tools',
                'category' => 'developer',
                'icon' => 'braces',
                'summary' => 'View, format, minify, validate and summarise JSON.',
                'description' => 'Validates JSON and returns a formatted, minified or tree-summarised form with the parse error position when it is invalid. Processing happens locally in the browser whenever possible.',
                'explanation' => 'Formatting is deterministic: the same input always produces the same output. The tool never modifies values, only whitespace and ordering as requested.',
                'fields' => array(
                    array('name' => 'json', 'type' => 'json', 'label' => 'JSON', 'required' => true, 'rows' => 12, 'maxlength' => 262144),
                    array('name' => 'mode', 'type' => 'select', 'label' => 'Operation', 'required' => true, 'default' => 'format', 'options' => array('format' => 'Format / beautify', 'minify' => 'Minify', 'validate' => 'Validate only', 'view' => 'View (tree summary)')),
                    array('name' => 'indent', 'type' => 'number', 'label' => 'Indent spaces', 'required' => false, 'default' => 2, 'min' => 0, 'max' => 8),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\JsonService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'code',
            ),
            'developer/encoding' => array(
                'name' => 'Encoding Tools',
                'category' => 'developer',
                'icon' => 'binary',
                'summary' => 'Base64, MD5, binary/text, ROT13 and Morse conversions.',
                'description' => 'Converts text and binary representations in both directions, with the exact output length and alphabet used. All operations are local and deterministic.',
                'explanation' => 'MD5 is a checksum, not a security control: it is unsuitable for password storage and for any modern cryptographic use. The password tools use proper one-way hashing instead.',
                'fields' => array(
                    array('name' => 'operation', 'type' => 'select', 'label' => 'Operation', 'required' => true, 'default' => 'base64_encode', 'options' => array(
                        'base64_encode' => 'Base64 encode', 'base64_decode' => 'Base64 decode', 'md5' => 'MD5 checksum', 'text_to_binary' => 'Text → binary',
                        'binary_to_text' => 'Binary → text', 'rot13' => 'ROT13', 'morse_encode' => 'Text → Morse', 'morse_decode' => 'Morse → text',
                    )),
                    array('name' => 'input', 'type' => 'textarea', 'label' => 'Input', 'required' => true, 'rows' => 6, 'maxlength' => 65536, 'sensitive' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\EncodingService',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'code',
                'notes' => array('MD5 output is provided as a checksum only and is explicitly not suitable for password storage.'),
            ),
            'developer/url' => array(
                'name' => 'URL Tools',
                'category' => 'developer',
                'icon' => 'link',
                'summary' => 'Rewrite-rule and .htaccess generators, plus a multi-URL opener.',
                'description' => 'Builds common Apache rewrite rules and .htaccess snippets, and opens a list of URLs in tabs when the browser allows it. The opener is client-side: no URL is fetched by the server.',
                'explanation' => 'Generated configuration is a starting point that must be reviewed before it is deployed; the tool explains what each directive does.',
                'fields' => array(
                    array('name' => 'operation', 'type' => 'select', 'label' => 'Tool', 'required' => true, 'default' => 'rewrite_generator', 'options' => array('rewrite_generator' => 'URL rewrite generator', 'htaccess_generator' => '.htaccess generator', 'multi_open' => 'Multi-URL opener (client side)')),
                    array('name' => 'value', 'type' => 'textarea', 'label' => 'Input', 'required' => true, 'rows' => 5, 'maxlength' => 8192, 'help' => 'Pattern/target for rewrites, or one URL per line for the opener.'),
                    array('name' => 'options', 'type' => 'text', 'label' => 'Options', 'required' => false, 'maxlength' => 255, 'help' => 'Comma-separated flags such as https_only, www, force_www, no_index, cache_static, security_headers.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\UrlService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'generated',
            ),
            'developer/user-agent' => array(
                'name' => 'User Agent Checker',
                'category' => 'developer',
                'icon' => 'user',
                'summary' => 'Show the user agent and browser details this visit reports.',
                'description' => 'Displays the raw User-Agent string, the values the browser volunteers (Accept, language, platform) and a conservative interpretation of the browser family.',
                'explanation' => 'Only what the browser itself sends is shown. Client hints may be absent, and a user agent can be overridden — nothing here is a fingerprint of a person.',
                'fields' => array(),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Developer\\UserAgentService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json'),
                'result_view' => 'details',
            ),
        );
    }
}
