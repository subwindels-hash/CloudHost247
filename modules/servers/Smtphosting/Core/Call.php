<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;

use GuzzleHttp\Client;

/**
 * Description of Call
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
abstract class Call
{
    const TYPE_GET = "GET";

    const TYPE_POST = "POST";

    const TYPE_PUT = "PUT";

    const TYPE_DELETE = "DELETE";

    /**
     * Action path
     *
     * @var string
     */
    public $action;

    /**
     * Request type
     *
     * @var string
     */
    public $type;

    /**
     * Configuration
     *
     * @var Configuration
     */
    public $config;

    /**
     * params to send trough API
     *
     * @var mixed
     */
    public $params;

    /**
     * AbstractCall constructor
     *
     * @param Configuration $config
     * @param array $params
     */
    public function __construct(Configuration $config, array $params)
    {
        $this->config = $config;
        $this->params = $params;
    }

    /**
     * Make request to API
     *
     * @return array|bool|mixed|\stdClass|string
     */
    public function process()
    {
        try
        {
            $this->setVariablesInActionString();
            $url = "{$this->config->apiEndpoint}/{$this->action}";


            $jar    = new \GuzzleHttp\Cookie\SessionCookieJar('PHPSESSID', true);
            $client = new Client(['cookies' => $jar]);

            if ($this->isWhmcsVersionHigherOrEqual('8.0.0'))
            {
                if ($this->type === self::TYPE_GET)
                {
                    $request = $client->request($this->type, $url, ["headers" => $this->config->getAuthHeaders(), "query" => $this->params]);
                }
                else
                {
                    $request = $client->request($this->type, $url, ["headers" => $this->config->getAuthHeaders(), "form_params" => $this->params]);
                }
                $output = $request->getBody()->getContents();

            }
            else
            {
                $request = $client->createRequest($this->type, $url, ["headers" => $this->config->getAuthHeaders(), $this->getParamKeyName() => $this->params]);
                $output  = $client->send($request)->getBody()->getContents();
            }
        }
        catch (\GuzzleHttp\Exception\ClientException $ex)
        {
            $response = $ex->getResponse();
            $output   = $response->getBody()->getContents();
        }
        catch (\GuzzleHttp\Exception\ServerException $ex)
        {
            $response = $ex->getResponse();
            $output   = $response->getBody()->getContents();
        }
        catch (\Exception $ex)
        {
            $output = $ex->getMessage();
        }
        $result = json_decode($output, true);
        if ($result === null && is_string($output))
        {
            if(strpos($output, '<html>'))
            {
                $output = $this->extractErrorMessageFromHtmlOutput($output);
            }
            throw new \Exception($output);
        }
        if ($result['data']['status'] == 'error')
        {
            throw new \Exception($result['data']['data']['errorMessage']);
        }
        if (preg_match("/error/", $output) && is_null($result['error']) && strpos($output, '<br') === false && is_null($result['displaydata']))
        {
            throw new \Exception("Empty response from API");
        }
        if ($result['error'])
        {
            throw new \Exception($result['error']);
        }

        return $result;
    }

    /**
     * Put variables from params to action string if possible
     */
    protected function setVariablesInActionString(): void
    {
        //Check if params needs to be filled
        if (strpos($this->action, ":") !== false)
        {
            //Get params names
            $pos   = 0;
            $names = [];
            while (($pos = strpos($this->action, ":", $pos)) !== false)
            {
                $pos++;

                $slash   = strpos($this->action, "/", $pos);
                $names[] = substr($this->action, $pos, $slash - $pos);
            }

            foreach ($names as $name)
            {
                $this->action = str_replace(":{$name}", $this->params[$name], $this->action);
            }
        }
    }

    /**
     * Get correct param name depending on the request type
     *
     * @return string
     */
    protected function getParamKeyName(): string
    {
        $result = "query";
        if ($this->type == self::TYPE_POST)
        {
            $result = "body";
        }

        return $result;
    }

    private function isWhmcsVersionHigherOrEqual(string $toCompare): int
    {
        if (isset($GLOBALS['CONFIG']['Version']))
        {
            $version = explode('-', $GLOBALS['CONFIG']['Version']);
            return (version_compare($version[0], $toCompare, '>='));
        }

        global $whmcs;

        return (version_compare($whmcs->getVersion()->getRelease(), $toCompare, '>='));
    }

    protected function extractErrorMessageFromHtmlOutput($output)
    {
        if (preg_match("/<p?.*>(.*)<\/p>/", $output, $m))
        {
            return $m[1];
        }
        return $output;
    }
}