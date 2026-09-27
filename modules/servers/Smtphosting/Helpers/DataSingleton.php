<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers;


class DataSingleton
{
    private static $instance;

    //step2
    protected $approvalMethods;
    protected $approvalEmails;
    protected $errorMessage;
    protected $brand;

    protected function __construct()
    {
    }

    protected function __clone()
    {
    }

    public static function getInstance(): DataSingleton
    {
        if (!isset(self::$instance))
        {
            self::$instance = new static();
        }
        return self::$instance;
    }

    /**
     * @param mixed $approvalMethods
     */
    public function setApprovalMethods($approvalMethods): void
    {
        $this->approvalMethods = $approvalMethods;
    }

    /**
     * @param mixed $approvalEmails
     */
    public function setApprovalEmails($approvalEmails): void
    {
        $this->approvalEmails = $approvalEmails;
    }

    /**
     * @param mixed $errorMessage
     */
    public function setErrorMessage($errorMessage): void
    {
        $this->errorMessage = $errorMessage;
    }

    /**
     * @return mixed
     */
    public function getApprovalMethods()
    {
        return $this->approvalMethods;
    }

    /**
     * @return mixed
     */
    public function getApprovalEmails()
    {
        return $this->approvalEmails;
    }

    /**
     * @return mixed
     */
    public function getErrorMessage()
    {
        return $this->errorMessage;
    }

    /**
     * @return mixed
     */
    public function getBrand()
    {
        return $this->brand;
    }

    /**
     * @param mixed $brand
     */
    public function setBrand($brand)
    {
        $this->brand = $brand;
    }
}