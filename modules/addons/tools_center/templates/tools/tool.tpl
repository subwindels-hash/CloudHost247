{* Tools Center - Individual Tool Template *}

<div class="tools-center-container">
    <!-- Breadcrumb -->
    <nav class="tc-breadcrumb">
        <a href="index.php?m=tools_center"><i class="fa fa-home"></i> Tools Center</a>
        <i class="fa fa-angle-right"></i>
        {if isset($toolCategories[$currentCategory])}
        <a href="index.php?m=tools_center&cat={$currentCategory}">{$toolCategories[$currentCategory].name}</a>
        {/if}
        <i class="fa fa-angle-right"></i>
        <span id="currentToolName">Tool</span>
    </nav>

    <!-- Tool Interface -->
    <div class="tc-tool-interface">
        <div class="tc-tool-form" id="toolForm">
            <!-- Form will be dynamically generated -->
            <div class="tc-loading">
                <i class="fa fa-spinner fa-spin"></i> Loading tool...
            </div>
        </div>

        <!-- Results Panel -->
        <div class="tc-tool-results" id="toolResults" style="display: none;">
            <div class="tc-results-header">
                <h3><i class="fa fa-chart-bar"></i> Results</h3>
                <button class="btn btn-default btn-sm" onclick="clearResults()">
                    <i class="fa fa-trash"></i> Clear
                </button>
            </div>
            <div class="tc-results-content" id="resultsContent">
                <!-- Results will appear here -->
            </div>
        </div>
    </div>
</div>

