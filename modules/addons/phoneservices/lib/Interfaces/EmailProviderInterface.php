<?php
/**
 * Transactional email provider contract (SendGrid and equivalents).
 *
 * @package PhoneServices
 */

namespace PhoneServices\Interfaces;

interface EmailProviderInterface extends TelecomProviderInterface
{
    /**
     * Send a transactional email.
     *
     * @param array{from?:string,from_name?:string,reply_to?:string,text?:string,categories?:array,template_id?:string,dynamic_data?:array} $options
     * @return array{success:bool,error:?string,message_id?:string}
     */
    public function sendEmail(string $to, string $subject, string $htmlBody, array $options = []): array;

    /**
     * Delivery status for a previously sent email, when the provider exposes it.
     */
    public function getEmailStatus(string $messageId): array;
}
