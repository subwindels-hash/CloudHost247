<?php
namespace CloudHost247\Broker\Services;

use CloudHost247\Broker\Repositories\SettingsRepository;
use CloudHost247\Foundation\Support\Logger;

/**
 * Customer notifications (requirement #27) through WHMCS's existing
 * notification/email infrastructure (localAPI SendEmail with the built-in
 * "general" custom template) — not a separate messaging system. Never places
 * a provider credential, internal note, or unnecessary private detail in the
 * message body. Honours the customer_notifications_enabled setting from
 * Super Admin -> Domain Brokerage -> Settings (requirement #35).
 */
final class NotificationService
{
    private $settings;

    public function __construct(SettingsRepository $settings = null)
    {
        $this->settings = $settings ?: new SettingsRepository();
    }

    public function notify($clientId, $subject, $message)
    {
        $clientId = (int) $clientId;
        if ($clientId <= 0 || !function_exists('localAPI')) { return false; }
        if ($this->settings->get('customer_notifications_enabled', '1') !== '1') { return false; }
        try {
            $result = localAPI('SendEmail', array(
                'id' => $clientId,
                'messagename' => '',
                'customtype' => 'general',
                'customsubject' => substr((string) $subject, 0, 191),
                'custommessage' => substr((string) $message, 0, 4000),
            ));
            $ok = isset($result['result']) && $result['result'] === 'success';
            if (!$ok) {
                Logger::write('cloudhost247_broker', 'warning', 'notification.failed', array(
                    'client_id' => $clientId, 'message' => isset($result['message']) ? (string) $result['message'] : '',
                ));
            }
            return $ok;
        } catch (\Throwable $error) {
            Logger::write('cloudhost247_broker', 'error', 'notification.exception', array('client_id' => $clientId));
            return false;
        }
    }

    public function caseCreated($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Domain brokerage request received: ' . $caseNumber,
            "We have received your domain brokerage request for {$domain} (case {$caseNumber}). CloudHost247 will attempt to acquire this domain on your behalf; acquisition is not guaranteed. We will update you as soon as a broker is assigned.");
    }

    public function brokerAssigned($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'A broker has been assigned: ' . $caseNumber,
            "A CloudHost247 broker has been assigned to your brokerage request for {$domain} (case {$caseNumber}) and will begin the acquisition process through a legitimate contact channel.");
    }

    public function contactAttempted($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Owner contact attempted: ' . $caseNumber,
            "CloudHost247 has attempted to contact the registrant or acquisition channel for {$domain} (case {$caseNumber}). We will let you know as soon as we hear back.");
    }

    public function ownerResponded($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'The domain owner responded: ' . $caseNumber,
            "The owner or acquisition channel for {$domain} has responded (case {$caseNumber}). Sign in to your CloudHost247 dashboard to review the details.");
    }

    public function offerReceived($clientId, $caseNumber, $domain, $amount, $currency)
    {
        return $this->notify($clientId, 'New offer for ' . $domain . ': ' . $caseNumber,
            "An offer of {$currency} {$amount} has been recorded for {$domain} (case {$caseNumber}). Sign in to your CloudHost247 dashboard to accept, reject or counter.");
    }

    public function counterofferReceived($clientId, $caseNumber, $domain, $amount, $currency)
    {
        return $this->notify($clientId, 'Counteroffer for ' . $domain . ': ' . $caseNumber,
            "The domain owner has countered at {$currency} {$amount} for {$domain} (case {$caseNumber}). Sign in to your CloudHost247 dashboard to respond.");
    }

    public function actionRequired($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Action required: ' . $caseNumber,
            "Your brokerage case for {$domain} (case {$caseNumber}) needs your review. Sign in to your CloudHost247 dashboard to continue.");
    }

    public function offerAccepted($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Agreement reached: ' . $caseNumber,
            "An agreement has been reached for {$domain} (case {$caseNumber}). Payment details are now available in your CloudHost247 dashboard.");
    }

    public function paymentRequired($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Payment required: ' . $caseNumber,
            "Payment is now required to proceed with the acquisition of {$domain} (case {$caseNumber}). Sign in to your CloudHost247 dashboard to review the invoice.");
    }

    public function paymentReceived($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Payment received: ' . $caseNumber,
            "We have received your payment for {$domain} (case {$caseNumber}). CloudHost247 will now authorize the domain transfer.");
    }

    public function transferStarted($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Transfer started: ' . $caseNumber,
            "The transfer for {$domain} (case {$caseNumber}) has been initiated. We will notify you once it is verified.");
    }

    public function transferCompleted($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Transfer completed: ' . $caseNumber,
            "The transfer for {$domain} (case {$caseNumber}) has been verified and completed. CloudHost247 is finalizing delivery of the domain to your account; we will confirm as soon as it is linked. Your brokerage case is now marked Completed.");
    }

    public function domainDelivered($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Domain delivered: ' . $caseNumber,
            "{$domain} (case {$caseNumber}) is now associated with your CloudHost247 account. You can manage the functions your registrar supports (DNS, nameservers, renewal, transfer lock, contacts) from your Client Area.");
    }

    public function transferFailed($clientId, $caseNumber, $domain, $reason)
    {
        return $this->notify($clientId, 'Transfer issue: ' . $caseNumber,
            "The transfer for {$domain} (case {$caseNumber}) could not be completed: {$reason}. Our team will follow up with next steps.");
    }

    public function caseCancelled($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Brokerage case cancelled: ' . $caseNumber,
            "Your brokerage case for {$domain} (case {$caseNumber}) has been cancelled.");
    }

    public function caseDisputed($clientId, $caseNumber, $domain)
    {
        return $this->notify($clientId, 'Brokerage case disputed: ' . $caseNumber,
            "Your brokerage case for {$domain} (case {$caseNumber}) has been marked as disputed while our team reviews it.");
    }
}
