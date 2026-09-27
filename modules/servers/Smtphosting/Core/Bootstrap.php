<?php

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\PathValidator;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\File;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\Builder;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection\Services;

if (!defined('DS'))
{
    define('DS', DIRECTORY_SEPARATOR);
}
if (!defined('PS'))
{
    define('PS', PATH_SEPARATOR);
}
if (!defined('CRLF'))
{
    define('CRLF', "\r\n");
}

require_once dirname(__DIR__) . DS . "autoload.php";
require_once __DIR__ . DS . "Helper" . DS . "Functions.php";

/**
 * Initialize base values
 */

ModuleConstants::initialize();
/**
 * Initailize DI builder
 */
new Builder();

/**
 * Initialize Services
 */
new Services();

/**
 * Check file permission
 */

$pathValidator = new PathValidator();
if (!$pathValidator->validatePath(ModuleConstants::getFullPath('storage', 'logs'), true, true, true))
{
    ServiceLocator::call('errorManager')->addError(
        'Bootstrap',
        PHP_EOL . ServiceLocator::call('lang')->absoluteT('permissionsStorage'),
        ['path' => ModuleConstants::getFullPath('storage')]
    );
}
