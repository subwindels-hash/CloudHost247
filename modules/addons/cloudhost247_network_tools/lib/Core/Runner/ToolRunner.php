<?php
namespace CloudHost247\NetworkTools\Core\Runner;

use CloudHost247\NetworkTools\Core\Integration\ProviderBridge;
use CloudHost247\NetworkTools\Core\Registry\ToolDefinition;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Repository\AbuseRepository;
use CloudHost247\NetworkTools\Core\Repository\CacheRepository;
use CloudHost247\NetworkTools\Core\Repository\ExecutionLogRepository;
use CloudHost247\NetworkTools\Core\Repository\ProviderRepository;
use CloudHost247\NetworkTools\Core\Repository\SettingsRepository;
use CloudHost247\NetworkTools\Core\Repository\ToolStateRepository;
use CloudHost247\NetworkTools\Core\Result\Capability;
use CloudHost247\NetworkTools\Core\Result\ErrorCode;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Result\ToolStatus;
use CloudHost247\NetworkTools\Core\Security\RateLimiter;

/**
 * Executes one tool request.
 *
 * Everything that must happen for *every* tool happens here exactly once, in a
 * fixed order, so no individual service can forget a control:
 *
 *   1. the tool exists in the registry;
 *   2. the module is enabled and the tool is not disabled or in maintenance;
 *   3. the caller may see it (public / customer / admin);
 *   4. a provider that the tool cannot work without is configured;
 *   5. the hosting environment supports the capabilities it needs;
 *   6. the submitted values validate against the tool's own schema;
 *   7. abuse thresholds and rate limits are applied;
 *   8. a cached public answer is used when allowed;
 *   9. the service runs;
 *  10. the execution is recorded (metadata only) and, for a signed-in
 *      customer, appended to their clearable history.
 *
 * A failure never carries data: ToolResult::failure() has no data argument.
 */
final class ToolRunner
{
    /** @var SettingsRepository */
    private $settings;
    /** @var ToolStateRepository */
    private $states;
    /** @var CacheRepository */
    private $cache;
    /** @var ExecutionLogRepository */
    private $executions;
    /** @var AbuseRepository */
    private $abuse;
    /** @var ProviderBridge */
    private $providers;
    /** @var ProviderRepository */
    private $providerRows;

    public function __construct(
        SettingsRepository $settings = null,
        ToolStateRepository $states = null,
        CacheRepository $cache = null,
        ExecutionLogRepository $executions = null,
        AbuseRepository $abuse = null,
        ProviderBridge $providers = null,
        ProviderRepository $providerRows = null
    ) {
        $this->settings = $settings ?: new SettingsRepository();
        $this->states = $states ?: new ToolStateRepository();
        $this->cache = $cache ?: new CacheRepository();
        $this->executions = $executions ?: new ExecutionLogRepository();
        $this->abuse = $abuse ?: new AbuseRepository();
        $this->providers = $providers ?: new ProviderBridge();
        $this->providerRows = $providerRows ?: new ProviderRepository();
    }

    public function settings()
    {
        return $this->settings;
    }

    public function states()
    {
        return $this->states;
    }

    public function providers()
    {
        return $this->providers;
    }

    public function cache()
    {
        return $this->cache;
    }

    /**
     * Effective state of a tool: what the operator set, narrowed by what the
     * environment or the provider configuration actually allows.
     *
     * @return array{state:string,label:string,tone:string,detail:string,operator_state:string}
     */
    public function status(ToolDefinition $definition)
    {
        $row = $this->states->find($definition->slug());
        $operatorState = $row ? (string) $row->status : ToolStatus::ACTIVE;
        if ($row && (int) $row->enabled === 0) {
            $operatorState = ToolStatus::DISABLED;
        }
        if ($operatorState === ToolStatus::DISABLED) {
            return $this->statusShape(ToolStatus::DISABLED, 'This tool has been disabled by an administrator.', $operatorState);
        }
        if ($operatorState === ToolStatus::MAINTENANCE) {
            return $this->statusShape(ToolStatus::MAINTENANCE, 'This tool is in maintenance mode.', $operatorState);
        }
        $provider = $this->providerReadiness($definition);
        if (!$provider['ready']) {
            return $this->statusShape(ToolStatus::CONFIGURATION_REQUIRED, $provider['detail'], $operatorState);
        }
        $capability = $this->capabilityGap($definition);
        if ($capability !== null) {
            return $this->statusShape(ToolStatus::SERVICE_UNAVAILABLE, $capability, $operatorState);
        }
        return $this->statusShape(ToolStatus::ACTIVE, '', $operatorState);
    }

