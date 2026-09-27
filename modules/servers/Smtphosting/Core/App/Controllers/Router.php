<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers;

class Router
{
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Lang;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\Smarty;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\OutputBuffer;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsAdmin;
    use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

    const ADMIN  = 'admin';
    const CLIENT = 'client';

    protected $controllerClass = null;
    protected $controllerMethod = null;

    public function __construct()
    {
        $this->isAdmin();
        $this->loadController();
    }

    /**
     * load routing params
     */
    public function loadController()
    {
        $this->getControllerClass();
        $this->getControllerMethod();
    }

    /**
     * @return string
     * class name of the controller
     */
    public function getControllerClass()
    {
        if ($this->controllerClass === null)
        {
            $this->controllerClass = '\ModulesGarden\ProductsReseller\Server\Smtphosting\App\Http\\' . ucfirst($this->getControllerType()) . '\\' . ucfirst($this->getController());
        }

        return $this->controllerClass;
    }

    /**
     * @return string
     * admin/client context type
     */
    public function getControllerType()
    {
        return $this->isAdminStatus ? self::ADMIN : self::CLIENT;
    }

    /**
     * @return string
     * get controller name
     */
    public function getController()
    {
        return filter_var($this->getRequestValue('mg-page', 'Home'), FILTER_SANITIZE_SPECIAL_CHARS);
    }

    /**
     * @return string
     * controller method name
     */
    public function getControllerMethod()
    {
        if ($this->controllerMethod === null)
        {
            $this->controllerMethod = $this->request->get('mg-action', 'index');
        }

        return $this->controllerMethod;
    }

    /**
     * @return bool
     * determines if controller can be called
     */
    public function isControllerCallable()
    {
        if (!class_exists($this->controllerClass))
        {
            return false;
        }

        if (!method_exists($this->controllerClass, $this->controllerMethod))
        {
            return false;
        }

        if (!is_callable([$this->controllerClass, $this->controllerMethod]))
        {
            return false;
        }

        return true;
    }
}
