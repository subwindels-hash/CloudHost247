<?php
namespace CloudHost247\Currency\Support;
use InvalidArgumentException;
final class RateMath
{
    public static function effective($rate, $marginPercent, $precision, $mode)
    {
        $rate=(float)$rate; $margin=(float)$marginPercent; $precision=(int)$precision;
        if (!is_finite($rate) || $rate <= 0) throw new InvalidArgumentException('Rate must be positive and finite.');
        if ($margin < -99 || $margin > 1000) throw new InvalidArgumentException('Margin is outside the allowed range.');
        if ($precision < 0 || $precision > 12) throw new InvalidArgumentException('Precision must be between 0 and 12.');
        $value=$rate*(1+($margin/100)); $factor=pow(10,$precision);
        if ($mode==='up') $value=ceil($value*$factor)/$factor; elseif ($mode==='down') $value=floor($value*$factor)/$factor; elseif ($mode==='nearest') $value=round($value,$precision,PHP_ROUND_HALF_UP); else throw new InvalidArgumentException('Unknown rounding mode.');
        return $value;
    }
    public static function convert($amount, $fromRate, $toRate, $precision=2)
    {
        if ((float)$fromRate<=0 || (float)$toRate<=0) throw new InvalidArgumentException('Conversion rates must be positive.');
        return round(((float)$amount/(float)$fromRate)*(float)$toRate,(int)$precision,PHP_ROUND_HALF_UP);
    }
}
