<?php
/**
 * Raised when WebAuthn cannot operate because the deployment is not
 * configured correctly (missing RP ID/origin, non-HTTPS production origin,
 * missing Entra credentials, ...).
 *
 * The system fails closed: callers surface CONFIGURATION_REQUIRED and refuse
 * the ceremony. It never degrades to a weaker authentication path.
 */

namespace CloudHost247\Passkey;

final class ConfigurationException extends PasskeyException
{
    public function __construct($message)
    {
        parent::__construct($message, 'configuration_required');
    }
}
