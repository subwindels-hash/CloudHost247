<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Admins;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;

class Whmcs
{
    /**
     * @var Admins
     */
    protected $admins;

    /**
     * @var string
     */
    protected $username;

    /**
     * @param Admins $admins
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception
     */
    public function __construct(Admins $admins)
    {
        $this->admins = $admins;
        $this->getAdminUserName();

        if (function_exists('localAPI') === false)
        {
            throw new Exception(ErrorCodesLib::CORE_WAPI_000001);
        }
    }

    /**
     * @return string
     */
    protected function getAdminUserName()
    {
        if (isset($this->username) === false)
        {
            $this->username = $this->admins->first()->toArray()['username'];
        }

        return $this->username;
    }

    public function call($command, $config = [])
    {

        $result = localAPI($command, $config, $this->getAdminUserName());

        if ($result['result'] == 'error')
        {
            $exc = new Exception(ErrorCodesLib::CORE_WAPI_000002, ['command' => $command, 'data' => $config, 'result' => $result]);
            $exc->setCustomMessage($result['message']);

            throw $exc;
        }
        unset($result['result']);

        return $result;
    }

    public function getAdminDetails($adminId)
    {
        $data = $this->admins->where("id", "LIKE", $adminId)->first();

        if ($data === null)
        {
            throw new Exception(ErrorCodesLib::CORE_WAPI_000003, ['adminId' => $adminId], ['adminId' => $adminId]);
        }

        $result = localAPI("getadmindetails", [], $data->toArray()['username']);

        if ($result['result'] == 'error')
        {
            $exc = new Exception(ErrorCodesLib::CORE_WAPI_000004, ['command' => "getadmindetails", 'data' => [], 'result' => $result]);
            $exc->setCustomMessage($result['message']);

            throw $exc;
        }

        $result['allowedpermissions'] = explode(",", $result['allowedpermissions']);
        unset($result['result']);

        return $result;
    }
}
