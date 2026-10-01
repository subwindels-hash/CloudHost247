<?php
namespace CloudHost247\Marketing\Services;

/**
 * The cPanel SMTP delivery provider (SESSION 6).
 *
 * Everything here is a thin, honest adapter:
 *
 *   - Credentials are never read, held or logged by this module. The client is
 *     built by `cloudhost247_integrations` from the encrypted vault, and this
 *     class only sees an object it can ask to send.
 *   - Availability is answered with a reason. "Not installed", "not configured"
 *     and "configured but unreadable" are three different sentences, and the
 *     campaign checklist shows exactly which one applies.
 *   - The sender-domain policy is stated up front *and* enforced again on the
 *     way out, so a campaign cannot bypass it by any route.
 *   - A provider failure is reported back to the integrations event history so
 *     a relay that starts refusing mail shows up where every other provider
 *     incident already shows up.
 *
 * The resolvers are constructor-injected: production uses the vault, tests use
 * a scripted client, and neither path contains a credential in the marketing
 * module itself.
 */
final class SmtpTransport implements MessageTransport, SenderPolicy
{
    const PROVIDER_KEY = 'cpanel_smtp';

    /** @var callable */
    private $resolver;
    /** @var callable */
    private $identityResolver;
    /** @var callable */
    private $reporter;
    /** @var string */
    private $providerKey;
    /** @var array|null */
    private $resolution = null;
    /** @var array|false|null */
    private $identity = null;

    public function __construct($resolver = null, $identityResolver = null, $reporter = null, $providerKey = self::PROVIDER_KEY)
    {
        $this->providerKey = (string) $providerKey;
        $this->resolver = is_callable($resolver) ? $resolver : $this->defaultResolver();
        $this->identityResolver = is_callable($identityResolver) ? $identityResolver : $this->defaultIdentityResolver();
        $this->reporter = is_callable($reporter) ? $reporter : $this->defaultReporter();
    }

    public function key()
    {
        return $this->providerKey;
    }

    public function isAvailable()
    {
        $resolution = $this->resolve();
        return $resolution['client'] !== null;
    }

    public function reason()
    {
        $resolution = $this->resolve();
        return $resolution['client'] !== null ? '' : $resolution['reason'];
    }

    /** Non-secret sending identity, or null when the provider is not configured. */
    public function identity()
    {
        if ($this->identity === null) {
            $this->identity = call_user_func($this->identityResolver);
        }
        return $this->identity === false ? null : $this->identity;
    }

    public function send(array $message)
    {
        $resolution = $this->resolve();
        if ($resolution['client'] === null) {
            return array('ok' => false, 'error' => $resolution['reason'], 'provider_message_id' => '');
        }

        $policy = $this->senderPolicy(isset($message['from_email']) ? $message['from_email'] : '');
        if (!$policy['ok']) {
            return array('ok' => false, 'error' => $policy['detail'], 'provider_message_id' => '');
        }

        $result = $resolution['client']->send($message);
        if (!empty($result['ok'])) {
            return array(
                'ok' => true,
                'error' => '',
                'provider_message_id' => isset($result['provider_message_id']) ? (string) $result['provider_message_id'] : '',
            );
        }

        $detail = isset($result['detail']) ? (string) $result['detail'] : 'The relay refused the message.';
        call_user_func($this->reporter,
            isset($result['code']) ? (string) $result['code'] : 'provider_unavailable',
            $detail
        );
        return array('ok' => false, 'error' => $detail, 'provider_message_id' => '');
    }

