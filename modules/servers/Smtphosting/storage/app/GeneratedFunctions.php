<?php
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SubmoduleController;

function Smtphosting_ssoLogin($params)
{
	return SubmoduleController::call("ssoLogin", $params);
}
function Smtphosting_getInfo($params)
{
	return SubmoduleController::call("getInfo", $params);
}
