<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Request;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\Context;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

/**
 * Description of Conteiner
 *
 * @author inbs
 */
class MainContainer extends Container
{
    use Traits\MainContainerElements;

    protected $name = 'mainContainer';
    protected $id = 'mainContainer';
    protected $defaultTemplateName = 'mainContainer';
    protected $templateName = 'mainContainer';
    protected $data = [];
    protected $vueInstanceName = null;

    public function __construct($baseId = null)
    {
        parent::__construct($baseId);

        $this->prepareElemnentsContainers();
    }

    public function addElement($element = null, $containerName = null)
    {
        if (is_string($element))
        {
            $element = DependencyInjection::create($element);
        }

        $container = $this->getElementContainerName($containerName);
        if (!$container)
        {
            return $this;
        }

        $id = $element->getId();
        if (!isset($this->{$container}[$id]))
        {
            $element->setMainContainer($this);
            $this->{$container}[$id] = $element;
            if ($element instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\AjaxElementInterface)
            {
                $this->ajaxElements[] = &$this->{$container}[$id];
            }
            if ($element->isVueComponent())
            {
                $this->vueComponents[$element->getTemplateName()] = &$this->{$container}[$id];
            }
        }

        return $this;
    }

    public function getVueInstanceName()
    {
        if ($this->vueInstanceName === null)
        {
            $randomGen             = new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\RandomStringGenerator(32);
            $this->vueInstanceName = $randomGen->genRandomString('mc');
        }

        return $this->vueInstanceName;
    }

    public function valicateACL($isAdmin)
    {
        foreach ($this->elements as $id => &$element)
        {
            /**
             * @var Context $element
             */
            if ($element->setIsAdminAcl($isAdmin)->validateElement($element) === false)
            {
                unset($this->elements[$id]);
                Helper\sl('errorManager')->addError(__CLASS__, 'There is no implemented interface for the widget "' . get_class($element) . '".');
            }
        }

        foreach ($this->ajaxElements as $id => &$element)
        {
            /**
             * @var Context $element
             */
            if ($element->setIsAdminAcl($isAdmin)->validateElement($element) === false)
            {
                unset($this->ajaxElements[$id]);
                Helper\sl('errorManager')->addError(__CLASS__, 'There is no implemented interface for the widget "' . get_class($element) . '".');
            }
        }

        return $this;
    }

    /**
     * @param array $data
     * @return $this
     */
    public function setData($data = [])
    {
        $this->data = $data;
        $this->updateData();

        return $this;
    }

    protected function updateData()
    {
        foreach ($this->data as $key => $value)
        {
            if (property_exists($this, $key))
            {
                $this->$key = $value;
            }
        }
        $this->data = [];

        return $this;
    }

    public function getHtml()
    {
        $this->loadDefaultNavbars();

        if ($this->html === '')
        {
            $this->buildHtml();
        }

        return $this->html;
    }

    /**
     * @return string
     */
    public function __toString()
    {
        return $this->getHtml();
    }

    public function getAjaxResponse()
    {
        $request = Request::build();

        foreach ($this->ajaxElements as $aElem)
        {
            if ($request->get('loadData', false) === $aElem->getId())
            {
                $response = $aElem->returnAjaxData();
                if ($response instanceof \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Interfaces\ResponseInterface)
                {
                    return $response->getFormatedResponse();
                }

                return $response;
            }
        }
    }

    public function getVueComponents()
    {
        $vBody = '';
        foreach ($this->vueComponents as $vElem)
        {
            $vBody .= $vElem->getVueComponents();
        }

        return $vBody;
    }

    public function getAjaxElems()
    {
        return $this->ajaxElements;
    }

    public function getVueComponentsJs()
    {
        $vJsBody = '';
        foreach ($this->vueComponents as $vElem)
        {
            $vJsBody .= $vElem->getVueComponentsJs();
        }

        return $vJsBody;
    }

    public function getDefaultVueComponentsJs()
    {
        if ($this->defaultComponentsJs === null)
        {
            $this->loadDefaultVueComponentsJs();
        }

        return $this->defaultComponentsJs;
    }

    protected function loadDefaultVueComponentsJs()
    {
        $componentsPath            = str_replace(DS . 'ui' . DS, DS . 'assets' . DS . 'js' . DS . 'defaultComponents' . DS, $this->getDefaultTemplateDir());
        $content                   = scandir($componentsPath);
        $this->defaultComponentsJs = '';
        if ($content)
        {
            foreach ($content as $file)
            {
                if(substr($file, 0, 1) == '.')
                {
                    continue;
                }
                $fileInfo = pathinfo($componentsPath . $file);
                if ($fileInfo['extension'] === 'js')
                {
                    $jsContent                 = file_get_contents($componentsPath . $file);
                    $this->defaultComponentsJs .= $jsContent ? $jsContent : '';
                }
            }
        }

        return $this;
    }
}
