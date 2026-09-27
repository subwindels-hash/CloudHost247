<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http;

/**
 * Description of AbstractController
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class AbstractController
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\OutputBuffer;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsAdmin;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

    public function __construct()
    {
        $this->loadRequestObj();
    }
}
