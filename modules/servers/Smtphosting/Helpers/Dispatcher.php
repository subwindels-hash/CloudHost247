<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

class Dispatcher
{
    public static function template(): string
    {
        return 'templates' . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'tpl' . DIRECTORY_SEPARATOR . 'controller' . DIRECTORY_SEPARATOR . 'css_assets';
    }

    public static function getTemplateForAction(string $action = ''): string
    {
        if ($action == '')
        {
            $action = debug_backtrace()[1]['function'];
        }
        $submoduleShortName = basename(debug_backtrace()[0]['file'], ".php");
        return ModuleConstants::getTemplatesDir() . DIRECTORY_SEPARATOR . $submoduleShortName . DIRECTORY_SEPARATOR . $action . '.tpl';
    }

    public static function getAATemplate($section): string
    {
        return ModuleConstants::getTemplatesDir() . DIRECTORY_SEPARATOR . $section . '.tpl';
    }

    public static function errorTemplate(): string
    {
        return 'assets' . DIRECTORY_SEPARATOR . 'tpl' . DIRECTORY_SEPARATOR . 'error';
    }

}