    private function statusShape($state, $detail, $operatorState)
    {
        return array(
            'state' => $state,
            'label' => ToolStatus::label($state),
            'tone' => ToolStatus::tone($state),
            'detail' => $detail,
            'operator_state' => $operatorState,
        );
    }

    /**
     * @return array{ready:bool,detail:string,missing:array,optional_missing:array}
     */
    public function providerReadiness(ToolDefinition $definition)
    {
        $providers = $definition->providers();
        if (!$providers) {
            return array('ready' => true, 'detail' => '', 'missing' => array(), 'optional_missing' => array());
        }
        $missing = array();
        $optionalMissing = array();
        $configured = array();
        foreach ($providers as $key) {
            $key = (string) $key;
            if (strpos($key, 'dnsbl.') === 0 || strpos($key, 'tool.') === 0) {
                // DNS blocklists and administrator-added HTTP data sources live
                // in the tool provider registry, not in the integration centre,
                // because they carry a zone or an endpoint rather than a key.
                $row = $this->providerRows->findByKey($key);
                if ($row && (int) $row->enabled === 1) {
                    $configured[] = $key;
                } elseif ($definition->requiresProvider()) {
                    $missing[] = $key;
                } else {
                    $optionalMissing[] = $key;
                }
                continue;
            }
            if ($this->providers->available($key)) {
                $configured[] = $key;
            } elseif ($definition->requiresProvider()) {
                $missing[] = $key;
            } else {
                $optionalMissing[] = $key;
            }
        }
        if ($definition->requiresProvider() && !$configured) {
            return array(
                'ready' => false,
                'detail' => 'This tool needs a provider that an administrator has not configured yet'
                    . ($missing ? ' (' . implode(', ', array_slice($missing, 0, 3)) . ')' : '') . '.',
                'missing' => $missing,
                'optional_missing' => $optionalMissing,
            );
        }
        return array('ready' => true, 'detail' => '', 'missing' => array(), 'optional_missing' => $optionalMissing);
    }

    /** Human-readable capability gap, or null when the tool can run. */
    public function capabilityGap(ToolDefinition $definition)
    {
        foreach ($definition->capabilities() as $capability) {
            if (!Capability::isAvailable($capability)) {
                return 'This tool needs ' . Capability::detail($capability) . ' Capability: ' . Capability::describeState(Capability::state($capability)) . '.';
            }
        }
        return null;
    }

