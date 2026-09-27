/**
 * CloudHost247 Tools Platform - Frontend JavaScript
 * Handles dynamic form rendering, AJAX submissions, and result display
 */

(function() {
    'use strict';

    // Tool field definitions
    var toolFields = {
        // DNS Tools
        'spf_checker': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'domain_dns_validation': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'reverse_ip_lookup': [
            { name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true }
        ],
        'dns_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true },
            { name: 'type', label: 'Record Type', type: 'select', options: ['A','AAAA','MX','TXT','NS','SOA','CNAME','SRV','CAA'], value: 'A' }
        ],
        'cname_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'www.example.com', required: true }
        ],
        'ns_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'mx_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'dns_propagation': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true },
            { name: 'type', label: 'Record Type', type: 'select', options: ['A','AAAA','MX','TXT','NS','CNAME'], value: 'A' }
        ],
        'dmarc_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'dns_health': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'dmarc_generator': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true },
            { name: 'policy', label: 'Policy', type: 'select', options: ['none','quarantine','reject'], value: 'none' },
            { name: 'pct', label: 'Percentage', type: 'number', placeholder: '100', value: '100' },
            { name: 'rua', label: 'Aggregate Reports Email (rua)', type: 'email', placeholder: 'dmarc@example.com' },
            { name: 'ruf', label: 'Forensic Reports Email (ruf)', type: 'email', placeholder: 'forensic@example.com' },
            { name: 'aspf', label: 'SPF Alignment', type: 'select', options: ['r','s'], value: 'r' },
            { name: 'adkim', label: 'DKIM Alignment', type: 'select', options: ['r','s'], value: 'r' }
        ],
        'dnskey_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'ds_record_lookup': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'dkim_checker': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true },
            { name: 'selector', label: 'Selector', type: 'text', placeholder: 'default', value: 'default' }
        ],

        // IP Tools
        'ping_ipv4': [
            { name: 'host', label: 'Host or IP', type: 'text', placeholder: 'google.com or 8.8.8.8', required: true }
        ],
        'ping_ipv6': [
            { name: 'host', label: 'Host or IPv6', type: 'text', placeholder: 'ipv6.google.com', required: true }
        ],
        'what_is_my_ip': [],
        'traceroute': [
            { name: 'host', label: 'Host or IP', type: 'text', placeholder: 'google.com', required: true }
        ],
        'ip_location': [
            { name: 'ip', label: 'IP Address (leave empty for your IP)', type: 'text', placeholder: '8.8.8.8' }
        ],
        'email_header_analyzer': [
            { name: 'header', label: 'Paste Email Header', type: 'textarea', placeholder: 'Received: from ...', rows: 10, required: true }
        ],
        'ip_blacklist': [
            { name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true }
        ],
        'ip_to_decimal': [
            { name: 'ip', label: 'IPv4 Address', type: 'text', placeholder: '192.168.1.1', required: true }
        ],
        'ip_to_hostname': [
            { name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true }
        ],
        'ip_whois': [
            { name: 'ip', label: 'IPv4 Address', type: 'text', placeholder: '8.8.8.8', required: true }
        ],
        'ipv6_whois': [
            { name: 'ip', label: 'IPv6 Address', type: 'text', placeholder: '2001:4860:4860::8888', required: true }
        ],
        'ipv4_ipv6_converter': [
            { name: 'input', label: 'IP Address', type: 'text', placeholder: '192.168.1.1 or ::ffff:192.168.1.1', required: true },
            { name: 'direction', label: 'Direction', type: 'select', options: ['v4_to_v6','v6_to_v4'], value: 'v4_to_v6' }
        ],
        'ipv6_generator': [
            { name: 'count', label: 'Number of Addresses', type: 'number', value: '5', min: 1, max: 20 }
        ],
        'ipv6_cidr': [
            { name: 'ipv6', label: 'IPv6 Address', type: 'text', placeholder: '2001:db8::1', required: true },
            { name: 'prefix', label: 'Prefix Length', type: 'number', value: '64', min: 1, max: 128 }
        ],
        'ipv6_compress': [
            { name: 'ipv6', label: 'IPv6 Address', type: 'text', placeholder: '2001:0db8:0000:0000:0000:0000:0000:0001', required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['compress','expand'], value: 'compress' }
        ],
        'subnet_calculator': [
            { name: 'ip', label: 'IP Address', type: 'text', placeholder: '192.168.1.1', required: true },
            { name: 'mask', label: 'CIDR (e.g. 24)', type: 'number', value: '24', min: 1, max: 32 }
        ],
        'isp_checker': [
            { name: 'ip', label: 'IP Address (leave empty for your IP)', type: 'text', placeholder: '8.8.8.8' }
        ],
        'domain_to_ip': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'google.com', required: true }
        ],

        // Developer Tools
        'http_headers': [
            { name: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com', required: true }
        ],
        'server_os_detector': [
            { name: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com', required: true }
        ],
        'md5_base64': [
            { name: 'input', label: 'Input Text', type: 'textarea', placeholder: 'Enter text...', rows: 4, required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['md5','sha1','sha256','base64_encode','base64_decode'], value: 'md5' }
        ],
        'multi_url_opener': [
            { name: 'urls', label: 'URLs (one per line)', type: 'textarea', placeholder: 'https://example.com\nhttps://google.com', rows: 8, required: true }
        ],
        'smtp_test': [
            { name: 'host', label: 'SMTP Server', type: 'text', placeholder: 'smtp.gmail.com', required: true },
            { name: 'port', label: 'Port', type: 'number', value: '25', min: 1, max: 65535 }
        ],
        'htaccess_generator': [
            { name: 'redirect_type', label: 'Redirect Type', type: 'select', options: ['301','302','307'], value: '301' },
            { name: 'from', label: 'From Path', type: 'text', placeholder: '/old-page', required: true },
            { name: 'to', label: 'To URL', type: 'url', placeholder: 'https://example.com/new-page', required: true }
        ],
        'url_rewrite': [
            { name: 'redirect_type', label: 'Redirect Type', type: 'select', options: ['301','302'], value: '301' },
            { name: 'from', label: 'From', type: 'text', placeholder: '/old-url', required: true },
            { name: 'to', label: 'To', type: 'text', placeholder: '/new-url', required: true }
        ],
        'broken_link_checker': [
            { name: 'url', label: 'Page URL', type: 'url', placeholder: 'https://example.com', required: true }
        ],
        'open_graph': [
            { name: 'title', label: 'Title', type: 'text', placeholder: 'Page Title', required: true },
            { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Page description...', rows: 3, required: true },
            { name: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com/page', required: true },
            { name: 'image', label: 'Image URL', type: 'url', placeholder: 'https://example.com/image.jpg' },
            { name: 'type', label: 'Type', type: 'select', options: ['website','article','product','profile'], value: 'website' }
        ],
        'raid_calculator': [
            { name: 'drives', label: 'Number of Drives', type: 'number', value: '4', min: 2, max: 24 },
            { name: 'size', label: 'Drive Size (GB)', type: 'number', value: '1000', min: 1 },
            { name: 'raid', label: 'RAID Level', type: 'select', options: ['0','1','5','6','10'], value: '5' }
        ],
        'binary_text': [
            { name: 'input', label: 'Input', type: 'textarea', placeholder: 'Enter text or binary...', rows: 4, required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['text_to_binary','binary_to_text','text_to_hex','hex_to_text'], value: 'text_to_binary' }
        ],
        'json_formatter': [
            { name: 'json', label: 'JSON Input', type: 'textarea', placeholder: '{"key": "value"}', rows: 10, required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['format','minify','tree'], value: 'format' }
        ],

        // Designer Tools
        'rgb_to_pantone': [
            { name: 'r', label: 'Red (0-255)', type: 'number', value: '255', min: 0, max: 255 },
            { name: 'g', label: 'Green (0-255)', type: 'number', value: '0', min: 0, max: 255 },
            { name: 'b', label: 'Blue (0-255)', type: 'number', value: '0', min: 0, max: 255 }
        ],
        'hex_to_pantone': [
            { name: 'hex', label: 'HEX Color', type: 'text', placeholder: '#FF5733', required: true }
        ],
        'cmyk_to_pantone': [
            { name: 'c', label: 'Cyan %', type: 'number', value: '0', min: 0, max: 100 },
            { name: 'm', label: 'Magenta %', type: 'number', value: '100', min: 0, max: 100 },
            { name: 'y', label: 'Yellow %', type: 'number', value: '100', min: 0, max: 100 },
            { name: 'k', label: 'Key/Black %', type: 'number', value: '0', min: 0, max: 100 }
        ],
        'hsv_to_pantone': [
            { name: 'h', label: 'Hue (0-360)', type: 'number', value: '0', min: 0, max: 360 },
            { name: 's', label: 'Saturation %', type: 'number', value: '100', min: 0, max: 100 },
            { name: 'v', label: 'Value %', type: 'number', value: '100', min: 0, max: 100 }
        ],

        // Webmaster Tools
        'link_analyzer': [
            { name: 'url', label: 'Page URL', type: 'url', placeholder: 'https://example.com', required: true }
        ],
        'user_agent': [],
        'pagerank': [
            { name: 'domain', label: 'Domain', type: 'text', placeholder: 'google.com', required: true }
        ],
        'punycode': [
            { name: 'input', label: 'Domain', type: 'text', placeholder: 'm\u00fcnchen.com or xn--mnchen-3ya.com', required: true },
            { name: 'direction', label: 'Direction', type: 'select', options: ['encode','decode'], value: 'encode' }
        ],
        'serp_preview': [
            { name: 'title', label: 'Page Title', type: 'text', placeholder: 'Your Page Title (50-60 chars)', required: true },
            { name: 'description', label: 'Meta Description', type: 'textarea', placeholder: 'Page description (150-160 chars)', rows: 3, required: true },
            { name: 'url', label: 'URL', type: 'url', placeholder: 'https://example.com/page', required: true }
        ],
        'robots_generator': [
            { name: 'user_agent', label: 'User-Agent', type: 'text', value: '*', required: true },
            { name: 'disallow', label: 'Disallow Paths (one per line)', type: 'textarea', placeholder: '/admin/\n/private/', rows: 5 },
            { name: 'allow', label: 'Allow Paths (one per line)', type: 'textarea', placeholder: '/public/', rows: 3 },
            { name: 'sitemap', label: 'Sitemap URL', type: 'url', placeholder: 'https://example.com/sitemap.xml' },
            { name: 'crawl_delay', label: 'Crawl-delay (seconds)', type: 'number', value: '0', min: 0 }
        ],

        // Network Tools
        'port_checker': [
            { name: 'host', label: 'Host', type: 'text', placeholder: 'example.com', required: true },
            { name: 'port', label: 'Port', type: 'number', value: '80', min: 1, max: 65535 }
        ],
        'mac_lookup': [
            { name: 'mac', label: 'MAC Address', type: 'text', placeholder: '00:1B:11:00:00:00', required: true }
        ],
        'mac_generator': [
            { name: 'count', label: 'Number of Addresses', type: 'number', value: '5', min: 1, max: 20 },
            { name: 'format', label: 'Format', type: 'select', options: ['colon','hyphen','dot','plain'], value: 'colon' }
        ],
        'asn_lookup': [
            { name: 'asn', label: 'ASN Number', type: 'text', placeholder: '15169', required: true }
        ],

        // Security Tools
        'ssl_checker': [
            { name: 'domain', label: 'Domain', type: 'text', placeholder: 'google.com', required: true }
        ],
        'password_encryptor': [
            { name: 'password', label: 'Password', type: 'text', placeholder: 'Enter password', required: true },
            { name: 'algorithm', label: 'Algorithm', type: 'select', options: ['md5','sha1','sha256','sha512','bcrypt','argon2'], value: 'sha256' }
        ],
        'password_generator': [
            { name: 'length', label: 'Length', type: 'number', value: '16', min: 4, max: 128 },
            { name: 'count', label: 'Generate Count', type: 'number', value: '5', min: 1, max: 20 },
            { name: 'uppercase', label: 'Uppercase (A-Z)', type: 'checkbox', checked: true },
            { name: 'lowercase', label: 'Lowercase (a-z)', type: 'checkbox', checked: true },
            { name: 'numbers', label: 'Numbers (0-9)', type: 'checkbox', checked: true },
            { name: 'symbols', label: 'Symbols', type: 'checkbox', checked: true }
        ],
        'password_strength': [
            { name: 'password', label: 'Password', type: 'text', placeholder: 'Enter password to check', required: true }
        ],

        // Productivity Tools
        'qr_generator': [
            { name: 'text', label: 'Text or URL', type: 'textarea', placeholder: 'https://example.com or any text', rows: 3, required: true },
            { name: 'size', label: 'Size (px)', type: 'number', value: '300', min: 100, max: 1000 }
        ],
        'qr_scanner': [
            { name: 'scanner', label: 'QR Scanner', type: 'file', accept: 'image/*' }
        ],
        'lorem_ipsum': [
            { name: 'count', label: 'Count', type: 'number', value: '5', min: 1, max: 50 },
            { name: 'type', label: 'Type', type: 'select', options: ['paragraphs','sentences','words'], value: 'paragraphs' }
        ],
        'time_calculator': [
            { name: 'start', label: 'Start Date/Time', type: 'datetime-local', required: true },
            { name: 'end', label: 'End Date/Time', type: 'datetime-local', required: true },
            { name: 'format', label: 'Output Format', type: 'select', options: ['seconds','minutes','hours','days','weeks','months','years'], value: 'hours' }
        ],
        'bin_checker': [
            { name: 'bin', label: 'BIN (first 6 digits)', type: 'text', placeholder: '411111', required: true }
        ],
        'credit_card_validator': [
            { name: 'number', label: 'Card Number', type: 'text', placeholder: '4111111111111111', required: true }
        ],
        'reverse_image_search': [
            { name: 'url', label: 'Image URL', type: 'url', placeholder: 'https://example.com/image.jpg', required: true }
        ],
        'username_checker': [
            { name: 'username', label: 'Username', type: 'text', placeholder: 'john_doe', required: true }
        ],
        'online_notepad': [
            { name: 'content', label: 'Your Notes', type: 'textarea', placeholder: 'Type your notes here...', rows: 15 },
            { name: 'notepad_action', type: 'hidden', value: 'save' }
        ],
        'small_text': [
            { name: 'text', label: 'Text', type: 'textarea', placeholder: 'Enter text...', rows: 4, required: true }
        ],
        'word_counter': [
            { name: 'text', label: 'Text', type: 'textarea', placeholder: 'Paste your text here...', rows: 10, required: true }
        ],
        'domain_availability': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'rot13': [
            { name: 'text', label: 'Text', type: 'textarea', placeholder: 'Enter text...', rows: 4, required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['encode','decode'], value: 'encode' }
        ],
        'morse_code': [
            { name: 'text', label: 'Text / Morse Code', type: 'textarea', placeholder: 'Enter text or morse code (use / for word spaces)', rows: 4, required: true },
            { name: 'mode', label: 'Mode', type: 'select', options: ['encode','decode'], value: 'encode' }
        ],
        'bimi_checker': [
            { name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true }
        ],
        'image_to_text': [
            { name: 'image', label: 'Upload Image', type: 'file', accept: 'image/*' }
        ],

        // Gaming Tools
        'minecraft_colors': [
            { name: 'text', label: 'Text with color codes', type: 'textarea', placeholder: '&cRed &aGreen &bBlue text', rows: 3 },
            { name: 'mc_action', type: 'hidden', value: 'preview' }
        ]
    };

    // Result renderers
    var resultRenderers = {
        'spf_checker': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Found:</span><span class="result-value">' + (data.found ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.records && data.records.length) {
                html += '<h5 class="mt-3">Records</h5><ul>';
                data.records.forEach(function(r) { html += '<li><code>' + escapeHtml(r) + '</code></li>'; });
                html += '</ul>';
            }
            if (data.issues && data.issues.length) {
                html += '<h5 class="mt-3">Issues</h5><ul>';
                data.issues.forEach(function(i) { html += '<li class="CloudHost247-status-fail">' + escapeHtml(i) + '</li>'; });
                html += '</ul>';
            }
            return html;
        },
        'domain_dns_validation': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Healthy:</span><span class="result-value">' + (data.healthy ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.issues && data.issues.length) {
                html += '<ul>';
                data.issues.forEach(function(i) { html += '<li class="CloudHost247-status-fail">' + escapeHtml(i) + '</li>'; });
                html += '</ul>';
            }
            if (data.records) {
                Object.keys(data.records).forEach(function(type) {
                    var recs = data.records[type];
                    if (recs && recs.length) {
                        html += '<h5 class="mt-3">' + escapeHtml(type) + ' Records</h5>';
                        html += '<table class="CloudHost247-dns-table"><thead><tr><th>Data</th><th>TTL</th></tr></thead><tbody>';
                        recs.forEach(function(r) {
                            html += '<tr><td><code>' + escapeHtml(JSON.stringify(r).substring(0, 200)) + '</code></td><td>' + (r.ttl || '-') + '</td></tr>';
                        });
                        html += '</tbody></table>';
                    }
                });
            }
            return html;
        },
        'reverse_ip_lookup': function(data) {
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Hostname:</span><span class="result-value">' + (data.found ? escapeHtml(data.hostname) : '<span class="CloudHost247-status-fail">Not found</span>') + '</span></div>';
            return html;
        },
        'dns_lookup': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Type:</span><span class="result-value">' + escapeHtml(data.type) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Records Found:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.records && data.records.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Type</th><th>Value</th><th>TTL</th></tr></thead><tbody>';
                data.records.forEach(function(r) {
                    html += '<tr><td>' + escapeHtml(r.type) + '</td><td><code>' + escapeHtml(r.value) + '</code></td><td>' + r.ttl + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'cname_lookup': function(data) {
            var html = '<table class="CloudHost247-dns-table"><thead><tr><th>Domain</th><th>Target</th><th>TTL</th></tr></thead><tbody>';
            (data.records || []).forEach(function(r) {
                html += '<tr><td>' + escapeHtml(r.domain) + '</td><td>' + escapeHtml(r.target) + '</td><td>' + r.ttl + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        },
        'ns_lookup': function(data) {
            var html = '<table class="CloudHost247-dns-table"><thead><tr><th>Nameserver</th><th>TTL</th></tr></thead><tbody>';
            (data.nameservers || []).forEach(function(r) {
                html += '<tr><td>' + escapeHtml(r.host) + '</td><td>' + r.ttl + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        },
        'mx_lookup': function(data) {
            var html = '<table class="CloudHost247-dns-table"><thead><tr><th>Priority</th><th>Mail Server</th><th>TTL</th></tr></thead><tbody>';
            (data.servers || []).forEach(function(r) {
                html += '<tr><td>' + r.priority + '</td><td>' + escapeHtml(r.target) + '</td><td>' + r.ttl + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        },
        'dns_propagation': function(data) {
            var html = '<table class="CloudHost247-dns-table"><thead><tr><th>DNS Server</th><th>IP</th><th>Resolved</th><th>Records</th></tr></thead><tbody>';
            (data.results || []).forEach(function(r) {
                html += '<tr><td>' + escapeHtml(r.server_name) + '</td><td>' + escapeHtml(r.server_ip) + '</td><td>' + (r.resolved ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</td><td>' + (r.records || []).join(', ') + '</td></tr>';
            });
            html += '</tbody></table>';
            return html;
        },
        'dmarc_lookup': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Found:</span><span class="result-value">' + (data.found ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.records && data.records.length) {
                html += '<h5 class="mt-3">Records</h5><ul>';
                data.records.forEach(function(r) { html += '<li><code>' + escapeHtml(r) + '</code></li>'; });
                html += '</ul>';
            }
            if (data.issues && data.issues.length) {
                html += '<h5 class="mt-3">Issues</h5><ul>';
                data.issues.forEach(function(i) { html += '<li class="CloudHost247-status-warning">' + escapeHtml(i) + '</li>'; });
                html += '</ul>';
            }
            return html;
        },
        'dns_health': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Score:</span><span class="result-value">' + data.score + '/' + data.max_score + ' (' + data.percentage + '%)</span></div>';
            html += '<div class="result-row"><span class="result-label">Healthy:</span><span class="result-value">' + (data.healthy ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-warning">Needs Attention</span>') + '</span></div>';
            if (data.checks && data.checks.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Check</th><th>Status</th><th>Detail</th></tr></thead><tbody>';
                data.checks.forEach(function(c) {
                    var statusClass = c.status === 'pass' ? 'CloudHost247-status-pass' : (c.status === 'fail' ? 'CloudHost247-status-fail' : 'CloudHost247-status-warning');
                    html += '<tr><td>' + escapeHtml(c.test) + '</td><td class="' + statusClass + '">' + escapeHtml(c.status) + '</td><td>' + escapeHtml(c.detail) + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'dmarc_generator': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<h5 class="mt-3">DNS TXT Record</h5><pre><code>' + escapeHtml(data.dns_entry) + '</code></pre>';
            html += '<h5 class="mt-3">Record Value</h5><pre><code>' + escapeHtml(data.record) + '</code></pre>';
            return html;
        },
        'dnskey_lookup': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Keys Found:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.keys && data.keys.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Flags</th><th>Protocol</th><th>Algorithm</th></tr></thead><tbody>';
                data.keys.forEach(function(k) {
                    html += '<tr><td>' + k.flags + '</td><td>' + k.protocol + '</td><td>' + k.algorithm + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'ds_record_lookup': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Records Found:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.records && data.records.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Key Tag</th><th>Algorithm</th><th>Digest Type</th><th>Digest</th></tr></thead><tbody>';
                data.records.forEach(function(r) {
                    html += '<tr><td>' + r.key_tag + '</td><td>' + r.algorithm + '</td><td>' + r.digest_type + '</td><td><code>' + escapeHtml(r.digest) + '</code></td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'dkim_checker': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Selector:</span><span class="result-value">' + escapeHtml(data.selector) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Found:</span><span class="result-value">' + (data.found ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.record) html += '<h5 class="mt-3">Record</h5><pre><code>' + escapeHtml(data.record) + '</code></pre>';
            if (data.issues && data.issues.length) {
                html += '<h5 class="mt-3">Issues</h5><ul>';
                data.issues.forEach(function(i) { html += '<li class="CloudHost247-status-warning">' + escapeHtml(i) + '</li>'; });
                html += '</ul>';
            }
            return html;
        },

        // IP Tools renderers
        'ping_ipv4': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Host:</span><span class="result-value">' + escapeHtml(data.host) + ' (' + escapeHtml(data.ip) + ')</span></div>';
            html += '<div class="result-row"><span class="result-label">Packets:</span><span class="result-value">' + data.packets_sent + ' sent, ' + data.packets_received + ' received</span></div>';
            html += '<div class="result-row"><span class="result-label">Packet Loss:</span><span class="result-value">' + data.packet_loss + '%</span></div>';
            html += '<div class="result-row"><span class="result-label">Min / Max / Avg:</span><span class="result-value">' + data.min_time + 'ms / ' + data.max_time + 'ms / ' + data.avg_time + 'ms</span></div>';
            if (data.results && data.results.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>#</th><th>Status</th><th>Time</th></tr></thead><tbody>';
                data.results.forEach(function(r) {
                    var statusClass = r.status === 'success' ? 'CloudHost247-status-pass' : 'CloudHost247-status-timeout';
                    html += '<tr><td>' + r.seq + '</td><td class="' + statusClass + '">' + r.status + '</td><td>' + (r.time ? r.time + 'ms' : '-') + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'ping_ipv6': function(data) {
            return resultRenderers['ping_ipv4'](data);
        },
        'what_is_my_ip': function(data) {
            var html = '<div class="result-row"><span class="result-label">Your IP:</span><span class="result-value"><strong>' + escapeHtml(data.ip) + '</strong></span></div>';
            if (data.hostname) html += '<div class="result-row"><span class="result-label">Hostname:</span><span class="result-value">' + escapeHtml(data.hostname) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">IPv6:</span><span class="result-value">' + (data.is_ipv6 ? 'Yes' : 'No') + '</span></div>';
            return html;
        },
        'traceroute': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Host:</span><span class="result-value">' + escapeHtml(data.host) + ' (' + escapeHtml(data.ip) + ')</span></div>';
            if (data.hops && data.hops.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Hop</th><th>IP</th><th>Hostname</th><th>Time</th></tr></thead><tbody>';
                data.hops.forEach(function(h) {
                    html += '<tr><td>' + h.hop + '</td><td>' + (h.ip || '-') + '</td><td>' + (h.hostname || '-') + '</td><td>' + (h.time_ms ? h.time_ms + 'ms' : '<span class="CloudHost247-status-timeout">Timeout</span>') + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'ip_location': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Country:</span><span class="result-value">' + escapeHtml(data.country) + ' (' + escapeHtml(data.country_code) + ')</span></div>';
            html += '<div class="result-row"><span class="result-label">Region:</span><span class="result-value">' + escapeHtml(data.region) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">City:</span><span class="result-value">' + escapeHtml(data.city) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">ZIP:</span><span class="result-value">' + escapeHtml(data.zip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Coordinates:</span><span class="result-value">' + data.latitude + ', ' + data.longitude + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Timezone:</span><span class="result-value">' + escapeHtml(data.timezone) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">ISP:</span><span class="result-value">' + escapeHtml(data.isp) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">ASN:</span><span class="result-value">' + escapeHtml(data.asn) + '</span></div>';
            if (data.cached) html += '<div class="text-muted small mt-2"><i class="fas fa-database"></i> Result from cache</div>';
            return html;
        },
        'email_header_analyzer': function(data) {
            var html = '';
            if (data.from) html += '<div class="result-row"><span class="result-label">From:</span><span class="result-value">' + escapeHtml(data.from) + '</span></div>';
            if (data.to) html += '<div class="result-row"><span class="result-label">To:</span><span class="result-value">' + escapeHtml(data.to) + '</span></div>';
            if (data.subject) html += '<div class="result-row"><span class="result-label">Subject:</span><span class="result-value">' + escapeHtml(data.subject) + '</span></div>';
            if (data.date) html += '<div class="result-row"><span class="result-label">Date:</span><span class="result-value">' + escapeHtml(data.date) + '</span></div>';
            if (data.spf_result) html += '<div class="result-row"><span class="result-label">SPF:</span><span class="result-value">' + escapeHtml(data.spf_result) + '</span></div>';
            if (data.dkim_result) html += '<div class="result-row"><span class="result-label">DKIM:</span><span class="result-value">' + escapeHtml(data.dkim_result) + '</span></div>';
            if (data.dmarc_result) html += '<div class="result-row"><span class="result-label">DMARC:</span><span class="result-value">' + escapeHtml(data.dmarc_result) + '</span></div>';
            if (data.received && data.received.length) {
                html += '<h5 class="mt-3">Received Headers (' + data.received.length + ')</h5><ol>';
                data.received.forEach(function(r) { html += '<li><code>' + escapeHtml(r.substring(0, 200)) + '...</code></li>'; });
                html += '</ol>';
            }
            if (data.warnings && data.warnings.length) {
                html += '<h5 class="mt-3">Warnings</h5><ul>';
                data.warnings.forEach(function(w) { html += '<li class="CloudHost247-status-warning">' + escapeHtml(w) + '</li>'; });
                html += '</ul>';
            }
            return html;
        },
        'ip_blacklist': function(data) {
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Status:</span><span class="result-value">' + (data.clean ? '<span class="CloudHost247-status-pass">Clean</span>' : '<span class="CloudHost247-status-fail">Listed on ' + data.listed_count + ' RBLs</span>') + '</span></div>';
            if (data.results && data.results.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>RBL</th><th>Status</th></tr></thead><tbody>';
                data.results.forEach(function(r) {
                    html += '<tr><td>' + escapeHtml(r.rbl) + '</td><td>' + (r.listed ? '<span class="CloudHost247-status-fail">Listed</span>' : '<span class="CloudHost247-status-pass">Clean</span>') + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'ip_to_decimal': function(data) {
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Decimal:</span><span class="result-value"><code>' + data.decimal + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Hex:</span><span class="result-value"><code>' + escapeHtml(data.hex) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Binary:</span><span class="result-value"><code>' + escapeHtml(data.binary) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Octal:</span><span class="result-value"><code>' + escapeHtml(data.octal) + '</code></span></div>';
            return html;
        },
        'ip_to_hostname': function(data) {
            return resultRenderers['reverse_ip_lookup'](data);
        },
        'ip_whois': function(data) {
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Server:</span><span class="result-value">' + escapeHtml(data.server) + '</span></div>';
            html += '<h5 class="mt-3">WHOIS Response</h5><pre>' + escapeHtml(data.whois) + '</pre>';
            return html;
        },
        'ipv6_whois': function(data) {
            return resultRenderers['ip_whois'](data);
        },
        'ipv4_ipv6_converter': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Direction:</span><span class="result-value">' + escapeHtml(data.direction) + '</span></div>';
            if (data.ipv4) html += '<div class="result-row"><span class="result-label">IPv4:</span><span class="result-value"><code>' + escapeHtml(data.ipv4) + '</code></span></div>';
            if (data.ipv6) html += '<div class="result-row"><span class="result-label">IPv6:</span><span class="result-value"><code>' + escapeHtml(data.ipv6) + '</code></span></div>';
            return html;
        },
        'ipv6_generator': function(data) {
            var html = '<div class="result-row"><span class="result-label">Generated:</span><span class="result-value">' + data.count + ' addresses</span></div>';
            if (data.addresses && data.addresses.length) {
                html += '<ul class="mt-3">';
                data.addresses.forEach(function(a) { html += '<li><code>' + escapeHtml(a) + '</code></li>'; });
                html += '</ul>';
            }
            return html;
        },
        'ipv6_cidr': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">IPv6:</span><span class="result-value">' + escapeHtml(data.ipv6) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Prefix:</span><span class="result-value">/' + data.prefix + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Total Addresses:</span><span class="result-value">' + escapeHtml(data.total_addresses) + '</span></div>';
            return html;
        },
        'ipv6_compress': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Original:</span><span class="result-value"><code>' + escapeHtml(data.original) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Result:</span><span class="result-value"><code>' + escapeHtml(data.compressed || data.expanded) + '</code></span></div>';
            return html;
        },
        'subnet_calculator': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">CIDR:</span><span class="result-value"><code>' + escapeHtml(data.cidr) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Subnet Mask:</span><span class="result-value"><code>' + escapeHtml(data.subnet_mask) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Wildcard:</span><span class="result-value"><code>' + escapeHtml(data.wildcard) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Network:</span><span class="result-value"><code>' + escapeHtml(data.network) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Broadcast:</span><span class="result-value"><code>' + escapeHtml(data.broadcast) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">First Usable:</span><span class="result-value"><code>' + escapeHtml(data.first_usable) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Last Usable:</span><span class="result-value"><code>' + escapeHtml(data.last_usable) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Total Hosts:</span><span class="result-value">' + data.total_hosts + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Usable Hosts:</span><span class="result-value">' + data.usable_hosts + '</span></div>';
            return html;
        },
        'isp_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">IP:</span><span class="result-value">' + escapeHtml(data.ip) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">ISP:</span><span class="result-value">' + escapeHtml(data.isp) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Organization:</span><span class="result-value">' + escapeHtml(data.organization) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Country:</span><span class="result-value">' + escapeHtml(data.country) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">City:</span><span class="result-value">' + escapeHtml(data.city) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">ASN:</span><span class="result-value">' + escapeHtml(data.asn) + '</span></div>';
            return html;
        },
        'domain_to_ip': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">IPv4:</span><span class="result-value">' + (data.ipv4 ? '<code>' + escapeHtml(data.ipv4) + '</code>' : '<span class="CloudHost247-status-fail">Not found</span>') + '</span></div>';
            html += '<div class="result-row"><span class="result-label">IPv6:</span><span class="result-value">' + (data.ipv6 ? '<code>' + escapeHtml(data.ipv6) + '</code>' : '<span class="CloudHost247-status-fail">Not found</span>') + '</span></div>';
            return html;
        },

        // Developer Tools renderers
        'http_headers': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">URL:</span><span class="result-value">' + escapeHtml(data.url) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">HTTP Code:</span><span class="result-value">' + data.http_code + '</span></div>';
            if (data.headers && data.headers.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Header</th><th>Value</th></tr></thead><tbody>';
                data.headers.forEach(function(h) {
                    if (h.status) {
                        html += '<tr><td colspan="2"><strong>' + escapeHtml(h.status) + '</strong></td></tr>';
                    } else {
                        html += '<tr><td>' + escapeHtml(h.name) + '</td><td>' + escapeHtml(h.value) + '</td></tr>';
                    }
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'server_os_detector': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">URL:</span><span class="result-value">' + escapeHtml(data.url) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Server:</span><span class="result-value">' + escapeHtml(data.server) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">OS Guess:</span><span class="result-value">' + escapeHtml(data.os_guess) + '</span></div>';
            return html;
        },
        'md5_base64': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Type:</span><span class="result-value">' + escapeHtml(data.type) + '</span></div>';
            html += '<h5 class="mt-3">Result</h5><pre><code>' + escapeHtml(data.hash || data.base64 || data.decoded || '') + '</code></pre>';
            return html;
        },
        'multi_url_opener': function(data) {
            var html = '<div class="result-row"><span class="result-label">Valid URLs:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.urls && data.urls.length) {
                html += '<ul class="mt-3">';
                data.urls.forEach(function(u) {
                    html += '<li><a href="' + escapeHtml(u) + '" target="_blank">' + escapeHtml(u) + ' <i class="fas fa-external-link-alt"></i></a></li>';
                });
                html += '</ul>';
                // Auto-open first few
                data.urls.slice(0, 5).forEach(function(u) { window.open(u, '_blank'); });
            }
            return html;
        },
        'smtp_test': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Host:</span><span class="result-value">' + escapeHtml(data.host) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Port:</span><span class="result-value">' + data.port + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Reachable:</span><span class="result-value">' + (data.reachable ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.banner) html += '<div class="result-row"><span class="result-label">Banner:</span><span class="result-value"><code>' + escapeHtml(data.banner) + '</code></span></div>';
            return html;
        },
        'htaccess_generator': function(data) {
            var html = '<h5>RewriteRule</h5><pre><code>' + escapeHtml(data.rewrite_rule) + '</code></pre>';
            html += '<h5 class="mt-3">Redirect Directive</h5><pre><code>' + escapeHtml(data.redirect_directive) + '</code></pre>';
            return html;
        },
        'url_rewrite': function(data) {
            return resultRenderers['htaccess_generator'](data);
        },
        'broken_link_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Checked:</span><span class="result-value">' + data.checked + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Broken:</span><span class="result-value">' + (data.broken ? '<span class="CloudHost247-status-fail">' + data.broken + '</span>' : '<span class="CloudHost247-status-pass">0</span>') + '</span></div>';
            if (data.links && data.links.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>URL</th><th>Status</th></tr></thead><tbody>';
                data.links.forEach(function(l) {
                    html += '<tr><td>' + escapeHtml(l.url) + '</td><td>' + (l.ok ? '<span class="CloudHost247-status-pass">' + l.status + '</span>' : '<span class="CloudHost247-status-fail">' + l.status + '</span>') + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'open_graph': function(data) {
            var html = '<h5>Generated Tags</h5><pre><code>' + escapeHtml(data.tags) + '</code></pre>';
            html += '<h5 class="mt-3">Preview</h5><div class="serp-preview">' + (data.preview_html || '') + '</div>';
            return html;
        },
        'raid_calculator': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">RAID Level:</span><span class="result-value">' + data.raid_level + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Drives:</span><span class="result-value">' + data.drives + ' x ' + data.drive_size_gb + ' GB</span></div>';
            html += '<div class="result-row"><span class="result-label">Usable:</span><span class="result-value"><strong>' + data.usable_capacity_gb + ' GB</strong></span></div>';
            html += '<div class="result-row"><span class="result-label">Fault Tolerance:</span><span class="result-value">' + data.fault_tolerance + ' drive(s)</span></div>';
            html += '<div class="result-row"><span class="result-label">Efficiency:</span><span class="result-value">' + data.efficiency + '%</span></div>';
            return html;
        },
        'binary_text': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Mode:</span><span class="result-value">' + escapeHtml(data.mode) + '</span></div>';
            html += '<h5 class="mt-3">Result</h5><pre><code>' + escapeHtml(data.output) + '</code></pre>';
            return html;
        },
        'json_formatter': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<h5>Formatted JSON</h5><pre><code>' + escapeHtml(data.formatted || data.tree || '') + '</code></pre>';
            return html;
        },

        // Designer Tools
        'rgb_to_pantone': function(data) {
            var html = '<div class="result-row"><span class="result-label">Input:</span><span class="result-value">' + escapeHtml(data.input) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">HEX:</span><span class="result-value"><code>' + escapeHtml(data.hex) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Pantone:</span><span class="result-value"><strong>' + escapeHtml(data.pantone) + '</strong></span></div>';
            if (data.hex) html += '<div class="mt-3"><div style="width:100px;height:100px;border-radius:8px;background:' + escapeHtml(data.hex) + ';display:inline-block;border:1px solid #ddd;"></div></div>';
            return html;
        },
        'hex_to_pantone': function(data) {
            return resultRenderers['rgb_to_pantone'](data);
        },
        'cmyk_to_pantone': function(data) {
            return resultRenderers['rgb_to_pantone'](data);
        },
        'hsv_to_pantone': function(data) {
            return resultRenderers['rgb_to_pantone'](data);
        },

        // Webmaster Tools
        'link_analyzer': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Total Links:</span><span class="result-value">' + data.total + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Internal:</span><span class="result-value">' + data.internal + '</span></div>';
            html += '<div class="result-row"><span class="result-label">External:</span><span class="result-value">' + data.external + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Other:</span><span class="result-value">' + data.other + '</span></div>';
            return html;
        },
        'user_agent': function(data) {
            var html = '<div class="result-row"><span class="result-label">User Agent:</span><span class="result-value"><code>' + escapeHtml(data.user_agent) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">Browser:</span><span class="result-value">' + escapeHtml(data.browser) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">OS:</span><span class="result-value">' + escapeHtml(data.os) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Mobile:</span><span class="result-value">' + (data.is_mobile ? 'Yes' : 'No') + '</span></div>';
            return html;
        },
        'pagerank': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Score:</span><span class="result-value"><strong>' + data.score + '/10</strong></span></div>';
            html += '<div class="alert alert-warning mt-3">' + escapeHtml(data.note) + '</div>';
            return html;
        },
        'punycode': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Original:</span><span class="result-value">' + escapeHtml(data.original) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Result:</span><span class="result-value"><code>' + escapeHtml(data.punycode || data.unicode) + '</code></span></div>';
            return html;
        },
        'serp_preview': function(data) {
            var html = '<div class="result-row"><span class="result-label">Title Length:</span><span class="result-value">' + data.title_length + ' chars (' + data.title_status + ')</span></div>';
            html += '<div class="result-row"><span class="result-label">Desc Length:</span><span class="result-value">' + data.description_length + ' chars (' + data.description_status + ')</span></div>';
            html += '<h5 class="mt-3">Preview</h5><div class="serp-preview"><div class="serp-url">' + escapeHtml(data.url) + '</div><div class="serp-title">' + escapeHtml(data.title) + '</div><div class="serp-desc">' + escapeHtml(data.description) + '</div></div>';
            return html;
        },
        'robots_generator': function(data) {
            var html = '<h5>robots.txt</h5><pre><code>' + escapeHtml(data.robots_txt) + '</code></pre>';
            return html;
        },

        // Network Tools
        'port_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Host:</span><span class="result-value">' + escapeHtml(data.host) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Port:</span><span class="result-value">' + data.port + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Status:</span><span class="result-value">' + (data.open ? '<span class="CloudHost247-status-pass">Open</span>' : '<span class="CloudHost247-status-fail">Closed</span>') + '</span></div>';
            return html;
        },
        'mac_lookup': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">MAC:</span><span class="result-value"><code>' + escapeHtml(data.mac) + '</code></span></div>';
            html += '<div class="result-row"><span class="result-label">OUI:</span><span class="result-value">' + escapeHtml(data.oui) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Vendor:</span><span class="result-value"><strong>' + escapeHtml(data.vendor) + '</strong></span></div>';
            return html;
        },
        'mac_generator': function(data) {
            var html = '<div class="result-row"><span class="result-label">Format:</span><span class="result-value">' + escapeHtml(data.format) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Generated:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.addresses && data.addresses.length) {
                html += '<ul class="mt-3">';
                data.addresses.forEach(function(a) { html += '<li><code>' + escapeHtml(a) + '</code></li>'; });
                html += '</ul>';
            }
            return html;
        },
        'asn_lookup': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">ASN:</span><span class="result-value">AS' + data.asn + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Name:</span><span class="result-value">' + escapeHtml(data.name) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Description:</span><span class="result-value">' + escapeHtml(data.description) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Country:</span><span class="result-value">' + escapeHtml(data.country) + '</span></div>';
            if (data.website && data.website !== 'N/A') html += '<div class="result-row"><span class="result-label">Website:</span><span class="result-value"><a href="' + escapeHtml(data.website) + '" target="_blank">' + escapeHtml(data.website) + '</a></span></div>';
            return html;
        },

        // Security Tools
        'ssl_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">SSL:</span><span class="result-value">' + (data.ssl_enabled ? '<span class="CloudHost247-status-pass">Enabled</span>' : '<span class="CloudHost247-status-fail">Not Found</span>') + '</span></div>';
            if (data.ssl_enabled) {
                html += '<div class="result-row"><span class="result-label">Issuer:</span><span class="result-value">' + escapeHtml(data.issuer) + '</span></div>';
                html += '<div class="result-row"><span class="result-label">Subject:</span><span class="result-value">' + escapeHtml(data.subject) + '</span></div>';
                html += '<div class="result-row"><span class="result-label">Valid From:</span><span class="result-value">' + escapeHtml(data.valid_from) + '</span></div>';
                html += '<div class="result-row"><span class="result-label">Valid To:</span><span class="result-value">' + escapeHtml(data.valid_to) + '</span></div>';
                html += '<div class="result-row"><span class="result-label">Days Remaining:</span><span class="result-value">' + (data.expired ? '<span class="CloudHost247-status-fail">Expired</span>' : (data.expiring_soon ? '<span class="CloudHost247-status-warning">' + data.days_remaining + ' (Expiring Soon!)</span>' : '<span class="CloudHost247-status-pass">' + data.days_remaining + '</span>')) + '</span></div>';
                html += '<div class="result-row"><span class="result-label">Serial:</span><span class="result-value"><code>' + escapeHtml(data.serial_number) + '</code></span></div>';
            }
            return html;
        },
        'password_encryptor': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Algorithm:</span><span class="result-value">' + escapeHtml(data.algorithm) + '</span></div>';
            html += '<h5 class="mt-3">Hash</h5><pre><code>' + escapeHtml(data.hash) + '</code></pre>';
            return html;
        },
        'password_generator': function(data) {
            var html = '<div class="result-row"><span class="result-label">Length:</span><span class="result-value">' + data.length + '</span></div>';
            if (data.passwords && data.passwords.length) {
                html += '<h5 class="mt-3">Passwords</h5><ul>';
                data.passwords.forEach(function(p) { html += '<li><code>' + escapeHtml(p) + '</code> <button class="btn btn-sm btn-outline-secondary" onclick="CloudHost247CopyText(this, \'' + escapeHtml(p) + '\')"><i class="fas fa-copy"></i></button></li>'; });
                html += '</ul>';
            }
            return html;
        },
        'password_strength': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var scoreClass = data.score < 30 ? 'CloudHost247-status-fail' : (data.score < 60 ? 'CloudHost247-status-warning' : 'CloudHost247-status-pass');
            var html = '<div class="result-row"><span class="result-label">Score:</span><span class="result-value ' + scoreClass + '"><strong>' + data.score + '/100 - ' + escapeHtml(data.strength) + '</strong></span></div>';
            html += '<div class="result-row"><span class="result-label">Length:</span><span class="result-value">' + data.length + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Est. Crack Time:</span><span class="result-value">' + escapeHtml(data.estimated_crack_time) + '</span></div>';
            if (data.feedback && data.feedback.length) {
                html += '<h5 class="mt-3">Feedback</h5><ul>';
                data.feedback.forEach(function(f) { html += '<li class="CloudHost247-status-warning">' + escapeHtml(f) + '</li>'; });
                html += '</ul>';
            }
            return html;
        },

        // Productivity Tools
        'qr_generator': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Text:</span><span class="result-value">' + escapeHtml(data.text) + '</span></div>';
            html += '<div class="CloudHost247-qr-result mt-3"><img src="' + escapeHtml(data.qr_url) + '" alt="QR Code"></div>';
            html += '<a href="' + escapeHtml(data.qr_url) + '" target="_blank" class="btn btn-outline-primary mt-2" download><i class="fas fa-download"></i> Download QR</a>';
            return html;
        },
        'qr_scanner': function(data) {
            return '<div class="alert alert-info">' + escapeHtml(data.message) + '</div>';
        },
        'lorem_ipsum': function(data) {
            var html = '<div class="result-row"><span class="result-label">Type:</span><span class="result-value">' + escapeHtml(data.type) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Count:</span><span class="result-value">' + data.count + '</span></div>';
            if (data.content && data.content.length) {
                html += '<div class="mt-3">';
                data.content.forEach(function(c) { html += '<p>' + escapeHtml(c) + '</p>'; });
                html += '</div>';
            }
            return html;
        },
        'time_calculator': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Start:</span><span class="result-value">' + escapeHtml(data.start) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">End:</span><span class="result-value">' + escapeHtml(data.end) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Difference:</span><span class="result-value"><strong>' + data.difference + '</strong></span></div>';
            if (data.all_units) {
                html += '<h5 class="mt-3">All Units</h5>';
                Object.keys(data.all_units).forEach(function(k) {
                    html += '<div class="result-row"><span class="result-label">' + escapeHtml(k) + ':</span><span class="result-value">' + data.all_units[k] + '</span></div>';
                });
            }
            return html;
        },
        'bin_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">BIN:</span><span class="result-value">' + escapeHtml(data.bin) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Network:</span><span class="result-value">' + escapeHtml(data.network) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Type:</span><span class="result-value">' + escapeHtml(data.type) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Bank:</span><span class="result-value">' + escapeHtml(data.bank) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Country:</span><span class="result-value">' + escapeHtml(data.country) + '</span></div>';
            return html;
        },
        'credit_card_validator': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Card Type:</span><span class="result-value">' + escapeHtml(data.card_type) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Valid:</span><span class="result-value">' + (data.valid ? '<span class="CloudHost247-status-pass">Yes (Luhn passed)</span>' : '<span class="CloudHost247-status-fail">No (Luhn failed)</span>') + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Length:</span><span class="result-value">' + data.length + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Masked:</span><span class="result-value"><code>' + escapeHtml(data.number_masked) + '</code></span></div>';
            return html;
        },
        'reverse_image_search': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Image:</span><span class="result-value">' + escapeHtml(data.image_url) + '</span></div>';
            if (data.engines && data.engines.length) {
                html += '<h5 class="mt-3">Search Engines</h5><ul>';
                data.engines.forEach(function(e) {
                    html += '<li><a href="' + escapeHtml(e.url) + '" target="_blank">' + escapeHtml(e.name) + ' <i class="fas fa-external-link-alt"></i></a></li>';
                });
                html += '</ul>';
            }
            return html;
        },
        'username_checker': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Username:</span><span class="result-value">' + escapeHtml(data.username) + '</span></div>';
            html += '<div class="alert alert-info">' + escapeHtml(data.note) + '</div>';
            if (data.platforms && data.platforms.length) {
                html += '<table class="CloudHost247-dns-table mt-3"><thead><tr><th>Platform</th><th>Availability</th></tr></thead><tbody>';
                data.platforms.forEach(function(p) {
                    html += '<tr><td>' + escapeHtml(p.name) + '</td><td>' + (p.available ? '<span class="CloudHost247-status-pass">Available</span>' : '<span class="CloudHost247-status-fail">Taken</span>') + '</td></tr>';
                });
                html += '</tbody></table>';
            }
            return html;
        },
        'online_notepad': function(data) {
            var html = '<div class="result-row"><span class="result-label">Saved:</span><span class="result-value">' + (data.saved ? 'Yes' : 'No') + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Words:</span><span class="result-value">' + data.words + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Characters:</span><span class="result-value">' + data.length + '</span></div>';
            return html;
        },
        'small_text': function(data) {
            var html = '<h5>Small Caps</h5><pre><code>' + escapeHtml(data.small_caps) + '</code></pre>';
            html += '<h5 class="mt-3">Tiny</h5><pre><code>' + escapeHtml(data.tiny) + '</code></pre>';
            html += '<h5 class="mt-3">Superscript</h5><pre><code>' + escapeHtml(data.superscript) + '</code></pre>';
            html += '<h5 class="mt-3">Subscript</h5><pre><code>' + escapeHtml(data.subscript) + '</code></pre>';
            return html;
        },
        'word_counter': function(data) {
            var html = '<div class="result-row"><span class="result-label">Characters:</span><span class="result-value">' + data.characters + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Characters (no spaces):</span><span class="result-value">' + data.characters_no_spaces + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Words:</span><span class="result-value"><strong>' + data.words + '</strong></span></div>';
            html += '<div class="result-row"><span class="result-label">Sentences:</span><span class="result-value">' + data.sentences + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Paragraphs:</span><span class="result-value">' + data.paragraphs + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Lines:</span><span class="result-value">' + data.lines + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Avg Word Length:</span><span class="result-value">' + data.average_word_length + '</span></div>';
            return html;
        },
        'domain_availability': function(data) {
            if (data.error) return '<div class="alert alert-danger">' + escapeHtml(data.error) + '</div>';
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">TLD:</span><span class="result-value">.' + escapeHtml(data.tld) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Available:</span><span class="result-value">' + (data.available ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No (Taken)</span>') + '</span></div>';
            return html;
        },
        'rot13': function(data) {
            var html = '<h5>Result</h5><pre><code>' + escapeHtml(data.result) + '</code></pre>';
            return html;
        },
        'morse_code': function(data) {
            var html = '<h5>Result</h5><pre><code>' + escapeHtml(data.morse || data.decoded) + '</code></pre>';
            return html;
        },
        'bimi_checker': function(data) {
            var html = '<div class="result-row"><span class="result-label">Domain:</span><span class="result-value">' + escapeHtml(data.domain) + '</span></div>';
            html += '<div class="result-row"><span class="result-label">Found:</span><span class="result-value">' + (data.found ? '<span class="CloudHost247-status-pass">Yes</span>' : '<span class="CloudHost247-status-fail">No</span>') + '</span></div>';
            if (data.record) html += '<pre class="mt-3"><code>' + escapeHtml(data.record) + '</code></pre>';
            return html;
        },
        'image_to_text': function(data) {
            var html = '<div class="alert alert-info">' + escapeHtml(data.note) + '</div>';
            html += '<p>' + escapeHtml(data.instructions) + '</p>';
            return html;
        },

        // Gaming Tools
        'minecraft_colors': function(data) {
            var html = '<div class="CloudHost247-mc-colors">';
            if (data.colors && data.colors.length) {
                data.colors.forEach(function(c) {
                    html += '<div class="CloudHost247-mc-color-btn" style="background:' + escapeHtml(c.hex) + ';" title="' + escapeHtml(c.code) + ' ' + escapeHtml(c.name) + '" onclick="CloudHost247InsertMCCode(\'' + c.code + '\')"></div>';
                });
            }
            html += '</div>';
            if (data.preview_html) {
                html += '<h5>Preview</h5><div class="p-3 bg-dark text-white rounded">' + data.preview_html + '</div>';
            }
            return html;
        }
    };

    // Helper functions
    function escapeHtml(text) {
        if (!text) return '';
        var div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function renderField(field) {
        var html = '<div class="form-group">';
        if (field.type !== 'hidden') {
            html += '<label for="' + field.name + '">' + escapeHtml(field.label) + (field.required ? ' <span class="text-danger">*</span>' : '') + '</label>';
        }
        switch (field.type) {
            case 'textarea':
                html += '<textarea name="' + field.name + '" id="' + field.name + '" class="form-control" rows="' + (field.rows || 4) + '" placeholder="' + escapeHtml(field.placeholder || '') + '" ' + (field.required ? 'required' : '') + '>' + escapeHtml(field.value || '') + '</textarea>';
                break;
            case 'select':
                html += '<select name="' + field.name + '" id="' + field.name + '" class="form-control">';
                (field.options || []).forEach(function(opt) {
                    html += '<option value="' + escapeHtml(opt) + '" ' + (field.value === opt ? 'selected' : '') + '>' + escapeHtml(opt) + '</option>';
                });
                html += '</select>';
                break;
            case 'checkbox':
                html += '<div class="custom-control custom-checkbox">';
                html += '<input type="checkbox" name="' + field.name + '" id="' + field.name + '" class="custom-control-input" ' + (field.checked ? 'checked' : '') + '>';
                html += '<label class="custom-control-label" for="' + field.name + '">' + escapeHtml(field.label) + '</label>';
                html += '</div>';
                break;
            case 'number':
                html += '<input type="number" name="' + field.name + '" id="' + field.name + '" class="form-control" value="' + escapeHtml(field.value || '') + '" placeholder="' + escapeHtml(field.placeholder || '') + '" ' + (field.min !== undefined ? 'min="' + field.min + '"' : '') + ' ' + (field.max !== undefined ? 'max="' + field.max + '"' : '') + ' ' + (field.required ? 'required' : '') + '>';
                break;
            case 'datetime-local':
                html += '<input type="datetime-local" name="' + field.name + '" id="' + field.name + '" class="form-control" ' + (field.required ? 'required' : '') + '>';
                break;
            case 'file':
                html += '<input type="file" name="' + field.name + '" id="' + field.name + '" class="form-control-file" ' + (field.accept ? 'accept="' + field.accept + '"' : '') + '>';
                break;
            default:
                html += '<input type="' + (field.type || 'text') + '" name="' + field.name + '" id="' + field.name + '" class="form-control" value="' + escapeHtml(field.value || '') + '" placeholder="' + escapeHtml(field.placeholder || '') + '" ' + (field.required ? 'required' : '') + '>';
        }
        html += '</div>';
        return html;
    }

    // Global functions exposed to window
    window.CloudHost247RenderToolForm = function(toolId, category) {
        var container = document.getElementById('CloudHost247-tool-fields');
        if (!container) return;

        var fields = toolFields[toolId] || [];
        var html = '';

        if (fields.length === 0) {
            html = '<div class="alert alert-info">This tool requires no input. Click "Run Tool" to execute.</div>';
        } else {
            fields.forEach(function(field) {
                html += renderField(field);
            });
        }

        container.innerHTML = html;

        // Bind form submission
        var form = document.getElementById('CloudHost247-tool-form');
        if (form) {
            form.addEventListener('submit', function(e) {
                e.preventDefault();
                CloudHost247SubmitTool(form, toolId);
            });
        }
    };

    window.CloudHost247SubmitTool = function(form, toolId) {
        var loading = document.getElementById('CloudHost247-tool-loading');
        var result = document.getElementById('CloudHost247-tool-result');
        var resultContent = document.getElementById('CloudHost247-result-content');
        var errorDiv = document.getElementById('CloudHost247-tool-error');

        if (loading) loading.style.display = 'block';
        if (result) result.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';

        var formData = new FormData(form);
        var xhr = new XMLHttpRequest();
        xhr.open('POST', window.location.href.split('?')[0] + '?m=CloudHost247_tools&action=ajax', true);
        xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

        xhr.onreadystatechange = function() {
            if (xhr.readyState === 4) {
                if (loading) loading.style.display = 'none';

                try {
                    var response = JSON.parse(xhr.responseText);
                    if (response.success) {
                        var renderer = resultRenderers[toolId];
                        if (renderer) {
                            resultContent.innerHTML = renderer(response.data);
                        } else {
                            resultContent.innerHTML = '<pre><code>' + escapeHtml(JSON.stringify(response.data, null, 2)) + '</code></pre>';
                        }
                        if (result) result.style.display = 'block';
                    } else {
                        if (errorDiv) {
                            errorDiv.textContent = response.message || 'An error occurred';
                            errorDiv.style.display = 'block';
                        }
                    }
                } catch (e) {
                    if (errorDiv) {
                        errorDiv.textContent = 'Invalid server response';
                        errorDiv.style.display = 'block';
                    }
                }
            }
        };

        xhr.send(formData);
    };

    window.CloudHost247ResetTool = function() {
        var form = document.getElementById('CloudHost247-tool-form');
        var result = document.getElementById('CloudHost247-tool-result');
        var errorDiv = document.getElementById('CloudHost247-tool-error');
        if (form) form.reset();
        if (result) result.style.display = 'none';
        if (errorDiv) errorDiv.style.display = 'none';
    };

    window.CloudHost247CopyResult = function() {
        var content = document.getElementById('CloudHost247-result-content');
        if (!content) return;
        var text = content.innerText;
        var textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);

        var btn = document.querySelector('.CloudHost247-result-header button');
        if (btn) {
            var original = btn.innerHTML;
            btn.innerHTML = '<i class="fas fa-check"></i> Copied!';
            btn.classList.add('CloudHost247-copy-feedback');
            setTimeout(function() {
                btn.innerHTML = original;
                btn.classList.remove('CloudHost247-copy-feedback');
            }, 2000);
        }
    };

    window.CloudHost247CopyText = function(btn, text) {
        var textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
        var original = btn.innerHTML;
        btn.innerHTML = '<i class="fas fa-check"></i>';
        setTimeout(function() { btn.innerHTML = original; }, 1500);
    };

    window.CloudHost247InsertMCCode = function(code) {
        var textarea = document.querySelector('textarea[name="text"]');
        if (textarea) {
            textarea.value += code;
        }
    };
})();
