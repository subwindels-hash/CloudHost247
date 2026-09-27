<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Enum;

/**
 * Description of StatusColor
 *
 * @author Pawel Kopec <pawelk@modulesgardne.com>
 */
final class StatusColor extends Enum
{
    const PENDING   = "f89406";
    const ACTIVE    = "46a546";
    const COMPLETED = "008b8b";
    const SUSPENDED = "0768b8";
    const CANCELLED = "bfbfbf";
    const FRAUD     = "000";

    public static function getColors()
    {
        return [
            "Pending"   => self::PENDING,
            "Active"    => self::ACTIVE,
            "Completed" => self::COMPLETED,
            "Suspended" => self::SUSPENDED,
            "Cancelled" => self::CANCELLED,
            "Fraud"     => self::FRAUD
        ];
    }
}
