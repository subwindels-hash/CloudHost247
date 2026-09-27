<?php
namespace CloudHost247\Ovh\Pricing;use InvalidArgumentException;
final class PriceCalculator
{public function calculate($sourcePrice,$sourceRate,$targetRate,$margin,$precision=2,$rounding='nearest'){foreach(array($sourcePrice,$sourceRate,$targetRate)as$v)if(!is_numeric($v)||(float)$v<=0)throw new InvalidArgumentException('Prices and rates must be positive.');if($margin<-99||$margin>1000)throw new InvalidArgumentException('Invalid margin.');$raw=((float)$sourcePrice/(float)$sourceRate)*(float)$targetRate*(1+((float)$margin/100));$f=pow(10,(int)$precision);if($rounding==='up')return ceil($raw*$f)/$f;if($rounding==='down')return floor($raw*$f)/$f;if($rounding==='nearest')return round($raw,(int)$precision,PHP_ROUND_HALF_UP);throw new InvalidArgumentException('Invalid rounding mode.');}}
