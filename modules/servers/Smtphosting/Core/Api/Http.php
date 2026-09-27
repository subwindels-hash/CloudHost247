<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\Exceptions\WhmcsApiException;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Traits\IsDebugOn;

use ModulesGarden\ProductsReseller\Server\Smtphosting\App\Libs\Exceptions\ApiException;


/**
 * Description of Http
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Http
{
    use IsDebugOn;

    /**
     * @var \AltoRouter;
     */
    protected $router;

    public function __construct($basepath)
    {
        $this->loadRouter($basepath);
        $this->router->addMatchTypes(["d" => "[^/]+"]);
    }

    /**
     * Parse API request
     */
    public function run()
    {
        try
        {
            $logger = $this->getLoggerObject();
            $match  = $this->router->match();
            if ($match)
            {
                $auth = $this->getAuthObject();
                $auth->run($match["name"]);

                $validator = $this->getValidatorObject();
                $validator->run($match["name"]);

                $request = explode("#", $match['target']);
                $action  = [$this->getController($request[0]), $request[1]];
                $result  = call_user_func_array($action, $match['params']);

                $logger->logInfo($match["name"], array_merge($match["params"], $_REQUEST), $result);

                echo json_encode($result);
            }
            else
            {
                header($_SERVER["SERVER_PROTOCOL"] . ' 404 Not Found');
                echo json_encode(["error" => "Action not found"]);
            }

            exit;
        }
        catch (ApiException $mgex)
        {
            $code   = $mgex->getMgHttpCode();
            $exdata = $mgex->getAdditionalData();

            $message = "{$mgex->getMgMessage(false)}" . ($this->isDebugOn() ? " | " . print_r($exdata, true) : "");
        }
        catch (WhmcsApiException $whmcsex)
        {
            $exdata  = $whmcsex->getAdditionalData();
            $message = "{$exdata["data"]["result"]["message"]}: {$exdata["data"]["result"]["error"]}";
        }
        catch (\Exception $ex)
        {
            $exdata  = $this->isDebugOn() ? print_r($ex, true) : null;
            $message = "Please contact administration (server side issue)" . ($exdata ? " | " . $exdata : "");
        }

        $logger->logError($match["name"], array_merge($match["params"], $_REQUEST), $exdata);

        $response = $this->getResponseBuilderObject();
        $message  = $response->build($match["name"], $message);

        http_response_code($code ?: 500);
        echo json_encode(["error" => $message]);
    }

    /**
     * Load router object
     *
     * @param $basePath
     * @throws \Exception
     */
    protected function loadRouter($basePath)
    {
        $this->router = new \AltoRouter();
        $this->router->setBasePath($basePath);

        $routes = require ModuleConstants::getDevConfigDir() . DS . "api" . DS . "routes.php";
        $this->router->addRoutes($routes);
    }

    /**
     * Get controller object
     *
     * @return Object
     */
    protected function getController($classname)
    {
        $classname = "\\ModulesGarden\\ProductsReseller\\Server\\Smtphosting\\App\\Http\\Api\\{$classname}";
        return new $classname;
    }

    /**
     * Get Authorization class object
     *
     * @return Auth class object
     */
    protected function getAuthObject()
    {
        $config = $this->getConfigElement("auth");
        $auth   = new $config["class"];

        return $auth;
    }

    /**
     * @return mixed
     */
    protected function getValidatorObject()
    {
        $config    = $this->getConfigElement("validator");
        $validator = new $config["class"];

        return $validator;
    }


    /**
     * Get Logger class object
     *
     * @return Logger class object
     */
    protected function getLoggerObject()
    {
        $config = $this->getConfigElement("logger");
        $auth   = new $config["class"];

        return $auth;
    }

    /**
     * Get Logger class object
     *
     * @return Logger class object
     */
    protected function getResponseBuilderObject()
    {
        $config = $this->getConfigElement("responseBuilder");
        $auth   = new $config["class"];

        return $auth;
    }

    /**
     * Get configuration element by type
     *
     * @param $type
     * @return mixed
     */
    protected function getConfigElement($type)
    {
        $config = require ModuleConstants::getDevConfigDir() . DS . "api" . DS . "config.php";
        foreach ($config as $element)
        {
            if ($element["type"] == $type)
            {
                return $element;
            }
        }
    }
}