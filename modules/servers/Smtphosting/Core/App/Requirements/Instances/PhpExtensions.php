<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\Instances;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\RequirementsList;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\RequirementInterface;

/**
 * Description of PhpExtensions
 *
 * @author INBSX-37H
 */
abstract class PhpExtensions extends RequirementsList implements RequirementInterface
{
    const EXTENSION_NAME = 'extensionName';

    final public function getHandler()
    {
        return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\Handlers\PhpExtensions::class;
    }
}
