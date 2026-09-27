<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api\AbstractApi\Curl;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Api\AbstractApi\Curl;

/**
 * Description of Request
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
class Request extends Curl
{
    protected $url = '';

    protected $lastResponse = [];

    protected $headers = [
        "Content-Type: application/x-www-form-urlencoded"
    ];

    public function getLastResponse()
    {
        return $this->lastResponse;
    }

    public function setUrl($url = "")
    {
        $this->url = $url;

        return $this;
    }

    public function resetHeaders()
    {
        $this->headers = [];

        return $this;
    }

    public function setHeaders(array $headers = [])
    {
        $this->headers = $headers;

        return $this;
    }

    public function addHeaders($headers)
    {
        if (is_array($headers))
        {
            $this->headers = $headers;
        }
        else
        {
            $this->headers[] = $headers;
        }

        return $this;
    }

    protected function send()
    {
        $return = parent::send();
        $this->close();
        $this->lastResponse[] = $return;

        return $return;
    }

    /**
     * @param array $data
     * @return string
     */
    protected function httpBuildQuery(array $data = [])
    {
        return empty($data) ? "" : http_build_query($data);
    }

    /**
     * @param array $data post field
     * @return Response
     */
    public function post($data = [])
    {

        $postvars = is_array($data) ? $this->httpBuildQuery($data) : $data;

        $this->open()
            ->setOptions(CURLOPT_SSL_VERIFYPEER, false)
            ->setOptions(CURLOPT_URL, $this->url)
            ->setOptions(CURLOPT_POSTFIELDS, $postvars)
            ->setOptions(CURLOPT_POST, true);

        if (!empty($this->headers))
        {
            $this->setOptions(CURLOPT_HTTPHEADER, $this->headers)
                ->setOptions(CURLOPT_HEADER, true);
        }

        return $this->send();
    }

    /**
     * @param array $data post field
     * @return Response
     */
    public function put($data = [])
    {

        $postvars = is_array($data) ? $this->httpBuildQuery($data) : $data;

        $this->open()
            ->setOptions(CURLOPT_SSL_VERIFYPEER, false)
            ->setOptions(CURLOPT_URL, $this->url)
            ->setOptions(CURLOPT_POSTFIELDS, $postvars)
            ->setOptions(CURLOPT_CUSTOMREQUEST, "PUT");

        if (!empty($this->headers))
        {
            $this->setOptions(CURLOPT_HTTPHEADER, $this->headers)
                ->setOptions(CURLOPT_HEADER, true);
        }

        return $this->send();
    }

    /**
     * @param array $data post field
     * @return Response
     */
    public function delete($data = [])
    {

        $deletevars = is_array($data) ? $this->httpBuildQuery($data) : $data;

        $this->open()
            ->setOptions(CURLOPT_SSL_VERIFYPEER, false)
            ->setOptions(CURLOPT_URL, $this->url . $deletevars)
            ->setOptions(CURLOPT_CUSTOMREQUEST, "DELETE");

        if (!empty($this->headers))
        {
            $this->setOptions(CURLOPT_HTTPHEADER, $this->headers)
                ->setOptions(CURLOPT_HEADER, true);
        }

        return $this->send();

    }

    /**
     * @param array $data post field
     * @return Response
     */
    public function get($data = [])
    {
        $getvars = is_array($data) ? $this->httpBuildQuery($data) : $data;

        $this->open()
            ->setOptions(CURLOPT_URL, $this->url . $getvars);

        if (!empty($this->headers))
        {
            $this->setOptions(CURLOPT_HTTPHEADER, $this->headers)
                ->setOptions(CURLOPT_HEADER, true);
        }

        return $this->send();
    }

    /**
     * @param array $data post field
     * @return Response
     */
    public function options($data = [])
    {
        $deletevars = is_array($data) ? $this->httpBuildQuery($data) : $data;

        $this->open()
            ->setOptions(CURLOPT_SSL_VERIFYPEER, false)
            ->setOptions(CURLOPT_URL, $this->url)
            ->setOptions(CURLOPT_CUSTOMREQUEST, "OPTIONS");

        if (!empty($this->headers))
        {
            $this->setOptions(CURLOPT_HTTPHEADER, $this->headers)
                ->setOptions(CURLOPT_HEADER, true);
        }

        return $this->send();
    }
}
