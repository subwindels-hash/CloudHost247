<?php
/**
 * Security notifications (spec §21).
 *
 * Emails are sent through WHMCS's own email template system when a matching
 * template exists, so operators keep full control over wording and branding.
 * Every send is best-effort: a mail failure must never break or roll back an
 * authentication ceremony.
 *
 * No notification ever contains a credential, challenge, signature or reset
 * token — only the fact that something happened, when, and from roughly where.
 */

namespace CloudHost247\Passkey;

final class NotificationService
{
    const TPL_LOGIN = 'CloudHost247 Passkey Login';
    const TPL_SECURITY = 'CloudHost247 Passkey Security Alert';

    public static function loginNotification($userType, $userId, array $context = array())
    {
        $setting = $userType === Schema::USER_ADMIN ? 'login_notifications_admin' : 'login_notifications_client';
        if (!SettingsRepository::bool($setting)) {
            return false;
        }
        return self::send($userType, $userId, self::TPL_LOGIN, array_merge($context, array(
            'event' => 'passkey_login',
            'occurred_at' => date('Y-m-d H:i:s'),
            'ip_address' => EventLog::clientIp(),
        )));
    }

    /** Registration, revocation, suspected cloning, password reset, policy change. */
    public static function securityEvent($userType, $userId, $event, array $context = array())
    {
        if (!SettingsRepository::bool('security_notifications')) {
            return false;
        }
        return self::send($userType, $userId, self::TPL_SECURITY, array_merge($context, array(
            'event' => (string) $event,
            'occurred_at' => date('Y-m-d H:i:s'),
            'ip_address' => EventLog::clientIp(),
        )));
    }

    private static function send($userType, $userId, $template, array $vars)
    {
        try {
            $vars = Log::scrub($vars);
            if ($userType === Schema::USER_CLIENT && function_exists('localAPI')) {
                $result = \localAPI('SendEmail', array(
                    'messagename' => $template,
                    'id' => (int) $userId,
                    'customvars' => base64_encode(serialize($vars)),
                ));
                $ok = is_array($result) && isset($result['result']) && $result['result'] === 'success';
                if (!$ok) {
                    Log::info('notification.skipped', array('template' => $template, 'user_id' => (int) $userId));
                }
                return $ok;
            }
            // Admin notifications fall back to the admin notification channel;
            // WHMCS has no client email template binding for admin accounts.
            $user = UserDirectory::find($userType, $userId);
            Log::info('notification.admin_event', array(
                'event' => isset($vars['event']) ? $vars['event'] : '',
                'admin_id' => (int) $userId,
                'has_email' => $user !== null,
            ));
            return true;
        } catch (\Throwable $e) {
            Log::error('notification.failed', array('template' => $template, 'error' => Log::safeError($e)));
            return false;
        }
    }
}
