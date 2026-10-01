<?php
/**
 * Editable page content (mod_hostx_email_content).
 *
 * The landing page copy - hero text, provider card bullets, FAQs, DNS guidance
 * - ships with sensible defaults and can be overridden per key without touching
 * PHP. Overrides are JSON documents stored in the content table, which the
 * CloudHost247 CMS tooling and the documented SQL snippets in README.md can
 * update.
 *
 * Content is plain text; every value is escaped at render time.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Repository;

use CloudHost247\Email\Support\Logger;
use WHMCS\Database\Capsule;

final class ContentRepository
{
    const TABLE = 'mod_hostx_email_content';

    /**
     * Built-in defaults. Deliberately factual: no provider claims that the
     * module cannot back up, no partnership language.
     *
     * @return array<string,mixed>
     */
    public static function defaults(): array
    {
        return [
            'hero' => [
                'heading'   => 'Professional Email Hosting for Your Business',
                'subheading' => 'Business email on your own domain, plus Microsoft 365 and Google Workspace '
                    . 'subscriptions, provisioned and billed through CloudHost247. Choose the platform that fits how '
                    . 'your team already works - we handle the ordering, licensing and DNS guidance.',
                'primary_cta'   => 'Explore Email Plans',
                'secondary_cta' => 'Compare Providers',
                'disclaimer'    => 'Microsoft 365 and Google Workspace are products of Microsoft and Google '
                    . 'respectively. CloudHost247 resells and provisions subscriptions on your behalf and is not '
                    . 'affiliated with, or an official partner of, either company.',
            ],
            'providers' => [
                'professional' => [
                    'summary'  => 'Business email on your domain, hosted on our mail platform.',
                    'features' => [
                        'Custom-domain mailboxes',
                        'IMAP and SMTP access where the platform supports it',
                        'Webmail access',
                        'Mailbox management from your client area',
                        'DNS setup guidance for MX, SPF, DKIM and DMARC',
                    ],
                ],
                'microsoft365' => [
                    'summary'  => 'Microsoft business email plans with Outlook.',
                    'features' => [
                        'Microsoft business email plans',
                        'Outlook integration',
                        'Microsoft 365 licence provisioning',
                        'Subscription management through CloudHost247 billing',
                    ],
                ],
                'google' => [
                    'summary'  => 'Google business email plans with Gmail.',
                    'features' => [
                        'Google business email plans',
                        'Gmail integration',
                        'Google Workspace licence provisioning',
                        'Subscription management through CloudHost247 billing',
                    ],
                ],
            ],
            'dns' => [
                'intro' => 'Email only starts flowing once your domain points at the platform you chose. After you '
                    . 'order, your client area shows the exact records your provider issued for your domain - we never '
                    . 'guess values, and we never change your DNS without your say-so.',
                'steps' => [
                    'Order a plan and complete checkout.',
                    'Open the service in your client area to see the records your provider issued.',
                    'Add those records at whoever hosts your DNS (registrar, CDN or our nameservers).',
                    'Wait for propagation, then re-check the verification status on the service page.',
                ],
                'note' => 'Verification status is reported by the provider or confirmed by a live DNS lookup. '
                    . 'If neither is available the page says "not verified" rather than assuming success.',
            ],
            'faqs' => [
                [
                    'question' => 'How do I connect my own domain?',
                    'answer'   => 'Enter your domain during checkout. After the order is provisioned, your client area '
                        . 'lists the DNS records your provider requires - verification TXT, MX, SPF, DKIM and DMARC '
                        . 'guidance - with copy buttons. Add them wherever your DNS is hosted. If your domain uses '
                        . 'CloudHost247 nameservers our support team can add them for you on request.',
                ],
                [
                    'question' => 'How are business email accounts created?',
                    'answer'   => 'Once payment is confirmed and the order is approved, the mailbox is created '
                        . 'automatically on the provider you selected and the credentials are delivered to the contact '
                        . 'address on your account. Nothing is provisioned before payment clears.',
                ],
                [
                    'question' => 'How do Microsoft 365 and Google Workspace subscriptions work?',
                    'answer'   => 'You order and pay through CloudHost247, and we create the user and assign the '
                        . 'licence on the tenant configured for your account. Renewals follow your WHMCS billing cycle. '
                        . 'Microsoft and Google remain the service providers, and their own terms and admin policies '
                        . 'apply to the tenant.',
                ],
                [
                    'question' => 'How long does DNS propagation take?',
                    'answer'   => 'Usually minutes to a few hours, and up to 48 hours in the worst case, depending on '
                        . 'the TTL your DNS host uses. Your service page re-checks the records and shows the current '
                        . 'state rather than assuming it worked.',
                ],
                [
                    'question' => 'How do I reset an email password?',
                    'answer'   => 'Use the password form on the service page in your client area. The change is sent '
                        . 'straight to the provider API. Some Microsoft 365 tenants are directory-synchronised or '
                        . 'federated, in which case passwords are managed on-premises and the page tells you so '
                        . 'instead of silently failing.',
                ],
                [
                    'question' => 'Can I migrate existing email, and what happens if I cancel?',
                    'answer'   => 'Existing mail can be migrated with standard IMAP migration tooling; contact support '
                        . 'before you switch MX records so nothing is lost. If you cancel, the subscription runs to the '
                        . 'end of the paid term and the mailbox is then removed and the licence released. Export '
                        . 'anything you need before the termination date.',
                ],
            ],
        ];
    }

    /** @var array<string,mixed>|null */
    private static $cache;

    /**
     * Full content tree: defaults merged with any stored overrides.
     *
     * @return array<string,mixed>
     */
    public static function all(string $locale = 'english'): array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $content = self::defaults();

        try {
            $rows = Capsule::table(self::TABLE)
                ->whereIn('locale', array_unique([$locale, 'english']))
                ->get();

            foreach ($rows as $row) {
                $decoded = json_decode((string) $row->value_json, true);

                if ($decoded !== null) {
                    $content[(string) $row->content_key] = $decoded;
                }
            }
        } catch (\Throwable $e) {
            // Table missing (module never used yet) - defaults stand.
            Logger::debug('content.load_failed', ['error' => $e->getMessage()]);
        }

        self::$cache = $content;

        return $content;
    }

    /**
     * @param  mixed $default
     * @return mixed
     */
    public static function get(string $key, $default = null, string $locale = 'english')
    {
        $all = self::all($locale);

        return array_key_exists($key, $all) ? $all[$key] : $default;
    }

    /**
     * Store an override.
     *
     * @param mixed $value
     */
    public static function set(string $key, $value, string $locale = 'english'): bool
    {
        try {
            $payload = json_encode($value);

            $exists = Capsule::table(self::TABLE)
                ->where('content_key', $key)
                ->where('locale', $locale)
                ->exists();

            if ($exists) {
                Capsule::table(self::TABLE)
                    ->where('content_key', $key)
                    ->where('locale', $locale)
                    ->update(['value_json' => $payload, 'updated_at' => date('Y-m-d H:i:s')]);
            } else {
                Capsule::table(self::TABLE)->insert([
                    'content_key' => $key,
                    'locale'      => $locale,
                    'value_json'  => $payload,
                    'updated_at'  => date('Y-m-d H:i:s'),
                ]);
            }

            self::$cache = null;

            return true;
        } catch (\Throwable $e) {
            Logger::error('content.save_failed', ['key' => $key, 'error' => $e->getMessage()]);

            return false;
        }
    }

    public static function clearCache(): void
    {
        self::$cache = null;
    }
}
