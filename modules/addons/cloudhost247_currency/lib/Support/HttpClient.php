<?php
namespace CloudHost247\Currency\Support;
use RuntimeException;
class HttpClient
{
    public function get($url, array $headers = array(), $timeout = 15)
    {
        if (!extension_loaded('curl')) throw new RuntimeException('cURL is required.');
        $ch = curl_init($url); curl_setopt_array($ch, array(CURLOPT_RETURNTRANSFER=>true,CURLOPT_FOLLOWLOCATION=>false,CURLOPT_CONNECTTIMEOUT=>5,CURLOPT_TIMEOUT=>(int)$timeout,CURLOPT_HTTPHEADER=>$headers,CURLOPT_SSL_VERIFYPEER=>true,CURLOPT_SSL_VERIFYHOST=>2,CURLOPT_USERAGENT=>'CloudHost247-Currency/1.0'));
        $body = curl_exec($ch); $error = curl_error($ch); $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE); curl_close($ch);
        if ($body === false || $error) throw new RuntimeException('Provider network error: ' . $error);
        if ($status < 200 || $status >= 300) throw new RuntimeException('Provider returned HTTP ' . $status);
        if (strlen($body) > 5000000) throw new RuntimeException('Provider response exceeds safety limit.');
        return $body;
    }
}
