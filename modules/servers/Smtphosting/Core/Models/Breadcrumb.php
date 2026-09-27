<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\BuildUrl;

/**
 * Description of Breadcrumb
 *
 * @author inbs
 */
class Breadcrumb
{
    protected $name;

    protected $controller;

    protected $action;

    protected $params = [];

    protected $icon;

    protected $url;

    public function __construct($name, $controller, $action, $params = [], $icon = null, $isUrl = true)
    {
        $this->name       = $name;
        $this->controller = $controller;
        $this->action     = $action;
        $this->params     = $params;
        $this->icon       = $icon;
        $this->url        = $isUrl ? BuildUrl::getUrl($this->controller, $this->action, $this->params) : null;
    }

    public function getName()
    {
        return $this->name;
    }

    public function isUrl()
    {
        return ($this->url ? true : false);
    }

    public function getUrl()
    {
        return $this->url;
    }

    public function isIcon()
    {
        return ($this->icon ? true : false);
    }

    public function getIcon()
    {
        return $this->icon;
    }

}
