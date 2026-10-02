<?php
namespace CloudHost247\NetworkTools\Core\Integration;

use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Result\ErrorCode;

/**
 * Adapts the existing CloudHost247 API & Integrations centre to the tools
 * platform. This class deliberately contains no provider credentials, no
 * endpoint list and no HTTP code of its own: it asks the integrations centre
 * for an already-authenticated, already-hardened client and translates that
 * centre's result vocabulary into the tools platform's error codes.
 *
 * Consequences that matter:
 *  - an administrator configures providers once, in one place;
 *  - a key is never hard-coded here, and a missing key is reported as
 *    CONFIGURATION_REQUIRED instead of returning invented data;
 *  - when the integrations centre is not installed, every provider-backed tool
 *    degrades to CONFIGURATION_REQUIRED and local tools keep working.
 */
final class ProviderBridge
{
    /** @var ProviderRepository */
    private $repository;

    public function __construct(ProviderRepository $repository = null)
    {
        $this->repository = $repository ?: new ProviderRepository();
    }

    public function installed()
    {
        return class_exists('CloudHost247\\Integrations\\Services\\IntegrationManager');
    }

    /** True when the integration is enabled for the active environment. */
    public function available($providerKey)
    {
        if (!$this->installed()) {
            return false;
        }
        try {
            return \CloudHost247\Integrations\Services\IntegrationManager::isAvailable($providerKey);
        } catch (\Throwable $unavailable) {
            return false;
        }
    }

    /**
     * First configured provider from a list, in the order the tool declared.
     *
     * @return array{available:bool,key:string,configured:array}
     */
    public function firstAvailable(array $providerKeys)
    {
        $configured = array();
        foreach ($providerKeys as $key) {
            if ($this->available($key)) {
                $configured[] = $key;
            }
        }
        return array('available' => count($configured) > 0, 'key' => $configured ? $configured[0] : '', 'configured' => $configured);
    }

    /** Registered tool-provider rows (DNSBL registry, endpoint selection). */
    public function toolProviders($type = null, $onlyEnabled = false)
    {
        return $this->repository->all($onlyEnabled, $type);
    }

    public function toolProvider($providerKey)
    {
        return $this->repository->findByKey($providerKey);
    }

    /**
     * Perform an authenticated provider request.
     *
     * @return array{ok:bool,code:string,message:string,status:int,json:array|null,latency_ms:int}
     */
    public function call($providerKey, $method, $path, array $options = array())
    {
        if (!$this->installed()) {
            return $this->failure(ErrorCode::CONFIGURATION_REQUIRED, 'The API & Integrations centre is not installed on this deployment.');
        }
        if (!$this->available($providerKey)) {
            return $this->failure(ErrorCode::CONFIGURATION_REQUIRED, 'No enabled configuration exists for this provider.');
        }
        try {
            $client = \CloudHost247\Integrations\Services\IntegrationManager::client($providerKey);
            $response = $client->request($method, $path, $options);
        } catch (\Throwable $failure) {
            $this->recordFailure($providerKey, $failure);
            return $this->failure(ErrorCode::PROVIDER_ERROR, $this->safeMessage($failure));
        }
        $status = isset($response['status']) ? (int) $response['status'] : 0;
        return array(
            'ok' => $status >= 200 && $status < 300,
            'code' => $status >= 200 && $status < 300 ? ErrorCode::OK : ErrorCode::PROVIDER_ERROR,
            'message' => $status >= 200 && $status < 300 ? '' : 'The provider returned HTTP ' . $status . '.',
            'status' => $status,
            'json' => isset($response['json']) ? $response['json'] : null,
            'body' => isset($response['body']) ? (string) $response['body'] : '',
            'latency_ms' => isset($response['latency_ms']) ? (int) $response['latency_ms'] : 0,
        );
    }

    /** Configuration + decrypted secrets, for services that own a client. Never expose. */
    public function credentials($providerKey)
    {
        if (!$this->installed()) {
            return null;
        }
        try {
            return \CloudHost247\Integrations\Services\IntegrationManager::optionalCredentials($providerKey);
        } catch (\Throwable $unavailable) {
            return null;
        }
    }

