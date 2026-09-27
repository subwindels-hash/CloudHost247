<?php
namespace CloudHost247\Ovh\Api;use InvalidArgumentException;
final class Credentials
{
 private $appKey,$appSecret,$consumerKey;public function __construct($a,$s,$c){foreach(array($a,$s,$c)as$v)if(!is_string($v)||strlen(trim($v))<8)throw new InvalidArgumentException('OVH API credentials are incomplete.');$this->appKey=trim($a);$this->appSecret=trim($s);$this->consumerKey=trim($c);}public function applicationKey(){return$this->appKey;}public function consumerKey(){return$this->consumerKey;}public function signature($method,$url,$body,$timestamp){return'$1$'.sha1($this->appSecret.'+'.$this->consumerKey.'+'.strtoupper($method).'+'.$url.'+'.$body.'+'.(int)$timestamp);}
}
