<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Requirements;

/**
 * Description of Requirements
 *
 * @author INBSX-37H
 */
abstract class RequirementsList
{
    protected $requirementsList = [];

    public function getHandlerInstance()
    {
        $handler = $this->getHandler();
        if (!class_exists($handler))
        {
            return null;
        }

        return new $handler($this->requirementsList);
    }

    abstract function getHandler();
}
