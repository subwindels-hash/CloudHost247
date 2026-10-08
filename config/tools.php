<?php
/** Authoritative public tools catalogue. Generated. Do not edit by hand. */
return array(
    'generatedFrom' => 'scripts/generate-global-platform.py',
    'categories' => array(
        'dns' => 'DNS',
        'ip' => 'IP',
        'developer' => 'Developer',
        'designer' => 'Designer',
        'webmaster' => 'Webmaster',
        'network' => 'Network',
        'cybersecurity' => 'Cybersecurity',
        'productivity' => 'Productivity',
        'gaming' => 'Gaming'
    ),
    'collections' => array(
        array(
            'slug' => 'compliance-documents',
            'name' => 'Compliance & Document Tools',
            'path' => '/tools/compliance-documents',
            'summary' => 'Professional utilities for identity-document formatting, validation, security, developer workflows and infrastructure configuration.',
            'description' => 'A working set of calculators and generators for identity-document formatting, secret generation, developer data handling and infrastructure configuration. Every tool runs in your browser tab: passwords, tokens, hashes and document fields are never uploaded, logged or stored by CloudHost247. Each tool states what it actually verifies — generation, validation or configuration assistance — and none of them claim to authenticate a document, certify a compliance programme or prove that a system is secure.',
            'seoTitle' => 'Compliance & Document Tools — MRZ, Security & Developer Utilities | CloudHost247',
            'seoDescription' => 'Professional utilities for identity-document formatting, validation, security, developer workflows and infrastructure configuration. Five calculators and twelve generators, all processed in your browser.',
            'keywords' => array(
                'compliance tools',
                'document tools',
                'mrz',
                'generators',
                'calculators',
                'identity document',
                'security'
            ),
            'groups' => array(
                array(
                    'slug' => 'identity',
                    'label' => 'Identity & Document',
                    'blurb' => 'Machine-readable document formatting and the date arithmetic identity checks depend on.',
                    'tools' => array(
                        'mrz-generator',
                        'age-date-calculator',
                        'date-duration-calculator'
                    )
                ),
                array(
                    'slug' => 'security',
                    'label' => 'Security & Secrets',
                    'blurb' => 'Random material, digests and written policy — generated locally, never uploaded.',
                    'tools' => array(
                        'random-password-generator',
                        'api-key-generator',
                        'password-policy-generator',
                        'http-security-headers-generator',
                        'checksum-hash-generator'
                    )
                ),
                array(
                    'slug' => 'developer',
                    'label' => 'Developer',
                    'blurb' => 'Identifiers, encodings and structured data for build and debug workflows.',
                    'tools' => array(
                        'uuid-generator',
                        'base64-generator',
                        'json-formatter',
                        'qr-code-generator'
                    )
                ),
                array(
                    'slug' => 'calculators',
                    'label' => 'Calculators & Conversion',
                    'blurb' => 'Exact arithmetic for percentages, data units and machine time.',
                    'tools' => array(
                        'percentage-calculator',
                        'unit-data-converter',
                        'unix-timestamp-calculator'
                    )
                ),
                array(
                    'slug' => 'infrastructure',
                    'label' => 'Infrastructure & Domains',
                    'blurb' => 'Configuration output for DNS zones and crawler directives.',
                    'tools' => array(
                        'dns-record-generator',
                        'robots-txt-generator'
                    )
                )
            )
        )
    ),
    'tools' => array(
        array(
            'slug' => 'dns-checker',
            'name' => 'DNS Checker',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Check A, AAAA, CNAME, MX, NS, TXT and SOA records for a domain in one view.',
            'description' => 'Check A, AAAA, CNAME, MX, NS, TXT and SOA records for a domain in one view. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DNS Checker — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Check A, AAAA, CNAME, MX, NS, TXT and SOA records for a domain in one view. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'checker',
                'records',
                'a',
                'ns',
                'dns-checker',
                'dns',
                'dns checker'
            ),
            'aliases' => array(),
            'path' => '/tools/dns-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_checker',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup',
                'dns-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DNS Checker actually check?',
                    'a' => 'Check A, AAAA, CNAME, MX, NS, TXT and SOA records for a domain in one view. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dns-propagation',
            'name' => 'DNS Propagation',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Compare one DNS question across the public resolvers CloudHost247 actually queries.',
            'description' => 'Compare one DNS question across the public resolvers CloudHost247 actually queries. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DNS Propagation — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Compare one DNS question across the public resolvers CloudHost247 actually queries. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'propagation',
                'resolvers',
                'dns-propagation',
                'dns',
                'dns propagation'
            ),
            'aliases' => array(),
            'path' => '/tools/dns-propagation',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_propagation',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'type',
                    'label' => 'Record type',
                    'type' => 'select',
                    'placeholder' => 'A',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'domain-dns-validation',
                'reverse-ip-lookup',
                'dns-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DNS Propagation actually check?',
                    'a' => 'Compare one DNS question across the public resolvers CloudHost247 actually queries. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'domain-dns-validation',
            'name' => 'Domain DNS Validation',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Validate that a domain has working delegation and the records a website usually needs.',
            'description' => 'Validate that a domain has working delegation and the records a website usually needs. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Domain DNS Validation — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Validate that a domain has working delegation and the records a website usually needs. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'validation',
                'domain',
                'domain-dns-validation',
                'dns',
                'domain dns validation'
            ),
            'aliases' => array(),
            'path' => '/tools/domain-dns-validation',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_validation',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'reverse-ip-lookup',
                'dns-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Domain DNS Validation actually check?',
                    'a' => 'Validate that a domain has working delegation and the records a website usually needs. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'reverse-ip-lookup',
            'name' => 'Reverse IP Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Resolve the PTR hostname for an address and report when neighbor enumeration is not configured.',
            'description' => 'Resolve the PTR hostname for an address and report when neighbor enumeration is not configured. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Reverse IP Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Resolve the PTR hostname for an address and report when neighbor enumeration is not configured. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'reverse',
                'ip',
                'ptr',
                'dns',
                'reverse-ip-lookup',
                'dns',
                'reverse ip lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/reverse-ip-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'reverse_ip',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'dns-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Reverse IP Lookup actually check?',
                    'a' => 'Resolve the PTR hostname for an address and report when neighbor enumeration is not configured. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dns-lookup',
            'name' => 'DNS Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up a single DNS record type, including TTL, value and the resolver that answered.',
            'description' => 'Look up a single DNS record type, including TTL, value and the resolver that answered. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DNS Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up a single DNS record type, including TTL, value and the resolver that answered. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'lookup',
                'a',
                'aaaa',
                'cname',
                'mx',
                'ns',
                'txt',
                'dns-lookup',
                'dns',
                'dns lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/dns-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'type',
                    'label' => 'Record type',
                    'type' => 'select',
                    'placeholder' => 'A',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DNS Lookup actually check?',
                    'a' => 'Look up a single DNS record type, including TTL, value and the resolver that answered. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'cname-lookup',
            'name' => 'CNAME Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up the canonical name record for a hostname.',
            'description' => 'Look up the canonical name record for a hostname. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'CNAME Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up the canonical name record for a hostname. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'cname',
                'dns',
                'alias',
                'cname-lookup',
                'dns',
                'cname lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/cname-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'CNAME'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does CNAME Lookup actually check?',
                    'a' => 'Look up the canonical name record for a hostname. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ns-lookup',
            'name' => 'NS Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up the authoritative name servers published for a domain.',
            'description' => 'Look up the authoritative name servers published for a domain. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'NS Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up the authoritative name servers published for a domain. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ns',
                'nameserver',
                'dns',
                'ns-lookup',
                'dns',
                'ns lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/ns-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'NS'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does NS Lookup actually check?',
                    'a' => 'Look up the authoritative name servers published for a domain. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'mx-lookup',
            'name' => 'MX Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up mail exchanger hosts, priorities and their addresses.',
            'description' => 'Look up mail exchanger hosts, priorities and their addresses. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'MX Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up mail exchanger hosts, priorities and their addresses. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'mx',
                'mail',
                'dns',
                'email',
                'mx-lookup',
                'dns',
                'mx lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/mx-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'MX'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does MX Lookup actually check?',
                    'a' => 'Look up mail exchanger hosts, priorities and their addresses. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'spf-record-checker',
            'name' => 'SPF Record Checker',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Parse a domain\'s SPF policy and flag syntax, lookup-count and multiple-record issues.',
            'description' => 'Parse a domain\'s SPF policy and flag syntax, lookup-count and multiple-record issues. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SPF Record Checker — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Parse a domain\'s SPF policy and flag syntax, lookup-count and multiple-record issues. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'spf',
                'email',
                'dns',
                'txt',
                'spf-record-checker',
                'dns',
                'spf record checker'
            ),
            'aliases' => array(),
            'path' => '/tools/spf-record-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'spf',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SPF Record Checker actually check?',
                    'a' => 'Parse a domain\'s SPF policy and flag syntax, lookup-count and multiple-record issues. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dmarc-checker',
            'name' => 'DMARC Checker',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Retrieve and explain the DMARC policy published at _dmarc.',
            'description' => 'Retrieve and explain the DMARC policy published at _dmarc. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DMARC Checker — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Retrieve and explain the DMARC policy published at _dmarc. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dmarc',
                'email',
                'dns',
                'dmarc-checker',
                'dns',
                'dmarc checker'
            ),
            'aliases' => array(),
            'path' => '/tools/dmarc-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dmarc',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DMARC Checker actually check?',
                    'a' => 'Retrieve and explain the DMARC policy published at _dmarc. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'domain-dns-health',
            'name' => 'Domain DNS Health Checker',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Run delegation, address, mail and authentication checks and label each result separately.',
            'description' => 'Run delegation, address, mail and authentication checks and label each result separately. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Domain DNS Health Checker — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Run delegation, address, mail and authentication checks and label each result separately. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'health',
                'domain',
                'domain-dns-health',
                'dns',
                'domain dns health checker'
            ),
            'aliases' => array(),
            'path' => '/tools/domain-dns-health',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_health',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Domain DNS Health Checker actually check?',
                    'a' => 'Run delegation, address, mail and authentication checks and label each result separately. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dmarc-record-generator',
            'name' => 'DMARC Record Generator',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Build a DMARC TXT value from the policy choices you select. Nothing is published for you.',
            'description' => 'Build a DMARC TXT value from the policy choices you select. Nothing is published for you. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DMARC Record Generator — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Build a DMARC TXT value from the policy choices you select. Nothing is published for you. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dmarc',
                'generator',
                'email',
                'dmarc-record-generator',
                'dns',
                'dmarc record generator'
            ),
            'aliases' => array(),
            'path' => '/tools/dmarc-record-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'dmarc_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'policy',
                    'label' => 'Policy',
                    'type' => 'select',
                    'placeholder' => 'none',
                    'required' => true
                ),
                array(
                    'name' => 'rua',
                    'label' => 'Aggregate report address',
                    'type' => 'text',
                    'placeholder' => 'dmarc@example.com',
                    'required' => false
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DMARC Record Generator actually check?',
                    'a' => 'Build a DMARC TXT value from the policy choices you select. Nothing is published for you. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dnskey-lookup',
            'name' => 'DNSKEY Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up DNSKEY records. This inspects published keys; it does not validate the signature chain.',
            'description' => 'Look up DNSKEY records. This inspects published keys; it does not validate the signature chain. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DNSKEY Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up DNSKEY records. This inspects published keys; it does not validate the signature chain. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dnskey',
                'dnssec',
                'dns',
                'dnskey-lookup',
                'dns',
                'dnskey lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/dnskey-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'DNSKEY'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DNSKEY Lookup actually check?',
                    'a' => 'Look up DNSKEY records. This inspects published keys; it does not validate the signature chain. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ds-lookup',
            'name' => 'DS Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up DS records at the parent. Presence of a DS is not a full DNSSEC validation.',
            'description' => 'Look up DS records at the parent. Presence of a DS is not a full DNSSEC validation. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DS Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up DS records at the parent. Presence of a DS is not a full DNSSEC validation. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ds',
                'dnssec',
                'dns',
                'ds-lookup',
                'dns',
                'ds lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/ds-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'DS'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DS Lookup actually check?',
                    'a' => 'Look up DS records at the parent. Presence of a DS is not a full DNSSEC validation. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'dkim-checker',
            'name' => 'DKIM Checker',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up a DKIM TXT record for the selector you provide. Selectors are never guessed.',
            'description' => 'Look up a DKIM TXT record for the selector you provide. Selectors are never guessed. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'DKIM Checker — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up a DKIM TXT record for the selector you provide. Selectors are never guessed. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dkim',
                'email',
                'dns',
                'dkim-checker',
                'dns',
                'dkim checker'
            ),
            'aliases' => array(),
            'path' => '/tools/dkim-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dkim',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'selector',
                    'label' => 'Selector',
                    'type' => 'text',
                    'placeholder' => 'default',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does DKIM Checker actually check?',
                    'a' => 'Look up a DKIM TXT record for the selector you provide. Selectors are never guessed. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ping-ipv4',
            'name' => 'Ping IPv4',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Measure TCP reachability to a public IPv4 host. This is not an ICMP echo.',
            'description' => 'Measure TCP reachability to a public IPv4 host. This is not an ICMP echo. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Ping IPv4 — Free IP Tool | CloudHost247',
            'seoDescription' => 'Measure TCP reachability to a public IPv4 host. This is not an ICMP echo. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ping',
                'ipv4',
                'latency',
                'ping-ipv4',
                'ip',
                'ping ipv4'
            ),
            'aliases' => array(),
            'path' => '/tools/ping-ipv4',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ping',
            'options' => array(
                'family' => 'ipv4'
            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv4 address or hostname',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute',
                'ip-location-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Ping IPv4 actually check?',
                    'a' => 'Measure TCP reachability to a public IPv4 host. This is not an ICMP echo. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ping-ipv6',
            'name' => 'Ping IPv6',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Measure TCP reachability to a public IPv6 host. This is not an ICMP echo.',
            'description' => 'Measure TCP reachability to a public IPv6 host. This is not an ICMP echo. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Ping IPv6 — Free IP Tool | CloudHost247',
            'seoDescription' => 'Measure TCP reachability to a public IPv6 host. This is not an ICMP echo. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ping',
                'ipv6',
                'latency',
                'ping-ipv6',
                'ip',
                'ping ipv6'
            ),
            'aliases' => array(),
            'path' => '/tools/ping-ipv6',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ping',
            'options' => array(
                'family' => 'ipv6'
            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 address or hostname',
                    'type' => 'text',
                    'placeholder' => '2001:db8::1',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'what-is-my-ip',
                'traceroute',
                'ip-location-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Ping IPv6 actually check?',
                    'a' => 'Measure TCP reachability to a public IPv6 host. This is not an ICMP echo. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'what-is-my-ip',
            'name' => 'What Is My IP',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Show the IP address seen by this CloudHost247 service, without trusting spoofable proxy headers by default.',
            'description' => 'Show the IP address seen by this CloudHost247 service, without trusting spoofable proxy headers by default. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'What Is My IP — Free IP Tool | CloudHost247',
            'seoDescription' => 'Show the IP address seen by this CloudHost247 service, without trusting spoofable proxy headers by default. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ip',
                'my ip',
                'address',
                'what-is-my-ip',
                'ip',
                'what is my ip'
            ),
            'aliases' => array(),
            'path' => '/tools/what-is-my-ip',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'my_ip',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'traceroute',
                'ip-location-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does What Is My IP actually check?',
                    'a' => 'Show the IP address seen by this CloudHost247 service, without trusting spoofable proxy headers by default. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'traceroute',
            'name' => 'Traceroute',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Report destination reachability. Hop-by-hop ICMP traceroute is shown only when the probe capability is available.',
            'description' => 'Report destination reachability. Hop-by-hop ICMP traceroute is shown only when the probe capability is available. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Traceroute — Free IP Tool | CloudHost247',
            'seoDescription' => 'Report destination reachability. Hop-by-hop ICMP traceroute is shown only when the probe capability is available. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'traceroute',
                'hops',
                'network',
                'traceroute',
                'ip',
                'traceroute'
            ),
            'aliases' => array(),
            'path' => '/tools/traceroute',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'traceroute',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'Hostname or IP',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'ip-location-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Traceroute actually check?',
                    'a' => 'Report destination reachability. Hop-by-hop ICMP traceroute is shown only when the probe capability is available. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-location-lookup',
            'name' => 'IP Location Lookup',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Show registration information and, separately, estimated geolocation when a provider responds.',
            'description' => 'Show registration information and, separately, estimated geolocation when a provider responds. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP Location Lookup — Free IP Tool | CloudHost247',
            'seoDescription' => 'Show registration information and, separately, estimated geolocation when a provider responds. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ip',
                'location',
                'geo',
                'ip-location-lookup',
                'ip',
                'ip location lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-location-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_location',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP Location Lookup actually check?',
                    'a' => 'Show registration information and, separately, estimated geolocation when a provider responds. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'trace-email',
            'name' => 'Trace Email',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Parse Received headers in your browser. Message content is not uploaded or stored.',
            'description' => 'Parse Received headers in your browser. Message content is not uploaded or stored. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Trace Email — Free IP Tool | CloudHost247',
            'seoDescription' => 'Parse Received headers in your browser. Message content is not uploaded or stored. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'email',
                'trace',
                'headers',
                'trace-email',
                'ip',
                'trace email'
            ),
            'aliases' => array(),
            'path' => '/tools/trace-email',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'trace_email',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Email headers',
                    'type' => 'textarea',
                    'placeholder' => 'Paste Received headers',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Trace Email actually check?',
                    'a' => 'Parse Received headers in your browser. Message content is not uploaded or stored. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-blacklist-checker',
            'name' => 'IP Blacklist Checker',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Query a fixed set of public DNS block lists and report each list\'s actual answer.',
            'description' => 'Query a fixed set of public DNS block lists and report each list\'s actual answer. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP Blacklist Checker — Free IP Tool | CloudHost247',
            'seoDescription' => 'Query a fixed set of public DNS block lists and report each list\'s actual answer. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'blacklist',
                'dnsbl',
                'ip',
                'ip-blacklist-checker',
                'ip',
                'ip blacklist checker'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-blacklist-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_blacklist',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP Blacklist Checker actually check?',
                    'a' => 'Query a fixed set of public DNS block lists and report each list\'s actual answer. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'email-blacklist-checker',
            'name' => 'Email Blacklist Checker',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Check a domain against public domain block lists. A listing is not a judgment of a mailbox.',
            'description' => 'Check a domain against public domain block lists. A listing is not a judgment of a mailbox. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Email Blacklist Checker — Free IP Tool | CloudHost247',
            'seoDescription' => 'Check a domain against public domain block lists. A listing is not a judgment of a mailbox. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'blacklist',
                'email',
                'domain',
                'email-blacklist-checker',
                'ip',
                'email blacklist checker'
            ),
            'aliases' => array(),
            'path' => '/tools/email-blacklist-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'email_blacklist',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Email Blacklist Checker actually check?',
                    'a' => 'Check a domain against public domain block lists. A listing is not a judgment of a mailbox. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-to-decimal',
            'name' => 'IP to Decimal',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Convert an IPv4 address to its unsigned decimal form and back.',
            'description' => 'Convert an IPv4 address to its unsigned decimal form and back. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP to Decimal — Free IP Tool | CloudHost247',
            'seoDescription' => 'Convert an IPv4 address to its unsigned decimal form and back. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ip',
                'decimal',
                'convert',
                'ip-to-decimal',
                'ip',
                'ip to decimal'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-to-decimal',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ip_decimal',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv4 address or decimal',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP to Decimal actually check?',
                    'a' => 'Convert an IPv4 address to its unsigned decimal form and back. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-to-hostname',
            'name' => 'IP to Hostname',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Resolve the PTR hostname for a public IP address.',
            'description' => 'Resolve the PTR hostname for a public IP address. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP to Hostname — Free IP Tool | CloudHost247',
            'seoDescription' => 'Resolve the PTR hostname for a public IP address. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ptr',
                'hostname',
                'ip',
                'ip-to-hostname',
                'ip',
                'ip to hostname'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-to-hostname',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_hostname',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP to Hostname actually check?',
                    'a' => 'Resolve the PTR hostname for a public IP address. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-whois',
            'name' => 'IP WHOIS',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Look up IPv4 registration data from RDAP. This is network registration, not a person search.',
            'description' => 'Look up IPv4 registration data from RDAP. This is network registration, not a person search. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP WHOIS — Free IP Tool | CloudHost247',
            'seoDescription' => 'Look up IPv4 registration data from RDAP. This is network registration, not a person search. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'whois',
                'rdap',
                'ip',
                'ip-whois',
                'ip',
                'ip whois'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-whois',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_whois',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP WHOIS actually check?',
                    'a' => 'Look up IPv4 registration data from RDAP. This is network registration, not a person search. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-whois',
            'name' => 'IPv6 WHOIS',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Look up IPv6 registration data from RDAP.',
            'description' => 'Look up IPv6 registration data from RDAP. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 WHOIS — Free IP Tool | CloudHost247',
            'seoDescription' => 'Look up IPv6 registration data from RDAP. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'whois',
                'ipv6',
                'rdap',
                'ipv6-whois',
                'ip',
                'ipv6 whois'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-whois',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_whois',
            'options' => array(
                'family' => 'ipv6'
            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 address',
                    'type' => 'text',
                    'placeholder' => '2001:db8::1',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 WHOIS actually check?',
                    'a' => 'Look up IPv6 registration data from RDAP. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv4-to-ipv6',
            'name' => 'IPv4 to IPv6',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Show IPv4-mapped and 6to4 encodings. An encoding is not proof the host has IPv6 connectivity.',
            'description' => 'Show IPv4-mapped and 6to4 encodings. An encoding is not proof the host has IPv6 connectivity. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv4 to IPv6 — Free IP Tool | CloudHost247',
            'seoDescription' => 'Show IPv4-mapped and 6to4 encodings. An encoding is not proof the host has IPv6 connectivity. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv4',
                'ipv6',
                'convert',
                'ipv4-to-ipv6',
                'ip',
                'ipv4 to ipv6'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv4-to-ipv6',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv4_to_ipv6',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv4 address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv4 to IPv6 actually check?',
                    'a' => 'Show IPv4-mapped and 6to4 encodings. An encoding is not proof the host has IPv6 connectivity. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'local-ipv6-generator',
            'name' => 'Local IPv6 Address Generator',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Generate a Unique Local Address in fd00::/8 for lab use. It is not routable on the public internet.',
            'description' => 'Generate a Unique Local Address in fd00::/8 for lab use. It is not routable on the public internet. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Local IPv6 Address Generator — Free IP Tool | CloudHost247',
            'seoDescription' => 'Generate a Unique Local Address in fd00::/8 for lab use. It is not routable on the public internet. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'ula',
                'generator',
                'local-ipv6-generator',
                'ip',
                'local ipv6 address generator'
            ),
            'aliases' => array(),
            'path' => '/tools/local-ipv6-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_ula',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Local IPv6 Address Generator actually check?',
                    'a' => 'Generate a Unique Local Address in fd00::/8 for lab use. It is not routable on the public internet. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-cidr-to-range',
            'name' => 'IPv6 CIDR to Range',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Expand an IPv6 prefix into its first and last addresses.',
            'description' => 'Expand an IPv6 prefix into its first and last addresses. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 CIDR to Range — Free IP Tool | CloudHost247',
            'seoDescription' => 'Expand an IPv6 prefix into its first and last addresses. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'cidr',
                'range',
                'ipv6-cidr-to-range',
                'ip',
                'ipv6 cidr to range'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-cidr-to-range',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_cidr_range',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 CIDR',
                    'type' => 'text',
                    'placeholder' => '2001:db8::/32',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 CIDR to Range actually check?',
                    'a' => 'Expand an IPv6 prefix into its first and last addresses. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-range-to-cidr',
            'name' => 'IPv6 Range to CIDR',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Summarize an aligned IPv6 range as CIDR prefixes. Unaligned ranges are split, not rounded away.',
            'description' => 'Summarize an aligned IPv6 range as CIDR prefixes. Unaligned ranges are split, not rounded away. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 Range to CIDR — Free IP Tool | CloudHost247',
            'seoDescription' => 'Summarize an aligned IPv6 range as CIDR prefixes. Unaligned ranges are split, not rounded away. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'cidr',
                'range',
                'ipv6-range-to-cidr',
                'ip',
                'ipv6 range to cidr'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-range-to-cidr',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_range_cidr',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'start',
                    'label' => 'First address',
                    'type' => 'text',
                    'placeholder' => '2001:db8::',
                    'required' => true
                ),
                array(
                    'name' => 'end',
                    'label' => 'Last address',
                    'type' => 'text',
                    'placeholder' => '2001:db8::ffff',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 Range to CIDR actually check?',
                    'a' => 'Summarize an aligned IPv6 range as CIDR prefixes. Unaligned ranges are split, not rounded away. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-compression',
            'name' => 'IPv6 Compression',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Compress an IPv6 address using the shortest standards representation.',
            'description' => 'Compress an IPv6 address using the shortest standards representation. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 Compression — Free IP Tool | CloudHost247',
            'seoDescription' => 'Compress an IPv6 address using the shortest standards representation. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'compress',
                'ipv6-compression',
                'ip',
                'ipv6 compression'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-compression',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_compress',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 address',
                    'type' => 'text',
                    'placeholder' => '2001:0db8:0000:0000:0000:0000:0000:0001',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 Compression actually check?',
                    'a' => 'Compress an IPv6 address using the shortest standards representation. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-expand',
            'name' => 'IPv6 Expand',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Expand a compressed IPv6 address to eight groups of four hexadecimal digits.',
            'description' => 'Expand a compressed IPv6 address to eight groups of four hexadecimal digits. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 Expand — Free IP Tool | CloudHost247',
            'seoDescription' => 'Expand a compressed IPv6 address to eight groups of four hexadecimal digits. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'expand',
                'ipv6-expand',
                'ip',
                'ipv6 expand'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-expand',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_expand',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 address',
                    'type' => 'text',
                    'placeholder' => '2001:db8::1',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 Expand actually check?',
                    'a' => 'Expand a compressed IPv6 address to eight groups of four hexadecimal digits. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ip-subnet-calculator',
            'name' => 'IP Subnet Calculator',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Calculate network, broadcast, usable range and mask for an IPv4 prefix.',
            'description' => 'Calculate network, broadcast, usable range and mask for an IPv4 prefix. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IP Subnet Calculator — Free IP Tool | CloudHost247',
            'seoDescription' => 'Calculate network, broadcast, usable range and mask for an IPv4 prefix. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'subnet',
                'cidr',
                'ip',
                'calculator',
                'ip-subnet-calculator',
                'ip',
                'ip subnet calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/ip-subnet-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'subnet',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv4 CIDR',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10/24',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IP Subnet Calculator actually check?',
                    'a' => 'Calculate network, broadcast, usable range and mask for an IPv4 prefix. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-to-ipv4',
            'name' => 'IPv6 to IPv4',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Extract an embedded IPv4 address from a mapped, 6to4 or well-known NAT64 address.',
            'description' => 'Extract an embedded IPv4 address from a mapped, 6to4 or well-known NAT64 address. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 to IPv4 — Free IP Tool | CloudHost247',
            'seoDescription' => 'Extract an embedded IPv4 address from a mapped, 6to4 or well-known NAT64 address. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'ipv4',
                'convert',
                'ipv6-to-ipv4',
                'ip',
                'ipv6 to ipv4'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-to-ipv4',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'ipv6_to_ipv4',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IPv6 address',
                    'type' => 'text',
                    'placeholder' => '::ffff:203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 to IPv4 actually check?',
                    'a' => 'Extract an embedded IPv4 address from a mapped, 6to4 or well-known NAT64 address. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ipv6-compatibility-checker',
            'name' => 'IPv6 Compatibility Checker',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Check whether a hostname publishes AAAA records and whether HTTPS responds on IPv6.',
            'description' => 'Check whether a hostname publishes AAAA records and whether HTTPS responds on IPv6. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'IPv6 Compatibility Checker — Free IP Tool | CloudHost247',
            'seoDescription' => 'Check whether a hostname publishes AAAA records and whether HTTPS responds on IPv6. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ipv6',
                'compatibility',
                'aaaa',
                'ipv6-compatibility-checker',
                'ip',
                'ipv6 compatibility checker'
            ),
            'aliases' => array(),
            'path' => '/tools/ipv6-compatibility-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ipv6_compat',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does IPv6 Compatibility Checker actually check?',
                    'a' => 'Check whether a hostname publishes AAAA records and whether HTTPS responds on IPv6. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'what-is-my-isp',
            'name' => 'What Is My ISP',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Identify the network registration seen for your connection, separate from estimated location.',
            'description' => 'Identify the network registration seen for your connection, separate from estimated location. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'What Is My ISP — Free IP Tool | CloudHost247',
            'seoDescription' => 'Identify the network registration seen for your connection, separate from estimated location. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'isp',
                'ip',
                'provider',
                'what-is-my-isp',
                'ip',
                'what is my isp'
            ),
            'aliases' => array(),
            'path' => '/tools/what-is-my-isp',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'isp',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does What Is My ISP actually check?',
                    'a' => 'Identify the network registration seen for your connection, separate from estimated location. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'domain-to-ip',
            'name' => 'Domain to IP',
            'category' => 'ip',
            'categoryLabel' => 'IP',
            'icon' => 'ip',
            'summary' => 'Resolve a hostname to its current A and AAAA addresses.',
            'description' => 'Resolve a hostname to its current A and AAAA addresses. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Domain to IP — Free IP Tool | CloudHost247',
            'seoDescription' => 'Resolve a hostname to its current A and AAAA addresses. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'domain',
                'ip',
                'dns',
                'domain-to-ip',
                'ip',
                'domain to ip'
            ),
            'aliases' => array(),
            'path' => '/tools/domain-to-ip',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'domain_to_ip',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'ping-ipv4',
                'ping-ipv6',
                'what-is-my-ip',
                'traceroute'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Server management',
                    'url' => 'server-management.php'
                ),
                array(
                    'label' => 'IP management',
                    'url' => 'ip-management.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Domain to IP actually check?',
                    'a' => 'Resolve a hostname to its current A and AAAA addresses. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'http-headers-checker',
            'name' => 'HTTP Headers Checker',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Fetch response headers from a public URL, including a bounded redirect chain.',
            'description' => 'Fetch response headers from a public URL, including a bounded redirect chain. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'HTTP Headers Checker — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Fetch response headers from a public URL, including a bounded redirect chain. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'http',
                'headers',
                'developer',
                'http-headers-checker',
                'developer',
                'http headers checker'
            ),
            'aliases' => array(),
            'path' => '/tools/http-headers-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'http_headers',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'website-os-checker',
                'md5-generator',
                'base64-generator',
                'multi-url-opener'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does HTTP Headers Checker actually check?',
                    'a' => 'Fetch response headers from a public URL, including a bounded redirect chain. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'website-os-checker',
            'name' => 'Website Operating System Checker',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Infer a server operating system only from headers the site chooses to send.',
            'description' => 'Infer a server operating system only from headers the site chooses to send. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Website Operating System Checker — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Infer a server operating system only from headers the site chooses to send. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'os',
                'server',
                'headers',
                'website-os-checker',
                'developer',
                'website operating system checker'
            ),
            'aliases' => array(),
            'path' => '/tools/website-os-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'server_os',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'md5-generator',
                'base64-generator',
                'multi-url-opener'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Website Operating System Checker actually check?',
                    'a' => 'Infer a server operating system only from headers the site chooses to send. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'md5-generator',
            'name' => 'MD5 Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Compute an MD5 checksum in your browser. MD5 is not suitable for password storage.',
            'description' => 'Compute an MD5 checksum in your browser. MD5 is not suitable for password storage. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'MD5 Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Compute an MD5 checksum in your browser. MD5 is not suitable for password storage. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'md5',
                'hash',
                'checksum',
                'md5-generator',
                'developer',
                'md5 generator'
            ),
            'aliases' => array(),
            'path' => '/tools/md5-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'md5',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'Text to hash',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'base64-generator',
                'multi-url-opener'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does MD5 Generator actually check?',
                    'a' => 'Compute an MD5 checksum in your browser. MD5 is not suitable for password storage. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'base64-generator',
            'name' => 'Base64 Encoder / Decoder',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Encode or decode Base64 with UTF-8 handling, strict validation and a URL-safe variant. Input is not uploaded.',
            'description' => 'Encodes text to Base64 and decodes Base64 back to text, treating the payload as UTF-8 in both directions so multi-byte characters survive the round trip. Decoding is strict: characters outside the chosen alphabet, a bad padding length or a truncated final quantum are reported as an error with the offending position, instead of being silently skipped the way a permissive decoder would. A URL-safe alphabet (- and _, no padding) is available for tokens that travel in a path or query string. Everything happens in your browser tab.',
            'seoTitle' => 'Base64 Encoder / Decoder — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Encode or decode Base64 with UTF-8 handling, strict validation and a URL-safe variant. Input is not uploaded. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'base64',
                'encode',
                'decode',
                'utf-8',
                'url-safe',
                'base64url',
                'base64-generator',
                'developer',
                'base64 encoder / decoder'
            ),
            'aliases' => array(),
            'path' => '/tools/base64-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'base64',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'op',
                    'label' => 'Operation',
                    'type' => 'select',
                    'placeholder' => 'encode',
                    'required' => true,
                    'choices' => array(
                        'encode' => 'Encode text → Base64',
                        'decode' => 'Decode Base64 → text'
                    )
                ),
                array(
                    'name' => 'variant',
                    'label' => 'Alphabet',
                    'type' => 'select',
                    'placeholder' => 'standard',
                    'required' => true,
                    'choices' => array(
                        'standard' => 'Standard (+ / with = padding)',
                        'urlsafe' => 'URL-safe (- _ without padding)'
                    )
                ),
                array(
                    'name' => 'text',
                    'label' => 'Text or Base64',
                    'type' => 'textarea',
                    'placeholder' => 'Text to encode, or Base64 to decode',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'multi-url-opener'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Base64 Encoder / Decoder actually check?',
                    'a' => 'Encode or decode Base64 with UTF-8 handling, strict validation and a URL-safe variant. Input is not uploaded. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'multi-url-opener',
            'name' => 'Multi URL Opener',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Open up to eight http(s) URLs in new tabs after you confirm. Other schemes are rejected.',
            'description' => 'Open up to eight http(s) URLs in new tabs after you confirm. Other schemes are rejected. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Multi URL Opener — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Open up to eight http(s) URLs in new tabs after you confirm. Other schemes are rejected. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'url',
                'opener',
                'tabs',
                'multi-url-opener',
                'developer',
                'multi url opener'
            ),
            'aliases' => array(),
            'path' => '/tools/multi-url-opener',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'multi_url',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'URLs',
                    'type' => 'textarea',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Multi URL Opener actually check?',
                    'a' => 'Open up to eight http(s) URLs in new tabs after you confirm. Other schemes are rejected. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'mrz-generator',
            'name' => 'MRZ Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Generate, validate and parse ICAO Doc 9303 machine-readable zones for TD1, TD2 and TD3 documents.',
            'description' => 'Builds machine-readable zones for the three ICAO Doc 9303 layouts — TD1 (3 lines of 30 characters), TD2 (2 lines of 36) and TD3 (2 lines of 44) — from the document fields you enter, validates the structure and the 7-3-1 check digits of an existing zone, and parses a supplied zone back into labelled fields. Field widths are enforced per format: a value that cannot fit the layout you selected is rejected with a message that names the field and the limit, never silently truncated. Names are transliterated to the ICAO Latin character set, and an unsupported character is reported instead of being removed or guessed. Privacy: the calculation runs in this browser tab, so the values you type are not uploaded, logged or stored by CloudHost247. Scope: machine-readable text only — a correct format and check digits prove the string is internally consistent, they do not prove that a physical or electronic document is genuine, and this page does not create passport artwork or travel documents.',
            'seoTitle' => 'MRZ Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Generate, validate and parse ICAO Doc 9303 machine-readable zones for TD1, TD2 and TD3 documents. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'mrz',
                'machine readable zone',
                'passport',
                'icao 9303',
                'td1',
                'td2',
                'td3',
                'check digit',
                'composite check digit',
                'ocr',
                'identity document',
                'parser',
                'validator',
                'mrz-generator',
                'developer',
                'mrz generator'
            ),
            'aliases' => array(),
            'path' => '/tools/mrz-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'mrz_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'mode',
                    'label' => 'Action',
                    'type' => 'select',
                    'placeholder' => 'generate',
                    'required' => true,
                    'choices' => array(
                        'generate' => 'Generate an MRZ',
                        'validate' => 'Validate an MRZ',
                        'parse' => 'Parse an MRZ'
                    )
                ),
                array(
                    'name' => 'format',
                    'label' => 'Document format',
                    'type' => 'select',
                    'placeholder' => 'TD3',
                    'required' => true,
                    'choices' => array(
                        'TD3' => 'TD3 — passport / 2 lines × 44 characters',
                        'TD2' => 'TD2 — ID card / 2 lines × 36 characters',
                        'TD1' => 'TD1 — ID card / 3 lines × 30 characters'
                    ),
                    'hint' => 'Determines the field widths, the check digits and the composite check digit.'
                ),
                array(
                    'name' => 'mrz',
                    'label' => 'Existing MRZ (validate or parse)',
                    'type' => 'textarea',
                    'placeholder' => 'Paste the machine-readable lines here',
                    'required' => false
                ),
                array(
                    'name' => 'documentCode',
                    'label' => 'Document code',
                    'type' => 'text',
                    'placeholder' => 'P',
                    'required' => false,
                    'hint' => 'P for passport. TD1/TD2 accept I, A, C, V and similar codes.'
                ),
                array(
                    'name' => 'issuingState',
                    'label' => 'Issuing state (3 letters)',
                    'type' => 'text',
                    'placeholder' => 'UTO',
                    'required' => false
                ),
                array(
                    'name' => 'surname',
                    'label' => 'Surname (as printed)',
                    'type' => 'text',
                    'placeholder' => 'SURNAME',
                    'required' => false
                ),
                array(
                    'name' => 'givenNames',
                    'label' => 'Given names (as printed)',
                    'type' => 'text',
                    'placeholder' => 'GIVEN NAMES',
                    'required' => false
                ),
                array(
                    'name' => 'nationality',
                    'label' => 'Nationality (3 letters)',
                    'type' => 'text',
                    'placeholder' => 'UTO',
                    'required' => false
                ),
                array(
                    'name' => 'documentNumber',
                    'label' => 'Document number',
                    'type' => 'text',
                    'placeholder' => 'AB1234567',
                    'required' => false
                ),
                array(
                    'name' => 'dateOfBirth',
                    'label' => 'Date of birth (YYMMDD)',
                    'type' => 'text',
                    'placeholder' => 'YYMMDD',
                    'required' => false
                ),
                array(
                    'name' => 'sex',
                    'label' => 'Sex',
                    'type' => 'select',
                    'placeholder' => 'F',
                    'required' => false,
                    'choices' => array(
                        'F' => 'F — female',
                        'M' => 'M — male',
                        '<' => '< — unspecified'
                    )
                ),
                array(
                    'name' => 'expiryDate',
                    'label' => 'Expiry date (YYMMDD)',
                    'type' => 'text',
                    'placeholder' => 'YYMMDD',
                    'required' => false
                ),
                array(
                    'name' => 'optionalData',
                    'label' => 'Optional / personal number',
                    'type' => 'text',
                    'placeholder' => 'OPTIONAL',
                    'required' => false,
                    'hint' => 'TD3 allows 14 characters, TD2 28, TD1 15 plus a separate 15-character second optional field.'
                ),
                array(
                    'name' => 'optionalData2',
                    'label' => 'Optional data 2 (TD1 only)',
                    'type' => 'text',
                    'placeholder' => 'OPTIONAL2',
                    'required' => false
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Which document formats does this generate?',
                    'a' => 'TD1 (ID card, three lines of 30 characters), TD2 (ID card, two lines of 36) and TD3 (passport, two lines of 44). The page states which layout you are building, and the field widths, check digits and composite check digit follow that layout.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'No. Everything is calculated in this browser tab. The values are not uploaded, not logged and not written to a database, and no MRZ string, document number or date of birth is sent to analytics or added to any URL.'
                ),
                array(
                    'q' => 'Does a valid check digit prove a passport is genuine?',
                    'a' => 'No. This is syntactic validation: structure, field widths, character set and check digits. Authenticity requires the document itself, the issuing authority and cryptographic verification (ICAO PKD / passive authentication), which this tool does not perform.'
                ),
                array(
                    'q' => 'What happens if a field is too long?',
                    'a' => 'Generation stops and the error names the field, the layout and the character limit. Fields are never truncated for you, because a truncated name field would produce a syntactically valid zone that misstates the document.'
                ),
                array(
                    'q' => 'Can I use a real passport here?',
                    'a' => 'Use synthetic test data. The built-in specimen uses the reserved ICAO test codes UTO and XXA, which belong to no real person or state.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => true,
            'sensitive' => true,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'age-date-calculator',
            'name' => 'Age & Date Calculator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Exact age in years, months and days between a date of birth and a reference date, with the day-count behind it.',
            'description' => 'Computes the exact age between a date of birth and a reference date in completed years, months and days, plus the total days, weeks, months and the next birthday. Calendar arithmetic is exact: leap days, month lengths and end-of-month boundaries are handled by counting whole months first and the remaining days second, so 31 January plus one month is reported rather than guessed. Useful in identity and document workflows where an age has to be stated precisely on a given date. The reference date defaults to today in your own time zone; nothing is sent to CloudHost247.',
            'seoTitle' => 'Age & Date Calculator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Exact age in years, months and days between a date of birth and a reference date, with the day-count behind it. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'age',
                'date of birth',
                'birthday',
                'years months days',
                'document verification',
                'calculator',
                'age-date-calculator',
                'productivity',
                'age & date calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/age-date-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'age_date',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'dateOfBirth',
                    'label' => 'Date of birth',
                    'type' => 'text',
                    'placeholder' => '1990-04-23',
                    'required' => true,
                    'hint' => 'ISO 8601 (YYYY-MM-DD) or DD/MM/YYYY.'
                ),
                array(
                    'name' => 'referenceDate',
                    'label' => 'Reference date',
                    'type' => 'text',
                    'placeholder' => '',
                    'required' => false,
                    'hint' => 'Defaults to today in your browser\'s time zone.'
                )
            ),
            'relatedTools' => array(
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator',
                'qr-scanner'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'How is the age calculated?',
                    'a' => 'Whole years first, then whole months, then the remaining days — the same way a person states an age. Totals in days, weeks and months are computed separately from the day difference, so they are consistent with the calendar result.'
                ),
                array(
                    'q' => 'Are leap years handled?',
                    'a' => 'Yes. February 29 birthdays and 366-day years are counted by real calendar arithmetic, not by a fixed 365-day year.'
                ),
                array(
                    'q' => 'Is the date of birth uploaded?',
                    'a' => 'No. The calculation runs in your browser tab and the date is not stored, logged or sent anywhere.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'date-duration-calculator',
            'name' => 'Date & Duration Calculator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Add or subtract days, weeks, months and years from a date, or measure the exact duration between two dates.',
            'description' => 'Add or subtract days, weeks, months and years from a date, or measure the exact duration between two dates. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Date & Duration Calculator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Add or subtract days, weeks, months and years from a date, or measure the exact duration between two dates. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'date',
                'duration',
                'add days',
                'date difference',
                'leap year',
                'calculator',
                'date-duration-calculator',
                'productivity',
                'date & duration calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/date-duration-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'date_duration',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'action',
                    'label' => 'Calculation',
                    'type' => 'select',
                    'placeholder' => 'difference',
                    'required' => true,
                    'choices' => array(
                        'difference' => 'Duration between two dates',
                        'add' => 'Add to a date',
                        'subtract' => 'Subtract from a date'
                    )
                ),
                array(
                    'name' => 'startDate',
                    'label' => 'Start date',
                    'type' => 'text',
                    'placeholder' => '2026-01-31',
                    'required' => true,
                    'hint' => 'ISO 8601 (YYYY-MM-DD) or DD/MM/YYYY.'
                ),
                array(
                    'name' => 'endDate',
                    'label' => 'End date',
                    'type' => 'text',
                    'placeholder' => '2026-12-31',
                    'required' => false,
                    'hint' => 'Used for the duration between two dates.'
                ),
                array(
                    'name' => 'amount',
                    'label' => 'Amount',
                    'type' => 'number',
                    'placeholder' => '30',
                    'required' => false,
                    'hint' => 'Used when adding or subtracting.'
                ),
                array(
                    'name' => 'unit',
                    'label' => 'Unit',
                    'type' => 'select',
                    'placeholder' => 'days',
                    'required' => true,
                    'choices' => array(
                        'days' => 'Days',
                        'weeks' => 'Weeks',
                        'months' => 'Months',
                        'years' => 'Years'
                    )
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'percentage-calculator',
                'qr-code-generator',
                'qr-scanner'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Date & Duration Calculator actually check?',
                    'a' => 'Add or subtract days, weeks, months and years from a date, or measure the exact duration between two dates. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'percentage-calculator',
            'name' => 'Percentage & Rate Calculator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Percentage increase or decrease, percentage difference, reverse percentage and rate calculations.',
            'description' => 'Percentage increase or decrease, percentage difference, reverse percentage and rate calculations. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Percentage & Rate Calculator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Percentage increase or decrease, percentage difference, reverse percentage and rate calculations. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'percentage',
                'percent',
                'increase',
                'decrease',
                'reverse percentage',
                'rate',
                'calculator',
                'percentage-calculator',
                'productivity',
                'percentage & rate calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/percentage-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'percentage',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'action',
                    'label' => 'Calculation',
                    'type' => 'select',
                    'placeholder' => 'change',
                    'required' => true,
                    'choices' => array(
                        'change' => 'Percentage increase / decrease',
                        'of' => 'What is X% of Y',
                        'isWhat' => 'X is what % of Y',
                        'reverse' => 'Reverse percentage (find the original)',
                        'difference' => 'Percentage difference'
                    )
                ),
                array(
                    'name' => 'from',
                    'label' => 'From / original value',
                    'type' => 'text',
                    'placeholder' => '1200',
                    'required' => true
                ),
                array(
                    'name' => 'to',
                    'label' => 'To / new value',
                    'type' => 'text',
                    'placeholder' => '1500',
                    'required' => false
                ),
                array(
                    'name' => 'percent',
                    'label' => 'Percentage (%)',
                    'type' => 'text',
                    'placeholder' => '15',
                    'required' => false
                ),
                array(
                    'name' => 'value',
                    'label' => 'Value',
                    'type' => 'text',
                    'placeholder' => '250',
                    'required' => false
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'qr-code-generator',
                'qr-scanner'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Percentage & Rate Calculator actually check?',
                    'a' => 'Percentage increase or decrease, percentage difference, reverse percentage and rate calculations. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'unit-data-converter',
            'name' => 'Unit & Data Conversion Calculator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Convert storage and data units between binary (KiB, MiB, GiB) and decimal (KB, MB, GB) systems.',
            'description' => 'Converts data and storage quantities between the binary units a kernel reports (KiB, MiB, GiB, TiB, PiB — powers of 1024) and the decimal units a vendor labels a drive with (kB, MB, GB, TB, PB — powers of 1000), plus bits and bytes. Every conversion is done in exact integer-byte arithmetic where the value allows, so a 4 TiB volume and a 4 TB drive show the 10% difference that is actually there instead of being rounded away. The result names both systems so an infrastructure figure cannot be misread.',
            'seoTitle' => 'Unit & Data Conversion Calculator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Convert storage and data units between binary (KiB, MiB, GiB) and decimal (KB, MB, GB) systems. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'unit',
                'converter',
                'bytes',
                'kibibyte',
                'mebibyte',
                'gibibyte',
                'storage',
                'data',
                'binary',
                'decimal',
                'unit-data-converter',
                'developer',
                'unit & data conversion calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/unit-data-converter',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'unit_data',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'amount',
                    'label' => 'Amount',
                    'type' => 'text',
                    'placeholder' => '1',
                    'required' => true
                ),
                array(
                    'name' => 'fromUnit',
                    'label' => 'From unit',
                    'type' => 'select',
                    'placeholder' => 'GiB',
                    'required' => true,
                    'choices' => array(
                        'bit' => 'bit',
                        'B' => 'B (byte)',
                        'kB' => 'kB (1000 B)',
                        'MB' => 'MB (1000 kB)',
                        'GB' => 'GB (1000 MB)',
                        'TB' => 'TB (1000 GB)',
                        'PB' => 'PB (1000 TB)',
                        'KiB' => 'KiB (1024 B)',
                        'MiB' => 'MiB (1024 KiB)',
                        'GiB' => 'GiB (1024 MiB)',
                        'TiB' => 'TiB (1024 GiB)',
                        'PiB' => 'PiB (1024 TiB)'
                    )
                ),
                array(
                    'name' => 'toUnit',
                    'label' => 'To unit',
                    'type' => 'select',
                    'placeholder' => 'GB',
                    'required' => true,
                    'choices' => array(
                        'bit' => 'bit',
                        'B' => 'B (byte)',
                        'kB' => 'kB (1000 B)',
                        'MB' => 'MB (1000 kB)',
                        'GB' => 'GB (1000 MB)',
                        'TB' => 'TB (1000 GB)',
                        'PB' => 'PB (1000 TB)',
                        'KiB' => 'KiB (1024 B)',
                        'MiB' => 'MiB (1024 KiB)',
                        'GiB' => 'GiB (1024 MiB)',
                        'TiB' => 'TiB (1024 GiB)',
                        'PiB' => 'PiB (1024 TiB)'
                    )
                ),
                array(
                    'name' => 'precision',
                    'label' => 'Decimal places',
                    'type' => 'number',
                    'placeholder' => '6',
                    'required' => false,
                    'hint' => '0 to 15. Defaults to 6.'
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Unit & Data Conversion Calculator actually check?',
                    'a' => 'Convert storage and data units between binary (KiB, MiB, GiB) and decimal (KB, MB, GB) systems. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'unix-timestamp-calculator',
            'name' => 'Timestamp / Unix Time Calculator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Convert Unix timestamps to and from human-readable dates in seconds or milliseconds, with UTC and ISO 8601.',
            'description' => 'Convert Unix timestamps to and from human-readable dates in seconds or milliseconds, with UTC and ISO 8601. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Timestamp / Unix Time Calculator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Convert Unix timestamps to and from human-readable dates in seconds or milliseconds, with UTC and ISO 8601. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'unix',
                'timestamp',
                'epoch',
                'iso 8601',
                'utc',
                'timezone',
                'converter',
                'calculator',
                'unix-timestamp-calculator',
                'developer',
                'timestamp / unix time calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/unix-timestamp-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'unix_timestamp',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'action',
                    'label' => 'Direction',
                    'type' => 'select',
                    'placeholder' => 'decode',
                    'required' => true,
                    'choices' => array(
                        'decode' => 'Timestamp → date/time',
                        'encode' => 'Date/time → timestamp',
                        'now' => 'Current timestamp'
                    )
                ),
                array(
                    'name' => 'timestamp',
                    'label' => 'Unix timestamp',
                    'type' => 'text',
                    'placeholder' => '1767225600',
                    'required' => false,
                    'hint' => 'Seconds or milliseconds — the tool detects which.'
                ),
                array(
                    'name' => 'datetime',
                    'label' => 'Date and time',
                    'type' => 'text',
                    'placeholder' => '2026-01-01T00:00:00Z',
                    'required' => false,
                    'hint' => 'ISO 8601, or YYYY-MM-DD HH:MM:SS.'
                ),
                array(
                    'name' => 'zone',
                    'label' => 'Time zone',
                    'type' => 'select',
                    'placeholder' => 'utc',
                    'required' => true,
                    'choices' => array(
                        'utc' => 'UTC',
                        'local' => 'My local time zone'
                    )
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Timestamp / Unix Time Calculator actually check?',
                    'a' => 'Convert Unix timestamps to and from human-readable dates in seconds or milliseconds, with UTC and ISO 8601. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'api-key-generator',
            'name' => 'API Key / Token Generator',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Cryptographically secure API keys and bearer tokens with a prefix, a chosen alphabet and bulk output.',
            'description' => 'Generates secrets from the browser\'s cryptographic random source (window.crypto) — never Math.random — with rejection sampling so every character in the chosen alphabet is equally likely and no modulo bias is introduced. Choose a prefix, a length and a character set, and generate one key or a batch. The estimated entropy in bits is reported so a weak choice is visible before you deploy it. Privacy: keys are created in your browser tab, are not sent to CloudHost247, are not written to logs or analytics, are not placed in a URL and are not persisted — closing the tab discards them. Scope: this generates random material. It does not register, validate or rotate a key in any service.',
            'seoTitle' => 'API Key / Token Generator — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Cryptographically secure API keys and bearer tokens with a prefix, a chosen alphabet and bulk output. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'api key',
                'token',
                'bearer',
                'secret',
                'random',
                'generator',
                'cryptography',
                'api-key-generator',
                'cybersecurity',
                'api key / token generator'
            ),
            'aliases' => array(),
            'path' => '/tools/api-key-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'api_key_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'prefix',
                    'label' => 'Prefix',
                    'type' => 'text',
                    'placeholder' => 'ch247',
                    'required' => false,
                    'hint' => 'Optional. Separated from the secret with an underscore.'
                ),
                array(
                    'name' => 'length',
                    'label' => 'Secret length',
                    'type' => 'number',
                    'placeholder' => '40',
                    'required' => true,
                    'hint' => '16 to 256 characters of secret, excluding the prefix.'
                ),
                array(
                    'name' => 'alphabet',
                    'label' => 'Character set',
                    'type' => 'select',
                    'placeholder' => 'base62',
                    'required' => true,
                    'choices' => array(
                        'base62' => 'A–Z a–z 0–9 (URL-safe)',
                        'hex' => '0–9 a–f (hex)',
                        'base32' => 'A–Z 2–7 (Crockford-safe)',
                        'urlsafe' => 'A–Z a–z 0–9 - _ (base64url)',
                        'digits' => '0–9 only'
                    )
                ),
                array(
                    'name' => 'count',
                    'label' => 'How many',
                    'type' => 'number',
                    'placeholder' => '1',
                    'required' => true,
                    'hint' => '1 to 100.'
                )
            ),
            'relatedTools' => array(
                'checksum-hash-generator',
                'http-security-headers-generator',
                'password-policy-generator',
                'ssl-certificate-checker'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Is the randomness suitable for secrets?',
                    'a' => 'It uses window.crypto.getRandomValues, the browser\'s CSPRNG, with rejection sampling to avoid modulo bias. If your browser has no CSPRNG the tool refuses to run rather than falling back to Math.random.'
                ),
                array(
                    'q' => 'Are the keys stored anywhere?',
                    'a' => 'No. They exist in this tab only, are not uploaded, not logged, not added to a URL and not written to local storage. Copy them now; refreshing discards them.'
                ),
                array(
                    'q' => 'Does this make my API secure?',
                    'a' => 'No. It produces random material. Transport security, storage at rest, rotation, scoping and revocation are your service\'s responsibility.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'checksum-hash-generator',
            'name' => 'Checksum / Hash Generator',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'SHA-256, SHA-384, SHA-512, SHA-1 and MD5 digests of text or a file, computed in your browser.',
            'description' => 'Computes cryptographic digests with the Web Crypto API in your browser tab. SHA-256, SHA-384 and SHA-512 are the recommended choices. SHA-1 is offered only for compatibility with systems that still publish SHA-1 fingerprints, and is labelled as such. MD5 is offered strictly as a legacy checksum for file identity against an older manifest: it is broken for collision resistance and must not be used for signatures, certificates or passwords. Output is hex and Base64. Files are read locally and are never uploaded.',
            'seoTitle' => 'Checksum / Hash Generator — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'SHA-256, SHA-384, SHA-512, SHA-1 and MD5 digests of text or a file, computed in your browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'hash',
                'checksum',
                'sha256',
                'sha384',
                'sha512',
                'sha1',
                'md5',
                'digest',
                'integrity',
                'generator',
                'checksum-hash-generator',
                'cybersecurity',
                'checksum / hash generator'
            ),
            'aliases' => array(),
            'path' => '/tools/checksum-hash-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'checksum_hash',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'source',
                    'label' => 'Input',
                    'type' => 'select',
                    'placeholder' => 'text',
                    'required' => true,
                    'choices' => array(
                        'text' => 'Text',
                        'file' => 'File'
                    )
                ),
                array(
                    'name' => 'text',
                    'label' => 'Text to hash',
                    'type' => 'textarea',
                    'placeholder' => 'Text to hash',
                    'required' => false
                ),
                array(
                    'name' => 'file',
                    'label' => 'File to hash',
                    'type' => 'file',
                    'placeholder' => '',
                    'required' => false,
                    'hint' => 'Read in this browser tab; never uploaded.'
                ),
                array(
                    'name' => 'algorithm',
                    'label' => 'Algorithm',
                    'type' => 'select',
                    'placeholder' => 'sha256',
                    'required' => true,
                    'choices' => array(
                        'sha256' => 'SHA-256 (recommended)',
                        'sha384' => 'SHA-384',
                        'sha512' => 'SHA-512',
                        'sha1' => 'SHA-1 (compatibility only)',
                        'md5' => 'MD5 (legacy checksum only)'
                    )
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'http-security-headers-generator',
                'password-policy-generator',
                'ssl-certificate-checker'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Where is the file read?',
                    'a' => 'In your browser tab, through the File API. It is streamed into the Web Crypto digest and never leaves your machine.'
                ),
                array(
                    'q' => 'Can I use MD5 for security?',
                    'a' => 'No. MD5 collisions are practical. Use it only to compare against an older manifest that publishes MD5, and treat a match as weak evidence.'
                ),
                array(
                    'q' => 'Does a matching checksum prove a file is safe?',
                    'a' => 'No. A digest proves the bytes are the same as the bytes that produced the reference digest. It says nothing about whether those bytes are trustworthy — that depends on where the reference digest came from.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'json-formatter',
            'name' => 'JSON Formatter / Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Format, minify and validate JSON with precise syntax error positions. Nothing is uploaded.',
            'description' => 'Parses JSON in your browser tab and re-emits it formatted, minified or simply validated. Invalid input produces the parser\'s message together with the line, the column and the offending fragment, so a syntax error can be found without counting braces by hand. Formatting preserves key order and value types; numbers that the parser would lose precision on (beyond 2^53) are reported rather than silently rewritten. The result can be copied or downloaded, and nothing is sent to CloudHost247.',
            'seoTitle' => 'JSON Formatter / Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Format, minify and validate JSON with precise syntax error positions. Nothing is uploaded. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'json',
                'formatter',
                'beautify',
                'minify',
                'validate',
                'syntax error',
                'generator',
                'json-formatter',
                'developer',
                'json formatter / generator'
            ),
            'aliases' => array(),
            'path' => '/tools/json-formatter',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'json_format',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'action',
                    'label' => 'Action',
                    'type' => 'select',
                    'placeholder' => 'format',
                    'required' => true,
                    'choices' => array(
                        'format' => 'Format (pretty-print)',
                        'minify' => 'Minify',
                        'validate' => 'Validate only'
                    )
                ),
                array(
                    'name' => 'text',
                    'label' => 'JSON',
                    'type' => 'textarea',
                    'placeholder' => '{"service":"example","enabled":true}',
                    'required' => true
                ),
                array(
                    'name' => 'indent',
                    'label' => 'Indent',
                    'type' => 'select',
                    'placeholder' => '2',
                    'required' => true,
                    'choices' => array(
                        '2' => '2 spaces',
                        '4' => '4 spaces',
                        'tab' => 'Tab'
                    )
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does JSON Formatter / Generator actually check?',
                    'a' => 'Format, minify and validate JSON with precise syntax error positions. Nothing is uploaded. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'http-security-headers-generator',
            'name' => 'HTTP Security Headers Generator',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Build a reviewed set of HTTP security headers and export it for nginx, Apache, .htaccess or Cloudflare.',
            'description' => 'Assembles a coherent set of response headers — Content-Security-Policy, Strict-Transport-Security, X-Content-Type-Options, Referrer-Policy, Permissions-Policy and frame protection — and emits them in the syntax the chosen server actually accepts. The choices are deliberately narrow: a strict CSP that will work on a site with no inline script, a balanced one for a site that still has inline styles, or none. The tool is configuration assistance. It does not scan your site, does not test the policy and does not tell you whether your application is secure; deploy the output to a staging host first and watch the console for violations.',
            'seoTitle' => 'HTTP Security Headers Generator — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Build a reviewed set of HTTP security headers and export it for nginx, Apache, .htaccess or Cloudflare. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'security headers',
                'csp',
                'hsts',
                'x-frame-options',
                'referrer-policy',
                'permissions-policy',
                'nginx',
                'apache',
                'generator',
                'http-security-headers-generator',
                'cybersecurity',
                'http security headers generator'
            ),
            'aliases' => array(),
            'path' => '/tools/http-security-headers-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'http_security_headers',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'server',
                    'label' => 'Output format',
                    'type' => 'select',
                    'placeholder' => 'nginx',
                    'required' => true,
                    'choices' => array(
                        'nginx' => 'nginx',
                        'apache' => 'Apache (.htaccess)',
                        'caddy' => 'Caddy',
                        'cloudflare' => 'Cloudflare Transform Rules',
                        'raw' => 'Plain header list'
                    )
                ),
                array(
                    'name' => 'csp',
                    'label' => 'Content-Security-Policy',
                    'type' => 'select',
                    'placeholder' => 'strict',
                    'required' => true,
                    'choices' => array(
                        'strict' => 'Strict — self only, no inline',
                        'balanced' => 'Balanced — self plus inline styles',
                        'off' => 'Omit the header'
                    )
                ),
                array(
                    'name' => 'hsts',
                    'label' => 'Strict-Transport-Security',
                    'type' => 'select',
                    'placeholder' => 'oneyear',
                    'required' => true,
                    'choices' => array(
                        'oneyear' => '1 year + includeSubDomains + preload',
                        'sixmonths' => '180 days + includeSubDomains',
                        'off' => 'Omit'
                    )
                ),
                array(
                    'name' => 'frame',
                    'label' => 'Frame / embedding protection',
                    'type' => 'select',
                    'placeholder' => 'deny',
                    'required' => true,
                    'choices' => array(
                        'deny' => 'Deny all framing',
                        'sameorigin' => 'Same origin only',
                        'off' => 'Omit'
                    )
                ),
                array(
                    'name' => 'referrerpolicy',
                    'label' => 'Referrer-Policy',
                    'type' => 'select',
                    'placeholder' => 'strict-origin-when-cross-origin',
                    'required' => true,
                    'choices' => array(
                        'no-referrer' => 'no-referrer',
                        'strict-origin-when-cross-origin' => 'strict-origin-when-cross-origin',
                        'same-origin' => 'same-origin'
                    )
                ),
                array(
                    'name' => 'permissions',
                    'label' => 'Permissions-Policy',
                    'type' => 'select',
                    'placeholder' => 'restrictive',
                    'required' => true,
                    'choices' => array(
                        'restrictive' => 'Restrict camera, microphone, geolocation, payment, usb',
                        'off' => 'Omit'
                    )
                ),
                array(
                    'name' => 'cookies',
                    'label' => 'Assume cookies with SameSite + Secure',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'domain',
                    'label' => 'Site domain',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => false,
                    'hint' => 'Optional. Used for the HSTS preload note only.'
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'password-policy-generator',
                'ssl-certificate-checker'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Will a strict CSP break my site?',
                    'a' => 'It can. A self-only policy with no unsafe-inline blocks inline script and style attributes. Test on staging, or start with Content-Security-Policy-Report-Only and read the violation reports before enforcing.'
                ),
                array(
                    'q' => 'Does this verify my headers?',
                    'a' => 'No. It generates configuration. To verify what a host actually sends, use the HTTP Headers Checker tool in this catalogue.'
                ),
                array(
                    'q' => 'Should I enable HSTS preload immediately?',
                    'a' => 'Only when every host and subdomain serves valid HTTPS and will do so permanently. Preload submission is effectively irreversible for months.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'password-policy-generator',
            'name' => 'Password Policy Generator',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Produce a documented password and authentication policy from the controls you select, ready to publish.',
            'description' => 'Turns the controls you select into a plain-language policy document you can hand to an auditor, publish in a wiki or attach to an onboarding pack: minimum length, composition, multi-factor scope, lockout and rate limiting, password history, maximum age, session timeout, storage algorithm and the review cadence that follows from those choices. Each section states what the control does and what it does not do. The guidance is aligned with NIST SP 800-63B and OWASP ASVS reasoning rather than legacy complexity rules, and the output says so. This is policy authoring — it does not configure an identity provider and it does not verify that your systems enforce what the document says.',
            'seoTitle' => 'Password Policy Generator — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Produce a documented password and authentication policy from the controls you select, ready to publish. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'password policy',
                'mfa',
                'lockout',
                'password history',
                'session',
                'compliance',
                'documentation',
                'generator',
                'password-policy-generator',
                'cybersecurity',
                'password policy generator'
            ),
            'aliases' => array(),
            'path' => '/tools/password-policy-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'password_policy',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'minLength',
                    'label' => 'Minimum length',
                    'type' => 'number',
                    'placeholder' => '14',
                    'required' => true,
                    'hint' => '6 to 128.'
                ),
                array(
                    'name' => 'mfa',
                    'label' => 'Multi-factor authentication',
                    'type' => 'select',
                    'placeholder' => 'required',
                    'required' => true,
                    'choices' => array(
                        'required' => 'Required for every account',
                        'privileged' => 'Required for privileged accounts only',
                        'optional' => 'Recommended, not enforced'
                    )
                ),
                array(
                    'name' => 'lockoutThreshold',
                    'label' => 'Failed attempts before lockout',
                    'type' => 'number',
                    'placeholder' => '5',
                    'required' => true,
                    'hint' => '0 disables lockout.'
                ),
                array(
                    'name' => 'lockoutMinutes',
                    'label' => 'Lockout duration (minutes)',
                    'type' => 'number',
                    'placeholder' => '15',
                    'required' => true
                ),
                array(
                    'name' => 'history',
                    'label' => 'Remembered previous passwords',
                    'type' => 'number',
                    'placeholder' => '5',
                    'required' => true,
                    'hint' => '0 to 24.'
                ),
                array(
                    'name' => 'maxAgeDays',
                    'label' => 'Maximum password age (days)',
                    'type' => 'number',
                    'placeholder' => '0',
                    'required' => true,
                    'hint' => '0 means no scheduled expiry.'
                ),
                array(
                    'name' => 'sessionMinutes',
                    'label' => 'Idle session timeout (minutes)',
                    'type' => 'number',
                    'placeholder' => '30',
                    'required' => true
                ),
                array(
                    'name' => 'breachCheck',
                    'label' => 'Screen new passwords against breached-password lists',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'complexity',
                    'label' => 'Composition rules',
                    'type' => 'select',
                    'placeholder' => 'length',
                    'required' => true,
                    'choices' => array(
                        'length' => 'Length only — NIST SP 800-63B aligned',
                        'classes' => 'Require upper, lower, digit and symbol'
                    )
                ),
                array(
                    'name' => 'storage',
                    'label' => 'Password storage',
                    'type' => 'select',
                    'placeholder' => 'argon2',
                    'required' => true,
                    'choices' => array(
                        'argon2' => 'Argon2id',
                        'scrypt' => 'scrypt',
                        'pbkdf2' => 'PBKDF2-SHA-256 (high iteration count)'
                    )
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'http-security-headers-generator',
                'ssl-certificate-checker'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Does this certify my compliance?',
                    'a' => 'No. It writes down the controls you chose in a form an auditor can read. Certification requires your systems to enforce them and evidence that they do.'
                ),
                array(
                    'q' => 'Why is complexity optional?',
                    'a' => 'NIST SP 800-63B recommends length and breach screening over forced character classes, which push people towards predictable substitutions. The generator offers both and states the trade-off in the document it produces.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'dns-record-generator',
            'name' => 'DNS / Domain Configuration Generator',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Build A, AAAA, CNAME, MX, TXT, SPF, DMARC and DKIM records from the values you supply, with format validation.',
            'description' => 'Assembles a DNS configuration from values you supply and refuses to invent any of them. Every record is validated before output: IPv4 and IPv6 literals are parsed properly, a CNAME target must be a hostname and cannot coexist with another record at the same name, an MX host must not be an address literal, SPF is checked against the 10-DNS-lookup limit for the mechanisms you list, DMARC is checked for the required v=DMARC1 and p= tags, and a DKIM record is emitted only when both a selector and a public key are present. Nothing is published: the output is a BIND zone fragment, structured JSON or a Cloudflare import CSV for you to review and apply.',
            'seoTitle' => 'DNS / Domain Configuration Generator — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Build A, AAAA, CNAME, MX, TXT, SPF, DMARC and DKIM records from the values you supply, with format validation. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'dns',
                'records',
                'zone file',
                'a',
                'aaaa',
                'cname',
                'mx',
                'txt',
                'spf',
                'dmarc',
                'dkim',
                'generator',
                'dns-record-generator',
                'dns',
                'dns / domain configuration generator'
            ),
            'aliases' => array(),
            'path' => '/tools/dns-record-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'dns_record_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'defaultTtl',
                    'label' => 'Default TTL (seconds)',
                    'type' => 'number',
                    'placeholder' => '3600',
                    'required' => true,
                    'hint' => '60 to 86400.'
                ),
                array(
                    'name' => 'aRecords',
                    'label' => 'A records (name = IPv4, one per line)',
                    'type' => 'textarea',
                    'placeholder' => '@ = 203.0.113.10',
                    'required' => false
                ),
                array(
                    'name' => 'aaaaRecords',
                    'label' => 'AAAA records (name = IPv6, one per line)',
                    'type' => 'textarea',
                    'placeholder' => '',
                    'required' => false
                ),
                array(
                    'name' => 'cnameRecords',
                    'label' => 'CNAME records (name = target, one per line)',
                    'type' => 'textarea',
                    'placeholder' => 'www = example.com.',
                    'required' => false
                ),
                array(
                    'name' => 'mxRecords',
                    'label' => 'MX records (priority host, one per line)',
                    'type' => 'textarea',
                    'placeholder' => '10 mail.example.com.',
                    'required' => false
                ),
                array(
                    'name' => 'txtRecords',
                    'label' => 'TXT records (name = value, one per line)',
                    'type' => 'textarea',
                    'placeholder' => '',
                    'required' => false
                ),
                array(
                    'name' => 'spfIncludes',
                    'label' => 'SPF include hosts',
                    'type' => 'text',
                    'placeholder' => '_spf.example.net',
                    'required' => false,
                    'hint' => 'Space or comma separated.'
                ),
                array(
                    'name' => 'spfPolicy',
                    'label' => 'SPF terminal policy',
                    'type' => 'select',
                    'placeholder' => '-all',
                    'required' => true,
                    'choices' => array(
                        '-all' => '-all (hard fail)',
                        '~all' => '~all (soft fail)',
                        '?all' => '?all (neutral)'
                    )
                ),
                array(
                    'name' => 'dmarcPolicy',
                    'label' => 'DMARC policy',
                    'type' => 'select',
                    'placeholder' => 'none',
                    'required' => true,
                    'choices' => array(
                        'none' => 'none',
                        'quarantine' => 'quarantine',
                        'reject' => 'reject'
                    )
                ),
                array(
                    'name' => 'dmarcRua',
                    'label' => 'DMARC aggregate report address',
                    'type' => 'text',
                    'placeholder' => 'dmarc@example.com',
                    'required' => false
                ),
                array(
                    'name' => 'dkimSelector',
                    'label' => 'DKIM selector',
                    'type' => 'text',
                    'placeholder' => '',
                    'required' => false,
                    'hint' => 'Only used if you also supply the public key.'
                ),
                array(
                    'name' => 'dkimPublicKey',
                    'label' => 'DKIM public key (base64, p= value)',
                    'type' => 'textarea',
                    'placeholder' => '',
                    'required' => false
                ),
                array(
                    'name' => 'format',
                    'label' => 'Output format',
                    'type' => 'select',
                    'placeholder' => 'zone',
                    'required' => true,
                    'choices' => array(
                        'zone' => 'BIND zone file',
                        'json' => 'Structured JSON',
                        'cloudflare' => 'Cloudflare import CSV'
                    )
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Does this change my DNS?',
                    'a' => 'No. It produces text for you to review and publish. No request is made to any registrar, DNS provider or resolver.'
                ),
                array(
                    'q' => 'Will it fill in values I leave out?',
                    'a' => 'No. An empty field produces no record. DKIM in particular is emitted only when you supply both the selector and the public key, because a guessed key would be worse than none.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'smtp-test',
            'name' => 'SMTP Test',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Connect to a public mail server, read the banner and send EHLO. Passwords are not accepted.',
            'description' => 'Connect to a public mail server, read the banner and send EHLO. Passwords are not accepted. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SMTP Test — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Connect to a public mail server, read the banner and send EHLO. Passwords are not accepted. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'smtp',
                'email',
                'banner',
                'smtp-test',
                'developer',
                'smtp test'
            ),
            'aliases' => array(),
            'path' => '/tools/smtp-test',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'smtp',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'host',
                    'label' => 'Mail host',
                    'type' => 'text',
                    'placeholder' => 'mail.example.com',
                    'required' => true
                ),
                array(
                    'name' => 'port',
                    'label' => 'Port',
                    'type' => 'select',
                    'placeholder' => '25',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SMTP Test actually check?',
                    'a' => 'Connect to a public mail server, read the banner and send EHLO. Passwords are not accepted. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'htaccess-redirect-generator',
            'name' => '.htaccess Redirect Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Generate an Apache redirect snippet for you to review and place yourself.',
            'description' => 'Generate an Apache redirect snippet for you to review and place yourself. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => '.htaccess Redirect Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Generate an Apache redirect snippet for you to review and place yourself. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'htaccess',
                'redirect',
                'apache',
                'htaccess-redirect-generator',
                'developer',
                '.htaccess redirect generator'
            ),
            'aliases' => array(),
            'path' => '/tools/htaccess-redirect-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'htaccess',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'source',
                    'label' => 'From path',
                    'type' => 'text',
                    'placeholder' => '/old',
                    'required' => true
                ),
                array(
                    'name' => 'target',
                    'label' => 'To URL',
                    'type' => 'text',
                    'placeholder' => 'https://example.com/new',
                    'required' => true
                ),
                array(
                    'name' => 'code',
                    'label' => 'Status',
                    'type' => 'select',
                    'placeholder' => '301',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does .htaccess Redirect Generator actually check?',
                    'a' => 'Generate an Apache redirect snippet for you to review and place yourself. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'url-rewrite-generator',
            'name' => 'URL Rewrite Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Generate a RewriteRule from a simple pattern. Review it before publishing.',
            'description' => 'Generate a RewriteRule from a simple pattern. Review it before publishing. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'URL Rewrite Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Generate a RewriteRule from a simple pattern. Review it before publishing. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'rewrite',
                'apache',
                'url',
                'url-rewrite-generator',
                'developer',
                'url rewrite generator'
            ),
            'aliases' => array(),
            'path' => '/tools/url-rewrite-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'rewrite',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'pattern',
                    'label' => 'Pattern',
                    'type' => 'text',
                    'placeholder' => '^blog/([0-9]+)$',
                    'required' => true
                ),
                array(
                    'name' => 'dest',
                    'label' => 'Substitution',
                    'type' => 'text',
                    'placeholder' => '/post.php?id=$1',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does URL Rewrite Generator actually check?',
                    'a' => 'Generate a RewriteRule from a simple pattern. Review it before publishing. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'broken-link-checker',
            'name' => 'Broken Link Checker',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Fetch one public page and check a bounded set of its links. This is not an unlimited crawler.',
            'description' => 'Fetch one public page and check a bounded set of its links. This is not an unlimited crawler. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Broken Link Checker — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Fetch one public page and check a bounded set of its links. This is not an unlimited crawler. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'broken',
                'links',
                'http',
                'broken-link-checker',
                'developer',
                'broken link checker'
            ),
            'aliases' => array(),
            'path' => '/tools/broken-link-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'broken_links',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Broken Link Checker actually check?',
                    'a' => 'Fetch one public page and check a bounded set of its links. This is not an unlimited crawler. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'open-graph-checker',
            'name' => 'Open Graph Checker',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Read Open Graph and Twitter card tags from a public page. Missing tags are reported as missing.',
            'description' => 'Read Open Graph and Twitter card tags from a public page. Missing tags are reported as missing. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Open Graph Checker — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Read Open Graph and Twitter card tags from a public page. Missing tags are reported as missing. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'opengraph',
                'og',
                'social',
                'open-graph-checker',
                'developer',
                'open graph checker'
            ),
            'aliases' => array(),
            'path' => '/tools/open-graph-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'open_graph',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Open Graph Checker actually check?',
                    'a' => 'Read Open Graph and Twitter card tags from a public page. Missing tags are reported as missing. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'raid-calculator',
            'name' => 'RAID Calculator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Estimate usable capacity for RAID 0, 1, 5, 6 and 10 from disk count and size.',
            'description' => 'Estimate usable capacity for RAID 0, 1, 5, 6 and 10 from disk count and size. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'RAID Calculator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Estimate usable capacity for RAID 0, 1, 5, 6 and 10 from disk count and size. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'raid',
                'calculator',
                'storage',
                'raid-calculator',
                'developer',
                'raid calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/raid-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'raid',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'disks',
                    'label' => 'Number of disks',
                    'type' => 'number',
                    'placeholder' => '4',
                    'required' => true
                ),
                array(
                    'name' => 'size',
                    'label' => 'Disk size (GB)',
                    'type' => 'number',
                    'placeholder' => '1000',
                    'required' => true
                ),
                array(
                    'name' => 'level',
                    'label' => 'RAID level',
                    'type' => 'select',
                    'placeholder' => '5',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does RAID Calculator actually check?',
                    'a' => 'Estimate usable capacity for RAID 0, 1, 5, 6 and 10 from disk count and size. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'binary-translator',
            'name' => 'Binary Translator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Decode space-separated binary bytes into text in your browser.',
            'description' => 'Decode space-separated binary bytes into text in your browser. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Binary Translator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Decode space-separated binary bytes into text in your browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'binary',
                'decode',
                'text',
                'binary-translator',
                'developer',
                'binary translator'
            ),
            'aliases' => array(),
            'path' => '/tools/binary-translator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'binary',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Binary',
                    'type' => 'textarea',
                    'placeholder' => '01000011 01001000',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Binary Translator actually check?',
                    'a' => 'Decode space-separated binary bytes into text in your browser. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'text-to-binary',
            'name' => 'Text to Binary',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Encode text as 8-bit binary in your browser.',
            'description' => 'Encode text as 8-bit binary in your browser. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Text to Binary — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Encode text as 8-bit binary in your browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'binary',
                'encode',
                'text',
                'text-to-binary',
                'developer',
                'text to binary'
            ),
            'aliases' => array(),
            'path' => '/tools/text-to-binary',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'text_binary',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'CH247',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Text to Binary actually check?',
                    'a' => 'Encode text as 8-bit binary in your browser. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'json-viewer',
            'name' => 'JSON Viewer',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Parse JSON and show a readable tree. Invalid JSON is an error, not a guess.',
            'description' => 'Parse JSON and show a readable tree. Invalid JSON is an error, not a guess. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'JSON Viewer — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Parse JSON and show a readable tree. Invalid JSON is an error, not a guess. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'json',
                'viewer',
                'parse',
                'json-viewer',
                'developer',
                'json viewer'
            ),
            'aliases' => array(),
            'path' => '/tools/json-viewer',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'json_view',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'JSON',
                    'type' => 'textarea',
                    'placeholder' => '{"ok":true}',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does JSON Viewer actually check?',
                    'a' => 'Parse JSON and show a readable tree. Invalid JSON is an error, not a guess. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'json-beautifier',
            'name' => 'JSON Beautifier',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Format JSON with indentation. The parser rejects trailing commas and comments.',
            'description' => 'Format JSON with indentation. The parser rejects trailing commas and comments. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'JSON Beautifier — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Format JSON with indentation. The parser rejects trailing commas and comments. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'json',
                'beautifier',
                'format',
                'json-beautifier',
                'developer',
                'json beautifier'
            ),
            'aliases' => array(),
            'path' => '/tools/json-beautifier',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'json_beautify',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'JSON',
                    'type' => 'textarea',
                    'placeholder' => '{"a":1}',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does JSON Beautifier actually check?',
                    'a' => 'Format JSON with indentation. The parser rejects trailing commas and comments. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'json-minifier',
            'name' => 'JSON Minifier',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Minify JSON after a real parse, so broken input is not silently shipped.',
            'description' => 'Minify JSON after a real parse, so broken input is not silently shipped. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'JSON Minifier — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Minify JSON after a real parse, so broken input is not silently shipped. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'json',
                'minify',
                'json-minifier',
                'developer',
                'json minifier'
            ),
            'aliases' => array(),
            'path' => '/tools/json-minifier',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'json_minify',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'JSON',
                    'type' => 'textarea',
                    'placeholder' => '{
  "a": 1
}',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does JSON Minifier actually check?',
                    'a' => 'Minify JSON after a real parse, so broken input is not silently shipped. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'email-verifier',
            'name' => 'Email Verifier',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Check address syntax and whether the domain publishes MX records. A mailbox is not confirmed.',
            'description' => 'Check address syntax and whether the domain publishes MX records. A mailbox is not confirmed. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Email Verifier — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Check address syntax and whether the domain publishes MX records. A mailbox is not confirmed. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'email',
                'verify',
                'mx',
                'email-verifier',
                'developer',
                'email verifier'
            ),
            'aliases' => array(),
            'path' => '/tools/email-verifier',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'email_verify',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'email',
                    'label' => 'Email address',
                    'type' => 'text',
                    'placeholder' => 'name@example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Email Verifier actually check?',
                    'a' => 'Check address syntax and whether the domain publishes MX records. A mailbox is not confirmed. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'rgb-to-colortone',
            'name' => 'RGB to Colortone',
            'category' => 'designer',
            'categoryLabel' => 'Designer',
            'icon' => 'designer',
            'summary' => 'Match an RGB color to the nearest CloudHost247 Colortone and show converted values.',
            'description' => 'Match an RGB color to the nearest CloudHost247 Colortone and show converted values. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'RGB to Colortone — Free Designer Tool | CloudHost247',
            'seoDescription' => 'Match an RGB color to the nearest CloudHost247 Colortone and show converted values. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'rgb',
                'color',
                'colortone',
                'rgb-to-colortone',
                'designer',
                'rgb to colortone'
            ),
            'aliases' => array(),
            'path' => '/tools/rgb-to-colortone',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'color_rgb',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'r',
                    'label' => 'Red',
                    'type' => 'number',
                    'placeholder' => '25',
                    'required' => true
                ),
                array(
                    'name' => 'g',
                    'label' => 'Green',
                    'type' => 'number',
                    'placeholder' => '105',
                    'required' => true
                ),
                array(
                    'name' => 'b',
                    'label' => 'Blue',
                    'type' => 'number',
                    'placeholder' => '71',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'hex-to-colortone',
                'cmyk-to-colortone',
                'hsv-to-colortone'
            ),
            'services' => array(
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does RGB to Colortone actually check?',
                    'a' => 'Match an RGB color to the nearest CloudHost247 Colortone and show converted values. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'hex-to-colortone',
            'name' => 'HEX to Colortone',
            'category' => 'designer',
            'categoryLabel' => 'Designer',
            'icon' => 'designer',
            'summary' => 'Match a HEX color to the nearest CloudHost247 Colortone and preview it.',
            'description' => 'Match a HEX color to the nearest CloudHost247 Colortone and preview it. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'HEX to Colortone — Free Designer Tool | CloudHost247',
            'seoDescription' => 'Match a HEX color to the nearest CloudHost247 Colortone and preview it. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'hex',
                'color',
                'colortone',
                'hex-to-colortone',
                'designer',
                'hex to colortone'
            ),
            'aliases' => array(),
            'path' => '/tools/hex-to-colortone',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'color_hex',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'hex',
                    'label' => 'HEX',
                    'type' => 'text',
                    'placeholder' => '#196947',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'rgb-to-colortone',
                'cmyk-to-colortone',
                'hsv-to-colortone'
            ),
            'services' => array(
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does HEX to Colortone actually check?',
                    'a' => 'Match a HEX color to the nearest CloudHost247 Colortone and preview it. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'cmyk-to-colortone',
            'name' => 'CMYK to Colortone',
            'category' => 'designer',
            'categoryLabel' => 'Designer',
            'icon' => 'designer',
            'summary' => 'Convert CMYK percentages to RGB, then match the nearest CloudHost247 Colortone.',
            'description' => 'Convert CMYK percentages to RGB, then match the nearest CloudHost247 Colortone. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'CMYK to Colortone — Free Designer Tool | CloudHost247',
            'seoDescription' => 'Convert CMYK percentages to RGB, then match the nearest CloudHost247 Colortone. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'cmyk',
                'color',
                'colortone',
                'cmyk-to-colortone',
                'designer',
                'cmyk to colortone'
            ),
            'aliases' => array(),
            'path' => '/tools/cmyk-to-colortone',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'color_cmyk',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'c',
                    'label' => 'Cyan %',
                    'type' => 'number',
                    'placeholder' => '76',
                    'required' => true
                ),
                array(
                    'name' => 'm',
                    'label' => 'Magenta %',
                    'type' => 'number',
                    'placeholder' => '33',
                    'required' => true
                ),
                array(
                    'name' => 'y',
                    'label' => 'Yellow %',
                    'type' => 'number',
                    'placeholder' => '32',
                    'required' => true
                ),
                array(
                    'name' => 'k',
                    'label' => 'Black %',
                    'type' => 'number',
                    'placeholder' => '42',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'rgb-to-colortone',
                'hex-to-colortone',
                'hsv-to-colortone'
            ),
            'services' => array(
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does CMYK to Colortone actually check?',
                    'a' => 'Convert CMYK percentages to RGB, then match the nearest CloudHost247 Colortone. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'hsv-to-colortone',
            'name' => 'HSV to Colortone',
            'category' => 'designer',
            'categoryLabel' => 'Designer',
            'icon' => 'designer',
            'summary' => 'Convert HSV to RGB and match the nearest CloudHost247 Colortone.',
            'description' => 'Convert HSV to RGB and match the nearest CloudHost247 Colortone. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'HSV to Colortone — Free Designer Tool | CloudHost247',
            'seoDescription' => 'Convert HSV to RGB and match the nearest CloudHost247 Colortone. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'hsv',
                'color',
                'colortone',
                'hsv-to-colortone',
                'designer',
                'hsv to colortone'
            ),
            'aliases' => array(),
            'path' => '/tools/hsv-to-colortone',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'color_hsv',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'h',
                    'label' => 'Hue',
                    'type' => 'number',
                    'placeholder' => '152',
                    'required' => true
                ),
                array(
                    'name' => 's',
                    'label' => 'Saturation %',
                    'type' => 'number',
                    'placeholder' => '76',
                    'required' => true
                ),
                array(
                    'name' => 'v',
                    'label' => 'Value %',
                    'type' => 'number',
                    'placeholder' => '41',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'rgb-to-colortone',
                'hex-to-colortone',
                'cmyk-to-colortone'
            ),
            'services' => array(
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does HSV to Colortone actually check?',
                    'a' => 'Convert HSV to RGB and match the nearest CloudHost247 Colortone. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'website-link-analyzer',
            'name' => 'Website Link Analyzer',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Summarize internal, external and nofollow links on a single public page.',
            'description' => 'Summarize internal, external and nofollow links on a single public page. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Website Link Analyzer — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Summarize internal, external and nofollow links on a single public page. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'links',
                'analyzer',
                'seo',
                'website-link-analyzer',
                'webmaster',
                'website link analyzer'
            ),
            'aliases' => array(),
            'path' => '/tools/website-link-analyzer',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'link_analyzer',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'user-agent-checker',
                'pagerank-checker',
                'punycode-converter',
                'serp-simulator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Website Link Analyzer actually check?',
                    'a' => 'Summarize internal, external and nofollow links on a single public page. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'user-agent-checker',
            'name' => 'User Agent Checker',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Show and parse the user agent your browser sends. A declared agent is not proof of identity.',
            'description' => 'Show and parse the user agent your browser sends. A declared agent is not proof of identity. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'User Agent Checker — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Show and parse the user agent your browser sends. A declared agent is not proof of identity. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'user agent',
                'browser',
                'user-agent-checker',
                'webmaster',
                'user agent checker'
            ),
            'aliases' => array(),
            'path' => '/tools/user-agent-checker',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'user_agent',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'website-link-analyzer',
                'pagerank-checker',
                'punycode-converter',
                'serp-simulator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does User Agent Checker actually check?',
                    'a' => 'Show and parse the user agent your browser sends. A declared agent is not proof of identity. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'pagerank-checker',
            'name' => 'Google Page Rank Checker',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Explain that public Google PageRank is retired, and show only observable indexability signals.',
            'description' => 'Explain that public Google PageRank is retired, and show only observable indexability signals. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Google Page Rank Checker — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Explain that public Google PageRank is retired, and show only observable indexability signals. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'pagerank',
                'seo',
                'google',
                'pagerank-checker',
                'webmaster',
                'google page rank checker'
            ),
            'aliases' => array(),
            'path' => '/tools/pagerank-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'pagerank',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Website URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'website-link-analyzer',
                'user-agent-checker',
                'punycode-converter',
                'serp-simulator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Google Page Rank Checker actually check?',
                    'a' => 'Explain that public Google PageRank is retired, and show only observable indexability signals. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'punycode-converter',
            'name' => 'Punycode Converter',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Convert between Unicode domains and Punycode. Conversion is not a safety endorsement.',
            'description' => 'Convert between Unicode domains and Punycode. Conversion is not a safety endorsement. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Punycode Converter — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Convert between Unicode domains and Punycode. Conversion is not a safety endorsement. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'punycode',
                'idn',
                'domain',
                'punycode-converter',
                'webmaster',
                'punycode converter'
            ),
            'aliases' => array(),
            'path' => '/tools/punycode-converter',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'punycode',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Domain',
                    'type' => 'text',
                    'placeholder' => 'münchen.example',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'website-link-analyzer',
                'user-agent-checker',
                'pagerank-checker',
                'serp-simulator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Punycode Converter actually check?',
                    'a' => 'Convert between Unicode domains and Punycode. Conversion is not a safety endorsement. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'serp-simulator',
            'name' => 'Google SERP Simulator',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Preview how a title and description may truncate. This is not a ranking prediction.',
            'description' => 'Preview how a title and description may truncate. This is not a ranking prediction. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Google SERP Simulator — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Preview how a title and description may truncate. This is not a ranking prediction. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'serp',
                'seo',
                'preview',
                'serp-simulator',
                'webmaster',
                'google serp simulator'
            ),
            'aliases' => array(),
            'path' => '/tools/serp-simulator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'serp',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'title',
                    'label' => 'Title',
                    'type' => 'text',
                    'placeholder' => 'Example page title',
                    'required' => true
                ),
                array(
                    'name' => 'url',
                    'label' => 'URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com/page',
                    'required' => true
                ),
                array(
                    'name' => 'description',
                    'label' => 'Description',
                    'type' => 'textarea',
                    'placeholder' => 'A short description.',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'website-link-analyzer',
                'user-agent-checker',
                'pagerank-checker',
                'punycode-converter'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Google SERP Simulator actually check?',
                    'a' => 'Preview how a title and description may truncate. This is not a ranking prediction. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'robots-txt-generator',
            'name' => 'Robots.txt Generator',
            'category' => 'webmaster',
            'categoryLabel' => 'Webmaster',
            'icon' => 'webmaster',
            'summary' => 'Build a valid robots.txt from your user-agent rules, allow and disallow paths, crawl-delay and sitemap URLs.',
            'description' => 'Assembles a robots.txt file from the rules you enter and validates them as it goes: each Disallow and Allow path must start with a forward slash, a sitemap must be an absolute http(s) URL, and a crawl-delay must be a positive number of seconds. Multiple user-agents share one rule block, which is what the specification expects. The preview is the exact file text you can download and publish. Scope: this writes crawl guidance for cooperating crawlers. It is not an access control, it does not hide anything from a client that ignores it, and it does not verify how a search engine currently treats your site.',
            'seoTitle' => 'Robots.txt Generator — Free Webmaster Tool | CloudHost247',
            'seoDescription' => 'Build a valid robots.txt from your user-agent rules, allow and disallow paths, crawl-delay and sitemap URLs. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'robots',
                'robots.txt',
                'seo',
                'crawler',
                'user-agent',
                'sitemap',
                'crawl-delay',
                'generator',
                'robots-txt-generator',
                'webmaster',
                'robots.txt generator'
            ),
            'aliases' => array(),
            'path' => '/tools/robots-txt-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'robots',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'agent',
                    'label' => 'User-agent (one per line)',
                    'type' => 'textarea',
                    'placeholder' => '*',
                    'required' => true,
                    'hint' => 'Use * for every crawler, or one token per line, e.g. Googlebot, Bingbot.'
                ),
                array(
                    'name' => 'disallow',
                    'label' => 'Disallow paths (one per line)',
                    'type' => 'textarea',
                    'placeholder' => '/admin/',
                    'required' => false
                ),
                array(
                    'name' => 'allow',
                    'label' => 'Allow paths (one per line)',
                    'type' => 'textarea',
                    'placeholder' => '',
                    'required' => false,
                    'hint' => 'An Allow inside a Disallowed directory re-opens that path. Most crawlers honour it.'
                ),
                array(
                    'name' => 'crawlDelay',
                    'label' => 'Crawl-delay (seconds)',
                    'type' => 'number',
                    'placeholder' => '',
                    'required' => false,
                    'hint' => 'Optional. Googlebot ignores this directive; Bing and Yandex honour it.'
                ),
                array(
                    'name' => 'sitemap',
                    'label' => 'Sitemap URLs (one per line)',
                    'type' => 'textarea',
                    'placeholder' => 'https://example.com/sitemap.xml',
                    'required' => false
                ),
                array(
                    'name' => 'noindexNote',
                    'label' => 'Warn about noindex in robots.txt',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                )
            ),
            'relatedTools' => array(
                'website-link-analyzer',
                'user-agent-checker',
                'pagerank-checker',
                'punycode-converter'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'WordPress',
                    'url' => 'wordpress-hosting.php'
                ),
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Website design',
                    'url' => 'website-design.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Does robots.txt keep a page private?',
                    'a' => 'No. It is a request that cooperating crawlers honour, and it is public. Anything that must stay private needs authentication. A Disallow can also keep a page out of your own view of the index while other sites still link to it.'
                ),
                array(
                    'q' => 'Does every crawler support crawl-delay?',
                    'a' => 'No. Googlebot ignores it; Bing and Yandex honour it. The generator notes this next to the value.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'port-checker',
            'name' => 'Port Checker',
            'category' => 'network',
            'categoryLabel' => 'Network',
            'icon' => 'network',
            'summary' => 'Test one TCP port on a public host. Private and metadata addresses are refused.',
            'description' => 'Test one TCP port on a public host. Private and metadata addresses are refused. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Port Checker — Free Network Tool | CloudHost247',
            'seoDescription' => 'Test one TCP port on a public host. Private and metadata addresses are refused. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'port',
                'tcp',
                'network',
                'port-checker',
                'network',
                'port checker'
            ),
            'aliases' => array(),
            'path' => '/tools/port-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'port',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'host',
                    'label' => 'Public host or IP',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'port',
                    'label' => 'Port',
                    'type' => 'number',
                    'placeholder' => '443',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'mac-address-lookup',
                'mac-address-generator',
                'asn-whois-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Network',
                    'url' => 'network.php'
                ),
                array(
                    'label' => 'Firewall',
                    'url' => 'firewall.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Port Checker actually check?',
                    'a' => 'Test one TCP port on a public host. Private and metadata addresses are refused. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'mac-address-lookup',
            'name' => 'MAC Address Lookup',
            'category' => 'network',
            'categoryLabel' => 'Network',
            'icon' => 'network',
            'summary' => 'Match a MAC prefix against CloudHost247\'s bundled public OUI sample. Unknown means not in that sample.',
            'description' => 'Match a MAC prefix against CloudHost247\'s bundled public OUI sample. Unknown means not in that sample. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'MAC Address Lookup — Free Network Tool | CloudHost247',
            'seoDescription' => 'Match a MAC prefix against CloudHost247\'s bundled public OUI sample. Unknown means not in that sample. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'mac',
                'oui',
                'vendor',
                'mac-address-lookup',
                'network',
                'mac address lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/mac-address-lookup',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'mac_lookup',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'mac',
                    'label' => 'MAC address',
                    'type' => 'text',
                    'placeholder' => '00:1A:11:00:00:00',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'port-checker',
                'mac-address-generator',
                'asn-whois-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Network',
                    'url' => 'network.php'
                ),
                array(
                    'label' => 'Firewall',
                    'url' => 'firewall.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does MAC Address Lookup actually check?',
                    'a' => 'Match a MAC prefix against CloudHost247\'s bundled public OUI sample. Unknown means not in that sample. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'mac-address-generator',
            'name' => 'MAC Address Generator',
            'category' => 'network',
            'categoryLabel' => 'Network',
            'icon' => 'network',
            'summary' => 'Generate a locally administered unicast MAC address for labs. It is not assigned to a manufacturer.',
            'description' => 'Generate a locally administered unicast MAC address for labs. It is not assigned to a manufacturer. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'MAC Address Generator — Free Network Tool | CloudHost247',
            'seoDescription' => 'Generate a locally administered unicast MAC address for labs. It is not assigned to a manufacturer. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'mac',
                'generator',
                'mac-address-generator',
                'network',
                'mac address generator'
            ),
            'aliases' => array(),
            'path' => '/tools/mac-address-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'mac_generate',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'port-checker',
                'mac-address-lookup',
                'asn-whois-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Network',
                    'url' => 'network.php'
                ),
                array(
                    'label' => 'Firewall',
                    'url' => 'firewall.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does MAC Address Generator actually check?',
                    'a' => 'Generate a locally administered unicast MAC address for labs. It is not assigned to a manufacturer. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'asn-whois-lookup',
            'name' => 'ASN WHOIS Lookup',
            'category' => 'network',
            'categoryLabel' => 'Network',
            'icon' => 'network',
            'summary' => 'Look up an autonomous system number through RDAP.',
            'description' => 'Look up an autonomous system number through RDAP. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'ASN WHOIS Lookup — Free Network Tool | CloudHost247',
            'seoDescription' => 'Look up an autonomous system number through RDAP. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'asn',
                'whois',
                'bgp',
                'asn-whois-lookup',
                'network',
                'asn whois lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/asn-whois-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'asn',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'ASN or IP',
                    'type' => 'text',
                    'placeholder' => 'AS13335',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'port-checker',
                'mac-address-lookup',
                'mac-address-generator'
            ),
            'services' => array(
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                ),
                array(
                    'label' => 'Network',
                    'url' => 'network.php'
                ),
                array(
                    'label' => 'Firewall',
                    'url' => 'firewall.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does ASN WHOIS Lookup actually check?',
                    'a' => 'Look up an autonomous system number through RDAP. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ssl-certificate-checker',
            'name' => 'SSL Certificate Checker',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Inspect the certificate a public host presents, including issuer, dates and names.',
            'description' => 'Inspect the certificate a public host presents, including issuer, dates and names. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SSL Certificate Checker — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Inspect the certificate a public host presents, including issuer, dates and names. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ssl',
                'tls',
                'certificate',
                'ssl-certificate-checker',
                'cybersecurity',
                'ssl certificate checker'
            ),
            'aliases' => array(),
            'path' => '/tools/ssl-certificate-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ssl',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'host',
                    'label' => 'Hostname',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'http-security-headers-generator',
                'password-policy-generator'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SSL Certificate Checker actually check?',
                    'a' => 'Inspect the certificate a public host presents, including issuer, dates and names. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'password-encryption',
            'name' => 'Password Encryption',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Derive a hash in your browser with SHA-256 or PBKDF2. The value is never uploaded or stored.',
            'description' => 'Derive a hash in your browser with SHA-256 or PBKDF2. The value is never uploaded or stored. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Password Encryption — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Derive a hash in your browser with SHA-256 or PBKDF2. The value is never uploaded or stored. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'password',
                'hash',
                'pbkdf2',
                'password-encryption',
                'cybersecurity',
                'password encryption'
            ),
            'aliases' => array(),
            'path' => '/tools/password-encryption',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'password_hash',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'password',
                    'label' => 'Password',
                    'type' => 'password',
                    'placeholder' => '',
                    'required' => true
                ),
                array(
                    'name' => 'algo',
                    'label' => 'Algorithm',
                    'type' => 'select',
                    'placeholder' => 'pbkdf2',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'http-security-headers-generator',
                'password-policy-generator'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Password Encryption actually check?',
                    'a' => 'Derive a hash in your browser with SHA-256 or PBKDF2. The value is never uploaded or stored. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'random-password-generator',
            'name' => 'Random Password Generator',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Generate a password or passphrase with the Web Crypto random source, with an entropy estimate. It stays in your browser.',
            'description' => 'Builds passwords and passphrases from window.crypto.getRandomValues with rejection sampling, so every character in the enabled sets is equally likely and no modulo bias is introduced. Choose the character classes, optionally drop look-alike characters (I, l, 1, O, 0), or switch to a passphrase of words from a built-in list. The estimated entropy in bits is reported against the actual alphabet used, so a weak configuration is visible before you rely on it. Privacy: values are generated in your browser tab, are not uploaded, logged, placed in a URL or persisted, and are discarded when you leave the page.',
            'seoTitle' => 'Random Password Generator — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Generate a password or passphrase with the Web Crypto random source, with an entropy estimate. It stays in your browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'password',
                'generator',
                'random',
                'passphrase',
                'entropy',
                'secure',
                'random-password-generator',
                'cybersecurity',
                'random password generator'
            ),
            'aliases' => array(),
            'path' => '/tools/random-password-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'password_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'kind',
                    'label' => 'Type',
                    'type' => 'select',
                    'placeholder' => 'password',
                    'required' => true,
                    'choices' => array(
                        'password' => 'Random password',
                        'passphrase' => 'Random passphrase (diceware-style words)'
                    )
                ),
                array(
                    'name' => 'length',
                    'label' => 'Length / words',
                    'type' => 'number',
                    'placeholder' => '20',
                    'required' => true,
                    'hint' => 'Password: 8 to 128 characters. Passphrase: 3 to 12 words.'
                ),
                array(
                    'name' => 'uppercase',
                    'label' => 'Uppercase A–Z',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'lowercase',
                    'label' => 'Lowercase a–z',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'numbers',
                    'label' => 'Digits 0–9',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'symbols',
                    'label' => 'Symbols',
                    'type' => 'select',
                    'placeholder' => 'yes',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes',
                        'no' => 'No'
                    )
                ),
                array(
                    'name' => 'unambiguous',
                    'label' => 'Exclude look-alike characters (I l 1 O 0)',
                    'type' => 'select',
                    'placeholder' => 'no',
                    'required' => true,
                    'choices' => array(
                        'yes' => 'Yes — drop I l 1 O 0',
                        'no' => 'No — use the full alphabet'
                    )
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'http-security-headers-generator',
                'password-policy-generator'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'Is the randomness cryptographically secure?',
                    'a' => 'Yes. It uses the browser CSPRNG with rejection sampling. If the browser exposes no CSPRNG the tool refuses to run instead of falling back to a predictable source.'
                ),
                array(
                    'q' => 'Are passwords ever sent to CloudHost247?',
                    'a' => 'No. There is no network request in this handler. Nothing is written to logs, analytics, local storage or a URL.'
                ),
                array(
                    'q' => 'Is a passphrase weaker than a password?',
                    'a' => 'Not necessarily, and the tool tells you rather than guessing: it reports the entropy of exactly what it produced. Each word is drawn from a built-in 368-word list, which is about 8.5 bits per word, so seven words is roughly 60 bits and five words is about 43. The estimate assumes the list is public, because it is.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'password-strength-checker',
            'name' => 'Password Strength Checker',
            'category' => 'cybersecurity',
            'categoryLabel' => 'Cybersecurity',
            'icon' => 'cybersecurity',
            'summary' => 'Score a password locally for length and character variety. It is not checked against breach lists.',
            'description' => 'Score a password locally for length and character variety. It is not checked against breach lists. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Password Strength Checker — Free Cybersecurity Tool | CloudHost247',
            'seoDescription' => 'Score a password locally for length and character variety. It is not checked against breach lists. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'password',
                'strength',
                'password-strength-checker',
                'cybersecurity',
                'password strength checker'
            ),
            'aliases' => array(),
            'path' => '/tools/password-strength-checker',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'password_strength',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'password',
                    'label' => 'Password',
                    'type' => 'password',
                    'placeholder' => '',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'api-key-generator',
                'checksum-hash-generator',
                'http-security-headers-generator',
                'password-policy-generator'
            ),
            'services' => array(
                array(
                    'label' => 'SSL certificates',
                    'url' => 'ssl-certificate.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Security',
                    'url' => 'security.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Password Strength Checker actually check?',
                    'a' => 'Score a password locally for length and character variety. It is not checked against breach lists. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'qr-code-generator',
            'name' => 'QR Code Generator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Encode text or a URL into a QR code in your browser, with an error-correction level and a PNG or SVG download.',
            'description' => 'Encodes the text or URL you enter into a QR symbol with a real Reed–Solomon encoder in your browser tab — no image is requested from a third party and the content is never uploaded. Choose the error-correction level (L, M, Q or H) to trade density against damage resistance, choose a pixel size, and download the result as PNG or SVG. The symbol version and module count reported come from the encoder itself, so you can see whether the payload actually fits.',
            'seoTitle' => 'QR Code Generator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Encode text or a URL into a QR code in your browser, with an error-correction level and a PNG or SVG download. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'qr',
                'generator',
                'barcode',
                'error correction',
                'png',
                'svg',
                'qr-code-generator',
                'productivity',
                'qr code generator'
            ),
            'aliases' => array(),
            'path' => '/tools/qr-code-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'qr_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Content',
                    'type' => 'textarea',
                    'placeholder' => 'https://example.com',
                    'required' => true
                ),
                array(
                    'name' => 'ecl',
                    'label' => 'Error correction',
                    'type' => 'select',
                    'placeholder' => 'M',
                    'required' => true,
                    'choices' => array(
                        'L' => 'L — about 7% recovery',
                        'M' => 'M — about 15% recovery',
                        'Q' => 'Q — about 25% recovery',
                        'H' => 'H — about 30% recovery'
                    ),
                    'hint' => 'Higher levels survive more damage and leave room for a centre logo, at the cost of density.'
                ),
                array(
                    'name' => 'size',
                    'label' => 'Image size (px)',
                    'type' => 'number',
                    'placeholder' => '320',
                    'required' => false,
                    'hint' => '128 to 1024. Defaults to 320.'
                ),
                array(
                    'name' => 'output',
                    'label' => 'Output',
                    'type' => 'select',
                    'placeholder' => 'png',
                    'required' => true,
                    'choices' => array(
                        'png' => 'PNG image',
                        'svg' => 'SVG vector'
                    )
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-scanner'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does QR Code Generator actually check?',
                    'a' => 'Encode text or a URL into a QR code in your browser, with an error-correction level and a PNG or SVG download. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => true,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'qr-scanner',
            'name' => 'QR Scanner',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Decode a QR image locally. Decoded links are shown as text and are not opened automatically.',
            'description' => 'Decode a QR image locally. Decoded links are shown as text and are not opened automatically. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'QR Scanner — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Decode a QR image locally. Decoded links are shown as text and are not opened automatically. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'qr',
                'scanner',
                'qr-scanner',
                'productivity',
                'qr scanner'
            ),
            'aliases' => array(),
            'path' => '/tools/qr-scanner',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'qr_scan',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'file',
                    'label' => 'QR image',
                    'type' => 'file',
                    'placeholder' => '',
                    'required' => true,
                    'hint' => 'Read and decoded in this browser; the image is not uploaded.',
                    'accept' => 'image/*'
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does QR Scanner actually check?',
                    'a' => 'Decode a QR image locally. Decoded links are shown as text and are not opened automatically. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'lorem-ipsum-generator',
            'name' => 'Lorem Ipsum Generator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Generate placeholder paragraphs. The text is filler, not product copy.',
            'description' => 'Generate placeholder paragraphs. The text is filler, not product copy. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Lorem Ipsum Generator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Generate placeholder paragraphs. The text is filler, not product copy. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'lorem',
                'placeholder',
                'lorem-ipsum-generator',
                'productivity',
                'lorem ipsum generator'
            ),
            'aliases' => array(),
            'path' => '/tools/lorem-ipsum-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'lorem',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'paragraphs',
                    'label' => 'Paragraphs',
                    'type' => 'number',
                    'placeholder' => '3',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Lorem Ipsum Generator actually check?',
                    'a' => 'Generate placeholder paragraphs. The text is filler, not product copy. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'time-card-calculator',
            'name' => 'Time Card Calculator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Add clock-in and clock-out pairs. This is arithmetic, not payroll or legal advice.',
            'description' => 'Add clock-in and clock-out pairs. This is arithmetic, not payroll or legal advice. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Time Card Calculator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Add clock-in and clock-out pairs. This is arithmetic, not payroll or legal advice. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'time',
                'timesheet',
                'calculator',
                'time-card-calculator',
                'productivity',
                'time card calculator'
            ),
            'aliases' => array(),
            'path' => '/tools/time-card-calculator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'timecard',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Entries',
                    'type' => 'textarea',
                    'placeholder' => '09:00-17:00
