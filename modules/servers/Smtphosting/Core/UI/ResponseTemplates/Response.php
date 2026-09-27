<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\ResponseTemplates;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 *  Abstract Ajax Response Model
 */
abstract class Response
{
    const STATUS_SUCCESS = 'success';
    const STATUS_ERROR   = 'error';
    protected $status = self::STATUS_SUCCESS;
    protected $data = [];
    protected $message = null;
    protected $dataType = 'data';
    protected $callBackFunction = null;
    protected $refreshTargetId = [];
    protected $customParams = [];

    protected $lang = null;

    public function __construct($data = [])
    {
        $this->data = $data;
    }

    public function setStatusSuccess()
    {
        $this->status = self::STATUS_SUCCESS;

        return $this;
    }

    public function setRefreshTargetIds(array $targetIds = [])
    {
        $this->refreshTargetId = $targetIds;

        return $this;
    }

    public function addRefreshTargetId($targetId)
    {

        if (in_array($targetId, $this->refreshTargetId, true) === false)
        {
            $this->refreshTargetId[] = $targetId;
        }

        return $this;
    }

    public function setStatusError()
    {
        $this->status = self::STATUS_ERROR;

        return $this;
    }

    public function setData($data)
    {
        $this->data = $data;

        return $this;
    }

    public function addData($key, $data)
    {
        $this->data[$key] = $data;

        return $this;
    }

    public function setCallBackFunction($name)
    {
        $this->callBackFunction = $name;

        return $this;
    }

    public function disableCallBackFunction()
    {
        $this->callBackFunction = null;

        return $this;
    }

    public function getData()
    {
        $return = [
            'status'        => $this->status,
            'message'       => $this->message,
            $this->dataType => $this->data,
            'refreshIds'    => $this->refreshTargetId,
            'customParams'  => $this->customParams
        ];
        if ($this->callBackFunction)
        {
            $return['callBackFunction'] = $this->callBackFunction;
        }

        return $return;
    }

    public function getFormatedResponse()
    {
        return Helper\json($this->getData())->setStatusCode(200);
    }

    public function setMessage($message)
    {
        $this->message = $message;

        return $this;
    }

    protected function loadLang()
    {
        if ($this->lang === null)
        {
            $this->lang = ServiceLocator::call('lang');
        }
    }

    public function setMessageAndTranslate($message)
    {
        $this->loadLang();

        $this->message = $this->lang->absoluteT($message);

        return $this;
    }

    public function setCustomParam($key, $value)
    {
        $this->customParams[$key] = $value;

        return $this;
    }
}
