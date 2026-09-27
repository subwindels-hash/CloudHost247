<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\DataTable\Filters\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;

abstract class Filter extends BaseContainer implements FilterInterface
{
    protected $id = 'filter';
    protected $name = 'filter';
    protected $title = 'filterTitle';
}
