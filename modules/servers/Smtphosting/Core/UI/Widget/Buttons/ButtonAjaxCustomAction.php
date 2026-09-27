<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Buttons;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

class ButtonAjaxCustomAction extends ButtonCustomAction implements AjaxElementInterface
{
    protected $id = 'ButtonAjaxCustomAction';
    protected $class = ['lu-btn lu-btn-circle lu-btn-outline lu-btn-inverse lu-btn-default lu-btn-icon-only'];
    protected $icon = 'lu-zmdi lu-zmdi-plus';
    protected $title = 'ButtonAjaxCustomAction';
    protected $htmlAttributes = [
        'href'        => 'javascript:;',
        'data-toggle' => 'lu-tooltip',
    ];

    protected $customActionName = null;
    protected $customActionParams = [];

    public function initContent()
    {
        $this->htmlAttributes['@click'] = 'makeCustomAction(' . $this->customActionName . ', ' . $this->parseCustomParams() . ', $event, \'' . $this->getNamespace() . '\', \'' . $this->getIndex() . '\')';
    }

    public function returnAjaxData()
    {
        return (new ResponseTemplates\RawDataJsonResponse(['exampleData' => 'example']))->setCallBackFunction($this->callBackFunction)->setRefreshTargetIds($this->refreshActionIds);
    }

    public function setCustomActionName($name)
    {
        $this->customActionName = $name;

        return $this;
    }

    public function setCustomActionParams(array $params)
    {
        $this->customActionParams = $params;

        return $this;
    }

    public function addCustomActionParam($key, $value)
    {
        $this->customActionParams[$key] = $value;

        return $this;
    }

    public function parseCustomParams()
    {
        if (count($this->customActionParams) === 0)
        {
            return '{}';
        }

        return $this->parseListTOJsString($this->customActionParams);
    }

    protected function parseListTOJsString($params)
    {
        $jsString = '{';
        foreach ($params as $key => $value)
        {
            $jsString .= ' ' . $key . ': ' . (is_array($value) ? ($this->parseListTOJsString($value) . ',') : ("'" . (string)$value) . "',");
        }

        $jsString = trim($jsString, ',') . ' } ';

        return $jsString;
    }
}
