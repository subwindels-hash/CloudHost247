<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Others;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\BaseContainer;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

/**
 * AjaxFieldForDataTable - a field that will load its content after creation
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class AjaxFieldForDataTable extends BaseContainer implements \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface
{
    protected $id = 'ajaxFieldForDataTable';
    protected $name = 'ajaxFieldForDataTable';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'dt-ajax-field';

    protected $asyncLoading = true;
    protected $ajaxData = null;

    public function changeAsyncLoading($load = true)
    {
        $this->asyncLoading = (bool)$load;
    }

    public function getAsyncLoaging()
    {
        return $this->asyncLoading;
    }

    public function setAjaxData($ajaxData = null)
    {
        $this->ajaxData = $ajaxData;

        return $this;
    }

    public function getAjaxData()
    {
        return $this->ajaxData;
    }

    public function prepareAjaxData()
    {
        //to be overwritten
        //set here $this->ajaxData value
    }

    public function returnAjaxData()
    {
        $this->prepareAjaxData();

        return (new ResponseTemplates\RawDataJsonResponse(['ajaxData' => $this->ajaxData]))
            ->setCallBackFunction($this->callBackFunction)->setRefreshTargetIds($this->refreshActionIds);
    }
}
