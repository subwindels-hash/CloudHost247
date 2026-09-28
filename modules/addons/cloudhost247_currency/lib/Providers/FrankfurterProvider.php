<?php
namespace CloudHost247\Currency\Providers;
use CloudHost247\Currency\Contracts\RateProvider; use CloudHost247\Currency\Support\HttpClient; use RuntimeException;
final class FrankfurterProvider implements RateProvider
{
    private $http; public function __construct(HttpClient $http){$this->http=$http;} public function key(){return 'frankfurter';}
    public function fetch($base,array $symbols){$base=strtoupper($base);$symbols=array_values(array_diff(array_unique(array_map('strtoupper',$symbols)),array($base)));$url='https://api.frankfurter.app/latest?from='.rawurlencode($base).'&to='.rawurlencode(implode(',',$symbols));$data=json_decode($this->http->get($url),true);if(!is_array($data)||empty($data['rates'])||!is_array($data['rates']))throw new RuntimeException('Frankfurter returned an invalid response.');$rates=array($base=>1.0);foreach($symbols as $code){if(!isset($data['rates'][$code])||!is_numeric($data['rates'][$code])||(float)$data['rates'][$code]<=0)throw new RuntimeException('Missing or invalid rate for '.$code);$rates[$code]=(float)$data['rates'][$code];}return $rates;}
}
