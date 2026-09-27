<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Admin;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\AbstractController;

class PageNotFound extends AbstractController
{
    public function index()
    {
        $pageControler = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Http\PageNotFound();

        return $pageControler->execute();
    }
}
