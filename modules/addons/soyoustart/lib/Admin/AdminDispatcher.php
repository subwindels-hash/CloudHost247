<?php

namespace WHMCS\Module\Addon\Soyoustart\Admin;

use WHMCS\Module\Addon\Soyoustart\Admin\Controller;

require __DIR__ . '/controller.php';

class AdminDispatcher {

    //private $controller = null;

    
    public function dispatch($action, $parameters)
    {
        $controller = new Controller($parameters);

        if (is_callable(array($controller, $action))) {
            return $controller->$action();
        }

        return '<p>Invalid action requested. Please go back and try again.</p>';
    }
}
