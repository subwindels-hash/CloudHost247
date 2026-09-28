<?php
/**
 * Core Module - lifecycle and admin/client controllers.
 *
 * Thin controller layer: it validates input, delegates to the service layer
 * and renders a template. No provider or SQL logic lives here.
 *
 * @package PhoneServices
 */

namespace PhoneServices\Core;

use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Providers\ProviderRegistry;
use PhoneServices\Services\EsimService;
use PhoneServices\Services\NumberService;
use PhoneServices\Services\PricingService;
use PhoneServices\Services\SmsService;
use PhoneServices\Services\UsageService;
use PhoneServices\Services\VoipService;

class Module
{
    /** Admin pages and the capability/toggle they belong to. */
    const ADMIN_PAGES = [
        'dashboard'    => null,
        'api_config'   => null,
        'providers'    => null,
        'pricing'      => null,
        'numbers'      => 'numbers',
        'voip'         => 'voip',
        'sms'          => 'sms',
        'esim'         => 'esim',
        'usage'        => 'analytics',
        'transactions' => null,
        'users'        => null,
        'logs'         => null,
    ];

    const CLIENT_PAGES = ['dashboard', 'numbers', 'voip', 'sms', 'esim', 'usage'];

    /* ==================================================================
     | Lifecycle
     * ================================================================= */

    /**
     * @return array{tables:int,migrations:int}
     */
    public function activate(): array
    {
        $installer = new Installer();
        $result = $installer->install();

        Config::clearCache();

        return $result;
    }

    /**
     * Data is intentionally preserved on deactivation - telecom records are
     * billing evidence and must survive a module toggle.
     */
    public function deactivate(): void
    {
        Logger::info('PhoneServices deactivated (data retained)');
    }

    public function upgrade(string $currentVersion): int
    {
        $installer = new Installer();

        return $installer->upgrade($currentVersion);
    }

    /* ==================================================================
     | Admin
     * ================================================================= */

    public function renderAdminDashboard(array $vars): void
    {
        $usageService = new UsageService();

        $this->renderAdmin('dashboard', [
            'vars'      => $vars,
            'stats'     => $usageService->getSystemStats(),
            'providers' => ProviderFactory::healthCheck(),
            'toggles'   => Config::getFeatureToggles(),
            'tables'    => Installer::tableStatus(),
            'recent'    => Logger::getRecentLogs(10, Logger::LEVEL_ERROR),
        ]);
    }

    /**
     * API configuration: credentials, mode, provider routing, feature flags.
     */
    public function renderApiConfig(array $vars): void
    {
        $notice = null;

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            $notice = $this->handleApiConfigPost($_POST);
        }

        $providerFields = [];
        foreach (ProviderRegistry::all() as $id => $definition) {
            foreach (ProviderRegistry::credentialLabels($id) as $field => $label) {
                $providerFields[$id][] = [
                    'name'     => $id . '_' . $field,
                    'label'    => $label,
                    'value'    => Config::masked($id . '_' . $field),
                    'required' => in_array($field, ProviderRegistry::requiredCredentials($id), true),
                    'is_set'   => (string) Config::get($id . '_' . $field, '') !== '',
                ];
            }
        }

        $routing = [];
        foreach (ProviderRegistry::CAPABILITIES as $capability) {
            $candidates = ProviderRegistry::forCapability($capability);
            if (!$candidates) {
                continue;
            }
            $routing[$capability] = [
                'selected'   => Config::getProviderForCapability($capability),
                'candidates' => $candidates,
            ];
        }

