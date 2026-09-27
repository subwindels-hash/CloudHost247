<?php

if (!class_exists('\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\WhmcsErrorManagerWrapper'))
{
    require_once __DIR__ . DIRECTORY_SEPARATOR . 'HandlerError' . DIRECTORY_SEPARATOR . 'WhmcsErrorManagerWrapper.php';
}

\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\WhmcsErrorManagerWrapper::setErrorManager($errMgmt);
