<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\View;

/**
 * Description of Breadcrumb
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Breadcrumb
{
    /**
     * @var array
     */
    protected $data = [];

    public function __construct()
    {

    }

    public function load(array $menu = [], $controller = null, $action = null, array $arrayBreadcrumb = [])
    {
        if (empty($controller))
        {
            $controller = key($menu);
        }
        if ($controller)
        {
            $this->data[] = [
                'name' => $controller,
                'url'  => $menu[strtolower($controller)]['url'] ?: $menu[$controller]['url'],
                'icon' => $menu[strtolower($controller)]['icon'] ?: $menu[$controller]['icon']
            ];
        }

        if ($arrayBreadcrumb)
        {
            $count = count($arrayBreadcrumb) - 1;
            foreach ($arrayBreadcrumb as $number => $breadcrumb)
            {
                $this->data[] = [
                    'name' => $breadcrumb->getName(),
                    'url'  => $breadcrumb->isUrl() && $count != $number ? $breadcrumb->getUrl() : null,
                    'icon' => $breadcrumb->isIcon() ? $breadcrumb->getIcon() : null
                ];
            }
        }
        elseif ($action && $action !== 'index')
        {
            $this->data[] = [
                'name' => $action,
                'url'  => $menu[$controller]['submenu'][$action]['url'],
                'icon' => $menu[$controller]['submenu'][$action]['icon']
            ];
        }

        return $this;
    }

    /**
     * @return array
     */
    public function get()
    {
        return $this->data;
    }
}
