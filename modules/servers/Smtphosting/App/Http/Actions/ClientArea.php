<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\Actions;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings\Repository;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
use WHMCS\Product\Product;

class ClientArea implements AbstractAction
{
    use Lang;

    protected $params;
    protected $lang;

    public function __construct($params)
    {
        $this->params = $params;
        $this->loadLang();
    }

    /**
     * @return mixed
     * @throws \Exception
     */
    public function process()
    {
        if ($_REQUEST['modop'] === 'custom')
        {
            return $this->productDetails($this->params, true);
        }
        $isSSL = \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\SSLSubmoduleChecker::check($this->params['serviceid']);
        $isSSL = $isSSL ?: \ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\SSLSubmoduleChecker::checkByName($this->params['serviceid']);
        if ($isSSL)
        {
            if (!function_exists('Smtphosting_getInfo'))
            {
                throw new \Exception($this->lang->T('loadingConfigurationProblemPleaseContactAdministrator'));
            }
            $caTemplate = Smtphosting_getInfo($this->params);
            return $caTemplate;
        }
        else
        {
            if ($_REQUEST['a'])
            {
                if (!function_exists('Smtphosting_' . $_REQUEST['a']))
                {
                    return [];
                }
                $caTemplate = call_user_func_array('Smtphosting_' . $_REQUEST['a'], [$this->params]);
            }
            else
            {
                $caTemplate = $this->productDetails($this->params, false);
            }
            return $caTemplate;
        }
    }

    protected function productDetails($params, $isModop)
    {
        $productRepo = new Repository();
        if ($productRepo->getProductSettings($params['pid'])['action_details'] === 'on' && function_exists('Smtphosting_details'))
        {
            $caTemplate = Smtphosting_details($this->params);

            if ($caTemplate === 'success')
            {
                return $caTemplate;
            }

            if ($caTemplate['error'])
            {
                throw new \Exception($caTemplate['error']);
            }

            return $caTemplate;
        }
        if (function_exists('Smtphosting_getInfo'))
        {
            $caTemplate = Smtphosting_getInfo($this->params);

            if ($caTemplate === 'success')
            {
                return $caTemplate;
            }

            if ($caTemplate['error'])
            {
                throw new \Exception($caTemplate['error']);
            }

            return $caTemplate;
        }
        if (!$isModop)
        {
            return [];
        }

    }
}
