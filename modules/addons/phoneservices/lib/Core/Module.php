<?php
/**
 * Core Module Class
 * Handles activation, database management, rendering, and lifecycle
 */

namespace PhoneServices\Core;

use PhoneServices\Providers\ProviderFactory;
use PhoneServices\Services\NumberService;
use PhoneServices\Services\VoipService;
use PhoneServices\Services\SmsService;
use PhoneServices\Services\EsimService;
use PhoneServices\Services\UsageService;
use PhoneServices\Services\PricingService;

class Module
{
    private $config;
    private $db;
    
    public function __construct()
    {
        $this->config = new Config();
        $this->db = new Database();
    }
    
    /**
     * Activate module - create database tables
     */
    public function activate()
    {
        $schemaFile = __DIR__ . '/../../install/schema.sql';
        if (file_exists($schemaFile)) {
            $sql = file_get_contents($schemaFile);
            $statements = array_filter(array_map('trim', explode(';', $sql)));
            foreach ($statements as $statement) {
                if (!empty($statement)) {
                    full_query($statement);
                }
            }
        }
        
        // Insert default settings
        $this->insertDefaultSettings();
    }
    
    /**
     * Deactivate module
     */
    public function deactivate()
    {
        // Do not drop tables to preserve data
        // Just disable scheduled tasks if any
    }
    
    /**
     * Upgrade module
     */
    public function upgrade($currentVersion)
    {
        $migrationsDir = __DIR__ . '/../../install/migrations/';
        if (is_dir($migrationsDir)) {
            $migrations = glob($migrationsDir . '*.sql');
            sort($migrations);
            foreach ($migrations as $migration) {
                $version = basename($migration, '.sql');
                if (version_compare($version, $currentVersion, '>')) {
                    $sql = file_get_contents($migration);
                    $statements = array_filter(array_map('trim', explode(';', $sql)));
                    foreach ($statements as $statement) {
                        if (!empty($statement)) {
                            full_query($statement);
                        }
                    }
                }
            }
        }
    }
    
    /**
     * Insert default settings on activation
     */
    private function insertDefaultSettings()
    {
        $defaults = [
            ['setting_name' => 'default_provider', 'setting_value' => 'twilio'],
            ['setting_name' => 'api_mode', 'setting_value' => 'sandbox'],
            ['setting_name' => 'enable_numbers', 'setting_value' => '1'],
            ['setting_name' => 'enable_voip', 'setting_value' => '1'],
            ['setting_name' => 'enable_sms', 'setting_value' => '1'],
            ['setting_name' => 'enable_esim', 'setting_value' => '1'],
            ['setting_name' => 'log_retention_days', 'setting_value' => '90'],
        ];
        
        foreach ($defaults as $setting) {
            $exists = select_query('mod_phoneservices_settings', 'id', ['setting_name' => $setting['setting_name']]);
            if (!mysql_num_rows($exists)) {
                insert_query('mod_phoneservices_settings', $setting);
            }
        }
    }
    
    // ==================== ADMIN RENDERERS ====================
    
