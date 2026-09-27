<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HandlerError\ErrorCodes;

class ErrorCodesLib extends ErrorCodes
{
    const CORE_CT_000001 = 'Provided controller does not exists';
    const CORE_CT_000002 = 'Provided controller does not exists';

    const CORE_ACT_000001 = 'Database error';
    const CORE_ACT_000002 = 'Database error';
    const CORE_ACT_000003 = 'Database error';
    const CORE_ACT_000004 = 'Database error';

    /**
     * Default error, used when no error code defined
     */
    const CORE_ERR_000001 = [
        self::MESSAGE     => 'Uncategorised error occured',
        self::CODE        => 'CORE_ERR_000001',
        self::DEV_MESSAGE => "It's a default error code, used when no error code was specified"
    ];

    /**
     * Logs class
     */
    const CORE_LOG_000001 = [
        self::MESSAGE => 'Method does not exist in the Logger class',
        self::CODE    => 'CORE_LOG_000001',
    ];

    /**
     * Register cache
     */
    const CORE_CREG_000001 = [
        self::MESSAGE => 'Register key already exists',
        self::CODE    => 'CORE_CREG_000001',
    ];

    /**
     * Database cache
     */
    const CORE_CDB_000001 = [
        self::MESSAGE => 'The callback needs to ba a callable',
        self::CODE    => 'CORE_CDB_000001',
    ];

    /**
     * GRAPHS
     */
    const CORE_GRA_000001 = [
        self::MESSAGE => 'Tooltip mode does not exists',
        self::CODE    => 'CORE_GRA_000001',
    ];

    const CORE_GRA_000002 = [
        self::MESSAGE => 'Width value is not numeric(:width:)',
        self::CODE    => 'CORE_GRA_000002',
    ];

    const CORE_GRA_000003 = [
        self::MESSAGE => 'Height value is not numeric(:height:)',
        self::CODE    => 'CORE_GRA_000003',
    ];

    /**
     * CURL
     */
    const CORE_CURL_000001 = [
        self::MESSAGE => 'CURL error',
        self::CODE    => 'CORE_CURL_000001',
    ];

    const CORE_CURL_000002 = [
        self::MESSAGE => 'CURL error',
        self::CODE    => 'CORE_CURL_000002',
    ];

    /**
     * WHMCS API core lib
     */
    const CORE_WAPI_000001 = [
        self::MESSAGE => 'No WHMCS files found',
        self::CODE    => 'CORE_WAPI_000001',
    ];

    const CORE_WAPI_000002 = [
        self::MESSAGE => 'WHMCS API error',
        self::CODE    => 'CORE_WAPI_000002',
    ];

    const CORE_WAPI_000003 = [
        self::MESSAGE => 'There is no admin with ID equal to ":adminId:"',
        self::CODE    => 'CORE_WAPI_000003',
    ];

    const CORE_WAPI_000004 = [
        self::MESSAGE => 'WHMCS API error',
        self::CODE    => 'CORE_WAPI_000004',
    ];

    /**
     * LIBS
     */
    const CORE_LIBS_DH_000001 = [
        self::MESSAGE => 'The TLD is missing in tld.list file',
        self::CODE    => 'CORE_LIBS_DH_000001',
    ];

    /**
     * WHMCS Service Package
     */
    const CORE_WS_000001 = [
        self::MESSAGE => 'Invalid service ID',
        self::CODE    => 'CORE_WS_000001',
    ];

    const CORE_WS_000002 = [
        self::MESSAGE => 'Invalid product ID',
        self::CODE    => 'CORE_WS_000001',
    ];
}
