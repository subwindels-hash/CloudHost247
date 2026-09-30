<?php
/**
 * Best-effort friendly name for a newly registered authenticator, so the
 * credential list reads "iPhone" rather than a base64 blob. Purely cosmetic:
 * the user can rename it, and nothing security-relevant depends on it.
 */

namespace CloudHost247\Passkey;

final class DeviceNamer
{
    public static function suggest($userAgent, array $transports = array())
    {
        $ua = (string) $userAgent;
        $map = array(
            'iPhone' => 'iPhone',
            'iPad' => 'iPad',
            'Macintosh' => 'Mac',
            'Android' => 'Android device',
            'Windows' => 'Windows device',
            'CrOS' => 'Chromebook',
            'Linux' => 'Linux device',
        );
        foreach ($map as $needle => $label) {
            if (stripos($ua, $needle) !== false) {
                return $label;
            }
        }
        if (in_array('usb', $transports, true) || in_array('nfc', $transports, true)) {
            return 'Security key';
        }
        return 'Passkey';
    }
}
