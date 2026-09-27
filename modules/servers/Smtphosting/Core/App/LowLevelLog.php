<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\App;

class LowLevelLog
{
    protected $logType = null;
    protected $logToken = null;
    protected $logTime = null;
    protected $moduleName = null;

    public function __construct($logType, $logToken, $logTime)
    {
        $this->logType  = $logType;
        $this->logToken = $logToken;
        $this->logTime  = $logTime;
    }

    public function makeLogs($logDetails)
    {
        if ($this->logType === 'error')
        {
            $this->logToDb($logDetails);
        }

        $this->logToFile($logDetails);

        if ($this->logType === 'error')
        {
            $this->logToPHPLog($logDetails);
        }
    }

    public function logToDb($logDetails = [])
    {
        \logModuleCall(
            $this->getModuleName() . ' Error',
            'Token: ' . $this->logToken,
            ['time' => $this->logTime],
            var_export($logDetails, true)
        );
    }

    public function logToFile($logDetails)
    {
        $logData = date('d.m.Y H:i:s', time()) . ' - Token: ' . $this->logToken . ' - ' . var_export($logDetails, true) . PHP_EOL;
        $logFile = $this->getLogFile($this->logType);

        file_put_contents($logFile, $logData, FILE_APPEND);
    }

    public function logToPHPLog($logDetails)
    {

    }

    public function getLogFile($logType = 'error')
    {
        $logDir  = dirname(dirname(__DIR__)) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'logs';
        $logFile = $logDir . DIRECTORY_SEPARATOR . $logType . '.log';
        if (!file_exists($logFile) && !is_writable($logDir))
        {
            //throw new \Exception('Insufficient permissions for directory: ' . $logDir);
        }
        if (file_exists($logFile) && !is_writable($logFile))
        {
            //throw new \Exception('Insufficient permissions for file: ' . $logFile);
        }

        return $logFile;
    }

    public function getModuleName()
    {
        if (!$this->moduleName)
        {
            $className = trim(self::class, '\\');
            if (strpos($className, 'ModulesGarden') === 0)
            {
                $pt1 = str_replace('ModulesGarden\\', '', $className);
                if (strpos($pt1, '\Core\App'))
                {
                    $this->moduleName = substr($pt1, 0, strpos($pt1, '\Core\App'));
                }
            }
        }

        return $this->moduleName;
    }
}
