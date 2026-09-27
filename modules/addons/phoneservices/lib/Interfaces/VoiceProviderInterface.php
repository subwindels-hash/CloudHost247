<?php
/**
 * Voice Provider Interface
 */

namespace PhoneServices\Interfaces;

interface VoiceProviderInterface extends TelecomProviderInterface
{
    /**
     * Initiate an outgoing call
     */
    public function initiateCall(string $from, string $to, array $options = []): array;
    
    /**
     * End an active call
     */
    public function endCall(string $callId): bool;
    
    /**
     * Get call details
     */
    public function getCallDetails(string $callId): array;
    
    /**
     * Get call logs
     */
    public function getCallLogs(array $filters = []): array;
    
    /**
     * Generate WebRTC token for client
     */
    public function generateWebRtcToken(string $identity, int $ttl = 3600): string;
    
    /**
     * Configure call webhook
     */
    public function setVoiceWebhook(string $url): bool;
}
