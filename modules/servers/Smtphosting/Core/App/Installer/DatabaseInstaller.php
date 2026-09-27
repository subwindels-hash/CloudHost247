<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App\Installer;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\FileReader\Reader;
use Illuminate\Database\Capsule\Manager;

class DatabaseInstaller
{
    const STATUS         = 'status';
    const STATUS_SUCCESS = 'success';
    const STATUS_ERROR   = 'error';
    const RAW_QUERY      = 'rawQuery';
    const ERROR_MESSAGE  = 'errorMessage';
    const FILE           = 'file';

    protected $queryResults = [];

    public function performQueryFromFile($file = '')
    {
        $queries = $this->getQueries($file);

        array_map(function ($query) use ($file) {
            $this->execute($query, $file);
        }, $queries);
    }

    protected function execute(&$query, $file)
    {
        try
        {
            $pdo = Manager::connection()->getPdo();
            if (empty($query) === false)
            {
                $statement = $pdo->prepare($query);
                $statement->execute();
            }
        }
        catch (\PDOException $exc)
        {
            $this->queryResults[] = [
                self::STATUS        => self::STATUS_ERROR,
                self::ERROR_MESSAGE => $exc->getMessage(),
                self::FILE          => $file,
                self::RAW_QUERY     => str_replace(PHP_EOL, '<br>', $query)
            ];

            return null;
        }

        $this->queryResults[] = [
            self::STATUS    => self::STATUS_SUCCESS,
            self::FILE      => $file,
            self::RAW_QUERY => $query
        ];
    }

    protected function getQueries($file)
    {
        return array_filter(explode(';', Reader::read($file)->get()), function ($element) {
            $tElement = trim($element);
            if ($element === '' || $tElement === '')
            {
                return false;
            }

            return true;
        });
    }

    public function isInstallCorrect()
    {
        foreach ($this->queryResults as $result)
        {
            if ($result[self::STATUS] === self::STATUS_ERROR)
            {
                return false;
            }
        }

        return true;
    }

    public function getFailedQueries()
    {
        $failedList = [];

        foreach ($this->queryResults as $result)
        {
            if ($result[self::STATUS] === self::STATUS_ERROR)
            {
                $failedList[] = $result;
            }
        }

        return $failedList;
    }

    public function getQueriesResults()
    {
        return $this->queryResults;
    }
}
