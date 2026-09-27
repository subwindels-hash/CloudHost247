<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Cache\Services;

use WHMCS\Database\Capsule;
use \Carbon\Carbon;

class DatabaseCache
{
    const CACHE_TABLE_NAME          = "Smtphosting_Cache";
    const CACHE_TIME_MINUTES        = 5;
    const PRODUCT_LIST_CACHE_KEY    = "configOptionsProductList";
    const SERVICE_DETAILS_CACHE_KEY = "serviceDetails_";

    public static function init()
    {
        if (Capsule::schema()->hasTable(self::CACHE_TABLE_NAME))
        {
            return;
        }

        Capsule::schema()->create(
            self::CACHE_TABLE_NAME,
            function ($table) {
                /** @var \Illuminate\Database\Schema\Blueprint $table */
                $table->increments('id');
                $table->string('key')->unique();
                $table->text('value');
                $table->dateTime('expiration');
            }
        );
    }

    public static function remember(string $key, $value, $expireInMinutes = null)
    {
        Capsule::table(self::CACHE_TABLE_NAME)->where('expiration', '<', Carbon::now())->delete();
        try
        {
            Capsule::table(self::CACHE_TABLE_NAME)
                ->updateOrInsert(['key' => $key],
                    [
                        'value'      => json_encode($value),
                        'expiration' => $expireInMinutes ? Carbon::now()->addMinutes($expireInMinutes) : Carbon::now()->addMinutes(self::CACHE_TIME_MINUTES)
                    ]
                );
        }
        catch (\Exception $e)
        {
            return null;
        }
        return $value;
    }

    public static function cache($key, $callable, $expirationDate)
    {
        $result = self::get($key);
        if ($result)
        {
            return $result;
        }
        $result = call_user_func($callable);
        return self::remember($key, json_encode($result), $expirationDate);
    }

    public static function get(string $key)
    {
        try
        {
            $object = Capsule::table(self::CACHE_TABLE_NAME)->where('key', $key)->where('expiration', '>', Carbon::now())->first();
            $result = $object ? json_decode($object->value, true) : null;
        }
        catch (\Exception $e)
        {
            $result = null;
        }
        return $result;
    }
}
