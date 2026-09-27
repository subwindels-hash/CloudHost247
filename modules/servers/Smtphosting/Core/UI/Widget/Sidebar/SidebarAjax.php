<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Sidebar;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

/**
 * Description of SidebarAjax
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgardne.com>
 */
class SidebarAjax extends Sidebar implements \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;

    protected $id = 'sidebarAjax';
    protected $name = 'sidebarAjax';

    protected $vueComponent = true;
    protected $defaultVueComponentName = 'mg-ajax-sidebar';

    protected $ajaxMenuElements = [];

    /**
     * overwrite this function, use add function to add ajax elements
     */
    public function prepareAjaxData()
    {

    }

    /**
     * do not overwrite this function
     * @return type \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates\RawDataJsonResponse
     */
    public function returnAjaxData()
    {
        $this->prepareAjaxData();

        $returnData = $this->parseProvidedData();

        return (new ResponseTemplates\RawDataJsonResponse($returnData))->setCallBackFunction($this->callBackFunction);
    }

    protected function parseProvidedData()
    {
        $this->loadLang();

        $data = [];
        foreach ($this->ajaxMenuElements as $mItem)
        {
            $data[] = [
                'id'            => $mItem->getId(),
                'namespace'     => $mItem->getNamespace(),
                'icon'          => $mItem->getIcon(),
                'href'          => method_exists($mItem, 'getHref') ? $mItem->getHref() : null,
                'htmlAtributes' => $mItem->getHtmlAttributes(),
                'class'         => $mItem->getClasses(),
                'clickAction'   => $this->parseOnClickAction($mItem->getHtmlAttributes()['@click']),
                'title'         => $this->lang->tr($this->id, $mItem->getTitle())
            ];
        }

        return $data;
    }

    public function add($sidebar)
    {
        $this->ajaxMenuElements[$sidebar->getId()] = $sidebar;

        if (method_exists($sidebar, 'setParent'))
        {
            $sidebar->setParent($this);
        }

        return $this;
    }

    public function parseOnClickAction($actionString)
    {
        if (stripos($actionString, '(') > 0)
        {
            $actions      = explode('(', $actionString);
            $action       = $actions[0];
            $paramsString = trim(trim(trim($actions[1], ';'), ')'), "'");
            $params       = explode(',', $paramsString);
            foreach ($params as $key => $param)
            {
                $params[$key] = trim(trim(trim($param), "'"), '"');
            }

            return ['action' => $action, 'params' => $params];
        }

        return ['action' => $actionString, 'params' => []];
    }
}
