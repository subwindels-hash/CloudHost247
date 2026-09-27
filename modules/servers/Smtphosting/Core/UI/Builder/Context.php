<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\BuildUrl;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\MainContainer;

use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

/**
 * Description of Context
 *
 * @author inbs
 */
class Context
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Title;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\HtmlElements;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Template;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Searchable;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Buttons;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Icon;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\VueComponent;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\HtmlAttributes;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\ACL;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\CallBackFunction;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\Alerts;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RefreshAction;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\WidgetView;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\AjaxComponent;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\ContainerElements;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\WhmcsParams;

    protected $html = '';
    protected $customTplVars = [];
    protected $mainContainer = null;
    protected $namespace = '';
    protected $errorMessage = false;

    public static $findItemContext = false;

    protected $initialized = true;

    public function __construct($baseId = null)
    {
        $this->addNewElementsContainer('buttons');

        $this->namespace = str_replace('\\', '_', get_class($this));
        $this->initIds($baseId);

        $this->prepareDefaultHtmlElements();
        $this->loadTemplateVars();
    }

    public function getErrorMessage()
    {
        return $this->errorMessage;
    }

    /**
     * @return string
     */
    public function getHtml()
    {
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

    protected function buildHtml()
    {
        $this->html = self::generate($this);
    }

    public function getCustomTplVars()
    {
        return $this->customTplVars;
    }

    public function getCustomTplVarsValue($varName)
    {
        return $this->customTplVars[$varName];
    }

    /**
     * @param \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Builder\Context $object
     * @return string
     */
    public static function generate(Context $object)
    {
        $tpl = $object->getTemplateName();

        $vars = [
            'title'          => $object->getTitle(),
            'class'          => $object->getClasses(),
            'name'           => $object->getName(),
            'elementId'      => $object->getId(),
            'htmlAttributes' => $object->getHtmlAttributes(),
            'elements'       => $object->getElements(),
            'scriptHtml'     => $object->getScriptHtml(),
            'customTplVars'  => $object->getCustomTplVars(),
            'rawObject'      => $object,
            'namespace'      => $object->getNamespace(),
            'isDebug'        => (bool)(int)sl('configurationAddon')->getConfigValue('debug', '0'),
            'isError'        => (bool)$object->getErrorMessage(),
            'errorMessage'   => $object->getErrorMessage(),
            'assetsUrl'      => BuildUrl::getAssetsURL(),
            'appAssetsUrl'   => BuildUrl::getAppAssetsURL()
        ];

        $lang = ServiceLocator::call('lang');

        $lang->stagCurrentContext('builder' . $object->getName());
        $lang->addToContext(lcfirst($object->getName()));
        $return = ServiceLocator::call('smarty')->setLang($lang)->view($tpl, $vars, $object->getTemplateDir());
        if (!$object->isVueRegistrationAllowed())
        {
            return $return;
        }

        if ($object->isVueComponent() && file_exists($object->getTemplateDir() . str_replace('.tpl', '', $tpl) . '_components.tpl'))
        {
            $vueComponents = ServiceLocator::call('smarty')->setLang($lang)->view(str_replace('.tpl', '', $tpl) . '_components', $vars, $object->getTemplateDir());
            $object->addVueComponentTemplate($vueComponents, $object->getId());
        }
        if ($object->isVueComponent() && file_exists($object->getTemplateDir() . str_replace('.tpl', '', $tpl) . '_components.js'))
        {
            $vueComponentsJs = file_get_contents($object->getTemplateDir() . str_replace('.tpl', '', $tpl) . '_components.js');
            $object->addVueComponentJs($vueComponentsJs, $object->getDefaultVueComponentName());
        }
        if ($object->isVueComponent() && $object->getDefaultVueComponentName())
        {
            $object->registerVueComponent($object->getId(), $object->getDefaultVueComponentName());
        }

        $lang->unstagContext('builder' . $object->getName());

        return $return;
    }

    public function setMainContainer(MainContainer &$mainContainer)
    {
        if ($this->mainContainer !== null)
        {
            return $this;
        }

        $this->mainContainer = &$mainContainer;
        $this->registerMainContainerAdditions($this);

        $this->propagateMainContainer($mainContainer);

        if (self::$findItemContext === false)
        {
            $this->runInitContentProcess();
        }

        return $this;
    }

    protected function propagateMainContainer(&$mainContainer)
    {
        foreach ($this->getElementsContainers() as $containerName)
        {
            foreach ($this->{$containerName} as &$container)
            {
                $container->setMainContainer($mainContainer);
            }
        }
    }

    public function initContent()
    {

    }

    public function runInitContentProcess()
    {
        $this->preInitContent();
        $this->initContent();
        $this->afterInitContent();

        //$this->initialized = true;
    }

    protected function preInitContent()
    {
        //Do not use or override this method
    }

    protected function afterInitContent()
    {
        //Do not use or override this method
    }

    public function getNamespace()
    {
        return $this->namespace;
    }

    public function wasInitialized()
    {
        return $this->initialized;
    }
}
