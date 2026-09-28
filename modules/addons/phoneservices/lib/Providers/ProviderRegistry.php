<?php
/**
 * Provider Registry
 *
 * Declarative catalogue of telecom providers. Nothing in the platform
 * hardcodes a provider: services resolve an implementation by *capability*
 * (sms, voice, numbers, esim, whatsapp, email) and the registry maps that to
 * whichever class the administrator selected.
 *
 * Third-party providers can be added at runtime without touching core code:
 *
 *   ProviderRegistry::register('mycarrier', [
 *       'label'        => 'My Carrier',
 *       'class'        => \Acme\MyCarrierProvider::class,
 *       'capabilities' => ['sms', 'voice'],
 *       'credentials'  => ['api_key' => 'API Key', 'api_secret' => 'API Secret'],
 *   ]);
 *
 * (Call it from a WHMCS hook - see hooks.php `PhoneServicesRegisterProviders`.)
 *
 * @package PhoneServices
 */

namespace PhoneServices\Providers;

class ProviderRegistry
{
    /** Capabilities the platform knows how to consume. */
    const CAPABILITIES = ['numbers', 'voice', 'sms', 'esim', 'whatsapp', 'email', 'webrtc'];

    /** @var array<string,array<string,mixed>>|null */
    private static $definitions;

    /** @var array<string,array<string,mixed>> Runtime additions */
    private static $extra = [];

    /**
     * Built-in provider definitions.
     *
     * @return array<string,array<string,mixed>>
     */
    private static function builtIn(): array
    {
        return [
            'twilio' => [
                'label'        => 'Twilio',
                'class'        => TwilioProvider::class,
                'capabilities' => ['numbers', 'voice', 'sms', 'webrtc'],
                'credentials'  => [
                    'account_sid' => 'Account SID',
                    'auth_token'  => 'Auth Token',
                    'api_key'     => 'API Key SID (WebRTC tokens)',
                    'api_secret'  => 'API Key Secret (WebRTC tokens)',
                    'twiml_app_sid' => 'TwiML Application SID (WebRTC)',
                ],
                'required'     => ['account_sid', 'auth_token'],
                'docs'         => 'https://www.twilio.com/docs',
            ],
            'vonage' => [
                'label'        => 'Vonage',
                'class'        => VonageProvider::class,
                'capabilities' => ['numbers', 'voice', 'sms'],
                'credentials'  => [
                    'api_key'          => 'API Key',
                    'api_secret'       => 'API Secret',
                    'application_id'   => 'Application ID (Voice)',
                    'signature_secret' => 'Signature Secret (webhooks)',
                ],
                'required'     => ['api_key', 'api_secret'],
                'docs'         => 'https://developer.vonage.com/en/api',
            ],
            'airalo' => [
                'label'        => 'Airalo',
                'class'        => AiraloProvider::class,
                'capabilities' => ['esim'],
                'credentials'  => [
                    'client_id'     => 'Client ID',
                    'client_secret' => 'Client Secret',
                    'api_token'     => 'API Token (legacy)',
                ],
                'required'     => ['api_token'],
                'docs'         => 'https://partners.airalo.com/api-docs',
            ],
            'truphone' => [
                'label'        => 'Truphone (1GLOBAL)',
                'class'        => TruphoneProvider::class,
                'capabilities' => ['esim'],
                'credentials'  => [
                    'api_key'    => 'API Key',
                    'account_id' => 'Account ID',
                ],
                'required'     => ['api_key'],
                'docs'         => 'https://developer.truphone.com',
            ],
            'whatsapp' => [
                'label'        => 'WhatsApp Business (Meta Cloud API)',
                'class'        => WhatsAppProvider::class,
                'capabilities' => ['whatsapp'],
                'credentials'  => [
                    'access_token'     => 'Permanent Access Token',
                    'phone_number_id'  => 'Phone Number ID',
                    'business_id'      => 'WhatsApp Business Account ID',
                    'verify_token'     => 'Webhook Verify Token',
                    'app_secret'       => 'App Secret (payload signature)',
                ],
                'required'     => ['access_token', 'phone_number_id'],
                'docs'         => 'https://developers.facebook.com/docs/whatsapp/cloud-api',
            ],
            'sendgrid' => [
                'label'        => 'SendGrid',
                'class'        => SendgridProvider::class,
                'capabilities' => ['email'],
                'credentials'  => [
                    'api_key'    => 'API Key',
                    'from_email' => 'Default From Address',
                    'from_name'  => 'Default From Name',
                ],
                'required'     => ['api_key'],
                'docs'         => 'https://docs.sendgrid.com/api-reference',
            ],
        ];
    }

    /**
     * Register or override a provider definition at runtime.
     *
     * @param array<string,mixed> $definition
     */
    public static function register(string $id, array $definition): void
    {
        $id = strtolower(trim($id));
        if ($id === '' || empty($definition['class'])) {
            return;
        }

        self::$extra[$id] = array_merge([
            'label'        => ucfirst($id),
            'capabilities' => [],
            'credentials'  => [],
            'required'     => [],
            'docs'         => '',
        ], $definition);

        self::$definitions = null;
    }

    /**
     * All provider definitions keyed by id.
     *
     * @return array<string,array<string,mixed>>
     */
    public static function all(): array
    {
        if (self::$definitions === null) {
            self::$definitions = array_merge(self::builtIn(), self::$extra);
        }

        return self::$definitions;
    }

    /**
     * @return array<string,mixed>|null
     */
    public static function definition(string $id): ?array
    {
        $all = self::all();

        return $all[strtolower($id)] ?? null;
    }

    public static function exists(string $id): bool
    {
        return self::definition($id) !== null;
    }

    /**
     * id => label map, for admin dropdowns.
     *
     * @return array<string,string>
     */
    public static function labels(): array
    {
        $labels = [];
        foreach (self::all() as $id => $definition) {
            $labels[$id] = (string) $definition['label'];
        }

        return $labels;
    }

    /**
     * Providers advertising a capability.
     *
     * @return array<string,string> id => label
     */
    public static function forCapability(string $capability): array
    {
        $matches = [];
        foreach (self::all() as $id => $definition) {
            if (in_array($capability, (array) $definition['capabilities'], true)) {
                $matches[$id] = (string) $definition['label'];
            }
        }

        return $matches;
    }

    /**
     * Credential field names for a provider (used by Config to build the bag).
     *
     * @return string[]
     */
    public static function credentialFields(string $id): array
    {
        $definition = self::definition($id);

        return $definition ? array_keys((array) $definition['credentials']) : [];
    }

    /**
     * Credential field => human label map (used by the admin UI).
     *
     * @return array<string,string>
     */
    public static function credentialLabels(string $id): array
    {
        $definition = self::definition($id);

        return $definition ? (array) $definition['credentials'] : [];
    }

    /**
     * Credentials that must be present for the provider to be usable.
     *
     * @return string[]
     */
    public static function requiredCredentials(string $id): array
    {
        $definition = self::definition($id);

        return $definition ? (array) $definition['required'] : [];
    }

    /**
     * @return string[]
     */
    public static function capabilities(string $id): array
    {
        $definition = self::definition($id);

        return $definition ? (array) $definition['capabilities'] : [];
    }

    public static function className(string $id): ?string
    {
        $definition = self::definition($id);

        return $definition ? (string) $definition['class'] : null;
    }

    /** Test seam. */
    public static function reset(): void
    {
        self::$extra = [];
        self::$definitions = null;
    }
}
