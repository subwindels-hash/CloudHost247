<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;

use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

class Smarty
{
    public static function fetch(string $file, array $vars)
    {
        $smarty = new \Smarty;
        foreach ($vars as $varName => $varData)
        {
            $smarty->assign($varName, $varData);
        }
        $smarty->assign('MGLANG', sl('lang'));
        return $smarty->fetch($file);
    }
}
