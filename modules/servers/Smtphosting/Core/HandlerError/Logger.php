<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError;

use \Monolog\Formatter\LineFormatter;
use \Monolog\Handler\StreamHandler;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Interfaces\LoggerInterface;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;

/**
 * Description of Logger
 *
 * @author Rafal Ossowski <rafal.os@modulesgarden.com>
 */
class Logger implements LoggerInterface
{
    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Logger
     */
    protected static $instance;

    protected $name;
    /**
     * @var \Monolog\Logger
     */
    protected $logger;
    protected $mainPath = null;
    protected $handlers = [];

    /**
     * @param string $name
     * @param string $debugName
     * @param string $warningName
     * @param string $errorName
     */
    protected function __construct(
        $name = '', $debugName = '', $warningName = '', $errorName = ''
    )
    {
//        $this->name     = $name;
//        $this->mainPath = ModuleConstants::getModuleRootDir() . DS . 'storage' . DS . 'logs' . DS;
//        if (is_dir($this->mainPath) === false)
//        {
//            mkdir($this->mainPath);
//        }
//        $this->logger   = new \Monolog\Logger($this->name);
//        
//        foreach ([
//            $this->mainPath . $debugName   => \Monolog\Logger::DEBUG,
//            $this->mainPath . $warningName => \Monolog\Logger::WARNING,
//            $this->mainPath . $errorName   => \Monolog\Logger::ERROR
//        ] as $path => $status)
//        {
//            if (file_exists($path) === false)
//            {
//                $myfile = fopen($path, "w");
//                fclose($myfile);
//                File::setPermission($path);
//            }
//            $this->handlers[] = $this->buildHandlar($path, $status);
//        }
//
//        $this->addHandlerToLogger();
    }

    private function __clone()
    {

    }

    public function isLoggerExist()
    {
        return isset($this->logger);
    }

    public function createLogger()
    {
        $this->logger = new \Monolog\Logger($this->name);
        //$this->addHandlerToLogger();
        return $this;
    }

    /**
     * @param string $name
     * @param array $arguments
     * @return mixed
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception
     */
    public function __call($name, $arguments)
    {
        if (method_exists($this->logger, $name))
        {
            return $this->logger->{$name}(
                (isset($arguments[0]) ? $arguments[0] : ''), (isset($arguments[1]) ? $arguments[1] : [])
            );
        }

        throw new Exception(ErrorCodesLib::CORE_LOG_000001, ['functionName' => $name]);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function debug($message, array $context = [])
    {
        //return $this->logger->debug($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function error($message, array $context = [])
    {
        //return $this->logger->error($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function warning($message, array $context = [])
    {
        //return $this->logger->warning($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function err($message, array $context = [])
    {
        //return $this->logger->err($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function warn($message, array $context = [])
    {
        //return $this->logger->warn($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addDebug($message, array $context = [])
    {
        //return $this->logger->addDebug($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addWarning($message, array $context = [])
    {
        //return $this->logger->addWarning($message, $context);
    }

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addError($message, array $context = [])
    {
        //return $this->logger->addError($message, $context);
    }

    private function addHandlerToLogger()
    {
        $formatter = $this->getFormatter();

        foreach ($this->handlers as $handler)
        {
            $handler->setFormatter($formatter);
            $this->logger->pushHandler($handler);
        }
    }

    private function buildHandlar($path, $type)
    {
        return new StreamHandler($path, $type);
    }

    /**
     * @return LineFormatter
     */
    private function getFormatter()
    {
        return new LineFormatter(null, null, false, true);
    }

    /**
     * @param string $name
     * @param string $debugName
     * @param string $warningName
     * @param string $errorName
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Logger
     */
    protected static function create(
        $name = 'default', $debugName = 'debug.log', $warningName = 'warning.log', $errorName = 'error.log'
    )
    {
        return new static($name, $debugName, $warningName, $errorName);
    }

    /**
     * @param string $name
     * @param string $debugName
     * @param string $warningName
     * @param string $errorName
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Logger
     */
    public static function get(
        $name = 'default', $debugName = 'debug.log', $warningName = 'warning.log', $errorName = 'error.log'
    )
    {
        if (!isset(self::$instance))
        {
            self::$instance = self::create($name, $debugName, $warningName, $errorName);
        }

        if (self::$instance->isLoggerExist())
        {
            self::$instance->createLogger();
        }

        return self::$instance;
    }
}
