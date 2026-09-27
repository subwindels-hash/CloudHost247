<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Traits\RequestObjectHandler;

/**
 * Helper for caching data in database
 * stores json in the $modelClass
 *
 * @author inbs
 */
class DatabaseCache
{
    use RequestObjectHandler;

    /**
     * @var string
     */
    protected $modelClass = '\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ModuleSettings\Model';

    /**
     * @var misc
     * whatever you need to store
     */
    protected $data = null;

    /**
     * @var int
     * timestamp of the last update
     */
    protected $lastDataUpdate = null;

    /**
     * @var int
     * valid period for stored data, after this it will be autoupdated by callback
     * in secounds like a timestamp
     */
    protected $validPeriod = 300;

    /**
     * @var string
     * key for data store
     */
    protected $dataKey = null;

    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ModuleSettings\Model
     */
    protected $model = null;

    /**
     * @var callable
     * function returning data for the key
     */
    protected $callback = null;

    protected $assocJsonDecode = false;

    public function __construct($key, $callback, $timeout = 300, $assoc = false, $forceReload = false)
    {
        $this->model           = sl($this->modelClass);
        $this->dataKey         = $key;
        $this->validPeriod     = (int)$timeout;
        $this->callback        = $callback;
        $this->assocJsonDecode = $assoc;

        $this->initLoadProcess($forceReload);
    }

    /**
     * wrapper for loading data process
     * @param bool $forceReload
     */
    protected function initLoadProcess($forceReload = false)
    {
        if ($forceReload)
        {
            $this->updateRemoteData();

            return;
        }

        $this->loadDataFromDb();

        if (!$this->isDataValid())
        {
            $this->updateRemoteData();
        }
    }

    /**
     * loads remote data and updates to local storage
     */
    protected function updateRemoteData()
    {
        $data = $this->loadRemoteData();
        $time = \time();

        $this->updateDbCache($data, $time);

        $this->data           = $data;
        $this->lastDataUpdate = $time;
    }

    /**
     * updates data in database
     */
    protected function updateDbCache($data, $time)
    {
        $dbData = $this->model->where('setting', $this->dataKey)->first();
        if ($dbData)
        {
            $dbData->update(['value' => json_encode($data)]);
        }
        else
        {
            $this->model->create([
                'setting' => $this->dataKey,
                'value'   => json_encode($data)
            ]);
        }

        $dbDataTime = $this->model->where('setting', $this->dataKey . '_lastDataUpdate')->first();
        if ($dbDataTime)
        {
            $dbDataTime->update(['value' => $time]);
        }
        else
        {
            $this->model->create([
                'setting' => $this->dataKey . '_lastDataUpdate',
                'value'   => $time
            ]);
        }
    }

    /**
     * using callback function to load data from custom source
     */
    protected function loadRemoteData()
    {
        if (!is_callable($this->callback))
        {
            throw new Exception(ErrorCodesLib::CORE_CDB_000001, ['callback' => $this->callback]);
        }

        $data = call_user_func_array($this->callback, []);

        return $data;
    }

    /**
     * returns loaded data
     */
    public function getData()
    {
        return $this->data;
    }

    /**
     * static wrapper for creating instance and retriving data
     */
    public static function loadData($key, $callback, $timeout = 300, $assoc = false, $forceReload = false)
    {
        $loader = new DatabaseCache($key, $callback, $timeout, $assoc, $forceReload);

        return $loader->getData();
    }

    /**
     * loads data stored in DB
     */
    protected function loadDataFromDb()
    {
        $dbData = $this->model->where('setting', $this->dataKey)->first();

        if (!$dbData)
        {
            return false;
        }

        $this->data = json_decode($dbData->value, $this->assocJsonDecode);

        $lastUpdate = $this->model->where('setting', $this->dataKey . '_lastDataUpdate')->first();
        if ($lastUpdate)
        {
            $this->lastDataUpdate = (int)$lastUpdate->value;
        }
    }

    /**
     * Check if data is still befeore renewal time
     */
    protected function isDataValid()
    {
        if (!$this->data || !$this->lastDataUpdate)
        {
            return false;
        }

        if (time() > ($this->lastDataUpdate + $this->validPeriod))
        {
            return false;
        }

        return true;
    }
}
