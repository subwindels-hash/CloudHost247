<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\ResponseInterface;

/**
 *  Ajax Json Data Response
 */
class DataJsonResponse extends Response implements ResponseInterface
{
    protected $dataType = 'data';
}
