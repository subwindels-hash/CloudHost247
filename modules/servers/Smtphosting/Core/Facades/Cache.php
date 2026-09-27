<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Facades;


use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Cache\Services\DatabaseCache;

class Cache extends Facade
{
    protected static $cache = DatabaseCache::class;
}