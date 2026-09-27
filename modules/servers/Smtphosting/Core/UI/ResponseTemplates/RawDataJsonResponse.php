<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\ResponseInterface;

/**
 * Ajax Raw Data Json Response
 */
class RawDataJsonResponse extends Response implements ResponseInterface
{
    protected $dataType = 'rawData';
}
