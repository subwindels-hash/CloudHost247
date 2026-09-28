<?php
namespace CloudHost247\ModuleManager\Support;

use InvalidArgumentException;

/**
 * The module kinds this platform can install, and where each one lives.
 *
 * The map is a closed allowlist. A package cannot name its own destination:
 * the install path is derived from the declared type plus the module id, so an
 * uploaded archive can never choose to write outside modules/<type>/<id>.
 */
final class ModuleType
{
    private static $types = array(
        'addon' => array('directory' => 'modules/addons', 'label' => 'Addon module', 'entry_suffix' => '.php'),
        'server' => array('directory' => 'modules/servers', 'label' => 'Server / provisioning module', 'entry_suffix' => '.php'),
        'gateway' => array('directory' => 'modules/gateways', 'label' => 'Payment gateway', 'entry_suffix' => '.php'),
        'registrar' => array('directory' => 'modules/registrars', 'label' => 'Domain registrar', 'entry_suffix' => '.php'),
        'report' => array('directory' => 'modules/reports', 'label' => 'Report', 'entry_suffix' => '.php'),
        'widget' => array('directory' => 'modules/widgets', 'label' => 'Admin dashboard widget', 'entry_suffix' => '.php'),
        'notification' => array('directory' => 'modules/notifications', 'label' => 'Notification provider', 'entry_suffix' => '.php'),
    );

    public static function all()
    {
        return self::$types;
    }

    public static function keys()
    {
        return array_keys(self::$types);
    }

    public static function isSupported($type)
    {
        return is_string($type) && isset(self::$types[$type]);
    }

    public static function assert($type)
    {
        if (!self::isSupported($type)) {
            throw new InvalidArgumentException('Unsupported module type. Supported types: ' . implode(', ', self::keys()) . '.');
        }
        return (string) $type;
    }

    public static function directory($type)
    {
        return self::$types[self::assert($type)]['directory'];
    }

    public static function label($type)
    {
        return self::isSupported($type) ? self::$types[$type]['label'] : 'Unknown module type';
    }

    /** The conventional WHMCS entry point for a module of this type. */
    public static function conventionalEntryPoint($type, $moduleId)
    {
        self::assert($type);
        return $moduleId . self::$types[$type]['entry_suffix'];
    }
}
