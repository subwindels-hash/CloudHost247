<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\BuildUrl;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon\Config;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsAdmin;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\View\MainMenu;

/**
 * BreadcrumbsHandler
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class BreadcrumbsHandler
{
    use IsAdmin;

    protected $breadcrumbs = [];

    public function __construct()
    {
        $this->loadDefault();
    }

    public function addBreadcrumb($url = null, $title = null, $order = null, $rawTitle = null)
    {
        $this->breadcrumbs[] = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Helpers\Breadcrumb(
            $url, $title, $this->getOrder($order), $rawTitle);
    }

    public function loadDefault()
    {
        if (!$this->isAdmin())
        {
            $clientAreaName = ServiceLocator::call(Config::class)->getConfigValue('clientareaName', 'default');
            $url            = BuildUrl::getUrl();
            $this->addBreadcrumb($url, $clientAreaName, null);
        }

        $router = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Router();
        if ($this->isAdmin())
        {
            $mainMenu = DependencyInjection::create(MainMenu::class)->buildBreadcrumb($router->getController(), $router->getControllerMethod(), []);
            $order    = 10;
            foreach ($mainMenu->getBreadcrumb() as $item)
            {
                $this->addBreadcrumb($item['url'], $item['name'], $order);
                $order += 10;
            }
        }
    }

    public function getOrder($order = null)
    {
        if (is_int($order) && $order > 0)
        {
            return $order;
        }

        if (count($this->breadcrumbs) === 0)
        {
            return 100;
        }

        $last = end($this->breadcrumbs);

        return $last->getOrder() + 100;
    }

    public function getBreadcrumbs()
    {
        //sort
        usort($this->breadcrumbs, function ($a, $b) {
            return ($a->getOrder() > $b->getOrder());
        });

        if ($this->isAdmin())
        {
            return $this->breadcrumbs;
        }

        $bcList = [];
        foreach ($this->breadcrumbs as $brc)
        {
            $bcDetails                 = $brc->getBreadcrumb();
            $bcList[$bcDetails['url']] = $bcDetails['title'];
        }

        return $bcList;
    }

    public function replaceBreadcrumbTitle($key = null, $value = null)
    {
        if ($key === null || !is_string($value) || $value === '' || !$this->breadcrumbs[$key])
        {
            return $this;
        }

        $this->breadcrumbs[$key]->setTitle($value);

        return $this;
    }

    public function disableBreadcrumb($key = null)
    {
        if ($key === null || !$this->breadcrumbs[$key])
        {
            return $this;
        }

        $this->breadcrumbs[$key]->setDisabled();

        return $this;
    }
}