09:30-17:15',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Time Card Calculator actually check?',
                    'a' => 'Add clock-in and clock-out pairs. This is arithmetic, not payroll or legal advice. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'bin-checker',
            'name' => 'BIN Checker',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Identify a card brand from the IIN prefix. The full number is not required and is not stored.',
            'description' => 'Identify a card brand from the IIN prefix. The full number is not required and is not stored. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'BIN Checker — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Identify a card brand from the IIN prefix. The full number is not required and is not stored. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'bin',
                'iin',
                'card',
                'bin-checker',
                'productivity',
                'bin checker'
            ),
            'aliases' => array(),
            'path' => '/tools/bin-checker',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'bin',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'bin',
                    'label' => 'First 6–8 digits',
                    'type' => 'text',
                    'placeholder' => '424242',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does BIN Checker actually check?',
                    'a' => 'Identify a card brand from the IIN prefix. The full number is not required and is not stored. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'credit-card-checker',
            'name' => 'Credit Card Checker',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Validate length and the Luhn checksum locally. This does not charge a card or contact a bank.',
            'description' => 'Validate length and the Luhn checksum locally. This does not charge a card or contact a bank. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Credit Card Checker — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Validate length and the Luhn checksum locally. This does not charge a card or contact a bank. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'credit',
                'card',
                'luhn',
                'credit-card-checker',
                'productivity',
                'credit card checker'
            ),
            'aliases' => array(),
            'path' => '/tools/credit-card-checker',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'card',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'number',
                    'label' => 'Card number',
                    'type' => 'text',
                    'placeholder' => '',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Credit Card Checker actually check?',
                    'a' => 'Validate length and the Luhn checksum locally. This does not charge a card or contact a bank. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'reverse-image-search',
            'name' => 'Reverse Image Search',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Build links to public image-search engines. CloudHost247 does not keep an image index.',
            'description' => 'Build links to public image-search engines. CloudHost247 does not keep an image index. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Reverse Image Search — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Build links to public image-search engines. CloudHost247 does not keep an image index. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'image',
                'search',
                'reverse',
                'reverse-image-search',
                'productivity',
                'reverse image search'
            ),
            'aliases' => array(),
            'path' => '/tools/reverse-image-search',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'reverse_image',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'url',
                    'label' => 'Image URL',
                    'type' => 'url',
                    'placeholder' => 'https://example.com/photo.jpg',
                    'required' => false
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Reverse Image Search actually check?',
                    'a' => 'Build links to public image-search engines. CloudHost247 does not keep an image index. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'name-checker',
            'name' => 'Name Checker',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Check a name for format issues and whether matching domains resolve. Social accounts are not scraped.',
            'description' => 'Check a name for format issues and whether matching domains resolve. Social accounts are not scraped. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Name Checker — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Check a name for format issues and whether matching domains resolve. Social accounts are not scraped. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'name',
                'username',
                'domain',
                'name-checker',
                'productivity',
                'name checker'
            ),
            'aliases' => array(),
            'path' => '/tools/name-checker',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'name_check',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'name',
                    'label' => 'Name',
                    'type' => 'text',
                    'placeholder' => 'cloudhost',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Name Checker actually check?',
                    'a' => 'Check a name for format issues and whether matching domains resolve. Social accounts are not scraped. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'online-notepad',
            'name' => 'Online Notepad',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'A private notepad that stays in this tab unless you choose to keep it in this browser.',
            'description' => 'A private notepad that stays in this tab unless you choose to keep it in this browser. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Online Notepad — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'A private notepad that stays in this tab unless you choose to keep it in this browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'notepad',
                'notes',
                'online-notepad',
                'productivity',
                'online notepad'
            ),
            'aliases' => array(),
            'path' => '/tools/online-notepad',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'notepad',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Notes',
                    'type' => 'textarea',
                    'placeholder' => '',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Online Notepad actually check?',
                    'a' => 'A private notepad that stays in this tab unless you choose to keep it in this browser. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'small-text-generator',
            'name' => 'Small Text Generator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Convert letters to small Unicode forms for display. Not every font renders them.',
            'description' => 'Convert letters to small Unicode forms for display. Not every font renders them. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Small Text Generator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Convert letters to small Unicode forms for display. Not every font renders them. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'small',
                'unicode',
                'text',
                'small-text-generator',
                'productivity',
                'small text generator'
            ),
            'aliases' => array(),
            'path' => '/tools/small-text-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'small_text',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'CloudHost247',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Small Text Generator actually check?',
                    'a' => 'Convert letters to small Unicode forms for display. Not every font renders them. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'word-counter',
            'name' => 'Word Counter',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Count words, characters, sentences and reading time in your browser.',
            'description' => 'Count words, characters, sentences and reading time in your browser. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Word Counter — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Count words, characters, sentences and reading time in your browser. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'word',
                'counter',
                'characters',
                'word-counter',
                'productivity',
                'word counter'
            ),
            'aliases' => array(),
            'path' => '/tools/word-counter',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'word_count',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'Paste text',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Word Counter actually check?',
                    'a' => 'Count words, characters, sentences and reading time in your browser. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'domain-name-search',
            'name' => 'Domain Name Search',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'See whether a name resolves and what RDAP says. This is not a checkout price or a guarantee.',
            'description' => 'See whether a name resolves and what RDAP says. This is not a checkout price or a guarantee. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Domain Name Search — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'See whether a name resolves and what RDAP says. This is not a checkout price or a guarantee. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'domain',
                'search',
                'availability',
                'domain-name-search',
                'productivity',
                'domain name search'
            ),
            'aliases' => array(),
            'path' => '/tools/domain-name-search',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'domain_search',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'name',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Domain Name Search actually check?',
                    'a' => 'See whether a name resolves and what RDAP says. This is not a checkout price or a guarantee. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'rot13',
            'name' => 'ROT13 Encoder/Decoder',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Rotate letters by 13 places. ROT13 is not encryption.',
            'description' => 'Rotate letters by 13 places. ROT13 is not encryption. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'ROT13 Encoder/Decoder — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Rotate letters by 13 places. ROT13 is not encryption. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'rot13',
                'cipher',
                'rot13',
                'productivity',
                'rot13 encoder/decoder'
            ),
            'aliases' => array(),
            'path' => '/tools/rot13',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'rot13',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'CloudHost247',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does ROT13 Encoder/Decoder actually check?',
                    'a' => 'Rotate letters by 13 places. ROT13 is not encryption. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'morse-code-translator',
            'name' => 'Morse Code Translator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Translate between text and Morse. Unsupported characters are reported, not dropped silently.',
            'description' => 'Translate between text and Morse. Unsupported characters are reported, not dropped silently. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Morse Code Translator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Translate between text and Morse. Unsupported characters are reported, not dropped silently. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'morse',
                'translator',
                'morse-code-translator',
                'productivity',
                'morse code translator'
            ),
            'aliases' => array(),
            'path' => '/tools/morse-code-translator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'morse',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text or Morse',
                    'type' => 'textarea',
                    'placeholder' => 'SOS',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Morse Code Translator actually check?',
                    'a' => 'Translate between text and Morse. Unsupported characters are reported, not dropped silently. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'bimi-checker-generator',
            'name' => 'BIMI Checker & Generator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Look up a BIMI record or draft one. A logo URL is evidence of a record, not brand verification.',
            'description' => 'Look up a BIMI record or draft one. A logo URL is evidence of a record, not brand verification. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'BIMI Checker & Generator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Look up a BIMI record or draft one. A logo URL is evidence of a record, not brand verification. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'bimi',
                'email',
                'logo',
                'bimi-checker-generator',
                'productivity',
                'bimi checker & generator'
            ),
            'aliases' => array(),
            'path' => '/tools/bimi-checker-generator',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'bimi',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                ),
                array(
                    'name' => 'selector',
                    'label' => 'Selector',
                    'type' => 'text',
                    'placeholder' => 'default',
                    'required' => false
                ),
                array(
                    'name' => 'logo',
                    'label' => 'Logo URL for a draft',
                    'type' => 'url',
                    'placeholder' => 'https://example.com/logo.svg',
                    'required' => false
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does BIMI Checker & Generator actually check?',
                    'a' => 'Look up a BIMI record or draft one. A logo URL is evidence of a record, not brand verification. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'image-to-text',
            'name' => 'Image to Text',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Extract text with the browser text detector when it exists. No text is invented if it does not.',
            'description' => 'Extract text with the browser text detector when it exists. No text is invented if it does not. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Image to Text — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Extract text with the browser text detector when it exists. No text is invented if it does not. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ocr',
                'image',
                'text',
                'image-to-text',
                'productivity',
                'image to text'
            ),
            'aliases' => array(),
            'path' => '/tools/image-to-text',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'image_text',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'file',
                    'label' => 'Image',
                    'type' => 'file',
                    'placeholder' => '',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Image to Text actually check?',
                    'a' => 'Extract text with the browser text detector when it exists. No text is invented if it does not. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'runic-translator',
            'name' => 'Runic Translator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Map Latin letters to a runic-style alphabet for display. This is not a historical transcription.',
            'description' => 'Map Latin letters to a runic-style alphabet for display. This is not a historical transcription. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Runic Translator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Map Latin letters to a runic-style alphabet for display. This is not a historical transcription. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'runic',
                'translator',
                'runic-translator',
                'productivity',
                'runic translator'
            ),
            'aliases' => array(),
            'path' => '/tools/runic-translator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'runic',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Text',
                    'type' => 'textarea',
                    'placeholder' => 'Cloud',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Runic Translator actually check?',
                    'a' => 'Map Latin letters to a runic-style alphabet for display. This is not a historical transcription. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'invisible-character-generator',
            'name' => 'Invisible Character Generator',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Copy a specific Unicode invisible character, with its code point named.',
            'description' => 'Copy a specific Unicode invisible character, with its code point named. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Invisible Character Generator — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Copy a specific Unicode invisible character, with its code point named. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'invisible',
                'unicode',
                'invisible-character-generator',
                'productivity',
                'invisible character generator'
            ),
            'aliases' => array(),
            'path' => '/tools/invisible-character-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'invisible',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'kind',
                    'label' => 'Character',
                    'type' => 'select',
                    'placeholder' => 'zwsp',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Invisible Character Generator actually check?',
                    'a' => 'Copy a specific Unicode invisible character, with its code point named. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'internet-speed-test',
            'name' => 'Internet Speed Test',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Measure latency, download and upload between this browser and this CloudHost247 service only.',
            'description' => 'Measure latency, download and upload between this browser and this CloudHost247 service only. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Internet Speed Test — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Measure latency, download and upload between this browser and this CloudHost247 service only. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'speed',
                'bandwidth',
                'latency',
                'internet-speed-test',
                'productivity',
                'internet speed test'
            ),
            'aliases' => array(),
            'path' => '/tools/internet-speed-test',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'speed',
            'options' => array(

            ),
            'inputs' => array(),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Internet Speed Test actually check?',
                    'a' => 'Measure latency, download and upload between this browser and this CloudHost247 service only. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'wifi-qr-scanner',
            'name' => 'WiFi QR Scanner',
            'category' => 'productivity',
            'categoryLabel' => 'Productivity',
            'icon' => 'productivity',
            'summary' => 'Decode a Wi-Fi QR code locally. The network is not joined and the passphrase is not stored.',
            'description' => 'Decode a Wi-Fi QR code locally. The network is not joined and the passphrase is not stored. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'WiFi QR Scanner — Free Productivity Tool | CloudHost247',
            'seoDescription' => 'Decode a Wi-Fi QR code locally. The network is not joined and the passphrase is not stored. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'wifi',
                'qr',
                'scanner',
                'wifi-qr-scanner',
                'productivity',
                'wifi qr scanner'
            ),
            'aliases' => array(),
            'path' => '/tools/wifi-qr-scanner',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'wifi_qr',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'file',
                    'label' => 'QR image',
                    'type' => 'file',
                    'placeholder' => '',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'age-date-calculator',
                'date-duration-calculator',
                'percentage-calculator',
                'qr-code-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'Domains',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'Help center',
                    'url' => 'help-center.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does WiFi QR Scanner actually check?',
                    'a' => 'Decode a Wi-Fi QR code locally. The network is not joined and the passphrase is not stored. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => true,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'minecraft-color-codes',
            'name' => 'Minecraft Color Codes',
            'category' => 'gaming',
            'categoryLabel' => 'Gaming',
            'icon' => 'gaming',
            'summary' => 'Reference and preview Minecraft formatting codes. Minecraft is a trademark of its owner; this is an unofficial aid.',
            'description' => 'Reference and preview Minecraft formatting codes. Minecraft is a trademark of its owner; this is an unofficial aid. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Minecraft Color Codes — Free Gaming Tool | CloudHost247',
            'seoDescription' => 'Reference and preview Minecraft formatting codes. Minecraft is a trademark of its owner; this is an unofficial aid. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'minecraft',
                'color',
                'codes',
                'minecraft-color-codes',
                'gaming',
                'minecraft color codes'
            ),
            'aliases' => array(),
            'path' => '/tools/minecraft-color-codes',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'minecraft',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'text',
                    'label' => 'Preview text',
                    'type' => 'text',
                    'placeholder' => 'Hello',
                    'required' => false
                )
            ),
            'relatedTools' => array(),
            'services' => array(
                array(
                    'label' => 'Game servers',
                    'url' => 'game-servers.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Dedicated servers',
                    'url' => 'dedicated-server.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Minecraft Color Codes actually check?',
                    'a' => 'Reference and preview Minecraft formatting codes. Minecraft is a trademark of its owner; this is an unofficial aid. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'soa-lookup',
            'name' => 'SOA Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up the start of authority record for a domain.',
            'description' => 'Look up the start of authority record for a domain. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SOA Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up the start of authority record for a domain. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'soa',
                'dns',
                'soa-lookup',
                'dns',
                'soa lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/soa-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'SOA'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SOA Lookup actually check?',
                    'a' => 'Look up the start of authority record for a domain. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'txt-lookup',
            'name' => 'TXT Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up TXT records, including SPF and verification tokens.',
            'description' => 'Look up TXT records, including SPF and verification tokens. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'TXT Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up TXT records, including SPF and verification tokens. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'txt',
                'dns',
                'txt-lookup',
                'dns',
                'txt lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/txt-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'TXT'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does TXT Lookup actually check?',
                    'a' => 'Look up TXT records, including SPF and verification tokens. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'caa-lookup',
            'name' => 'CAA Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up CAA records that name which certificate authorities may issue.',
            'description' => 'Look up CAA records that name which certificate authorities may issue. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'CAA Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up CAA records that name which certificate authorities may issue. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'caa',
                'dns',
                'ssl',
                'caa-lookup',
                'dns',
                'caa lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/caa-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'CAA'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does CAA Lookup actually check?',
                    'a' => 'Look up CAA records that name which certificate authorities may issue. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'srv-lookup',
            'name' => 'SRV Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up SRV service records, including priority and weight.',
            'description' => 'Look up SRV service records, including priority and weight. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SRV Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up SRV service records, including priority and weight. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'srv',
                'dns',
                'srv-lookup',
                'dns',
                'srv lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/srv-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'SRV'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SRV Lookup actually check?',
                    'a' => 'Look up SRV service records, including priority and weight. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'ptr-lookup',
            'name' => 'PTR Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up the reverse DNS pointer for an IP address.',
            'description' => 'Look up the reverse DNS pointer for an IP address. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'PTR Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up the reverse DNS pointer for an IP address. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'ptr',
                'dns',
                'reverse',
                'ptr-lookup',
                'dns',
                'ptr lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/ptr-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'ip_hostname',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'target',
                    'label' => 'IP address',
                    'type' => 'text',
                    'placeholder' => '203.0.113.10',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does PTR Lookup actually check?',
                    'a' => 'Look up the reverse DNS pointer for an IP address. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'a-record-lookup',
            'name' => 'A Record Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up IPv4 address records for a hostname.',
            'description' => 'Look up IPv4 address records for a hostname. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'A Record Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up IPv4 address records for a hostname. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'a',
                'dns',
                'ipv4',
                'a-record-lookup',
                'dns',
                'a record lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/a-record-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'A'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does A Record Lookup actually check?',
                    'a' => 'Look up IPv4 address records for a hostname. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'aaaa-lookup',
            'name' => 'AAAA Lookup',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up IPv6 address records for a hostname.',
            'description' => 'Look up IPv6 address records for a hostname. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'AAAA Lookup — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up IPv6 address records for a hostname. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'aaaa',
                'dns',
                'ipv6',
                'aaaa-lookup',
                'dns',
                'aaaa lookup'
            ),
            'aliases' => array(),
            'path' => '/tools/aaaa-lookup',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'dns_lookup',
            'options' => array(
                'type' => 'AAAA'
            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does AAAA Lookup actually check?',
                    'a' => 'Look up IPv6 address records for a hostname. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'uuid-generator',
            'name' => 'UUID Generator',
            'category' => 'developer',
            'categoryLabel' => 'Developer',
            'icon' => 'developer',
            'summary' => 'Generate UUIDv4, time-ordered UUIDv7 or nil UUIDs in bulk from the browser\'s cryptographic random source.',
            'description' => 'Generates UUIDs from window.crypto — never Math.random — with the version and variant bits set correctly for the layout you choose. v4 carries 122 bits of randomness. v7 places a 48-bit Unix millisecond timestamp in the high bits so identifiers sort by creation time, which matters for database primary keys and log correlation. Generate one or a thousand, then copy or download the list. Nothing is uploaded and nothing is stored.',
            'seoTitle' => 'UUID Generator — Free Developer Tool | CloudHost247',
            'seoDescription' => 'Generate UUIDv4, time-ordered UUIDv7 or nil UUIDs in bulk from the browser\'s cryptographic random source. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'uuid',
                'generator',
                'uuidv4',
                'uuidv7',
                'guid',
                'bulk',
                'uuid-generator',
                'developer',
                'uuid generator'
            ),
            'aliases' => array(),
            'path' => '/tools/uuid-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'uuid',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'version',
                    'label' => 'Version',
                    'type' => 'select',
                    'placeholder' => 'v4',
                    'required' => true,
                    'choices' => array(
                        'v4' => 'v4 — random',
                        'v7' => 'v7 — time-ordered (sortable)',
                        'nil' => 'Nil UUID (all zeros)'
                    ),
                    'hint' => 'v7 embeds a 48-bit Unix millisecond timestamp, so identifiers sort by creation time.'
                ),
                array(
                    'name' => 'count',
                    'label' => 'How many',
                    'type' => 'number',
                    'placeholder' => '1',
                    'required' => true,
                    'hint' => '1 to 1000.'
                ),
                array(
                    'name' => 'format',
                    'label' => 'Format',
                    'type' => 'select',
                    'placeholder' => 'standard',
                    'required' => true,
                    'choices' => array(
                        'standard' => '8-4-4-4-12 hyphenated',
                        'hex' => 'Hex, no hyphens',
                        'braces' => '{8-4-4-4-12}',
                        'urn' => 'urn:uuid:8-4-4-4-12',
                        'upper' => 'Uppercase hyphenated'
                    )
                )
            ),
            'relatedTools' => array(
                'http-headers-checker',
                'website-os-checker',
                'md5-generator',
                'base64-generator'
            ),
            'services' => array(
                array(
                    'label' => 'Developer hosting',
                    'url' => 'developer-friendly.php'
                ),
                array(
                    'label' => 'PaaS',
                    'url' => 'paas.php'
                ),
                array(
                    'label' => 'Node.js',
                    'url' => 'nodejs-hosting.php'
                ),
                array(
                    'label' => 'Docker',
                    'url' => 'docker-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does UUID Generator actually check?',
                    'a' => 'Generate UUIDv4, time-ordered UUIDv7 or nil UUIDs in bulk from the browser\'s cryptographic random source. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => 'compliance-documents',
            'enabled' => true
        ),
        array(
            'slug' => 'domain-whois',
            'name' => 'Domain WHOIS',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Look up domain registration data through RDAP and label the source.',
            'description' => 'Look up domain registration data through RDAP and label the source. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'Domain WHOIS — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Look up domain registration data through RDAP and label the source. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'whois',
                'rdap',
                'domain',
                'domain-whois',
                'dns',
                'domain whois'
            ),
            'aliases' => array(),
            'path' => '/tools/domain-whois',
            'legacyPaths' => array(),
            'mode' => 'server',
            'handler' => 'domain_whois',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'domain',
                    'label' => 'Domain name',
                    'type' => 'text',
                    'placeholder' => 'example.com',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does Domain WHOIS actually check?',
                    'a' => 'Look up domain registration data through RDAP and label the source. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens on the CloudHost247 service after the input is validated. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Live check',
            'featured' => true,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        ),
        array(
            'slug' => 'spf-record-generator',
            'name' => 'SPF Record Generator',
            'category' => 'dns',
            'categoryLabel' => 'DNS',
            'icon' => 'dns',
            'summary' => 'Draft an SPF TXT value from the mechanisms you choose. It is not published automatically.',
            'description' => 'Draft an SPF TXT value from the mechanisms you choose. It is not published automatically. CloudHost247 labels estimates, missing data and unavailable probes instead of filling them in.',
            'seoTitle' => 'SPF Record Generator — Free DNS Tool | CloudHost247',
            'seoDescription' => 'Draft an SPF TXT value from the mechanisms you choose. It is not published automatically. Free CloudHost247 tool for administrators, developers and website owners.',
            'keywords' => array(
                'spf',
                'generator',
                'spf-record-generator',
                'dns',
                'spf record generator'
            ),
            'aliases' => array(),
            'path' => '/tools/spf-record-generator',
            'legacyPaths' => array(),
            'mode' => 'local',
            'handler' => 'spf_generate',
            'options' => array(

            ),
            'inputs' => array(
                array(
                    'name' => 'includes',
                    'label' => 'Include hosts',
                    'type' => 'text',
                    'placeholder' => '_spf.example.com',
                    'required' => false
                ),
                array(
                    'name' => 'policy',
                    'label' => 'Terminal policy',
                    'type' => 'select',
                    'placeholder' => '-all',
                    'required' => true
                )
            ),
            'relatedTools' => array(
                'dns-checker',
                'dns-propagation',
                'domain-dns-validation',
                'reverse-ip-lookup'
            ),
            'services' => array(
                array(
                    'label' => 'Domain registration',
                    'url' => 'domain.php'
                ),
                array(
                    'label' => 'DNS management',
                    'url' => 'dns-management.php'
                ),
                array(
                    'label' => 'Web hosting',
                    'url' => 'web-hosting.php'
                ),
                array(
                    'label' => 'VPS',
                    'url' => 'vps-hosting.php'
                ),
                array(
                    'label' => 'Cloud hosting',
                    'url' => 'cloudhost247-hosting.php'
                )
            ),
            'faq' => array(
                array(
                    'q' => 'What does SPF Record Generator actually check?',
                    'a' => 'Draft an SPF TXT value from the mechanisms you choose. It is not published automatically. Each result names its source.'
                ),
                array(
                    'q' => 'Is my input stored?',
                    'a' => 'Processing happens in your browser and is not uploaded. Sensitive values are not written to logs.'
                ),
                array(
                    'q' => 'Does a result guarantee the rest of the internet sees the same thing?',
                    'a' => 'No. A result describes this check at this time. DNS and geolocation answers can differ by resolver and provider.'
                )
            ),
            'badge' => 'Browser-only',
            'featured' => false,
            'sensitive' => false,
            'collection' => '',
            'enabled' => true
        )
    )
);
