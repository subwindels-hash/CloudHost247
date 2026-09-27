<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\Instances;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\RequirementsList;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\RequirementInterface;

/**
 * Description of Classes
 *
 * @author INBSX-37H
 */
abstract class Classes extends RequirementsList implements RequirementInterface
{
    const CLASS_NAME = 'className';

    final public function getHandler()
    {
        return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements\Handlers\Classes::class;
    }
}
