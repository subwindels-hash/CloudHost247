<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Model;

/**
 * Description of AbstractModel
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
abstract class AbstractModel
{
    /**
     * @var string
     */
    protected $class;

    /**
     * @var string
     */
    protected $message;

    /**
     * @var array
     */
    protected $trace;

    /**
     * @var string
     */
    protected $date;

    /**
     * @var string
     */
    protected $time;

    /**
     * @param string $class
     * @param string $massage
     * @param array $trace
     */
    public function __construct($class = "", $massage = "", $trace = [])
    {
        $this->date = date('Y-m-d');
        $this->time = date('H:i:s');

        $this->setClass($class)->setMessage($massage)->setTrace($trace);
    }

    public function getClass()
    {
        return $this->class;
    }

    public function setClass($class = "")
    {
        $this->class = $class;

        return $this;
    }

    public function getMessage()
    {
        return $this->message;
    }

    public function setMessage($message = "")
    {
        $this->message = $message;

        return $this;
    }

    public function getTrace()
    {
        return $this->trace;
    }

    public function setTrace($trace = [])
    {
        $this->trace = $trace;

        return $this;
    }

    public function getDate()
    {
        return $this->date;
    }

    public function setDate($date = '')
    {
        $this->date = $date;

        return $this;
    }

    public function getTime()
    {
        return $this->time;
    }

    public function setTime($time = "")
    {
        $this->time = $time;

        return $this;
    }

    public function getFullMessage()
    {
        return "[ " . $this->getClass() . " ]( {$this->getDate()} {$this->getMessage()} ) :\n{$this->getMessage()}";
    }
}