    public function renderAdminDashboard($vars)
    {
        $usageService = new UsageService();
        $stats = $usageService->getSystemStats();
        
        $template = __DIR__ . '/../../templates/admin/dashboard.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'stats' => $stats]);
            include $template;
        }
    }
    
    public function renderApiConfig($vars)
    {
        $config = new Config();
        $providers = ProviderFactory::getAvailableProviders();
        
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $this->handleApiConfigPost($vars, $_POST);
        }
        
        $template = __DIR__ . '/../../templates/admin/api_config.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'providers' => $providers, 'config' => $config]);
            include $template;
        }
    }
    
    private function handleApiConfigPost($vars, $post)
    {
        $allowedFields = [
            'api_mode', 'default_provider', 'twilio_account_sid', 'twilio_auth_token',
            'vonage_api_key', 'vonage_api_secret', 'airalo_api_token',
            'truphone_api_key', 'sendgrid_api_key', 'whatsapp_business_token'
        ];
        
        foreach ($allowedFields as $field) {
            if (isset($post[$field])) {
                update_query('tbladdonmodules', ['value' => $post[$field]], ['module' => 'phoneservices', 'setting' => $field]);
            }
        }
        
        // Update feature toggles
        $toggles = ['enable_numbers', 'enable_voip', 'enable_sms', 'enable_esim'];
        foreach ($toggles as $toggle) {
            $value = isset($post[$toggle]) ? '1' : '0';
            update_query('mod_phoneservices_settings', ['setting_value' => $value], ['setting_name' => $toggle]);
        }
        
        header('Location: ' . $vars['modulelink'] . '&action=api_config&success=1');
        exit;
    }
    
    public function renderPricing($vars)
    {
        $pricingService = new PricingService();
        
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {
            $pricingService->updatePricing($_POST);
            header('Location: ' . $vars['modulelink'] . '&action=pricing&success=1');
            exit;
        }
        
        $pricing = $pricingService->getAllPricing();
        $template = __DIR__ . '/../../templates/admin/pricing.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'pricing' => $pricing]);
            include $template;
        }
    }
    
    public function renderNumbersAdmin($vars)
    {
        $numberService = new NumberService();
        $numbers = $numberService->getAllNumbers();
        $template = __DIR__ . '/../../templates/admin/numbers.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'numbers' => $numbers]);
            include $template;
        }
    }
    
    public function renderVoipAdmin($vars)
    {
        $voipService = new VoipService();
        $calls = $voipService->getAllCallLogs();
        $template = __DIR__ . '/../../templates/admin/voip.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'calls' => $calls]);
            include $template;
        }
    }
    
    public function renderSmsAdmin($vars)
    {
        $smsService = new SmsService();
        $messages = $smsService->getAllMessages();
        $template = __DIR__ . '/../../templates/admin/sms.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'messages' => $messages]);
            include $template;
        }
    }
    
    public function renderEsimAdmin($vars)
    {
        $esimService = new EsimService();
        $esims = $esimService->getAllProfiles();
        $template = __DIR__ . '/../../templates/admin/esim.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'esims' => $esims]);
            include $template;
        }
    }
    
    public function renderUsageAdmin($vars)
    {
        $usageService = new UsageService();
        $reports = $usageService->getSystemUsageReport();
        $template = __DIR__ . '/../../templates/admin/usage.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'reports' => $reports]);
            include $template;
        }
    }
    
    public function renderTransactionsAdmin($vars)
    {
        $usageService = new UsageService();
        $transactions = $usageService->getAllTransactions();
        $template = __DIR__ . '/../../templates/admin/transactions.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'transactions' => $transactions]);
            include $template;
        }
    }
    
    public function renderUsersAdmin($vars)
    {
        $result = select_query('tblclients', 'id, firstname, lastname, email, status', '', 'id', 'DESC');
        $users = [];
        while ($row = mysql_fetch_assoc($result)) {
            $users[] = $row;
        }
        $template = __DIR__ . '/../../templates/admin/users.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'users' => $users]);
            include $template;
        }
    }
    
    public function renderLogsAdmin($vars)
    {
        $logs = Logger::getRecentLogs(100);
        $template = __DIR__ . '/../../templates/admin/logs.tpl';
        if (file_exists($template)) {
            extract(['vars' => $vars, 'logs' => $logs]);
            include $template;
        }
    }
    
    // ==================== CLIENT AREA ====================
    
    public function renderClientArea($vars, $action)
    {
        $userId = isset($_SESSION['uid']) ? $_SESSION['uid'] : 0;
        if (!$userId && $action !== 'dashboard') {
            $action = 'dashboard';
        }
        
        $data = [];
        $data['vars'] = $vars;
        $data['action'] = $action;
        
        switch ($action) {
            case 'numbers':
                $service = new NumberService();
                $data['numbers'] = $service->getUserNumbers($userId);
                $data['availableCountries'] = $service->getAvailableCountries();
                break;
            case 'voip':
                $service = new VoipService();
                $data['calls'] = $service->getUserCallLogs($userId);
                $data['webRtcConfig'] = $service->getWebRtcConfig($userId);
                break;
            case 'sms':
                $service = new SmsService();
                $data['messages'] = $service->getUserMessages($userId);
                break;
            case 'esim':
                $service = new EsimService();
                $data['esims'] = $service->getUserProfiles($userId);
                $data['plans'] = $service->getAvailablePlans();
                break;
            case 'usage':
                $service = new UsageService();
                $data['usage'] = $service->getUserUsage($userId);
                $data['transactions'] = $service->getUserTransactions($userId);
                break;
            case 'dashboard':
            default:
                $usageService = new UsageService();
                $numberService = new NumberService();
                $data['stats'] = [
                    'numbers' => $numberService->countUserNumbers($userId),
                    'calls' => $usageService->countUserCalls($userId),
                    'sms' => $usageService->countUserSms($userId),
                    'esims' => $usageService->countUserEsims($userId),
                ];
                break;
        }
        
        $template = __DIR__ . '/../../templates/client/' . $action . '.tpl';
        $output = '';
        if (file_exists($template)) {
            extract($data);
            ob_start();
            include $template;
            $output = ob_get_clean();
        } else {
            $output = '<div class="alert alert-danger">Template not found: ' . htmlspecialchars($action) . '</div>';
        }
        
        return [
            'pagetitle' => 'Phone Services',
            'breadcrumb' => [
                'index.php?m=phoneservices' => 'Phone Services',
            ],
            'templatefile' => 'clientarea',
            'requirelogin' => true,
            'forcessl' => false,
            'vars' => [
                'content' => $output,
                'action' => $action,
                'modulelink' => $vars['modulelink'],
            ],
        ];
    }
}
