<?php
namespace CloudHost247\Currency\Providers;
use CloudHost247\Currency\Support\HttpClient; use InvalidArgumentException;
final class ProviderFactory { public static function make($key,HttpClient $http){if($key==='frankfurter')return new FrankfurterProvider($http);if($key==='ecb')return new EcbProvider($http);throw new InvalidArgumentException('Unsupported provider.');} }
