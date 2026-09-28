<?php
namespace CloudHost247\Currency\Providers;
use CloudHost247\Currency\Contracts\RateProvider; use CloudHost247\Currency\Support\EndpointResolver; use CloudHost247\Currency\Support\HttpClient; use RuntimeException;
require_once __DIR__.'/../Support/EndpointResolver.php';
final class EcbProvider implements RateProvider
{
 private $http; public function __construct(HttpClient $http){$this->http=$http;} public function key(){return 'ecb';}
 public function fetch($base,array $symbols){$xml=$this->http->get(EndpointResolver::baseUrl('ecb','https://www.ecb.europa.eu').'/stats/eurofxref/eurofxref-daily.xml');if(!preg_match_all('/currency=["\']([A-Z]{3})["\']\s+rate=["\']([0-9.]+)["\']/',$xml,$m,PREG_SET_ORDER))throw new RuntimeException('ECB returned an invalid response.');$eur=array('EUR'=>1.0);foreach($m as $r)$eur[$r[1]]=(float)$r[2];$base=strtoupper($base);if(empty($eur[$base]))throw new RuntimeException('ECB does not provide base '.$base);$out=array($base=>1.0);foreach(array_unique(array_map('strtoupper',$symbols)) as $code){if(empty($eur[$code]))throw new RuntimeException('ECB does not provide '.$code);$out[$code]=$eur[$code]/$eur[$base];}return $out;}
}
