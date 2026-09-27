<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ServiceLocator;

/**
 * Description of ErrorManager
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class ErrorManager
{
    const TYPE_ERROR   = "Error";
    const TYPE_WARNING = "Warning";

    protected static $lastToken = null;

    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error[]
     */
    protected static $errors = [];

    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Warning[]
     */
    protected static $warnings = [];

    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\WhmcsLogsHandler
     */
    protected static $whmcsLogger;


    /**
     * @var \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Interfaces\LoggerInterface
     */
    protected $logger;

    /**
     * @var bool
     */
    protected $withWarning = false;

    /**
     * @param Logger $logger
     */
    public function __construct(Logger $logger)
    {
        $this->logger = $logger;
    }

    /**
     * @param string $classname
     * @param string $message
     * @param array $trace
     */
    public function addError($classname = null, $message = '', $trace = [])
    {
        $error = $this->createNewModel(self::TYPE_ERROR, $classname, $message, $trace);
        $this->_addError($error)
            ->logger->addError($error->getFullMessage(), $error->getTrace());
        $this->getWhmcsLogger()->addModuleLog(
            [
                "type"    => "ERROR",
                "class"   => $error->getClass(),
                "message" => $error->getMessage(),
                "data"    => $error->getTrace()
            ]
        );

        return $this;
    }

    public static function getLastErrorToken()
    {
        return self::$lastToken;
    }

    public static function setLastErrorToken($token)
    {
        self::$lastToken = $token;

        return self;
    }

    /**
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error
     */
    public static function getFirstError()
    {
        return (count(self::$errors) > 0) ? self::$errors[0] : null;
    }

    /**
     * @param string $classname
     * @param string $message
     * @param array $trace
     */
    public function addWarning($classname = null, $message = '', $trace = [])
    {
        $warning = $this->createNewModel(self::TYPE_WARNING, $classname, $message, $trace);
        $this->_addWarning($warning)
            ->logger->addWarning($warning->getFullMessage(), $warning->getTrace());
        $this->getWhmcsLogger()->addModuleLog(
            [
                "type"    => "WARNING",
                "class"   => $warning->getClass(),
                "message" => $warning->getMessage(),
                "data"    => $warning->getTrace()
            ]
        );

        return $this;
    }

    /**
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error[]
     */
    public static function getErrors()
    {
        return self::$errors;
    }

    /**
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Warning[]
     */
    public static function getWarnings()
    {
        return self::$warnings;
    }

    public static function reset()
    {
        self::$warnings = [];
        self::$errors   = [];

        return self;
    }

    /**
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\WhmcsLogsHandler
     */
    public function getWhmcsLogger()
    {
        if (isset(self::$whmcsLogger) === false)
        {
            self::$whmcsLogger = ServiceLocator::call("whmcsLogger");
        }

        return self::$whmcsLogger;
    }

    /**
     * @return bool
     */
    public function hesError()
    {
        return (bool)(count(self::$errors) != 0);
    }

    /**
     * @return bool
     */
    public function hesWarning()
    {
        return (bool)(count(self::$warnings) != 0);
    }

    public function withWarnings()
    {
        $this->withWarning = true;

        return $this;
    }

    public function withoutWarnings()
    {
        $this->withWarning = false;

        return $this;
    }

    /**
     * @return string
     */
    public function __toString()
    {
        $string = '';
        if (count(self::getErrors()) != 0 || (count(self::getWarnings()) != 0) && $this->withWarning)
        {
            $string .= '<div class="list-group">';
            foreach (self::getErrors() as $error)
            {
                $string .= '<div class="alert alert-danger">';
                $string .= '<h4>Class: <strong>';
                $string .= $error->getClass();
                $string .= '<span class="pull-right">' . $error->getDate() . " " . $error->getTime() . '</span>';
                $string .= '</strong></h4>';
                $string .= '<p>' . $error->getMessage() . '</p>';
                $string .= '</div>';
            }
            if ($this->withWarning)
            {
                foreach (self::getWarnings() as $warning)
                {
                    $string .= '<div class="alert alert-warning">';
                    $string .= '<h4>Class: <strong>';
                    $string .= $warning->getClass();
                    $string .= '<span class="pull-right">' . $warning->getDate() . " " . $warning->getTime() . '</span>';
                    $string .= '</strong></h4>';
                    $string .= '<p>' . $warning->getMessage() . '</p>';
                    $string .= '</div>';
                }
            }

            $string .= '</div>';
            self::reset();
        }
        return $string;
    }

    private function createNewModel($type = self::TYPE_ERROR, $class = "", $massage = "", $trace = [])
    {
        return $this->{"createNewModel" . $type}($class, $massage, $trace);
    }

    /**
     * @param string $class
     * @param string $massage
     * @param array $trace
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error
     */
    private function createNewModelError($class = "", $massage = "", $trace = [])
    {
        return new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error($class, $massage, $trace);
    }

    /**
     * @param string $class
     * @param string $massage
     * @param array $trace
     * @return \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Warning
     */
    private function createNewModelWarning($class = "", $massage = "", $trace = [])
    {
        return new \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error($class, $massage, $trace);
    }

    protected function _addError(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Error $error)
    {
        array_push(self::$errors, $error);

        return $this;
    }

    protected function _addWarning(\ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model\Warning $warning)
    {
        array_push(self::$warnings, $warning);

        return $this;
    }
}
