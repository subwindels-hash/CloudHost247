<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Controllers\Instances\Addon\Config;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Http\Request;

/**
 * Handles adding new records to WHMCS Module and Activity Logs
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class WhmcsLogsHandler
{
    /**
     * @var Config
     */
    private $addon;

    /**
     * @var Request
     */
    private $request;

    /**
     * @param Addon $addon
     * @param Request $request
     */
    public function __construct(Config $addon, Request $request)
    {
        $this->addon   = $addon;
        $this->request = $request;
    }

    /**
     * @param mixed $responseData
     * @param array $replaceVars
     * @return $this
     */
    public function addModuleLog($responseData = [], array $replaceVars = [])
    {
        if ($this->isDebugin())
        {
            if (is_array($responseData) === false)
            {
                if (is_object($responseData))
                {
                    $responseData = print_r($responseData, true);
                }
            }

            logModuleCall(
                $this->getModuleName(),
                $this->getFullAction(),
                $this->getRequestData(),
                $responseData,
                print_r($responseData, true),
                $replaceVars
            );
        }

        return $this;
    }

    /**
     * @param mixed $message
     * @param int $userId
     * @return $this
     */
    public function addActiveLog($message, $userId = 0)
    {
        if ($this->isDebugin())
        {
            if (is_string($message) === false)
            {
                $message = print_r($message, true);
            }

            logActivity($message, $userId);
        }
        return $this;
    }

    /**
     * @return array
     */
    private function getRequestData()
    {
        return array_merge($this->request->request->all(), $this->request->query->all());
    }

    /**
     * @return string
     */
    private function getModuleName()
    {
        return $this->addon->getConfigValue("name", 'Smtphosting');
    }

    /**
     * @return bool
     */
    private function isDebugin()
    {
        return (bool)((int)$this->addon->getConfigValue("debug", "0"));
    }

    /**
     * @return string
     */
    private function getFullAction()
    {
        return $this->request->get('mg-page', 'Home') . $this->request->get('mg-action', 'Index');
    }

    public function addModuleLogError(Exceptions\Exception $exception, array $replaceVars = [])
    {
        $responseData = $exception->getOriginalException();
        if (!$exception->isLogable())
        {
            return;
        }

        if (is_object($responseData))
        {
            $responseData = print_r([
                'message' => $responseData->getMessage(),
                'code'    => $responseData->getCode(),
                'file'    => $responseData->getFile(),
                'line'    => $responseData->getLine(),
                'trace'   => $responseData->getTraceAsString(),
                //'previous' => $responseData->getPrevious()
            ], true);
        }

        if (!$responseData)
        {
            $responseData = [
                'message' => $exception->getMgMessage(false),
                'trace'   => $exception->getTraceAsString()
            ];
        }

        logModuleCall(
            $this->getModuleName(),
            $this->getFullAction(),
            [
                'deteils' => $exception->getDetailsToLog(),
                'request' => $this->getRequestData()
            ],
            $responseData,
            print_r($responseData, true),
            $replaceVars
        );


        return $this;
    }
}
