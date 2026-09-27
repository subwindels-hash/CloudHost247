<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api\AbstractApi;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api\AbstractApi\Curl\Response;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\DependencyInjection;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception;
use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes\ErrorCodesLib;

/**
 * Description of Curl
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
abstract class Curl
{
    private $curl;
    private $options = [
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_HEADER         => false,
        CURLOPT_RETURNTRANSFER => true,
        CURLINFO_HEADER_OUT    => true
    ];
    protected $curlParser;

    public function setCurlParser($curlParser)
    {
        $this->curlParser = $curlParser;

        return $this;
    }

    public function setOptions($options, $value)
    {
        $this->options[$options] = $value;
        return $this;
    }

    protected function open()
    {
        $this->curl = curl_init();

        return $this;
    }

    protected function close()
    {
        curl_close($this->curl);

        return $this;
    }

    protected function unsetOptions($options)
    {
        if (is_array($options))
        {
            foreach ($options as $option)
            {
                if (isset($this->options[$option]))
                {
                    unset($this->options[$option]);
                }
            }
        }
        else
        {
            unset($this->options[$options]);
        }

        return $this;
    }

    /**
     * @return Response
     * @throws \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\Exceptions\Exception
     */
    protected function send()
    {
        $this->includeOptions();

        if (($head = $this->execute()) === false)
        {
            throw new Exception(ErrorCodesLib::CORE_CURL_000001, ['lastCurlError' => $this->getLastErrorWithCurl()]);
        }

        if ($errno = $this->getLastErrorNumber())
        {
            throw new Exception(ErrorCodesLib::CORE_CURL_000002, ['curlError' => $this->getLastError($errno)]);
        }

        [$header, $body] = $this->curlParser->rebuild($head, $this->getHeaderSize());

        return DependencyInjection::create(Response::class)
            ->setRequest($this->getHeaderOut())
            ->setHeader($header)
            ->setCode($this->getHttpCode())
            ->setBody($body);
    }

    private function execute()
    {
        return curl_exec($this->curl);
    }

    private function getLastErrorNumber()
    {
        return curl_errno($this->curl);
    }

    /**
     * (PHP 5 &gt;= 5.5.0, PHP 7)<br/>
     * Return string describing the given error code
     * @link http://php.net/manual/en/function.curl-strerror.php
     * @param int $errornum <p>
     * One of the cURL error codes constants.
     * </p>
     * @return string error description or <b>NULL</b> for invalid error code.
     */
    private function getLastError($errmo)
    {
        return curl_strerror($errmo);
    }

    /**
     * (PHP 4 &gt;= 4.0.3, PHP 5, PHP 7)<br/>
     * Return a string containing the last error for the current session
     * @link http://php.net/manual/en/function.curl-error.php
     * @param resource $ch
     * @return string the error message or '' (the empty string) if no
     * error occurred.
     */
    private function getLastErrorWithCurl()
    {
        return curl_error($this->curl);
    }

    private function getHeaderSize()
    {
        return curl_getinfo($this->curl, CURLINFO_HEADER_SIZE);
    }

    private function getHeaderOut()
    {
        return curl_getinfo($this->curl, CURLINFO_HEADER_OUT);
    }

    private function getHttpCode()
    {
        return curl_getinfo($this->curl, CURLINFO_HTTP_CODE);
    }

    private function includeOptions()
    {
        curl_setopt_array($this->curl, $this->options);

        return $this;
    }
}
