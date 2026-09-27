<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Traits\HostingComponent;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\di;
use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

class ClientAreaSidebar
{
    use Lang, HostingComponent;

    protected $lang      = null;
    protected $request   = null;
    protected $hostingId = null;
    protected $productId = null;
    protected $server;
    protected $client;
    protected $moduleName = null;

    public function __construct()
    {

        $this->loadLang();
        $this->loadModuleName();
        $this->lang->addToContext('sidebarMenu');

        $this->request = sl('request');

        $this->hostingId = $this->request->get('id', '');
        $this->initHosting($this->hostingId);

        if ($this->hosting)
        {
            $this->productId = $this->hosting->product->id;
            $this->server    = $this->hosting->servers->id;
        }
    }

    protected function loadModuleName()
    {
        $appParams = di("appParamsContainer");
        $this->moduleName = $appParams->getParam('systemName');
    }

    public function addChildren(&$menuItem, $children)
    {
        if (!$this->hosting || !$this->request->getSession('uid') || $this->hosting->domainstatus !== 'Active' || $this->hosting->product->servertype !== $this->moduleName)
        {
            return;
        }

        foreach ($children as $childName => $child) {
//            if (in_array($childName, FeaturesWithControllers::getOneClickLoginSettingsWithNames()))
//            {
//                $this->addOneClickLogin($menuItem, $childName, $child);
//                continue;
//            }


            $btn = $menuItem->addChild($childName, [
                'label'   => $this->lang->T($childName),
                'uri'     => $this->parseUrl($childName, $child),
                'icon'    => $child['icon'],
                'order'   => $child['order'],
                'display' => true
            ]);

            if ($btn && (($this->request->get('mg-page', null) === $childName) ||
                    ($this->request->get('mg-page', null) === 'user' && $childName === 'users')))
            {
                $btn->setClass('active');
            }
        }
    }

    public function addOneClickLogin(&$menuItem, $childName, $child)
    {
//        if ($this->isSettingEnabled(array_search($childName, FeaturesWithControllers::getOneClickLoginSettingsWithNames()), $this->productId) === false)
//        {
//            return;
//        }
//        $params = sl('request')->query->all();
//        unset($params['mg-action']);
//        unset($params['mg-page']);
        $menuItem->addChild($childName, [
            'label'   => $this->lang->T($childName),
//            'uri' => BuildUrl::getUrl('OneClickLogin', 'redirect',array_merge($params,['where' => $childName])),
            'icon'    => $child['icon'],
            'order'   => $child['order'],
            'display' => true
        ]);
    }

    public function addSubmenuItem(&$primaryMenuItem, $name, $menuItem)
    {
        if (!$this->hosting || !$this->request->getSession('uid') || $this->hosting->domainstatus !== 'Active')
        {
            return;
        }

        $primaryMenuItem->addChild($name, [
            'label'   => $this->lang->T($name),
            'uri'     => '#',
            'icon'    => $menuItem['icon'],
            'order'   => $menuItem['order'],
            'display' => true
        ]);
    }

    public function parseUrl($pageName, $menuItem)
    {
        if ($menuItem['externalUrl'])
        {
            return $menuItem['externalUrl'];
        }

        if (!$menuItem['url'])
        {
            $menuItem['url'] = 'clientarea.php?action=productdetails&amp;id=' . $this->hostingId . '&amp;modop=custom&amp;a=management&amp;mg-page=' . $pageName;
        }

        return $menuItem['url'];
    }
    public function isProperProductType()
    {
        return $this->hosting->product->servertype === $this->moduleName;
    }

}