        $this->renderAdmin('api_config', [
            'vars'           => $vars,
            'notice'         => $notice,
            'apiMode'        => Config::get('api_mode', 'sandbox'),
            'providers'      => ProviderRegistry::labels(),
            'providerFields' => $providerFields,
            'routing'        => $routing,
            'toggles'        => Config::getFeatureToggles(),
            'defaultProvider' => Config::get('default_provider', 'twilio'),
            'webhookBase'    => Config::webhookBaseUrl(),
            'allowedOrigins' => (string) Config::get('api_allowed_origins', ''),
            'apiRateLimit'   => Config::getInt('api_rate_limit', 120),
            'debugLogging'   => Config::getBool('debug_logging', false),
            'csrf'           => Security::csrfField(),
        ]);
    }

    /**
     * @param array<string,mixed> $post
     * @return array{type:string,message:string}
     */
    private function handleApiConfigPost(array $post): array
    {
        if (!Security::verifyCsrf($post)) {
            return ['type' => 'danger', 'message' => 'Security token mismatch - changes were not saved.'];
        }

        $saved = 0;

        // Provider credentials (blank input = keep the stored value).
        foreach (ProviderRegistry::all() as $id => $definition) {
            foreach (ProviderRegistry::credentialFields($id) as $field) {
                $key = $id . '_' . $field;
                if (!array_key_exists($key, $post)) {
                    continue;
                }

                $value = Security::text($post[$key], 500);
                if ($value === '' || strpos($value, '****') === 0) {
                    continue; // masked placeholder resubmitted
                }

                Config::set($key, $value);
                $saved++;
            }
        }

        // Mode + provider routing.
        Config::set('api_mode', Security::oneOf($post['api_mode'] ?? '', ['sandbox', 'live'], 'sandbox'));

        if (!empty($post['default_provider']) && ProviderRegistry::exists((string) $post['default_provider'])) {
            Config::set('default_provider', strtolower((string) $post['default_provider']));
        }

        foreach (ProviderRegistry::CAPABILITIES as $capability) {
            $key = 'provider_' . $capability;
            if (isset($post[$key]) && ProviderRegistry::exists((string) $post[$key])) {
                Config::set($key, strtolower((string) $post[$key]));
            }
        }

        // Feature toggles - unchecked checkboxes are absent from the POST.
        foreach (array_keys(Config::getFeatureToggles()) as $service) {
            Config::set('enable_' . $service, isset($post['enable_' . $service]) ? '1' : '0');
        }

        if (isset($post['webhook_base_url'])) {
            $url = filter_var(trim((string) $post['webhook_base_url']), FILTER_VALIDATE_URL);
            Config::set('webhook_base_url', $url ?: '');
        }

        // REST API access control.
        if (isset($post['api_allowed_origins'])) {
            $origins = [];

            foreach (preg_split('/[\s,]+/', (string) $post['api_allowed_origins']) as $origin) {
                $origin = rtrim(trim((string) $origin), '/');

                if ($origin !== '' && filter_var($origin, FILTER_VALIDATE_URL)) {
                    $origins[] = $origin;
                }
            }

            Config::set('api_allowed_origins', implode(',', array_unique($origins)));
        }

        if (isset($post['api_rate_limit'])) {
            Config::set('api_rate_limit', (string) max(0, min(10000, (int) $post['api_rate_limit'])));
        }

        Config::set('debug_logging', isset($post['debug_logging']) ? '1' : '0');

        ProviderFactory::clearCache();
        Logger::info('API configuration updated', ['credentials_changed' => $saved]);

        return ['type' => 'success', 'message' => 'Configuration saved.' . ($saved ? " {$saved} credential(s) updated." : '')];
    }

    /**
     * Provider health / connectivity page.
     */
    public function renderProviders(array $vars): void
    {
        $notice = null;

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST' && Security::verifyCsrf($_POST)) {
            $providerId = strtolower(Security::text($_POST['provider'] ?? '', 50));
            $provider = ProviderFactory::getProvider($providerId);

            if ($provider === null) {
                $notice = ['type' => 'danger', 'message' => 'Unknown provider: ' . Security::escape($providerId)];
            } else {
                $ok = $provider->testConnection();
                $notice = [
                    'type'    => $ok ? 'success' : 'danger',
                    'message' => $ok
                        ? ProviderRegistry::labels()[$providerId] . ' connection succeeded.'
                        : 'Connection failed: ' . Security::escape((string) $provider->getLastError()),
                ];
            }
        }

        $this->renderAdmin('providers', [
            'vars'      => $vars,
            'notice'    => $notice,
            'providers' => ProviderFactory::healthCheck(),
            'csrf'      => Security::csrfField(),
        ]);
    }

    public function renderPricing(array $vars): void
    {
        $pricingService = new PricingService();
        $notice = null;

        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'POST') {
            if (Security::verifyCsrf($_POST)) {
                $pricingService->updatePricing($_POST);
                $notice = ['type' => 'success', 'message' => 'Pricing updated.'];
            } else {
                $notice = ['type' => 'danger', 'message' => 'Security token mismatch - pricing was not saved.'];
            }
        }

        $this->renderAdmin('pricing', [
            'vars'    => $vars,
            'notice'  => $notice,
            'pricing' => $pricingService->getAllPricing(),
            'csrf'    => Security::csrfField(),
        ]);
    }

    public function renderNumbersAdmin(array $vars): void
    {
        $numberService = new NumberService();
        $notice = $this->handleNumberAction($numberService);

        $filters = [
            'status'  => Security::text($_GET['status'] ?? '', 20),
            'country' => Security::text($_GET['country'] ?? '', 2),
            'search'  => Security::text($_GET['q'] ?? '', 50),
        ];

        $this->renderAdmin('numbers', [
            'vars'    => $vars,
            'notice'  => $notice,
            'numbers' => $numberService->getAllNumbers($filters),
            'filters' => $filters,
            'csrf'    => Security::csrfField(),
        ]);
    }

    /**
     * @return array{type:string,message:string}|null
     */
    private function handleNumberAction(NumberService $numberService): ?array
    {
        if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
            return null;
        }

        if (!Security::verifyCsrf($_POST)) {
            return ['type' => 'danger', 'message' => 'Security token mismatch.'];
        }

        $numberId = (int) ($_POST['number_id'] ?? 0);
        $operation = Security::oneOf($_POST['operation'] ?? '', ['activate', 'suspend', 'release', 'renew'], '');

        if ($numberId <= 0 || $operation === '') {
            return ['type' => 'danger', 'message' => 'Invalid request.'];
        }

        switch ($operation) {
            case 'activate':
                $ok = $numberService->activateNumber($numberId);
                break;
            case 'suspend':
                $ok = $numberService->suspendNumber($numberId, Security::text($_POST['reason'] ?? 'Admin action', 255));
                break;
            case 'release':
                $ok = $numberService->releaseNumber($numberId);
                break;
            case 'renew':
            default:
                $result = $numberService->renewNumber($numberId);
                $ok = !empty($result['success']);
                break;
        }

        return [
            'type'    => $ok ? 'success' : 'danger',
            'message' => $ok
                ? 'Number ' . $operation . 'd successfully.'
                : 'Could not ' . $operation . ' the number - check the system log.',
        ];
    }

    public function renderVoipAdmin(array $vars): void
    {
        $voipService = new VoipService();

        $this->renderAdmin('voip', [
            'vars'  => $vars,
            'calls' => $voipService->getAllCallLogs(['limit' => 200]),
            'stats' => $voipService->getCallStatistics(),
            'csrf'  => Security::csrfField(),
        ]);
    }

    public function renderSmsAdmin(array $vars): void
    {
        $smsService = new SmsService();

        $this->renderAdmin('sms', [
            'vars'     => $vars,
            'messages' => $smsService->getAllMessages(['limit' => 200]),
            'stats'    => $smsService->getMessageStatistics(),
            'csrf'     => Security::csrfField(),
        ]);
    }

    public function renderEsimAdmin(array $vars): void
    {
        $esimService = new EsimService();

        $this->renderAdmin('esim', [
            'vars'  => $vars,
            'esims' => $esimService->getAllProfiles(),
            'csrf'  => Security::csrfField(),
        ]);
    }

    public function renderUsageAdmin(array $vars): void
    {
        $usageService = new UsageService();

        $this->renderAdmin('usage', [
            'vars'    => $vars,
            'reports' => $usageService->getSystemUsageReport(),
            'stats'   => $usageService->getSystemStats(),
        ]);
    }

    public function renderTransactionsAdmin(array $vars): void
    {
        $usageService = new UsageService();

        $filters = [
            'user_id'      => (int) ($_GET['user_id'] ?? 0),
            'status'       => Security::text($_GET['status'] ?? '', 20),
            'service_type' => Security::text($_GET['service_type'] ?? '', 20),
            'from'         => Security::text($_GET['from'] ?? '', 20),
            'to'           => Security::text($_GET['to'] ?? '', 20),
        ];

        $this->renderAdmin('transactions', [
            'vars'         => $vars,
            'filters'      => $filters,
            'transactions' => $usageService->getAllTransactions($filters),
            'totals'       => $usageService->getTransactionTotals($filters),
        ]);
    }

    /**
     * User & subscription management.
     */
    public function renderUsersAdmin(array $vars): void
    {
        $search = Security::text($_GET['q'] ?? '', 60);

        $sql = 'SELECT c.id, c.firstname, c.lastname, c.email, c.status,
                       (SELECT COUNT(*) FROM mod_phoneservices_numbers n WHERE n.user_id = c.id AND n.status <> "released") AS numbers,
                       (SELECT COUNT(*) FROM mod_phoneservices_esims e WHERE e.user_id = c.id) AS esims,
                       (SELECT COUNT(*) FROM mod_phoneservices_calls k WHERE k.user_id = c.id) AS calls,
                       (SELECT COUNT(*) FROM mod_phoneservices_messages m WHERE m.user_id = c.id) AS messages,
                       (SELECT COALESCE(SUM(t.amount),0) FROM mod_phoneservices_transactions t WHERE t.user_id = c.id AND t.status = "completed") AS spend
                  FROM tblclients c
                 WHERE (? = "" OR c.email LIKE ? OR c.firstname LIKE ? OR c.lastname LIKE ?)
                 ORDER BY numbers DESC, c.id DESC
                 LIMIT 200';

        $like = '%' . $search . '%';
        $users = Database::raw($sql, [$search, $like, $like, $like]);

        $this->renderAdmin('users', [
            'vars'   => $vars,
            'users'  => $users,
            'search' => $search,
            'subscriptions' => Database::select('mod_phoneservices_subscriptions', '*', [], 'id', 'DESC', 100),
        ]);
    }

    public function renderLogsAdmin(array $vars): void
    {
        $level = Security::oneOf($_GET['level'] ?? '', ['debug', 'info', 'warning', 'error'], '');

        $this->renderAdmin('logs', [
            'vars'  => $vars,
            'logs'  => Logger::getRecentLogs(200, $level ?: null),
            'level' => $level,
        ]);
    }

    /**
     * Include an admin template with the given data in scope.
     *
     * @param array<string,mixed> $data
     */
    private function renderAdmin(string $page, array $data): void
    {
        $template = PHONESERVICES_ROOT . '/templates/admin/' . $page . '.tpl';

        if (!is_file($template)) {
            echo '<div class="alert alert-danger">Admin template missing: ' . Security::escape($page) . '</div>';
            return;
        }

        extract($data, EXTR_SKIP);
        include $template;
    }

    /* ==================================================================
     | Client area
     * ================================================================= */

    /**
     * @param array<string,mixed> $vars
     * @return array<string,mixed>
     */
    public function renderClientArea(array $vars, string $action): array
    {
        $userId = Security::currentClientId();

        if (!in_array($action, self::CLIENT_PAGES, true)) {
            $action = 'dashboard';
        }

        // Respect the dynamic service switches.
        $requiredToggle = ['numbers' => 'numbers', 'voip' => 'voip', 'sms' => 'sms', 'esim' => 'esim', 'usage' => 'analytics'];
        if (isset($requiredToggle[$action]) && !Config::isServiceEnabled($requiredToggle[$action])) {
            $action = 'dashboard';
        }

        $data = [
            'vars'     => $vars,
            'action'   => $action,
            'userId'   => $userId,
            'toggles'  => Config::getFeatureToggles(),
            'currency' => Config::get('currency', 'USD'),
            'csrf'     => Security::csrfToken(),
        ];

        try {
            $data += $this->clientPageData($action, $userId);
        } catch (\Throwable $e) {
            Logger::exception($e, 'Client area render');
            $data['error'] = 'This service is temporarily unavailable. Please try again shortly.';
        }

        $template = PHONESERVICES_ROOT . '/templates/client/' . $action . '.tpl';
        $output = '';

        if (is_file($template)) {
            extract($data, EXTR_SKIP);
            ob_start();
            include $template;
            $output = (string) ob_get_clean();
        } else {
            $output = '<div class="alert alert-danger">Template not found: ' . Security::escape($action) . '</div>';
        }

        return [
            'pagetitle'    => 'Phone Services',
            'breadcrumb'   => ['index.php?m=phoneservices' => 'Phone Services'],
            'templatefile' => 'clientarea',
            'requirelogin' => true,
            'forcessl'     => true,
            'vars'         => [
                'content'    => $output,
                'action'     => $action,
                'toggles'    => Config::getFeatureToggles(),
                'modulelink' => $vars['modulelink'] ?? 'index.php?m=phoneservices',
            ],
        ];
    }

    /**
     * @return array<string,mixed>
     */
    private function clientPageData(string $action, int $userId): array
    {
        switch ($action) {
            case 'numbers':
                $service = new NumberService();
                return [
                    'numbers'            => $service->getUserNumbers($userId),
                    'availableCountries' => $service->getAvailableCountries(),
                ];

            case 'voip':
                $service = new VoipService();
                return [
                    'calls'       => $service->getUserCallLogs($userId),
                    'webRtcConfig' => $service->getWebRtcConfig($userId),
                ];

            case 'sms':
                $service = new SmsService();
                $numberService = new NumberService();
                return [
                    'messages' => $service->getUserMessages($userId),
                    'numbers'  => $numberService->getUserNumbers($userId),
                ];

            case 'esim':
                $service = new EsimService();
                return [
                    'esims' => $service->getUserProfiles($userId),
                    'plans' => $service->getAvailablePlans(),
                ];

            case 'usage':
                $service = new UsageService();
                return [
                    'usage'        => $service->getUserUsage($userId),
                    'transactions' => $service->getUserTransactions($userId),
                    'daily'        => $service->getUserDailyUsage($userId, 30),
                ];

            case 'dashboard':
            default:
                $usageService = new UsageService();
                $numberService = new NumberService();
                return [
                    'stats' => [
                        'numbers' => $numberService->countUserNumbers($userId),
                        'calls'   => $usageService->countUserCalls($userId),
                        'sms'     => $usageService->countUserSms($userId),
                        'esims'   => $usageService->countUserEsims($userId),
                        'spend'   => $usageService->getUserSpend($userId),
                    ],
                    'usage' => $usageService->getUserUsage($userId),
                ];
        }
    }
}