<script>
// Tool definitions with their input fields
var toolDefinitions = {
    // DNS Tools
    spfChecker: {
        title: 'SPF Record Checker',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dnsValidation: {
        title: 'Domain DNS Validation',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    reverseIpLookup: {
        title: 'Reverse IP Lookup',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true}
        ]
    },
    dnsLookup: {
        title: 'DNS Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true},
            {name: 'type', label: 'Record Type', type: 'select', options: ['ALL', 'A', 'AAAA', 'MX', 'NS', 'SOA', 'TXT', 'CNAME', 'SRV', 'CAA'], value: 'ALL'}
        ]
    },
    cnameLookup: {
        title: 'CNAME Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'www.example.com', required: true}
        ]
    },
    nsLookup: {
        title: 'NS Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    mxLookup: {
        title: 'MX Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dnsPropagation: {
        title: 'DNS Propagation Checker',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true},
            {name: 'type', label: 'Record Type', type: 'select', options: ['A', 'AAAA', 'MX', 'NS', 'TXT'], value: 'A'}
        ]
    },
    dmarcValidation: {
        title: 'DMARC Validation',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dnsHealth: {
        title: 'DNS Health Checker',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dmarcGenerator: {
        title: 'DMARC Record Generator',
        fields: [
            {name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com', required: true},
            {name: 'policy', label: 'Policy', type: 'select', options: ['none', 'quarantine', 'reject'], value: 'none'},
            {name: 'rua', label: 'Report Email', type: 'text', placeholder: 'dmarc-reports@example.com', value: ''},
            {name: 'pct', label: 'Percentage', type: 'text', placeholder: '100', value: '100'}
        ]
    },
    dnskeyLookup: {
        title: 'DNSKEY Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dsLookup: {
        title: 'DS Lookup',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    dkimChecker: {
        title: 'DKIM Checker',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'example.com', required: true},
            {name: 'selector', label: 'Selector (optional)', type: 'text', placeholder: 'default', value: 'default'}
        ]
    },
    // IP Tools
    ping: {
        title: 'Ping Test',
        fields: [
            {name: 'host', label: 'Host or IP', type: 'text', placeholder: '8.8.8.8 or google.com', required: true},
            {name: 'count', label: 'Packet Count', type: 'number', value: '4', min: 1, max: 10}
        ]
    },
    whatIsMyIP: {
        title: 'What is My IP',
        fields: [] // No input needed
    },
    traceroute: {
        title: 'Traceroute',
        fields: [
            {name: 'host', label: 'Host or IP', type: 'text', placeholder: 'google.com', required: true},
            {name: 'max_hops', label: 'Max Hops', type: 'number', value: '30', min: 1, max: 50}
        ]
    },
    ipLocation: {
        title: 'IP Location Lookup',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8 (leave empty for your IP)', value: ''}
        ]
    },
    emailHeaderAnalyzer: {
        title: 'Email Header Analyzer',
        fields: [
            {name: 'headers', label: 'Email Headers', type: 'textarea', placeholder: 'Paste full email headers here...', rows: 10, required: true}
        ]
    },
    ipBlacklist: {
        title: 'IP Blacklist Checker',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true}
        ]
    },
    ipToDecimal: {
        title: 'IP to Decimal Converter',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '192.168.1.1', required: true}
        ]
    },
    resolveIPtoHostname: {
        title: 'Resolve IP to Hostname',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true}
        ]
    },
    ipWhois: {
        title: 'IP WHOIS Lookup',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8', required: true}
        ]
    },
    ipv6Whois: {
        title: 'IPv6 WHOIS Lookup',
        fields: [
            {name: 'ip', label: 'IPv6 Address', type: 'text', placeholder: '2001:4860:4860::8888', required: true}
        ]
    },
    ipv4ToIPv6: {
        title: 'IPv4 to IPv6 Converter',
        fields: [
            {name: 'ip', label: 'IPv4 Address', type: 'text', placeholder: '192.168.1.1', required: true}
        ]
    },
    localIPv6Generator: {
        title: 'Local IPv6 Generator',
        fields: [
            {name: 'count', label: 'Number of Addresses', type: 'number', value: '5', min: 1, max: 50}
        ]
    },
    ipv6CIDRtoRange: {
        title: 'IPv6 CIDR to Range',
        fields: [
            {name: 'cidr', label: 'IPv6 CIDR', type: 'text', placeholder: '2001:db8::/32', required: true}
        ]
    },
    ipv6RangeToCIDR: {
        title: 'IPv6 Range to CIDR',
        fields: [
            {name: 'start', label: 'Start IPv6', type: 'text', placeholder: '2001:db8::', required: true},
            {name: 'end', label: 'End IPv6', type: 'text', placeholder: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff', required: true}
        ]
    },
    ipv6Compatibility: {
        title: 'IPv6 Compatibility',
        fields: [
            {name: 'host', label: 'Hostname', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    ipv6Compression: {
        title: 'IPv6 Compression',
        fields: [
            {name: 'ip', label: 'IPv6 Address', type: 'text', placeholder: '2001:0db8:0000:0000:0000:0000:0000:0001', required: true}
        ]
    },
    ipv6Expand: {
        title: 'IPv6 Expand',
        fields: [
            {name: 'ip', label: 'IPv6 Address', type: 'text', placeholder: '2001:db8::1', required: true}
        ]
    },
    subnetCalculator: {
        title: 'Subnet Calculator',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '192.168.1.1', required: true},
            {name: 'cidr', label: 'CIDR (optional)', type: 'text', placeholder: '24'},
            {name: 'mask', label: 'Subnet Mask (optional)', type: 'text', placeholder: '255.255.255.0'}
        ]
    },
    ipv6ToIPv4: {
        title: 'IPv6 to IPv4',
        fields: [
            {name: 'ip', label: 'IPv6 Address', type: 'text', placeholder: '::ffff:192.0.2.1', required: true}
        ]
    },
    ispChecker: {
        title: 'ISP Checker',
        fields: [
            {name: 'ip', label: 'IP Address', type: 'text', placeholder: '8.8.8.8 (leave empty for your IP)', value: ''}
        ]
    },
    websiteToIP: {
        title: 'Website to IP',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'google.com', required: true}
        ]
    },
    // Search
    domainSearch: {
        title: 'Domain Name Search',
        fields: [
            {name: 'domain', label: 'Domain Name', type: 'text', placeholder: 'mydomain', required: true}
        ]
    },
    // Developer
    httpHeadersCheck: {
        title: 'HTTP Headers Check',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'https://example.com', required: true}
        ]
    },
    websiteOSChecker: {
        title: 'Website OS Checker',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'https://example.com', required: true}
        ]
    },
    hashGenerator: {
        title: 'MD5 & Hash Generator',
        fields: [
            {name: 'text', label: 'Text to Hash', type: 'textarea', placeholder: 'Enter text...', rows: 4, required: true}
        ]
    },
    multiUrlOpener: {
        title: 'Multi URL Opener',
        fields: [
            {name: 'urls', label: 'URLs (one per line)', type: 'textarea', placeholder: 'https://example.com\nhttps://google.com', rows: 6, required: true}
        ]
    },
    smtpTest: {
        title: 'SMTP Test',
        fields: [
            {name: 'host', label: 'SMTP Host', type: 'text', placeholder: 'smtp.gmail.com', required: true},
            {name: 'port', label: 'Port (optional)', type: 'number', value: '25'}
        ]
    },
    htaccessRedirectGenerator: {
        title: 'htaccess Redirect Generator',
        fields: [
            {name: 'type', label: 'Redirect Type', type: 'select', options: ['301', '302', 'rewrite'], value: '301'},
            {name: 'from', label: 'From Path', type: 'text', placeholder: '/old-page'},
            {name: 'to', label: 'To URL', type: 'text', placeholder: '/new-page'},
            {name: 'www', label: 'www Redirect', type: 'select', options: ['', 'www', 'non-www'], value: ''},
            {name: 'https', label: 'Force HTTPS', type: 'select', options: ['', 'force'], value: ''}
        ]
    },
    urlRewriteGenerator: {
        title: 'URL Rewrite Generator',
        fields: [
            {name: 'source', label: 'Source URL', type: 'text', placeholder: '/old-url', required: true},
            {name: 'target', label: 'Target URL', type: 'text', placeholder: '/new-url', required: true},
            {name: 'type', label: 'Server Type', type: 'select', options: ['apache', 'nginx', 'iis'], value: 'apache'}
        ]
    },
    brokenLinksChecker: {
        title: 'Broken Links Checker',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'https://example.com', required: true}
        ]
    },
    openGraphGenerator: {
        title: 'Open Graph Generator',
        fields: [
            {name: 'title', label: 'Title', type: 'text', placeholder: 'Page Title', required: true},
            {name: 'description', label: 'Description', type: 'textarea', placeholder: 'Page description...', rows: 3},
            {name: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/page', required: true},
            {name: 'image', label: 'Image URL', type: 'text', placeholder: 'https://example.com/image.jpg'},
            {name: 'site_name', label: 'Site Name', type: 'text', placeholder: 'My Website'}
        ]
    },
    raidCalculator: {
        title: 'RAID Calculator',
        fields: [
            {name: 'type', label: 'RAID Type', type: 'select', options: ['RAID0', 'RAID1', 'RAID5', 'RAID6', 'RAID10'], value: 'RAID1', required: true},
            {name: 'drives', label: 'Number of Drives', type: 'number', value: '2', min: 2, required: true},
            {name: 'drive_size', label: 'Drive Size', type: 'number', value: '1000', required: true},
            {name: 'drive_unit', label: 'Unit', type: 'select', options: ['GB', 'TB', 'MB'], value: 'GB'}
        ]
    },
    binaryTextConverter: {
        title: 'Binary <-> Text Converter',
        fields: [
            {name: 'text', label: 'Text / Binary', type: 'textarea', placeholder: 'Enter text or binary...', rows: 6, required: true},
            {name: 'mode', label: 'Direction', type: 'select', options: ['auto', 'text_to_binary', 'binary_to_text'], value: 'auto'}
        ]
    },
    jsonTool: {
        title: 'JSON Tool',
        fields: [
            {name: 'json', label: 'JSON Data', type: 'textarea', placeholder: '{\n  \"key\": \"value\"\n}', rows: 10, required: true},
            {name: 'action', label: 'Action', type: 'select', options: ['beautify', 'minify', 'validate'], value: 'beautify'}
        ]
    },
    // Designer
    rgbToPantone: {
        title: 'RGB to Pantone',
        fields: [
            {name: 'r', label: 'Red (0-255)', type: 'number', value: '255', min: 0, max: 255, required: true},
            {name: 'g', label: 'Green (0-255)', type: 'number', value: '0', min: 0, max: 255, required: true},
            {name: 'b', label: 'Blue (0-255)', type: 'number', value: '0', min: 0, max: 255, required: true}
        ]
    },
    hexToPantone: {
        title: 'HEX to Pantone',
        fields: [
            {name: 'hex', label: 'HEX Color', type: 'text', placeholder: '#FF0000', required: true}
        ]
    },
    cmykToPantone: {
        title: 'CMYK to Pantone',
        fields: [
            {name: 'c', label: 'Cyan (0-100)', type: 'number', value: '0', min: 0, max: 100, required: true},
            {name: 'm', label: 'Magenta (0-100)', type: 'number', value: '100', min: 0, max: 100, required: true},
            {name: 'y', label: 'Yellow (0-100)', type: 'number', value: '100', min: 0, max: 100, required: true},
            {name: 'k', label: 'Key/Black (0-100)', type: 'number', value: '0', min: 0, max: 100, required: true}
        ]
    },
    hsvToPantone: {
        title: 'HSV to Pantone',
        fields: [
            {name: 'h', label: 'Hue (0-360)', type: 'number', value: '0', min: 0, max: 360, required: true},
            {name: 's', label: 'Saturation (0-100)', type: 'number', value: '100', min: 0, max: 100, required: true},
            {name: 'v', label: 'Value (0-100)', type: 'number', value: '100', min: 0, max: 100, required: true}
        ]
    },
    // Webmaster
    websiteLinkAnalyzer: {
        title: 'Website Link Analyzer',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'https://example.com', required: true}
        ]
    },
    userAgentChecker: {
        title: 'User Agent Checker',
        fields: [
            {name: 'ua', label: 'User Agent (optional)', type: 'textarea', placeholder: 'Paste user agent string or leave empty for current browser...', rows: 3, value: ''}
        ]
    },
    pageRankChecker: {
        title: 'PageRank Checker',
        fields: [
            {name: 'url', label: 'Website URL', type: 'text', placeholder: 'example.com', required: true}
        ]
    },
    punycodeConverter: {
        title: 'Punycode Converter',
        fields: [
            {name: 'domain', label: 'Domain', type: 'text', placeholder: 'm\u00fcnchen.com or xn--mnchen-3ya.com', required: true},
            {name: 'direction', label: 'Direction', type: 'select', options: ['auto', 'to_punycode', 'to_unicode'], value: 'auto'}
        ]
    },
    serpSimulator: {
        title: 'SERP Simulator',
        fields: [
            {name: 'title', label: 'Page Title', type: 'text', placeholder: 'Your Page Title', required: true},
            {name: 'description', label: 'Meta Description', type: 'textarea', placeholder: 'Page description...', rows: 3},
            {name: 'url', label: 'URL', type: 'text', placeholder: 'https://example.com/page', required: true}
        ]
    },
    robotsGenerator: {
        title: 'Robots.txt Generator',
        fields: [
            {name: 'disallow', label: 'Disallow Paths', type: 'textarea', placeholder: '/admin/\n/cgi-bin/\n/tmp/', rows: 4, value: '/admin/\n/cgi-bin/\n/tmp/\n/private/'},
            {name: 'allow', label: 'Allow Paths', type: 'textarea', placeholder: '/public/\n/assets/', rows: 3},
            {name: 'sitemap', label: 'Sitemap URL', type: 'text', placeholder: 'https://example.com/sitemap.xml'},
            {name: 'crawl_delay', label: 'Crawl Delay (seconds)', type: 'number', value: '0', min: 0}
        ]
    },
    // Network
    portChecker: {
        title: 'Port Checker',
        fields: [
            {name: 'host', label: 'Host or IP', type: 'text', placeholder: 'example.com', required: true},
            {name: 'ports', label: 'Ports (optional)', type: 'text', placeholder: '80,443,8080 or leave empty for common ports'}
        ]
    },
    macLookup: {
        title: 'MAC Address Lookup',
        fields: [
            {name: 'mac', label: 'MAC Address', type: 'text', placeholder: '00:1B:44:11:3A:B7', required: true}
        ]
    },
    macGenerator: {
        title: 'MAC Address Generator',
        fields: [
            {name: 'count', label: 'Count', type: 'number', value: '5', min: 1, max: 50},
            {name: 'format', label: 'Format', type: 'select', options: ['colon', 'dash', 'dot', 'plain', 'cisco'], value: 'colon'}
        ]
    },
    asnWhois: {
        title: 'ASN WHOIS Lookup',
        fields: [
            {name: 'asn', label: 'AS Number', type: 'text', placeholder: 'AS15169 or 15169'},
            {name: 'ip', label: 'OR IP Address', type: 'text', placeholder: '8.8.8.8'}
        ]
    },
    // Security
    sslChecker: {
        title: 'SSL Certificate Checker',
        fields: [
            {name: 'host', label: 'Hostname', type: 'text', placeholder: 'google.com', required: true},
            {name: 'port', label: 'Port', type: 'number', value: '443', min: 1, max: 65535}
        ]
    },
    passwordEncrypt: {
        title: 'Password Encryption',
        fields: [
            {name: 'password', label: 'Password', type: 'text', placeholder: 'Enter password to encrypt', required: true},
            {name: 'algorithm', label: 'Algorithm', type: 'select', options: ['bcrypt', 'argon2', 'sha256', 'sha512'], value: 'bcrypt'}
        ]
    },
    passwordGenerator: {
        title: 'Password Generator',
        fields: [
            {name: 'length', label: 'Length', type: 'number', value: '16', min: 4, max: 128},
            {name: 'count', label: 'Count', type: 'number', value: '5', min: 1, max: 50}
        ]
    },
    passwordStrength: {
        title: 'Password Strength Checker',
        fields: [
            {name: 'password', label: 'Password', type: 'text', placeholder: 'Enter password to check', required: true}
        ]
    },
    // Productivity
    qrGenerator: {
        title: 'QR Code Generator',
        fields: [
            {name: 'data', label: 'Data / URL', type: 'text', placeholder: 'https://example.com', required: true},
            {name: 'size', label: 'Size (px)', type: 'number', value: '300', min: 100, max: 1000},
            {name: 'level', label: 'Error Correction', type: 'select', options: ['L', 'M', 'Q', 'H'], value: 'M'}
        ]
    },
    qrScanner: {
        title: 'QR Scanner',
        fields: [
            {name: 'url', label: 'QR Image URL', type: 'text', placeholder: 'https://example.com/qr.png', required: true}
        ]
    },
    loremIpsum: {
        title: 'Lorem Ipsum Generator',
        fields: [
            {name: 'type', label: 'Type', type: 'select', options: ['paragraphs', 'sentences', 'words', 'lists'], value: 'paragraphs'},
            {name: 'count', label: 'Count', type: 'number', value: '3', min: 1, max: 100},
            {name: 'html', label: 'Output HTML', type: 'select', options: ['false', 'true'], value: 'false'}
        ]
    },
    timeCard: {
        title: 'Time Card Calculator',
        fields: [
            {name: 'hourly_rate', label: 'Hourly Rate ($)', type: 'number', value: '0', step: '0.01', min: 0}
        ],
        note: 'Use the JSON editor below to add time entries: [{"date":"2024-01-01","time_in":"09:00","time_out":"17:00","break":30}]'
    },
    binChecker: {
        title: 'BIN Checker',
        fields: [
            {name: 'bin', label: 'BIN Number', type: 'text', placeholder: '424242', required: true}
        ]
    },
    creditCardValidator: {
        title: 'Credit Card Validator',
        fields: [
            {name: 'number', label: 'Card Number', type: 'text', placeholder: '4242424242424242', required: true}
        ]
    },
    reverseImageSearch: {
        title: 'Reverse Image Search',
        fields: [
            {name: 'url', label: 'Image URL', type: 'text', placeholder: 'https://example.com/image.jpg', required: true}
        ]
    },
    usernameChecker: {
        title: 'Username Checker',
        fields: [
            {name: 'username', label: 'Username', type: 'text', placeholder: 'myusername', required: true}
        ]
    },
    notepad: {
        title: 'Online Notepad',
        fields: [
            {name: 'action', label: 'Action', type: 'select', options: ['create', 'read', 'update'], value: 'create'},
            {name: 'content', label: 'Content', type: 'textarea', placeholder: 'Type your notes here...', rows: 10},
            {name: 'note_id', label: 'Note ID (for read/update)', type: 'text', placeholder: 'Leave empty for new note'}
        ]
    },
    smallText: {
        title: 'Small Text Generator',
        fields: [
            {name: 'text', label: 'Text', type: 'text', placeholder: 'Hello World', required: true},
            {name: 'style', label: 'Style', type: 'select', options: ['all', 'superscript', 'subscript', 'smallcaps'], value: 'all'}
        ]
    },
    wordCounter: {
        title: 'Word Counter',
        fields: [
            {name: 'text', label: 'Text', type: 'textarea', placeholder: 'Paste your text here...', rows: 10, required: true}
        ]
    },
    rot13: {
        title: 'ROT13 Encoder/Decoder',
        fields: [
            {name: 'text', label: 'Text', type: 'textarea', placeholder: 'Enter text...', rows: 6, required: true}
        ]
    },
    morseCode: {
        title: 'Morse Code Translator',
        fields: [
            {name: 'text', label: 'Text / Morse Code', type: 'textarea', placeholder: 'Enter text or morse code...', rows: 6, required: true},
            {name: 'direction', label: 'Direction', type: 'select', options: ['auto', 'to_morse', 'to_text'], value: 'auto'}
        ]
    },
    bimiChecker: {
        title: 'BIMI Checker',
        fields: [
            {name: 'domain', label: 'Domain', type: 'text', placeholder: 'example.com', required: true},
            {name: 'action', label: 'Action', type: 'select', options: ['check', 'generate'], value: 'check'}
        ]
    },
    imageToText: {
        title: 'Image to Text (OCR)',
        fields: [
            {name: 'url', label: 'Image URL', type: 'text', placeholder: 'https://example.com/image.png', required: true}
        ]
    },
    // Gaming
    minecraftColorCodes: {
        title: 'Minecraft Color Codes',
        fields: [
            {name: 'preview', label: 'Preview Text', type: 'text', placeholder: '\u00a7cRed \u00a7aGreen \u00a7bBlue', value: '\u00a71Dark Blue \u00a7aGreen \u00a7cRed \u00a7eYellow \u00a7fWhite'}
        ]
    },
    minecraftFormatCodes: {
        title: 'Minecraft Format Codes',
        fields: [
            {name: 'format', label: 'Format Code', type: 'select', options: ['l', 'o', 'n', 'm', 'r'], value: 'l'},
            {name: 'text', label: 'Preview Text', type: 'text', placeholder: 'Sample Text', value: 'Bold Text'}
        ]
    }
};

// Current tool from URL
var currentCategory = '{$currentCategory}';
var currentToolAction = '{$currentTool}';

document.addEventListener('DOMContentLoaded', function() {
    if (currentToolAction && toolDefinitions[currentToolAction]) {
        renderToolForm(currentCategory, currentToolAction);
    }
});
</script>