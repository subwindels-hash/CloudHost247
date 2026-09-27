<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Helpers;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Traits\HostingComponent;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Traits\AdminAreaServicePageHelper;

/**
 * Description of PageController
 *
 * @author Mateusz Pawłowski <mateusz.pa@modulesgarden.com>
 */
class PageController
{
    const PAGE_DISABLED = 'disablePage';

    use AdminAreaServicePageHelper, HostingComponent;

    public function checkPages($items)
    {

        $pages = [];
        foreach ($items as $page => $params)
        {
            if (isset($params['validate']))
            {
                if ($this->runMethod($params['validate']))
                {
                    unset($params['validate']);
                    $pages[$page] = $params;
                }
            }
            else
            {
                $pages[$page] = $params;
            }
        }
        return $pages;
    }

    public function checkOnePage($page, $throwable = false)
    {
        foreach($this->readClientFile() as $group)
        {
            if(isset($group['children']) && !empty($group['children']))
            {
                foreach ($group['children'] as $pageName => $pageDetails)
                {
                    if($pageName == $this->getName($page) && isset($pageDetails['validate']))
                    {
                        $status = $this->runMethod($pageDetails['validate']);

                        if($throwable && !$status)
                        {
                            throw new \Exception(self::PAGE_DISABLED);
                        }

                        return $status;
                    }
                }
            }
        }

        return true;
    }

    private function getName($pageClass)
    {
        return strtolower(substr(strrchr($pageClass, "\\"), 1));
    }

    private function readClientFile()
    {
        return Reader::read(ModuleConstants::getDevConfigDir() . DS . 'menu' . DS . 'client.yml')->get();
    }

    private function runMethod($functions)
    {
        $status = false;
        foreach(explode(',', $functions) as $function){
            $status = $this->{$function}();
            if($status === true){
                continue;
            }
            $status = false;
            break;
        }
        return $status;
    }

    public function __call($name, $arguments = null)
    {
        $this->initHostingConfiguration();

        $fieldsRepository = new Repository();

        $fields = $fieldsRepository->getProductSettings($this->hosting->packageid);

        if($fields[$name] == "on")
        {
            return true;
        }

        return false;
    }

    protected function initHostingConfiguration()
    {
        $serviceId = $this->getServiceIdForAAServicePage();
        $this->initHosting($serviceId);
    }


}
