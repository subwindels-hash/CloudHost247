<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\ResponseInterface;

/**
 *  Ajax Html Data Response
 */
class HtmlDataJsonResponse extends Response implements ResponseInterface
{
    protected $dataType = 'htmlData';
}
