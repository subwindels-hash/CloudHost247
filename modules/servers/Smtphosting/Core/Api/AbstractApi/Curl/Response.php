<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api\AbstractApi\Curl;

/**
 * Description of Respons
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Response
{
    protected $body;
    protected $request;
    protected $header;
    protected $code;

    public function setRequest($request)
    {
        $this->request = $request;

        return $this;
    }

    public function setHeader($header)
    {
        $this->header = $header;

        return $this;
    }

    public function setBody($body)
    {
        $this->body = $body;

        return $this;
    }

    public function setCode($code)
    {
        $this->code = $code;

        return $this;
    }

    /**
     * @param bool $isJson
     * @return string|\stdClass
     */
    public function getBody($isJson = true)
    {


        if ($isJson)
        {
            return json_decode($this->body);
        }

        return $this->body;
    }

    /**
     * @return string
     */
    public function getRequest()
    {
        return $this->request;
    }

    /**
     * @return string
     */
    public function getHeader()
    {
        return $this->header;
    }

    /**
     * @return int
     */
    public function getCode()
    {
        return $this->code;
    }

    /**
     * @return bool
     */
    public function isSuccess()
    {
        return (bool)($this->code >= 200 && $this->code < 300);
    }
}
