<?php
namespace CloudHost247\Integrations\Registry;

/**
 * Built-in provider catalog.
 *
 * Every entry is a real, documented provider API with a real authentication
 * strategy and a real read-only connection test. Nothing here is a placeholder:
 * if a provider appears in the dashboard, the platform can store its
 * credentials, build an authenticated client for it and verify the connection
 * server-side.
 *
 * `used_by` records which part of CloudHost247 consumes the integration, so the
 * inventory in docs/independent-rebuild/API-INVENTORY-AUDIT.md stays honest.
 */
final class ProviderCatalog
{
    /** @return ProviderDefinition[] */
    public static function definitions()
    {
        $definitions = array();
        foreach (self::specifications() as $specification) {
            $definitions[] = ProviderDefinition::fromArray($specification);
        }
        return $definitions;
    }

    private static function specifications()
    {
        return array_merge(
            self::remoteDesktop(),
            self::hosting(),
            self::controlPanels(),
            self::domainsAndDns(),
            self::payments(),
            self::messaging(),
            self::intelligenceAndEdge(),
            self::storageMonitoringVerification(),
            self::platformServices()
        );
    }

    /* ------------------------------------------------------------------ RDP */

    private static function remoteDesktop()
    {
        return array(array(
            'key' => 'rdp',
            'label' => 'Remote Desktop provider',
            'category' => 'rdp',
            'capabilities' => array('provisioning', 'lifecycle'),
            'vendor' => 'Authorized RDP provider',
            'summary' => 'Provider API behind the CloudHost247 secure RDP server module.',
            'documentation' => 'docs/independent-rebuild/RDP-SECURE-REBUILD-WORK-ITEM.md',
            'credentials_url' => 'Issued by the authorized RDP provider control panel.',
            'scopes' => array('GET /me', 'GET /services/{id}', 'POST /services', 'POST /services/{id}/{action}'),
            'used_by' => array('modules/servers/RDP'),
            'fields' => array(
                array('key' => 'base_url', 'label' => 'API base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'HTTPS origin documented by the provider, for example https://api.provider.example. The host must also appear in CH247_RDP_ALLOWED_HOSTS.'),
                array('key' => 'access_token', 'label' => 'API access token', 'type' => 'secret', 'required' => true, 'help' => 'Bearer token issued by the provider. Sent in the Authorization header only.'),
            ),
            'auth' => array('type' => 'bearer', 'secret' => 'access_token'),
            'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
            'health' => array('method' => 'GET', 'path' => '/me', 'expect' => array('json' => true)),
            'defaults' => array('timeout_seconds' => 20, 'connect_timeout_seconds' => 5),
            'notes' => 'The RDP server module additionally requires the endpoint host in CH247_RDP_ALLOWED_HOSTS.',
        ));
    }

    /* -------------------------------------------------------------- Hosting */

    private static function hosting()
    {
        $ovhFields = array(
            array('key' => 'region', 'label' => 'API region', 'type' => 'select', 'storage' => 'column', 'required' => true, 'options' => array('eu' => 'Europe', 'ca' => 'Canada', 'us' => 'United States')),
            array('key' => 'application_key', 'label' => 'Application key', 'type' => 'secret', 'required' => true, 'help' => 'Created at the provider token page together with the secret and consumer key.'),
            array('key' => 'application_secret', 'label' => 'Application secret', 'type' => 'secret', 'required' => true),
            array('key' => 'consumer_key', 'label' => 'Consumer key', 'type' => 'secret', 'required' => true, 'help' => 'Scope this key to the minimum access rules the platform needs.'),
        );

        return array(
            array(
                'key' => 'ovh',
                'label' => 'OVHcloud API',
                'category' => 'hosting',
                'capabilities' => array('provisioning', 'catalog', 'billing', 'domains', 'dns', 'ip'),
                'vendor' => 'OVHcloud SAS',
                'summary' => 'Signed OVHcloud API used for catalog, ordering, provisioning and reconciliation.',
                'documentation' => 'https://api.ovh.com/',
                'credentials_url' => 'https://api.ovh.com/createToken/',
                'scopes' => array('GET /auth/currentCredential', 'GET /me', 'GET /order/*', 'GET /dedicated/server/*', 'GET /vps/*'),
                'used_by' => array('modules/addons/cloudhost247_ovh', 'modules/servers/cloudhost247_ovh', 'crons/cloudhost247_ovh.php'),
                'fields' => $ovhFields,
                'auth' => array('type' => 'ovh'),
                'base_url' => array('mode' => ProviderDefinition::BASE_REGION, 'map' => array(
                    'eu' => 'https://eu.api.ovh.com/1.0',
                    'ca' => 'https://ca.api.ovh.com/1.0',
                    'us' => 'https://api.us.ovhcloud.com/1.0',
                )),
                'health' => array('method' => 'GET', 'path' => '/auth/currentCredential', 'expect' => array('json' => true, 'require' => array('status'))),
                'defaults' => array('api_version' => '1.0', 'timeout_seconds' => 30),
            ),
            array(
                'key' => 'soyoustart',
                'label' => 'SoYouStart API',
                'category' => 'hosting',
                'capabilities' => array('provisioning', 'catalog', 'ip'),
                'vendor' => 'OVHcloud SAS (SoYouStart brand)',
                'summary' => 'SoYouStart brand of the OVHcloud API used by the legacy dedicated-server automation.',
                'documentation' => 'https://eu.api.soyoustart.com/',
                'credentials_url' => 'https://eu.api.soyoustart.com/createToken/',
                'scopes' => array('GET /auth/currentCredential', 'GET /dedicated/server/*', 'GET /ip/*'),
                'used_by' => array('modules/addons/soyoustart', 'modules/servers/soyoustart', 'modules/servers/soyoustart_vps', 'crons/getServer.php', 'crons/getIpStatus.php', 'crons/priceSync.php'),
                'fields' => array(
                    array('key' => 'region', 'label' => 'API region', 'type' => 'select', 'storage' => 'column', 'required' => true, 'options' => array('eu' => 'Europe', 'ca' => 'Canada')),
                    $ovhFields[1], $ovhFields[2], $ovhFields[3],
                ),
                'auth' => array('type' => 'ovh'),
                'base_url' => array('mode' => ProviderDefinition::BASE_REGION, 'map' => array(
                    'eu' => 'https://eu.api.soyoustart.com/1.0',
                    'ca' => 'https://ca.api.soyoustart.com/1.0',
                )),
                'health' => array('method' => 'GET', 'path' => '/auth/currentCredential', 'expect' => array('json' => true, 'require' => array('status'))),
                'defaults' => array('api_version' => '1.0', 'timeout_seconds' => 30),
                'notes' => 'The vendor SoYouStart modules remain byte-identical; this entry centralises the credential source used when they are replaced.',
            ),
        );
    }

    /* -------------------------------------------------------- Control panels */

    private static function controlPanels()
    {
        return array(
            array(
                'key' => 'whm',
                'label' => 'WHM (cPanel server)',
                'category' => 'control_panel',
                'capabilities' => array('provisioning', 'accounts', 'packages'),
                'vendor' => 'cPanel, L.L.C.',
                'summary' => 'WHM API 1 over HTTPS with an API token for server-level hosting automation.',
                'documentation' => 'https://api.docs.cpanel.net/whm/introduction/',
                'credentials_url' => 'WHM -> Development -> Manage API Tokens',
                'scopes' => array('version', 'listaccts', 'createacct', 'suspendacct', 'unsuspendacct'),
                'used_by' => array('Available for WHMCS cPanel/WHM server configuration'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'WHM base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'For example https://server.example.com:2087'),
                    array('key' => 'username', 'label' => 'WHM user', 'type' => 'text', 'storage' => 'column', 'required' => true, 'help' => 'root or the reseller account that owns the token.'),
                    array('key' => 'api_key', 'label' => 'API token', 'type' => 'secret', 'required' => true, 'help' => 'Sent as "Authorization: whm user:token". Never placed in a URL.'),
                ),
                'auth' => array('type' => 'header', 'header' => 'Authorization', 'format' => 'whm {username}:{secret}', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'host_policy' => array('allowed_ports' => array(443, 2087)),
                'health' => array('method' => 'GET', 'path' => '/json-api/version?api.version=1', 'expect' => array('json' => true, 'require' => array('version'))),
                'defaults' => array('timeout_seconds' => 20),
            ),
            array(
                'key' => 'cpanel',
                'label' => 'cPanel (account UAPI)',
                'category' => 'control_panel',
                'capabilities' => array('email', 'databases', 'files'),
                'vendor' => 'cPanel, L.L.C.',
                'summary' => 'cPanel UAPI with an account-scoped API token.',
                'documentation' => 'https://api.docs.cpanel.net/cpanel/introduction/',
                'credentials_url' => 'cPanel -> Security -> Manage API Tokens',
                'scopes' => array('Variables::get_user_information', 'Email::list_pops'),
                'used_by' => array('Available for WHMCS cPanel server configuration'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'cPanel base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'For example https://server.example.com:2083'),
                    array('key' => 'username', 'label' => 'cPanel account', 'type' => 'text', 'storage' => 'column', 'required' => true),
                    array('key' => 'api_key', 'label' => 'API token', 'type' => 'secret', 'required' => true, 'help' => 'Sent as "Authorization: cpanel user:token".'),
                ),
                'auth' => array('type' => 'header', 'header' => 'Authorization', 'format' => 'cpanel {username}:{secret}', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'host_policy' => array('allowed_ports' => array(443, 2083)),
                'health' => array('method' => 'GET', 'path' => '/execute/Variables/get_user_information', 'expect' => array('json' => true)),
                'defaults' => array('timeout_seconds' => 20),
            ),
        );
    }

    /* ----------------------------------------------------- Domains and DNS */

    private static function domainsAndDns()
    {
        return array(
            array(
                'key' => 'gandi',
                'label' => 'Gandi registrar API',
                'category' => 'domains',
                'capabilities' => array('registrar', 'dns'),
                'vendor' => 'Gandi SAS',
                'summary' => 'Gandi v5 REST API for domain registration, renewal and contact management.',
                'documentation' => 'https://api.gandi.net/docs/domains/',
                'credentials_url' => 'Gandi account -> Security -> Personal Access Token',
                'scopes' => array('domain:read', 'domain:manage'),
                'used_by' => array('Available for domain registrar automation'),
                'fields' => array(
                    array('key' => 'access_token', 'label' => 'Personal access token', 'type' => 'secret', 'required' => true, 'help' => 'Sent as an Authorization bearer header.'),
                    array('key' => 'account_id', 'label' => 'Organisation ID', 'type' => 'text', 'storage' => 'column', 'required' => false, 'help' => 'Optional sharing-id used when the token can see several organisations.'),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'access_token'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.gandi.net/v5'),
                'health' => array('method' => 'GET', 'path' => '/domain/domains?per_page=1'),
                'defaults' => array('api_version' => 'v5', 'timeout_seconds' => 20),
            ),
            array(
                'key' => 'powerdns',
                'label' => 'PowerDNS authoritative API',
                'category' => 'dns',
                'capabilities' => array('dns', 'zones'),
                'vendor' => 'PowerDNS / Open-Xchange',
                'summary' => 'PowerDNS authoritative HTTP API for zone and record automation.',
                'documentation' => 'https://doc.powerdns.com/authoritative/http-api/index.html',
                'credentials_url' => 'PowerDNS server configuration: api-key= in pdns.conf',
                'scopes' => array('GET /api/v1/servers', 'GET /api/v1/servers/localhost/zones'),
                'used_by' => array('Available for DNS automation of hosted zones'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'API base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'For example https://ns1.example.com:8081'),
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true, 'help' => 'Sent in the X-API-Key header.'),
                ),
                'auth' => array('type' => 'header', 'header' => 'X-API-Key', 'format' => '{secret}', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'GET', 'path' => '/api/v1/servers', 'expect' => array('json' => true)),
                'defaults' => array('timeout_seconds' => 15),
            ),
            array(
                'key' => 'cloudflare',
                'label' => 'Cloudflare API',
                'category' => 'cdn',
                'capabilities' => array('dns', 'cdn', 'waf', 'cache'),
                'vendor' => 'Cloudflare, Inc.',
                'summary' => 'Cloudflare v4 API for DNS records, cache purge and zone settings.',
                'documentation' => 'https://developers.cloudflare.com/api/',
                'credentials_url' => 'Cloudflare dashboard -> My Profile -> API Tokens -> Create Token',
                'scopes' => array('Zone:Read', 'DNS:Edit', 'Cache Purge'),
                'used_by' => array('Available for zone, DNS and edge automation'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API token', 'type' => 'secret', 'required' => true, 'help' => 'Use a scoped API token, not the legacy global API key.'),
                    array('key' => 'account_id', 'label' => 'Account ID', 'type' => 'text', 'storage' => 'column', 'required' => false),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.cloudflare.com/client/v4'),
                'health' => array('method' => 'GET', 'path' => '/user/tokens/verify', 'expect' => array('json' => true, 'equals' => array('success' => true), 'failure_code' => 'authentication_failed')),
                'defaults' => array('api_version' => 'v4', 'timeout_seconds' => 15),
            ),
        );
    }

    /* ------------------------------------------------------------- Payments */

    private static function payments()
    {
        return array(
            array(
                'key' => 'stripe',
                'label' => 'Stripe',
                'category' => 'payments',
                'capabilities' => array('payments', 'refunds', 'webhooks'),
                'vendor' => 'Stripe, Inc.',
                'summary' => 'Stripe REST API for card payments and refunds.',
                'documentation' => 'https://docs.stripe.com/api',
                'credentials_url' => 'Stripe dashboard -> Developers -> API keys',
                'scopes' => array('balance:read', 'charges:write', 'refunds:write'),
                'used_by' => array('Available for WHMCS payment gateway configuration'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'Secret key', 'type' => 'secret', 'required' => true, 'help' => 'sk_live_... in production, sk_test_... in development and staging.'),
                    array('key' => 'webhook_secret', 'label' => 'Webhook signing secret', 'type' => 'secret', 'required' => false, 'help' => 'whsec_... used to verify inbound webhooks.'),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.stripe.com/v1'),
                'health' => array('method' => 'GET', 'path' => '/balance', 'expect' => array('json' => true, 'require' => array('object'))),
                'credential_rules' => array('api_key' => array(
                    'production_requires_prefix' => 'sk_live_',
                    'non_production_requires_prefix' => 'sk_test_',
                )),
                'defaults' => array('timeout_seconds' => 20),
            ),
            array(
                'key' => 'paypal',
                'label' => 'PayPal REST',
                'category' => 'payments',
                'capabilities' => array('payments', 'subscriptions'),
                'vendor' => 'PayPal Holdings, Inc.',
                'summary' => 'PayPal REST API with OAuth2 client-credentials, separate live and sandbox hosts.',
                'documentation' => 'https://developer.paypal.com/api/rest/',
                'credentials_url' => 'PayPal Developer dashboard -> Apps & Credentials',
                'scopes' => array('openid', 'https://uri.paypal.com/services/payments/payment'),
                'used_by' => array('Available for WHMCS payment gateway configuration'),
                'fields' => array(
                    array('key' => 'client_id', 'label' => 'Client ID', 'type' => 'text', 'storage' => 'option', 'required' => true),
                    array('key' => 'client_secret', 'label' => 'Client secret', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array(
                    'type' => 'oauth2_client_credentials',
                    'token_path' => '/v1/oauth2/token',
                    'client_id_source' => 'option:client_id',
                    'secret' => 'client_secret',
                ),
                'base_url' => array('mode' => ProviderDefinition::BASE_ENVIRONMENT, 'map' => array(
                    'production' => 'https://api-m.paypal.com',
                    'staging' => 'https://api-m.sandbox.paypal.com',
                    'development' => 'https://api-m.sandbox.paypal.com',
                )),
                'health' => array('method' => 'GET', 'path' => '/v1/identity/oauth2/userinfo?schema=paypalv1.1', 'expect' => array('json' => true)),
                'defaults' => array('timeout_seconds' => 25),
            ),
            array(
                'key' => 'blockonomics',
                'label' => 'Blockonomics',
                'category' => 'payments',
                'capabilities' => array('payments', 'crypto'),
                'vendor' => 'Blockonomics',
                'summary' => 'Bitcoin payment API used by the Blockonomics WHMCS gateway.',
                'documentation' => 'https://www.blockonomics.co/views/api.html',
                'credentials_url' => 'Blockonomics -> Wallet Watcher -> Settings -> Generate new API Key',
                'scopes' => array('GET /api/address', 'POST /api/new_address'),
                'used_by' => array('modules/gateways/blockonomics.php', 'modules/gateways/callback/blockonomics.php'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true, 'help' => 'Sent as an Authorization bearer header.'),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://www.blockonomics.co/api'),
                'health' => array('method' => 'GET', 'path' => '/address'),
                'defaults' => array('timeout_seconds' => 20),
            ),
        );
    }

    /* ------------------------------------------------------------ Messaging */

    private static function messaging()
    {
        return array(
            array(
                'key' => 'smtp',
                'label' => 'SMTP relay',
                'category' => 'email',
                'capabilities' => array('email'),
                'vendor' => 'Deployment mail relay',
                'summary' => 'Authenticated SMTP submission used for transactional mail.',
                'documentation' => 'https://datatracker.ietf.org/doc/html/rfc4954',
                'credentials_url' => 'Issued by the mail relay operator.',
                'scopes' => array('SMTP AUTH submission'),
                'used_by' => array('WHMCS mail delivery', 'crons/emailSend.php'),
                'fields' => array(
                    array('key' => 'host', 'label' => 'SMTP host', 'type' => 'text', 'storage' => 'option', 'required' => true, 'help' => 'For example smtp.example.com'),
                    array('key' => 'port', 'label' => 'Port', 'type' => 'number', 'storage' => 'option', 'required' => true, 'default' => 587, 'min' => 1, 'max' => 65535),
                    array('key' => 'encryption', 'label' => 'Encryption', 'type' => 'select', 'storage' => 'option', 'required' => true, 'options' => array('tls' => 'STARTTLS', 'ssl' => 'Implicit TLS'), 'default' => 'tls'),
                    array('key' => 'username', 'label' => 'SMTP username', 'type' => 'text', 'storage' => 'column', 'required' => true),
                    array('key' => 'password', 'label' => 'SMTP password', 'type' => 'secret', 'required' => true, 'help' => 'Required by the SMTP AUTH protocol; stored encrypted and used server-side only.'),
                    array('key' => 'from_address', 'label' => 'Default from address', 'type' => 'text', 'storage' => 'option', 'required' => false),
                ),
                'auth' => array('type' => 'smtp', 'secret' => 'password'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'smtp://configured-host'),
                'health' => array('method' => 'SMTP', 'path' => 'AUTH'),
                'defaults' => array('timeout_seconds' => 15, 'connect_timeout_seconds' => 5),
                'notes' => 'The connection test performs a real SMTP handshake, STARTTLS upgrade and AUTH exchange, then QUIT. No message is sent.',
            ),
            array(
                'key' => 'sendgrid',
                'label' => 'SendGrid',
                'category' => 'email',
                'capabilities' => array('email', 'templates'),
                'vendor' => 'Twilio SendGrid',
                'summary' => 'SendGrid v3 API for transactional email.',
                'documentation' => 'https://www.twilio.com/docs/sendgrid/api-reference',
                'credentials_url' => 'SendGrid -> Settings -> API Keys',
                'scopes' => array('mail.send', 'scopes.read'),
                'used_by' => array('Available for transactional email delivery'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.sendgrid.com/v3'),
                'health' => array('method' => 'GET', 'path' => '/scopes', 'expect' => array('json' => true, 'require' => array('scopes'))),
                'defaults' => array('api_version' => 'v3', 'timeout_seconds' => 20),
            ),
            array(
                'key' => 'microsoft_graph',
                'label' => 'Microsoft Graph',
                'category' => 'email',
                'capabilities' => array('email', 'identity', 'licensing'),
                'vendor' => 'Microsoft Corporation',
                'summary' => 'Microsoft Graph with an application registration, used for Microsoft 365 mailbox provisioning.',
                'documentation' => 'https://learn.microsoft.com/graph/api/overview',
                'credentials_url' => 'Entra admin center -> App registrations -> Certificates & secrets',
                'scopes' => array('Organization.Read.All', 'User.ReadWrite.All', 'Directory.Read.All'),
                'used_by' => array('modules/servers/cloudhost247_email'),
                'fields' => array(
                    array('key' => 'tenant_id', 'label' => 'Directory (tenant) ID', 'type' => 'text', 'storage' => 'option', 'required' => true),
                    array('key' => 'client_id', 'label' => 'Application (client) ID', 'type' => 'text', 'storage' => 'option', 'required' => true),
                    array('key' => 'client_secret', 'label' => 'Client secret', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array(
                    'type' => 'oauth2_client_credentials',
                    'token_url' => 'https://login.microsoftonline.com/{option:tenant_id}/oauth2/v2.0/token',
                    'scope' => 'https://graph.microsoft.com/.default',
                    'client_id_source' => 'option:client_id',
                    'secret' => 'client_secret',
                ),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://graph.microsoft.com/v1.0'),
                'health' => array('method' => 'GET', 'path' => '/organization', 'expect' => array('json' => true, 'require' => array('value'))),
                'defaults' => array('api_version' => 'v1.0', 'timeout_seconds' => 25),
            ),
            array(
                'key' => 'twilio',
                'label' => 'Twilio',
                'category' => 'sms',
                'capabilities' => array('sms', 'voice', 'numbers'),
                'vendor' => 'Twilio Inc.',
                'summary' => 'Twilio REST API for SMS and phone number services.',
                'documentation' => 'https://www.twilio.com/docs/usage/api',
                'credentials_url' => 'Twilio Console -> Account -> API keys & tokens',
                'scopes' => array('Accounts:read', 'Messages:write'),
                'used_by' => array('modules/addons/phoneservices'),
                'fields' => array(
                    array('key' => 'account_id', 'label' => 'Account SID', 'type' => 'text', 'storage' => 'column', 'required' => true, 'help' => 'Begins with AC.'),
                    array('key' => 'password', 'label' => 'Auth token', 'type' => 'secret', 'required' => true, 'help' => 'Used as the HTTP basic password; never sent in a URL.'),
                ),
                'auth' => array('type' => 'basic', 'username_source' => 'column:account_id', 'secret' => 'password'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.twilio.com'),
                'health' => array('method' => 'GET', 'path' => '/2010-04-01/Accounts/{account_id}.json', 'expect' => array('json' => true, 'require' => array('sid'))),
                'defaults' => array('api_version' => '2010-04-01', 'timeout_seconds' => 20),
            ),
            array(
                'key' => 'whatsapp_cloud',
                'label' => 'WhatsApp Cloud API',
                'category' => 'whatsapp',
                'capabilities' => array('whatsapp', 'templates'),
                'vendor' => 'Meta Platforms, Inc.',
                'summary' => 'WhatsApp Business Cloud API on the Meta Graph endpoint.',
                'documentation' => 'https://developers.facebook.com/docs/whatsapp/cloud-api',
                'credentials_url' => 'Meta for Developers -> WhatsApp -> API Setup (system user access token)',
                'scopes' => array('whatsapp_business_messaging', 'whatsapp_business_management'),
                'used_by' => array('Available for customer notification delivery'),
                'fields' => array(
                    array('key' => 'account_id', 'label' => 'Phone number ID', 'type' => 'text', 'storage' => 'column', 'required' => true),
                    array('key' => 'api_version', 'label' => 'Graph API version', 'type' => 'text', 'storage' => 'column', 'required' => true, 'default' => 'v21.0'),
                    array('key' => 'access_token', 'label' => 'System user access token', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'access_token'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://graph.facebook.com'),
                'health' => array('method' => 'GET', 'path' => '/{api_version}/{account_id}?fields=display_phone_number,verified_name', 'expect' => array('json' => true, 'require' => array('id'))),
                'defaults' => array('api_version' => 'v21.0', 'timeout_seconds' => 20),
            ),
            array(
                'key' => 'telegram',
                'label' => 'Telegram Bot API',
                'category' => 'telegram',
                'capabilities' => array('notifications', 'bot'),
                'vendor' => 'Telegram FZ-LLC',
                'summary' => 'Telegram Bot API for administrator and customer notifications.',
                'documentation' => 'https://core.telegram.org/bots/api',
                'credentials_url' => 'Telegram @BotFather -> /newbot or /token',
                'scopes' => array('getMe', 'sendMessage'),
                'used_by' => array('Available for administrator notification delivery'),
                'fields' => array(
                    array('key' => 'access_token', 'label' => 'Bot token', 'type' => 'secret', 'required' => true, 'help' => 'The Telegram protocol requires the token inside the request path. It is used server-side only and is redacted from every log, audit entry and error message.'),
                    array('key' => 'chat_id', 'label' => 'Default chat ID', 'type' => 'text', 'storage' => 'option', 'required' => false),
                ),
                'auth' => array('type' => 'path_token', 'secret' => 'access_token', 'prefix' => 'bot'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.telegram.org'),
                'health' => array('method' => 'GET', 'path' => '/{path_token}/getMe', 'expect' => array('json' => true, 'equals' => array('ok' => true), 'failure_code' => 'authentication_failed')),
                'defaults' => array('timeout_seconds' => 15),
                'notes' => 'Telegram mandates the bot token in the URL path. The request URL is never logged; Redactor::url() replaces the token segment.',
            ),
            array(
                'key' => 'slack',
                'label' => 'Slack',
                'category' => 'notifications',
                'capabilities' => array('notifications', 'alerts'),
                'vendor' => 'Slack Technologies, LLC',
                'summary' => 'Slack Web API for operational alerting.',
                'documentation' => 'https://api.slack.com/web',
                'credentials_url' => 'Slack -> Your Apps -> OAuth & Permissions -> Bot User OAuth Token',
                'scopes' => array('chat:write', 'auth:test'),
                'used_by' => array('Available for operational alerting'),
                'fields' => array(
                    array('key' => 'access_token', 'label' => 'Bot user OAuth token', 'type' => 'secret', 'required' => true, 'help' => 'Begins with xoxb-.'),
                    array('key' => 'channel', 'label' => 'Default channel', 'type' => 'text', 'storage' => 'option', 'required' => false),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'access_token'),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://slack.com/api'),
                'health' => array('method' => 'POST', 'path' => '/auth.test', 'expect' => array('json' => true, 'equals' => array('ok' => true), 'failure_code' => 'authentication_failed')),
                'defaults' => array('timeout_seconds' => 15),
            ),
        );
    }

    /* ------------------------------------------------- AI, edge and rates */

    private static function intelligenceAndEdge()
    {
        return array(
            array(
                'key' => 'openai',
                'label' => 'OpenAI',
                'category' => 'ai',
                'capabilities' => array('llm', 'embeddings'),
                'vendor' => 'OpenAI, L.L.C.',
                'summary' => 'OpenAI REST API for assistant and content features.',
                'documentation' => 'https://platform.openai.com/docs/api-reference',
                'credentials_url' => 'OpenAI platform -> API keys',
                'scopes' => array('api.model.read', 'api.responses.write'),
                'used_by' => array('Available for assistive content generation'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
                    array('key' => 'organization', 'label' => 'Organization ID', 'type' => 'text', 'storage' => 'option', 'required' => false),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key', 'extra_headers' => array('OpenAI-Organization' => '{option:organization}')),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.openai.com/v1'),
                'health' => array('method' => 'GET', 'path' => '/models', 'expect' => array('json' => true, 'require' => array('data'))),
                'defaults' => array('api_version' => 'v1', 'timeout_seconds' => 30),
            ),
            array(
                'key' => 'anthropic',
                'label' => 'Anthropic',
                'category' => 'ai',
                'capabilities' => array('llm'),
                'vendor' => 'Anthropic PBC',
                'summary' => 'Anthropic Messages API for assistant features.',
                'documentation' => 'https://docs.anthropic.com/en/api',
                'credentials_url' => 'Anthropic Console -> API keys',
                'scopes' => array('models:read', 'messages:write'),
                'used_by' => array('Available for assistive content generation'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
                    array('key' => 'api_version', 'label' => 'Anthropic version header', 'type' => 'text', 'storage' => 'column', 'required' => true, 'default' => '2023-06-01'),
                ),
                'auth' => array('type' => 'header', 'header' => 'x-api-key', 'format' => '{secret}', 'secret' => 'api_key', 'extra_headers' => array('anthropic-version' => '{api_version}')),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.anthropic.com/v1'),
                'health' => array('method' => 'GET', 'path' => '/models', 'expect' => array('json' => true, 'require' => array('data'))),
                'defaults' => array('api_version' => '2023-06-01', 'timeout_seconds' => 30),
            ),
            array(
                'key' => 'frankfurter',
                'label' => 'Frankfurter exchange rates',
                'category' => 'exchange_rates',
                'capabilities' => array('exchange_rates'),
                'vendor' => 'Frankfurter (ECB reference data)',
                'summary' => 'Public exchange-rate API consumed by the CloudHost247 currency engine.',
                'documentation' => 'https://www.frankfurter.app/docs/',
                'credentials_url' => 'No credentials required.',
                'scopes' => array('public read'),
                'used_by' => array('modules/addons/cloudhost247_currency'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'API base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'default' => 'https://api.frankfurter.app', 'help' => 'Change only when a self-hosted Frankfurter instance is used.'),
                ),
                'auth' => array('type' => 'none'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'GET', 'path' => '/latest?from=USD&to=EUR', 'expect' => array('json' => true, 'require' => array('rates'))),
                'defaults' => array('timeout_seconds' => 15, 'base_url' => 'https://api.frankfurter.app'),
            ),
            array(
                'key' => 'ecb',
                'label' => 'European Central Bank reference rates',
                'category' => 'exchange_rates',
                'capabilities' => array('exchange_rates'),
                'vendor' => 'European Central Bank',
                'summary' => 'Daily euro foreign-exchange reference rates used as the currency fallback provider.',
                'documentation' => 'https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html',
                'credentials_url' => 'No credentials required.',
                'scopes' => array('public read'),
                'used_by' => array('modules/addons/cloudhost247_currency'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'Base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'default' => 'https://www.ecb.europa.eu'),
                ),
                'auth' => array('type' => 'none'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'GET', 'path' => '/stats/eurofxref/eurofxref-daily.xml', 'expect' => array('contains' => 'eurofxref')),
                'defaults' => array('timeout_seconds' => 15, 'base_url' => 'https://www.ecb.europa.eu'),
            ),
        );
    }

    /* ------------------------------ Storage, monitoring and verification */

    private static function storageMonitoringVerification()
    {
        return array(
            array(
                'key' => 's3',
                'label' => 'S3-compatible object storage',
                'category' => 'storage',
                'capabilities' => array('backups', 'object_storage'),
                'vendor' => 'AWS S3 / OVHcloud Object Storage / any S3-compatible endpoint',
                'summary' => 'AWS Signature Version 4 object storage used for backups and downloads.',
                'documentation' => 'https://docs.aws.amazon.com/AmazonS3/latest/API/Welcome.html',
                'credentials_url' => 'Provider console -> access keys (access key ID + secret access key)',
                'scopes' => array('s3:ListAllMyBuckets', 's3:ListBucket', 's3:GetObject', 's3:PutObject'),
                'used_by' => array('Available for backup and object storage'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'Endpoint URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'For example https://s3.eu-west-3.amazonaws.com or https://s3.gra.io.cloud.ovh.net'),
                    array('key' => 'region', 'label' => 'Region', 'type' => 'text', 'storage' => 'column', 'required' => true, 'default' => 'us-east-1'),
                    array('key' => 'bucket', 'label' => 'Bucket', 'type' => 'text', 'storage' => 'option', 'required' => false, 'help' => 'When set, the connection test lists one object in this bucket instead of listing all buckets.'),
                    array('key' => 'api_key', 'label' => 'Access key ID', 'type' => 'secret', 'required' => true),
                    array('key' => 'api_secret', 'label' => 'Secret access key', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array('type' => 'awsv4', 'service' => 's3', 'key_id_secret' => 'api_key', 'secret' => 'api_secret'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'GET', 'path' => '/', 'expect' => array('contains' => 'ListAllMyBucketsResult')),
                'defaults' => array('timeout_seconds' => 25),
                'notes' => 'When a bucket is configured the health check performs a list-type=2 request limited to one key.',
            ),
            array(
                'key' => 'uptimerobot',
                'label' => 'UptimeRobot',
                'category' => 'monitoring',
                'capabilities' => array('monitoring', 'alerts'),
                'vendor' => 'UptimeRobot Service Provider Ltd.',
                'summary' => 'UptimeRobot v2 API for uptime monitors and maintenance windows.',
                'documentation' => 'https://uptimerobot.com/api/',
                'credentials_url' => 'UptimeRobot -> My Settings -> API keys',
                'scopes' => array('getAccountDetails', 'getMonitors'),
                'used_by' => array('Available for platform availability monitoring'),
                'fields' => array(
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true, 'help' => 'Sent in the request body, never in the URL.'),
                ),
                'auth' => array('type' => 'form_field', 'field' => 'api_key', 'secret' => 'api_key', 'extra_form' => array('format' => 'json')),
                'base_url' => array('mode' => ProviderDefinition::BASE_FIXED, 'url' => 'https://api.uptimerobot.com/v2'),
                'health' => array('method' => 'POST', 'path' => '/getAccountDetails', 'expect' => array('json' => true, 'equals' => array('stat' => 'ok'), 'failure_code' => 'authentication_failed')),
                'defaults' => array('api_version' => 'v2', 'timeout_seconds' => 20),
            ),
            array(
                'key' => 'onfido',
                'label' => 'Onfido identity verification',
                'category' => 'verification',
                'capabilities' => array('kyc', 'identity'),
                'vendor' => 'Onfido Ltd.',
                'summary' => 'Onfido API for customer identity verification and anti-fraud checks.',
                'documentation' => 'https://documentation.onfido.com/api/latest/',
                'credentials_url' => 'Onfido Dashboard -> Developers -> API tokens',
                'scopes' => array('applicants:read', 'checks:write', 'webhooks:read'),
                'used_by' => array('Available for customer verification workflows'),
                'fields' => array(
                    array('key' => 'region', 'label' => 'Data region', 'type' => 'select', 'storage' => 'column', 'required' => true, 'options' => array('eu' => 'Europe', 'us' => 'United States', 'ca' => 'Canada')),
                    array('key' => 'api_key', 'label' => 'API token', 'type' => 'secret', 'required' => true, 'help' => 'Sandbox tokens contain api_sandbox; live tokens contain api_live.'),
                ),
                'auth' => array('type' => 'header', 'header' => 'Authorization', 'format' => 'Token token={secret}', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_REGION, 'map' => array(
                    'eu' => 'https://api.eu.onfido.com/v3.6',
                    'us' => 'https://api.us.onfido.com/v3.6',
                    'ca' => 'https://api.ca.onfido.com/v3.6',
                )),
                'health' => array('method' => 'GET', 'path' => '/webhooks', 'expect' => array('json' => true)),
                'credential_rules' => array('api_key' => array(
                    'production_forbids_substring' => 'api_sandbox',
                    'non_production_forbids_substring' => 'api_live',
                )),
                'defaults' => array('api_version' => 'v3.6', 'timeout_seconds' => 25),
            ),
        );
    }

    /* ----------------------------------------------- CloudHost247 platform */

    private static function platformServices()
    {
        return array(
            array(
                'key' => 'lteproxy',
                'label' => 'CloudHost247 LTE Proxy API',
                'category' => 'network',
                'capabilities' => array('provisioning', 'proxy'),
                'vendor' => 'CloudHost247',
                'summary' => 'Reseller API behind the CloudHost247 LTE proxy server module.',
                'documentation' => 'modules/servers/cloudhost247_lteproxy/README.md',
                'credentials_url' => 'Issued by the CloudHost247 LTE proxy platform operator.',
                'scopes' => array('GET /account/info', 'GET /orders', 'POST /orders'),
                'used_by' => array('modules/servers/cloudhost247_lteproxy'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'API base URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'Supplied by the platform operator. No endpoint is hard-coded in source.'),
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true),
                ),
                'auth' => array('type' => 'bearer', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'GET', 'path' => '/account/info', 'expect' => array('json' => true)),
                'defaults' => array('timeout_seconds' => 30),
            ),
            array(
                'key' => 'smm_panel',
                'label' => 'SMM panel API',
                'category' => 'social',
                'capabilities' => array('smm', 'orders'),
                'vendor' => 'SMM panel operator',
                'summary' => 'Standard SMM panel v2 API used by the social-media reseller modules.',
                'documentation' => 'modules/addons/smmaddon/README.md',
                'credentials_url' => 'SMM panel account -> API section.',
                'scopes' => array('balance', 'services', 'add', 'status'),
                'used_by' => array('modules/addons/smmaddon', 'modules/servers/smmprovisioning'),
                'fields' => array(
                    array('key' => 'base_url', 'label' => 'API URL', 'type' => 'url', 'storage' => 'column', 'required' => true, 'help' => 'The panel API endpoint, for example https://panel.example.com/api/v2'),
                    array('key' => 'api_key', 'label' => 'API key', 'type' => 'secret', 'required' => true, 'help' => 'Submitted in the POST body as "key"; never in a query string.'),
                ),
                'auth' => array('type' => 'form_field', 'field' => 'key', 'secret' => 'api_key'),
                'base_url' => array('mode' => ProviderDefinition::BASE_ADMIN),
                'health' => array('method' => 'POST', 'path' => '', 'form' => array('action' => 'balance'), 'expect' => array('json' => true, 'require' => array('balance'))),
                'defaults' => array('timeout_seconds' => 25),
            ),
        );
    }
}
