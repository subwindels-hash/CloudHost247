<?php
/**
 * Typed view over the WHMCS $params array.
 *
 * WHMCS hands provisioning modules a large untyped array. Everything the module
 * needs is read through this class so that:
 *   - option numbering lives in exactly one place (see CONFIG_OPTIONS);
 *   - credentials are read from the WHMCS-encrypted server fields and are never
 *     copied into our own tables or logs;
 *   - values are validated at the boundary.
 *
 * Credential mapping (documented in README.md, section "Server settings"):
 *
 *   Provider          Hostname            Username                  Password        Access hash
 *   ----------------  ------------------  ------------------------  --------------  -------------------------
 *   professional      API base URL        (optional account id)     API key         optional JSON overrides
 *   microsoft365      (optional)          Application (client) ID   Client secret   Tenant ID
 *   google            (optional)          Delegated admin email     (unused)        Service-account JSON
 *
 * WHMCS encrypts tblservers.password and tblservers.accesshash at rest and
 * decrypts them into $params, so the module never stores plaintext secrets.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Support;

final class Config
{
    const PROVIDER_PROFESSIONAL = 'professional';
    const PROVIDER_MICROSOFT    = 'microsoft365';
    const PROVIDER_GOOGLE       = 'google';

    /**
     * configoption<N> => logical name. The order is part of the module's public
     * contract: changing it would silently repoint existing products.
     *
     * @var array<int,string>
     */
    const CONFIG_OPTIONS = [
        1 => 'provider',
        2 => 'plan_tier',
        3 => 'plan_sku',
        4 => 'mailbox_quantity',
        5 => 'storage_gb',
        6 => 'usage_location',
        7 => 'login_url',
        8 => 'force_password_change',
    ];

    /** @var array<string,mixed> */
    private $params;

    /**
     * @param array<string,mixed> $params
     */
    public function __construct(array $params)
    {
        $this->params = $params;
    }

    /**
     * @return array<string,mixed>
     */
    public function raw(): array
    {
        return $this->params;
    }

    /* ------------------------------------------------------------------
     | Product configuration
     * ----------------------------------------------------------------- */

    public function option(string $name, string $default = ''): string
    {
        $index = array_search($name, self::CONFIG_OPTIONS, true);

        if ($index === false) {
            return $default;
        }

        $value = $this->params['configoption' . $index] ?? '';

        return $value === '' ? $default : Validator::text($value, 255);
    }

    public function provider(): string
    {
        return Validator::oneOf(
            $this->option('provider', self::PROVIDER_PROFESSIONAL),
            [self::PROVIDER_PROFESSIONAL, self::PROVIDER_MICROSOFT, self::PROVIDER_GOOGLE],
            self::PROVIDER_PROFESSIONAL
        );
    }

    public function planTier(): string
    {
        return Validator::oneOf($this->option('plan_tier', 'standard'), ['basic', 'standard', 'premium'], 'standard');
    }

    /**
     * Provider SKU / plan id. Empty means "not mapped" - provisioning refuses
     * to guess one.
     */
    public function planSku(): string
    {
        $sku = trim($this->option('plan_sku'));

        return Validator::isSku($sku) ? $sku : '';
    }

    public function mailboxQuantity(): int
    {
        return max(1, min(500, (int) $this->option('mailbox_quantity', '1')));
    }

    /**
     * Storage allowance, for display only. 0 = not configured, which the UI
     * renders as "not verified" rather than inventing a number.
     */
    public function storageGb(): int
    {
        return max(0, (int) $this->option('storage_gb', '0'));
    }

    /**
     * ISO 3166-1 alpha-2 usage location. Microsoft refuses to assign a licence
     * without one.
     */
    public function usageLocation(): string
    {
        $value = strtoupper(trim($this->option('usage_location')));

        return preg_match('/^[A-Z]{2}$/', $value) ? $value : '';
    }

    /**
     * Provider login URL override (used for the "Webmail" button on the
     * Professional Email provider, which has no canonical URL).
     */
    public function loginUrlOverride(): string
    {
        $url = trim($this->option('login_url'));

        return stripos($url, 'https://') === 0 ? $url : '';
    }

    public function forcePasswordChange(): bool
    {
        return in_array(strtolower($this->option('force_password_change', 'on')), ['on', 'yes', '1', 'true'], true);
    }

    /* ------------------------------------------------------------------
     | Server credentials (WHMCS-encrypted fields)
     * ----------------------------------------------------------------- */

    public function serverHostname(): string
    {
        return Validator::text($this->params['serverhostname'] ?? '', 255);
    }

    public function serverUsername(): string
    {
        return Validator::text($this->params['serverusername'] ?? '', 255);
    }

    /**
     * Decrypted by WHMCS before the module sees it. Never logged, never stored.
     */
    public function serverPassword(): string
    {
        $value = $this->params['serverpassword'] ?? '';

        return is_string($value) ? $value : '';
    }

    public function serverAccessHash(): string
    {
        $value = $this->params['serveraccesshash'] ?? '';

        return is_string($value) ? trim($value) : '';
    }

    /**
     * Base URL for the Professional Email provider API.
     */
    public function apiBaseUrl(): string
    {
        $host = $this->serverHostname();

        if ($host === '') {
            return '';
        }

        if (stripos($host, 'http://') === 0) {
            // Never silently downgrade; the transport refuses plain HTTP anyway.
            return '';
        }

        if (stripos($host, 'https://') !== 0) {
            $host = 'https://' . $host;
        }

        return rtrim($host, '/');
    }

    /* ------------------------------------------------------------------
     | Service facts
     * ----------------------------------------------------------------- */

    public function serviceId(): int
    {
        return (int) ($this->params['serviceid'] ?? 0);
    }

    public function clientId(): int
    {
        return (int) ($this->params['userid'] ?? ($this->params['clientsdetails']['userid'] ?? 0));
    }

    public function productId(): int
    {
        return (int) ($this->params['pid'] ?? 0);
    }

    public function domain(): string
    {
        return Validator::normaliseDomain((string) ($this->params['domain'] ?? ''));
    }

    public function mailboxLocalPart(): string
    {
        $username = strtolower(trim((string) ($this->params['username'] ?? '')));

        if ($username !== '' && Validator::isLocalPart($username)) {
            return $username;
        }

        // Fall back to a custom field, then to the client's own address.
        $custom = $this->customField('Mailbox Username');

        if ($custom !== '' && Validator::isLocalPart($custom)) {
            return strtolower($custom);
        }

        return '';
    }

    /**
     * The mailbox address to provision.
     */
    public function mailboxAddress(): string
    {
        $custom = $this->customField('Mailbox Address');

        if ($custom !== '' && Validator::isEmail($custom)) {
            return strtolower($custom);
        }

        return Validator::buildEmail($this->mailboxLocalPart(), $this->domain());
    }

    /**
     * Contact address for credential delivery (never the mailbox itself).
     */
    public function contactEmail(): string
    {
        $custom = $this->customField('Contact Email');

        if ($custom !== '' && Validator::isEmail($custom)) {
            return strtolower($custom);
        }

        $email = (string) ($this->params['clientsdetails']['email'] ?? '');

        return Validator::isEmail($email) ? strtolower($email) : '';
    }

    public function firstName(): string
    {
        return Validator::text($this->params['clientsdetails']['firstname'] ?? '', 64);
    }

    public function lastName(): string
    {
        return Validator::text($this->params['clientsdetails']['lastname'] ?? '', 64);
    }

    public function displayName(): string
    {
        $name = trim($this->firstName() . ' ' . $this->lastName());

        if ($name !== '') {
            return $name;
        }

        $address = $this->mailboxAddress();

        return $address !== '' ? explode('@', $address)[0] : 'Mailbox';
    }

    public function password(): string
    {
        $value = $this->params['password'] ?? '';

        return is_string($value) ? $value : '';
    }

    public function customField(string $name): string
    {
        $fields = $this->params['customfields'] ?? [];

        if (!is_array($fields)) {
            return '';
        }

        foreach ($fields as $key => $value) {
            if (strcasecmp((string) $key, $name) === 0) {
                return Validator::text($value, 255);
            }
        }

        return '';
    }

    /* ------------------------------------------------------------------
     | Validation
     * ----------------------------------------------------------------- */

    /**
     * Product/service level validation, before any provider call.
     *
     * @return array<string,mixed> Result envelope
     */
    public function validateService(): array
    {
        if ($this->serviceId() <= 0) {
            return Result::fail(Result::CODE_VALIDATION, 'The WHMCS service id is missing.');
        }

        if ($this->clientId() <= 0) {
            return Result::fail(Result::CODE_VALIDATION, 'The WHMCS client could not be identified.');
        }

        if (!Validator::isDomain($this->domain())) {
            return Result::fail(
                Result::CODE_VALIDATION,
                'A valid custom domain is required on the service before the mailbox can be provisioned.'
            );
        }

        if (!Validator::isEmail($this->mailboxAddress())) {
            return Result::fail(
                Result::CODE_VALIDATION,
                'A valid mailbox username is required on the service before it can be provisioned.'
            );
        }

        return Result::ok([
            'service_id' => $this->serviceId(),
            'domain'     => $this->domain(),
            'email'      => $this->mailboxAddress(),
            'provider'   => $this->provider(),
        ]);
    }

    /**
     * A short, non-sensitive summary for logs and the admin tab.
     *
     * @return array<string,mixed>
     */
    public function summary(): array
    {
        return [
            'service_id' => $this->serviceId(),
            'client_id'  => $this->clientId(),
            'provider'   => $this->provider(),
            'plan_tier'  => $this->planTier(),
            'plan_sku'   => $this->planSku(),
            'domain'     => $this->domain(),
            'email'      => $this->mailboxAddress(),
            'quantity'   => $this->mailboxQuantity(),
        ];
    }
}