    /**
     * Run a tool.
     *
     * @param string $slug
     * @param array  $input   raw submitted values
     * @param array  $context actor, client_id, admin_id, ip, request, trust_proxy
     * @return array{ok:bool,tool:ToolDefinition|null,result:ToolResult,status:array}
     */
    public function run($slug, array $input, array $context = array())
    {
        $context = array_merge(array(
            'actor' => 'guest', 'client_id' => 0, 'admin_id' => 0, 'ip' => '',
            'request' => 'ui', 'trust_proxy' => $this->settings->bool('trust_proxy_headers'),
        ), $context);
        $definition = ToolRegistry::get($slug);
        if ($definition === null) {
            return $this->outcome(null, ToolResult::failure(ErrorCode::NOT_FOUND, 'That tool does not exist.'), $this->statusShape('UNKNOWN', '', 'UNKNOWN'));
        }
        $status = $this->status($definition);
        if (!$this->settings->bool('enabled')) {
            return $this->outcome($definition, ToolResult::unavailable('The CloudHost247 tools platform is currently disabled by an administrator.'), $this->statusShape(ToolStatus::DISABLED, '', 'DISABLED'));
        }
        if ($status['state'] === ToolStatus::DISABLED || $status['state'] === ToolStatus::MAINTENANCE) {
            return $this->outcome($definition, ToolResult::failure(
                $status['state'] === ToolStatus::MAINTENANCE ? ErrorCode::MAINTENANCE : ErrorCode::TOOL_DISABLED,
                $status['detail']
            ), $status);
        }
        if (!$this->allowedFor($definition, $context)) {
            return $this->outcome($definition, ToolResult::failure(ErrorCode::ACCESS_DENIED, 'Your account does not have access to this tool.'), $status);
        }
        if ($definition->isAdminOnly() && $context['actor'] !== 'admin') {
            return $this->outcome($definition, ToolResult::failure(ErrorCode::ACCESS_DENIED, 'This tool is limited to CloudHost247 administrators.'), $status);
        }
        if ($definition->requiresAuth() && $context['actor'] === 'guest') {
            return $this->outcome($definition, ToolResult::failure(ErrorCode::AUTH_REQUIRED), $status);
        }
        if ($status['state'] === ToolStatus::CONFIGURATION_REQUIRED) {
            return $this->outcome($definition, ToolResult::configurationRequired($status['detail']), $status);
        }
        if ($status['state'] === ToolStatus::SERVICE_UNAVAILABLE) {
            return $this->outcome($definition, ToolResult::capabilityUnavailable($status['detail']), $status);
        }
        $validation = $definition->validateInput($input);
        if (!$validation['ok']) {
            return $this->record($definition, $context, ToolResult::invalid($validation['message']), $status);
        }
        $clean = $validation['input'];

        $limits = $this->limitsFor($definition);
        $identities = RateLimiter::identities($context['trust_proxy']);
        $identities['ip'] = $context['ip'] !== '' ? (string) $context['ip'] : $identities['ip'];
        $identities['tool'] = $definition->slug();
        if ($definition->isHighRisk()) {
            $threshold = max(1, $this->settings->int('abuse_block_threshold'));
            $recent = $this->abuse->recentCount($identities['ip'], 15);
            if ($recent >= $threshold) {
                $this->abuse->record('high_risk_lockout', $identities['ip'], (int) $context['client_id'], $definition->slug(), 'recent abuse events: ' . $recent);
                return $this->record($definition, $context, ToolResult::rateLimited('Too many high-risk requests from this address. Please wait before trying again.'), $status);
            }
        }
        $limited = RateLimiter::attempt($identities, $limits);
        if (!$limited['allowed']) {
            $this->abuse->record('rate_limited', $identities['ip'], (int) $context['client_id'], $definition->slug(), 'dimension ' . $limited['dimension']);
            $result = ToolResult::rateLimited('Rate limit reached for ' . $limited['dimension'] . '. Try again in ' . $limited['retry_after'] . ' seconds.');
            $result->withMeta(array('retry_after' => $limited['retry_after']));
            return $this->record($definition, $context, $result, $status);
        }

        $cacheKey = $this->cacheKey($definition, $clean);
        $cached = $cacheKey !== '' ? $this->cache->get($cacheKey) : null;
        if (is_array($cached) && isset($cached['data'], $cached['warnings'])) {
            $result = ToolResult::success($cached['data'], (array) $cached['warnings'], array('cached' => true, 'cache_age_seconds' => isset($cached['stored_at']) ? max(0, time() - (int) $cached['stored_at']) : null));
            return $this->record($definition, $context, $result, $status, true);
        }

        $handler = $definition->handler();
        if ($handler === '' || !class_exists($handler)) {
            return $this->record($definition, $context, ToolResult::unavailable('This tool is not available in this build.'), $status);
        }
        $serviceContext = array(
            'tool' => $definition,
            'settings' => $this->settings->all(),
            'runner' => $this,
            'providers' => $this->providers,
            'provider_rows' => $this->providerRows,
            'actor' => $context['actor'],
            'client_id' => (int) $context['client_id'],
            'admin_id' => (int) $context['admin_id'],
            'ip' => $identities['ip'],
            'request' => $context['request'],
            'timeout_seconds' => $this->timeoutFor($definition),
        );
        $started = microtime(true);
        try {
            $instance = new $handler();
            $method = $definition->method();
            if (!method_exists($instance, $method)) {
                return $this->record($definition, $context, ToolResult::unavailable('This tool is not available in this build.'), $status);
            }
            $result = $instance->$method($clean, $serviceContext);
            if (!$result instanceof ToolResult) {
                // A service that returns anything else is a programming error and
                // must never leak its shape into a diagnostic answer.
                $result = ToolResult::unavailable('This tool returned an invalid result and has been logged for review.');
            }
        } catch (\Throwable $failure) {
            $correlation = class_exists('CloudHost247\\Foundation\\Support\\SafeError')
                ? \CloudHost247\Foundation\Support\SafeError::from($failure, 'cloudhost247_network_tools', 'tool.failed', 'That tool could not complete.')->__toString() : '';
            $result = ToolResult::failure(ErrorCode::SERVICE_UNAVAILABLE, 'That tool could not complete. Please try again shortly.');
            $result->withMeta(array('error_class' => get_class($failure)));
        }
        $durationMs = (int) round((microtime(true) - $started) * 1000);
        $result->withMeta(array('duration_ms' => $durationMs));
        if ($durationMs > $this->timeoutFor($definition) * 1000) {
            $result->withWarning('This tool took longer than its configured ' . $this->timeoutFor($definition) . ' second budget.');
        }
        if ($definition->isClientOnly()) {
            $result->withMeta(array('client_only' => true));
        }

        if ($cacheKey !== '' && $result->isOk()) {
            $this->cache->put($cacheKey, array('data' => $result->data(), 'warnings' => $result->warnings(), 'stored_at' => time()), $this->cacheSecondsFor($definition));
        }
        return $this->record($definition, $context, $result, $status, false, $durationMs);
    }

