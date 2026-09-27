<?php
/**
 * Configuration Manager
 * Handles all module settings with caching
 */

namespace PhoneServices\Core;

class Config
{
    private static $cache = [];
    
    /**
     * Get a configuration value
     */
    public static function get($key, $default = null)
    {
        if (isset(self::$cache[$key])) {
            return self::$cache[$key];
        }
        
        $result = select_query('tbladdonmodules', 'value', ['module' => 'phoneservices', 'setting' => $key]);
        if ($row = mysql_fetch_assoc($result)) {
            self::$cache[$key] = $row['value'];
            return $row['value'];
        }
        
        // Fallback to mod_phoneservices_settings
        $result = select_query('mod_phoneservices_settings', 'setting_value', ['setting_name' => $key]);
        if ($row = mysql_fetch_assoc($result)) {
            self::$cache[$key] = $row['setting_value'];
            return $row['setting_value'];
        }
        
        return $default;
    }
    
    /**
     * Set a configuration value
     */
    public static function set($key, $value)
    {
        self::$cache[$key] = $value;
        
        $exists = select_query('mod_phoneservices_settings', 'id', ['setting_name' => $key]);
        if (mysql_num_rows($exists)) {
            update_query('mod_phoneservices_settings', ['setting_value' => $value], ['setting_name' => $key]);
        } else {
            insert_query('mod_phoneservices_settings', ['setting_name' => $key, 'setting_value' => $value]);
        }
    }
    
    /**
     * Get all feature toggles
     */
    public static function getFeatureToggles()
    {
        return [
            'numbers' => self::get('enable_numbers', '1') === '1',
            'voip'    => self::get('enable_voip', '1') === '1',
            'sms'     => self::get('enable_sms', '1') === '1',
            'esim'    => self::get('enable_esim', '1') === '1',
        ];
    }
    
    /**
     * Check if a service is enabled
     */
    public static function isServiceEnabled($service)
    {
        $toggles = self::getFeatureToggles();
        return isset($toggles[$service]) ? $toggles[$service] : false;
    }
    
    /**
     * Get provider credentials
     */
    public static function getProviderCredentials($provider)
    {
        $map = [
            'twilio' => ['account_sid' => 'twilio_account_sid', 'auth_token' => 'twilio_auth_token'],
            'vonage' => ['api_key' => 'vonage_api_key', 'api_secret' => 'vonage_api_secret'],
            'airalo' => ['api_token' => 'airalo_api_token'],
            'truphone' => ['api_key' => 'truphone_api_key'],
        ];
        
        if (!isset($map[$provider])) {
            return [];
        }
        
        $credentials = [];
        foreach ($map[$provider] as $key => $configKey) {
            $credentials[$key] = self::get($configKey, '');
        }
        
        return $credentials;
    }
    
    /**
     * Get SendGrid credentials
     */
    public static function getSendgridCredentials()
    {
        return ['api_key' => self::get('sendgrid_api_key', '')];
    }
    
    /**
     * Get WhatsApp credentials
     */
    public static function getWhatsappCredentials()
    {
        return ['token' => self::get('whatsapp_business_token', '')];
    }
    
    /**
     * Clear cache
     */
    public static function clearCache()
    {
        self::$cache = [];
    }
}
