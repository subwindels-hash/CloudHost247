<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits;

/**
 * Vue Components related functions
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
trait VueComponent
{
    protected $vueComponent = false;
    protected $defaultVueComponentName = null;

    protected static $vueComponentBody = '';
    protected static $listIdElements = [];

    protected static $vueComponentBodyJs = '';
    protected static $listIdElementsJs = [];

    protected static $vueComponentRegistrationsBody = null;
    protected static $vueComponentRegistrations = [];
    protected static $vueComponentRegistredIds = [];

    public function isVueComponent()
    {
        return $this->vueComponent;
    }

    public function getDefaultVueComponentName()
    {
        return $this->defaultVueComponentName;
    }

    public function getVueComponents()
    {
        if (self::$vueComponentBody === '')
        {
            $this->html = self::generate($this);
        }

        return self::$vueComponentBody;
    }

    protected function addVueComponentTemplate($componentBody, $id)
    {
        if ($id === $this->getRequestValue('loadData', false) && $this->getRequestValue('ajax') == '1')
        {
            return $this;
        }

        if (!in_array($id, self::$listIdElements))
        {
            self::$vueComponentBody .= $componentBody;
            self::$listIdElements[] = $id;
        }

        return $this;
    }

    public function getVueComponentsJs()
    {
        return self::$vueComponentBodyJs;
    }

    protected function addVueComponentJs($componentBodyJs, $id)
    {
        if (!in_array($id, self::$listIdElementsJs))
        {
            self::$vueComponentBodyJs .= $componentBodyJs;
            self::$listIdElementsJs[] = $id;
        }

        return $this;
    }

    protected function registerVueComponent($componentId, $componentTemplateId)
    {
        if ($componentId === $this->getRequestValue('loadData', false) && $this->getRequestValue('ajax') == '1')
        {
            return $this;
        }

        if (!in_array($componentId, self::$vueComponentRegistredIds))
        {
            self::$vueComponentRegistrations[$componentId] = $componentTemplateId;
        }

        return $this;
    }

    public function getVueComponentsRegistrationsJs()
    {
        self::$vueComponentRegistrationsBody = '';
        foreach (self::$vueComponentRegistrations as $componentId => $componentTemplateId)
        {
            self::$vueComponentRegistrationsBody .= ' mgJsComponentHandler.addComponentByDefaultTemplate(\'' . strtolower($componentId) . '\', \'' . $componentTemplateId . '\'); ';
        }

        return self::$vueComponentRegistrationsBody;
    }

    public function getVueComponentsRegistrations()
    {
        return self::$vueComponentRegistrations;
    }

    /**
     * A default method to be overwritten in order to manage vue components registration process.
     */
    public function isVueRegistrationAllowed()
    {
        return true;
    }
}