    private function allowedFor(ToolDefinition $definition, array $context)
    {
        $actor = $context['actor'];
        if ($definition->isAdminOnly()) {
            return $actor === 'admin';
        }
        if ($actor === 'admin') {
            return true;
        }
        if ($definition->visibility() === ToolDefinition::VISIBILITY_PUBLIC) {
            return $this->settings->bool('public_access') || $actor === 'customer' || $actor === 'api';
        }
        return true;
    }

    /** Effective rate limits: per-tier defaults, then the per-tool override. */
    public function limitsFor(ToolDefinition $definition)
    {
        $limits = RateLimiter::defaultLimits($definition->rateTier());
        $overrides = $this->states->overrides($definition->slug());
        if (!empty($overrides['rate_limits'])) {
            foreach ($overrides['rate_limits'] as $dimension => $rule) {
                if (isset($limits[$dimension]) && is_array($rule) && count($rule) === 2) {
                    $limits[$dimension] = array((int) $rule[0], (int) $rule[1]);
                }
            }
        }
        return $limits;
    }

    public function timeoutFor(ToolDefinition $definition)
    {
        $overrides = $this->states->overrides($definition->slug());
        if ($overrides['timeout_seconds'] !== null && $overrides['timeout_seconds'] > 0) {
            return max(1, min(60, (int) $overrides['timeout_seconds']));
        }
        return $definition->timeoutSeconds();
    }

    public function cacheSecondsFor(ToolDefinition $definition)
    {
        $overrides = $this->states->overrides($definition->slug());
        if ($overrides['cache_seconds'] !== null) {
            return max(0, min(86400, (int) $overrides['cache_seconds']));
        }
        return $definition->cacheSeconds();
    }

