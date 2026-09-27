<?php

class getData
{
    public $baseUrl = "https://www.googleapis.com/oauth2/v1/userinfo?alt=json";
    public $apiKey, $endPoint, $action;
    public $method = "GET";
    public $data = [];
    public $header = [];
    public $last_request = [];


    private function __curlCall()
    {
        $this->curl = curl_init();

        switch ($this->method) {
            case 'POST':
                curl_setopt($this->curl, CURLOPT_POST, 1);
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (count($this->data) > 0 ? json_encode($this->data) : ""));
                break;

            case 'PUT':
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'PUT');
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (count($this->data) > 0 ? json_encode($this->data) : ""));
                break;

            case 'DELETE':
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'DELETE');
                curl_setopt($this->curl, CURLOPT_POSTFIELDS, (count($this->data) > 0 ? json_encode($this->data) : ""));
                break;

            default:
                curl_setopt($this->curl, CURLOPT_CUSTOMREQUEST, 'GET');
        }

        curl_setopt($this->curl, CURLOPT_URL, $this->baseUrl . $this->endPoint);

        curl_setopt($this->curl, CURLOPT_RETURNTRANSFER, true);

        curl_setopt($this->curl, CURLOPT_CONNECTTIMEOUT, 0);

        curl_setopt($this->curl, CURLOPT_MAXREDIRS, 10);

        curl_setopt($this->curl, CURLOPT_CONNECTTIMEOUT, 0);

        curl_setopt($this->curl, CURLOPT_TIMEOUT, 10); //timeout in seconds

        curl_setopt($this->curl, CURLOPT_FOLLOWLOCATION, 1);

        curl_setopt($this->curl, CURLOPT_HTTPHEADER, $this->header);

        $response = curl_exec($this->curl);

        $httpCode = curl_getinfo($this->curl, CURLINFO_HTTP_CODE);

        if (curl_errno($this->curl)) {
            throw new \Exception(curl_error($this->curl));
        }
        return ['httpcode' => $httpCode, 'result' => json_decode($response)];
    }
	
    /*To get types */
    public function getUserData($token)
    {
        $this->endPoint = "&access_token={$token}";
        $this->action = "Getting user data";
        $response =  $this->__curlCall();
        return $response;
    }
}
