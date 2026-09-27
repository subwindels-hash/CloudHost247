<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\View;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\BuildUrl;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

/**
 * Description of MainMenu
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class MainMenu
{
    /**
     * @var array
     */
    protected $menuContect = [];

    /**
     * @var array
     */
    protected $menu = [];

    /**
     * @var Breadcrumb
     */
    protected $breadcrumbModel;

    /**
     * @var array
     */
    protected $breadcrumb = [];

    public function __construct(Breadcrumb $breadcrumb)
    {
        $this->breadcrumbModel = $breadcrumb;

        $this->loadMenuContect();
        $this->buildMenu();
    }

    private function loadMenuContect()
    {
        $isAdmin           = Helper\isAdmin();
        $file              = ($isAdmin) ? 'admin.yml' : 'client.yml';
        $this->menuContect = Reader::read(ModuleConstants::getDevConfigDir() . DS . 'menu' . DS . $file)->get();
    }

    private function buildMenu()
    {

        foreach ($this->menuContect as $catName => $category)
        {
            if (isset($category['submenu']))
            {
                foreach ($category['submenu'] as $subName => &$subPage)
                {
                    if (empty($subPage['url']))
                    {
                        $subPage['url'] = isset($subPage['externalUrl']) ? isset($subPage['externalUrl'])
                            : BuildUrl::getUrl($catName, $subName);
                    }
                }
            }
            if (!is_string($category))
            {
                $category['url'] = isset($category['externalUrl']) ? isset($category['externalUrl'])
                    : BuildUrl::getUrl($catName);
            }
            $this->menu[$catName] = $category;
        }
    }

    public function buildBreadcrumb($controller = null, $action = null, array $arrayBreadcrumb = [])
    {
        $this->breadcrumb = $this->breadcrumbModel
            ->load($this->getMenu(), $controller, $action, $arrayBreadcrumb)
            ->get();
        return $this;
    }

    public function getMenu()
    {
        return $this->menu;
    }

    public function getBreadcrumb()
    {
        return $this->breadcrumb;
    }
}