    /**
     * A cache key exists only for tools that opted in, that have no sensitive
     * input, and that are cacheable by nature (no actor-specific data).
     */
    private function cacheKey(ToolDefinition $definition, array $input)
    {
        if ($this->cacheSecondsFor($definition) <= 0 || $definition->hasSensitiveInput() || $definition->isClientOnly()) {
            return '';
        }
        if ($definition->visibility() !== ToolDefinition::VISIBILITY_PUBLIC && $definition->visibility() !== ToolDefinition::VISIBILITY_CUSTOMER) {
            return '';
        }
        return $definition->slug() . '|' . json_encode($input);
    }

    private function outcome(ToolDefinition $definition = null, ToolResult $result = null, array $status = array())
    {
        $envelope = $result === null ? ToolResult::failure(ErrorCode::UNKNOWN) : $result;
        $envelope->withMeta(array(
            'tool' => $definition ? $definition->slug() : '',
            'tool_name' => $definition ? $definition->name() : '',
            'tool_status' => isset($status['state']) ? $status['state'] : '',
            'timestamp' => gmdate('c'),
        ));
        return array(
            'ok' => $envelope->isOk(),
            'tool' => $definition,
            'result' => $envelope,
            'status' => $status,
        );
    }

    /** Record the outcome and return the same envelope to the caller. */
    private function record(ToolDefinition $definition, array $context, ToolResult $result, array $status, $cached = false, $durationMs = 0)
    {
        $meta = $result->meta();
        $durationMs = $durationMs > 0 ? $durationMs : (isset($meta['duration_ms']) ? (int) $meta['duration_ms'] : 0);
        $label = $definition->targetLabel(array());
        try {
            $this->executions->record(array(
                'tool_slug' => $definition->slug(),
                'category' => $definition->category(),
                'actor_type' => (string) $context['actor'],
                'client_id' => (int) $context['client_id'],
                'admin_id' => (int) $context['admin_id'],
                'ip_address' => (string) $context['ip'],
                'target_label' => '',
                'result_code' => $result->code(),
                'ok' => $result->isOk(),
                'duration_ms' => $durationMs,
                'cached' => $cached,
            ));
        } catch (\Throwable $unavailable) {
            // Analytics must never break a diagnostic.
        }
        return $this->outcome($definition, $result, $status);
    }

    /**
     * Record a successful execution against a customer's history.
     *
     * Called by the controllers (which know the validated input) rather than by
     * run(), because the target label must come from the validated input and
     * must never be derived from a sensitive field.
     */
    public function recordHistory(ToolDefinition $definition, array $context, array $cleanInput, ToolResult $result)
    {
        if (!$this->settings->bool('history_enabled') || (int) $context['client_id'] <= 0) {
            return false;
        }
        $policy = $definition->historyPolicy();
        if ($policy === 'none') {
            return false;
        }
        $label = $policy === 'tool_only' || $definition->hasSensitiveInput() ? '' : $definition->targetLabel($cleanInput);
        $summary = $result->isOk() ? $this->summarise($result) : $result->message();
        return $this->executions->historyRecord(array(
            'client_id' => (int) $context['client_id'],
            'tool_slug' => $definition->slug(),
            'target_label' => $label,
            'result_code' => $result->code(),
            'ok' => $result->isOk(),
            'summary' => substr((string) $summary, 0, 500),
        ));
    }

    /** Short, non-sensitive description of a successful result. */
    private function summarise(ToolResult $result)
    {
        $data = $result->data();
        if (isset($data['summary']) && is_string($data['summary'])) {
            return $data['summary'];
        }
        if (isset($data['status']) && is_string($data['status'])) {
            return 'Status: ' . $data['status'];
        }
        $counts = array();
        foreach ($data as $key => $value) {
            if (is_array($value) && $key !== 'settings') {
                $counts[] = count($value) . ' ' . str_replace('_', ' ', $key);
            }
        }
        return $counts ? 'Result: ' . implode(', ', array_slice($counts, 0, 4)) : 'Completed';
    }
}