    /**
     * The sender-domain rule: a campaign may only send from the authenticated
     * mailbox's domain or from the provider's configured from-address domain.
     * That is what stops a compromised or careless administrator from turning
     * the relay into an open sender for an unrelated domain.
     */
    public function senderPolicy($fromEmail)
    {
        $identity = $this->identity();
        if ($identity === null) {
            return array(
                'ok' => true,
                'detail' => 'Sender domain is checked as soon as the cPanel SMTP provider is configured and enabled.',
                'enforced' => false,
            );
        }

        $allowed = array();
        foreach (array('username', 'from_address') as $field) {
            $domain = $this->domain(isset($identity[$field]) ? $identity[$field] : '');
            if ($domain !== '' && !in_array($domain, $allowed, true)) { $allowed[] = $domain; }
        }
        if (!$allowed) {
            return array(
                'ok' => false,
                'detail' => 'The cPanel SMTP provider has no usable mailbox address, so no sender can be authorised.',
                'enforced' => true,
            );
        }

        $domain = $this->domain((string) $fromEmail);
        if ($domain === '' || !in_array($domain, $allowed, true)) {
            return array(
                'ok' => false,
                'detail' => 'A campaign may only send from ' . implode(' or ', $allowed) . ' with this mailbox; "' . $domain . '" would be refused by the relay or look like spoofing.',
                'enforced' => true,
            );
        }

        return array(
            'ok' => true,
            'detail' => 'Sending as ' . $identity['username'] . '; ' . $domain . ' is an authorised sender domain.',
            'enforced' => true,
        );
    }

    // ---------------------------------------------------------------- defaults

    private function resolve()
    {
        if ($this->resolution === null) {
            try {
                $resolution = call_user_func($this->resolver);
            } catch (\Throwable $error) {
                $resolution = array('client' => null, 'reason' => 'The cPanel SMTP provider is not usable: ' . $error->getMessage());
            }
            if (!is_array($resolution) || !array_key_exists('client', $resolution)) {
                $resolution = array('client' => null, 'reason' => 'The cPanel SMTP provider could not be resolved.');
            }
            if ($resolution['client'] === null && (!isset($resolution['reason']) || $resolution['reason'] === '')) {
                $resolution['reason'] = 'The cPanel SMTP provider is not configured in API & Integrations yet.';
            }
            $this->resolution = $resolution;
        }
        return $this->resolution;
    }

    private function defaultResolver()
    {
        $providerKey = $this->providerKey;
        return function () use ($providerKey) {
            if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
                return array('client' => null, 'reason' => 'The cPanel SMTP provider needs the API & Integrations addon, which is not active on this deployment.');
            }
            $manager = 'CloudHost247\\Integrations\\Services\\IntegrationManager';
            if (!call_user_func(array($manager, 'installed'))) {
                return array('client' => null, 'reason' => 'The cPanel SMTP provider needs the API & Integrations addon, which is not active on this deployment.');
            }
            $client = call_user_func(array($manager, 'smtp'), $providerKey);
            if ($client === null) {
                return array('client' => null, 'reason' => 'The cPanel SMTP provider is not configured in API & Integrations yet.');
            }
            return array('client' => $client, 'reason' => '');
        };
    }

    private function defaultIdentityResolver()
    {
        $providerKey = $this->providerKey;
        return function () use ($providerKey) {
            if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) {
                return false;
            }
            $manager = 'CloudHost247\\Integrations\\Services\\IntegrationManager';
            try {
                return call_user_func(array($manager, 'smtpIdentity'), $providerKey);
            } catch (\Throwable $error) {
                return false;
            }
        };
    }

    private function defaultReporter()
    {
        $providerKey = $this->providerKey;
        return function ($code, $detail) use ($providerKey) {
            if (!class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager')) { return; }
            $manager = 'CloudHost247\\Integrations\\Services\\IntegrationManager';
            $environment = 'production';
            if (class_exists('CloudHost247\\Integrations\\Support\\Environment')) {
                try { $environment = \CloudHost247\Integrations\Support\Environment::active(); } catch (\Throwable $error) { $environment = 'production'; }
            }
            try {
                call_user_func(array($manager, 'recordRuntimeFailure'), $providerKey, $environment, $code, $detail);
            } catch (\Throwable $error) {
                // Observability must never break a send attempt.
            }
        };
    }

    private function domain($address)
    {
        $position = strrpos(trim((string) $address), '@');
        return $position === false ? '' : strtolower(trim(substr($address, $position + 1)));
    }
}
