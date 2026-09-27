<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers;

/**
 * Constants vars for alert types
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class AlertTypesConstants
{
    const SUCCESS = 'success';
    const INFO    = 'info';
    const WARNING = 'warning';
    const DANGER  = 'danger';

    const EXTRA_SMALL  = 'xs';
    const SMALL        = 'sm';
    const DEFAULT_SIZE = '';
    const LARGE        = 'lg';
    const EXTRA_LARGE  = 'xlg';

    public static function getAlertTypes()
    {
        return [
            self::DANGER,
            self::INFO,
            self::SUCCESS,
            self::WARNING,
            null
        ];
    }

    public static function getAlertSizes()
    {
        return [
            self::EXTRA_SMALL,
            self::SMALL,
            self::DEFAULT_SIZE,
            self::LARGE,
            self::EXTRA_LARGE
        ];
    }
}