    /** Shared SMTP submission client for the configured provider, or null. */
    public function smtpClient($providerKey)
    {
        if (!$this->installed() || !method_exists('CloudHost247\\Integrations\\Services\\IntegrationManager', 'smtp')) {
            return null;
        }
        try {
            return \CloudHost247\Integrations\Services\IntegrationManager::smtp($providerKey);
        } catch (\Throwable $unavailable) {
            return null;
        }
    }

    /** Non-secret SMTP identity (from address/name) of the configured provider. */
    public function smtpIdentity($providerKey)
    {
        if (!$this->installed() || !method_exists('CloudHost247\\Integrations\\Services\\IntegrationManager', 'smtpIdentity')) {
            return array();
        }
        try {
            $identity = \CloudHost247\Integrations\Services\IntegrationManager::smtpIdentity($providerKey);
            return is_array($identity) ? $identity : array();
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    /**
     * Reuse the integrations centre's SMTP probe for a one-off diagnostic.
     * User-supplied credentials are passed straight through and are never
     * persisted by either module.
     *
     * @return array{ok:bool,code:string,message:string,latency_ms:int}
     */
    public function probeSmtp(array $settings)
    {
        if (!class_exists('CloudHost247\\Integrations\\Api\\SmtpProbe')) {
            return $this->failure(ErrorCode::CONFIGURATION_REQUIRED, 'The SMTP probe is not available on this deployment.');
        }
        try {
            $probe = new \CloudHost247\Integrations\Api\SmtpProbe();
            $result = $probe->check($settings);
        } catch (\Throwable $failure) {
            return $this->failure(ErrorCode::PROVIDER_ERROR, 'The SMTP test could not be completed.');
        }
        $code = isset($result['code']) ? (string) $result['code'] : '';
        $connected = $code === 'connected';
        return array(
            'ok' => $connected,
            'code' => $connected ? ErrorCode::OK : ($code === 'timeout' ? ErrorCode::TIMEOUT : (in_array($code, array('authentication_failed', 'permission_denied'), true) ? ErrorCode::ACCESS_DENIED : ErrorCode::PROVIDER_ERROR)),
            'message' => isset($result['detail']) ? (string) $result['detail'] : '',
            'provider_code' => $code,
            'latency_ms' => isset($result['latency_ms']) ? (int) $result['latency_ms'] : 0,
        );
    }

    /** Sanitized provider health for the admin dashboard. */
    public function health($environment = null)
    {
        if (!$this->installed()) {
            return array();
        }
        try {
            return \CloudHost247\Integrations\Services\IntegrationManager::overview($environment);
        } catch (\Throwable $unavailable) {
            return array();
        }
    }

    public function recordFailure($providerKey, \Throwable $failure)
    {
        if (!$this->installed() || !method_exists('CloudHost247\\Integrations\\Services\\IntegrationManager', 'recordRuntimeFailure')) {
            return;
        }
        try {
            \CloudHost247\Integrations\Services\IntegrationManager::recordRuntimeFailure(
                $providerKey, null, 'provider_unavailable', 'network tools provider call failed: ' . get_class($failure)
            );
        } catch (\Throwable $ignored) {
            // Recording must never mask the original failure.
        }
    }

    private function safeMessage(\Throwable $failure)
    {
        $message = trim((string) $failure->getMessage());
        if ($message === '') {
            $message = 'The provider request failed.';
        }
        if (class_exists('CloudHost247\\Integrations\\Support\\Redactor')) {
            return \CloudHost247\Integrations\Support\Redactor::text($message, 200);
        }
        return substr(preg_replace('/[A-Za-z0-9_\-]{24,}/', '[redacted]', $message), 0, 200);
    }

    private function failure($code, $message)
    {
        return array('ok' => false, 'code' => $code, 'message' => (string) $message, 'status' => 0, 'json' => null, 'body' => '', 'latency_ms' => 0);
    }
}
