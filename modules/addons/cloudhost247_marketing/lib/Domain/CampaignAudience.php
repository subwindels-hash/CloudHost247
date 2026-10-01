<?php
namespace CloudHost247\Marketing\Domain;

/**
 * Who a campaign is addressed to (requirement #7, #21).
 *
 * Three audience kinds exist and they are resolved at send time, never frozen
 * into membership rows. `all_subscribers` is deliberately not "everyone in the
 * table": it means every subscriber whose status is `subscribed` and who is not
 * suppressed — the send path applies the same filters again, so a campaign can
 * never widen its own audience between approval and delivery.
 */
final class CampaignAudience
{
    const LIST = 'list';
    const SEGMENT = 'segment';
    const ALL = 'all_subscribers';

    public static function all()
    {
        return array(self::LIST, self::SEGMENT, self::ALL);
    }

    public static function isValid($type)
    {
        return in_array((string) $type, self::all(), true);
    }

    public static function label($type)
    {
        $labels = array(
            self::LIST => 'Mailing list',
            self::SEGMENT => 'Segment',
            self::ALL => 'All subscribed addresses',
        );
        $type = (string) $type;
        return isset($labels[$type]) ? $labels[$type] : 'Unknown';
    }

    /** Only list and segment audiences carry a reference id. */
    public static function needsReference($type)
    {
        return in_array((string) $type, array(self::LIST, self::SEGMENT), true);
    }
}
