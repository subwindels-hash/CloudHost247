<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Security tools (docs sections 21, 40, 41, 48).
 */
final class SecurityCatalog
{
    public static function definitions()
    {
        return array(
            'security/ssl' => array(
                'name' => 'SSL Certificate Checker',
                'category' => 'security',
                'icon' => 'lock',
                'summary' => 'Inspect the TLS certificate and chain a host presents.',
                'description' => 'Connects over TLS, reads the certificate the server actually presents, and reports issuer, subject, SANs, validity, days remaining, key and signature algorithm, chain, negotiated TLS version and hostname match.',
                'explanation' => 'The certificate shown is the leaf the server sends for this hostname. Private keys are never requested, read or displayed. "Expiring soon" is a statement about the expiry date the certificate carries.',
                'fields' => array(
                    array('name' => 'host', 'type' => 'hostname', 'label' => 'Hostname', 'required' => true, 'placeholder' => 'example.com', 'target' => true),
                    array('name' => 'port', 'type' => 'port', 'label' => 'Port', 'required' => false, 'default' => 443),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Security\\SslService',
                'target_field' => 'host',
                'timeout_seconds' => 20,
                'cache_seconds' => 900,
                'exports' => array('json', 'csv', 'pdf', 'png'),
                'result_view' => 'certificate',
                'capabilities' => array('tls_client', 'openssl'),
            ),
            'security/ip-blacklist' => array(
                'name' => 'IP Blacklist Checker',
                'category' => 'security',
                'icon' => 'ban',
                'summary' => 'Check an IP against the DNS blocklists an administrator has enabled.',
                'description' => 'Queries each enabled blocklist provider from the administrator-managed registry for the reversed address, and reports listed/not listed, the reply code, what the operator documents for that code, and how to request removal.',
                'explanation' => 'A blocklist is one operator\'s opinion, not a verdict: a listing usually means the address was reported for sending unsolicited mail or for an exploited service. Absence from these lists does not mean an address is reputable, and presence on one does not by itself prove abuse. Zero providers enabled reports CONFIGURATION_REQUIRED — never a made-up "clean" result.',
                'fields' => array(
                    array('name' => 'ip', 'type' => 'public_ip', 'label' => 'IP address', 'required' => true, 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Ip\\BlacklistService',
                'requires_provider' => true,
                'providers' => array('dnsbl.spamhaus_zen', 'dnsbl.spamcop', 'dnsbl.barracuda', 'dnsbl.dronebl', 'dnsbl.sorbs', 'dnsbl.uceprotect', 'dnsbl.abuseat', 'dnsbl.spfbl'),
                'target_field' => 'ip',
                'cache_seconds' => 1800,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'blacklist',
                'notes' => array('Providers are configured in Admin → CloudHost247 Tools → Providers; several operators only accept queries from registered resolvers.'),
            ),
            'security/password' => array(
                'name' => 'Password Tools',
                'category' => 'security',
                'icon' => 'key',
                'summary' => 'Generate passwords, assess strength locally and hash safely.',
                'description' => 'Generates passwords with a cryptographically secure source, evaluates the strength of a password you type, and produces one-way password hashes with password_hash().',
                'explanation' => 'Strength analysis and hashing run on the CloudHost247 server for this request only: the value is never stored, logged, cached or sent to any third party, and it is discarded when the request ends. Hashing is one-way — it cannot be reversed, and that is the point.',
                'fields' => array(
                    array('name' => 'operation', 'type' => 'select', 'label' => 'Tool', 'required' => true, 'default' => 'generate', 'options' => array('generate' => 'Password generator', 'strength' => 'Password strength checker', 'hash' => 'Password hash utility', 'verify' => 'Verify against a hash')),
                    array('name' => 'length', 'type' => 'number', 'label' => 'Length', 'required' => false, 'default' => 20, 'min' => 8, 'max' => 128),
                    array('name' => 'algorithm', 'type' => 'select', 'label' => 'Hash algorithm', 'required' => false, 'default' => 'default', 'options' => array('default' => 'PHP default (currently bcrypt)', 'bcrypt' => 'bcrypt', 'argon2id' => 'Argon2id (when available)')),
                    array('name' => 'hash_to_verify', 'type' => 'text', 'label' => 'Existing hash to verify', 'required' => false, 'sensitive' => true, 'maxlength' => 255, 'help' => 'Only used by the verification operation, and never stored.'),
                    array('name' => 'uppercase', 'type' => 'checkbox', 'label' => 'Include uppercase', 'default' => true),
                    array('name' => 'lowercase', 'type' => 'checkbox', 'label' => 'Include lowercase', 'default' => true),
                    array('name' => 'numbers', 'type' => 'checkbox', 'label' => 'Include numbers', 'default' => true),
                    array('name' => 'symbols', 'type' => 'checkbox', 'label' => 'Include symbols', 'default' => true),
                    array('name' => 'exclude_ambiguous', 'type' => 'checkbox', 'label' => 'Exclude ambiguous characters', 'default' => true),
                    array('name' => 'value', 'type' => 'password', 'label' => 'Password to check or hash', 'required' => false, 'sensitive' => true, 'help' => 'Never stored. Used for this single request only.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Security\\PasswordService',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json'),
                'result_view' => 'password',
                'notes' => array('Never send a real production password to any online tool, including this one. Generating a new password locally or rotating the credential afterwards is always safer.'),
            ),
            'security/bin-checker' => array(
                'name' => 'BIN Checker',
                'category' => 'security',
                'icon' => 'credit-card',
                'summary' => 'Look up a card issuer from a BIN/IIN prefix.',
                'description' => 'Validates the BIN (first six to eight digits) and returns only what the configured data source publishes: scheme, issuer, country, card type and category.',
                'explanation' => 'Only the issuer prefix is accepted — never a complete card number. The module refuses longer input, stores nothing and cannot be used to test cards. When no BIN data source is configured the tool reports CONFIGURATION_REQUIRED.',
                'fields' => array(
                    array('name' => 'bin', 'type' => 'text', 'label' => 'BIN / IIN', 'required' => true, 'maxlength' => 8, 'placeholder' => '424242', 'help' => 'Six to eight digits only. Do not enter a full card number.', 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Security\\BinService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'requires_provider' => true,
                'providers' => array('tool.bin_lookup'),
                'visibility' => 'customer',
                'cache_seconds' => 86400,
                'exports' => array('json', 'csv'),
                'result_view' => 'details',
            ),
        );
    }
}
