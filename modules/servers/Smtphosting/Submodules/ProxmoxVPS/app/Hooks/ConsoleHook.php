<?php

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;

add_hook('ClientAreaFooterOutput', 0, function() {
    return file_get_contents(ModuleConstants::getTemplatesDir() . '/ProxmoxVPS/console-hook.html');
});

