<?php
namespace CloudHost247\Ovh\Api;use InvalidArgumentException;
final class Endpoint
{
 private static $regions=array('eu'=>'https://eu.api.ovh.com/1.0','ca'=>'https://ca.api.ovh.com/1.0','us'=>'https://api.us.ovhcloud.com/1.0');
 public static function forRegion($r){$r=strtolower($r);if(!isset(self::$regions[$r]))throw new InvalidArgumentException('Unsupported OVH API region.');return self::$regions[$r];}
 public static function path($path){if(!is_string($path)||$path===''||$path[0]!=='/'||strpos($path,'..')!==false||preg_match('/[\r\n]/',$path))throw new InvalidArgumentException('Unsafe OVH API path.');return $path;}
}
