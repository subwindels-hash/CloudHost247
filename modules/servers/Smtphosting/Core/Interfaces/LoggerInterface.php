<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Interfaces;

/**
 *
 * @author Rafał Ossowski <rafal.os@modulesgarden.com>
 */
interface LoggerInterface
{
    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function debug($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function error($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function warning($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function err($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function warn($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addDebug($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addWarning($message, array $context = []);

    /**
     * @param string $message
     * @param array $context
     * @return bool
     */
    public function addError($message, array $context = []);
}
