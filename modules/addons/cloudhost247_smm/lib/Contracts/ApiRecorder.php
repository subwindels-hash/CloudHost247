<?php
namespace CloudHost247\Smm\Contracts;

/** API execution log boundary. Implementations MUST redact credentials before persisting. */
interface ApiRecorder
{
    /**
     * @param int|null $providerId
     * @param string   $operation services|add|status|refill|refill_status|cancel|balance
     * @param array    $request   form fields (will be redacted)
     * @param mixed    $response  decoded response or raw excerpt (will be redacted + truncated)
     * @param int      $httpStatus
     * @param int      $durationMs
     * @param string   $result    success|rejected|error
     * @param string   $correlationId
     * @return void
     */
    public function record($providerId, $operation, array $request, $response, $httpStatus, $durationMs, $result, $correlationId);
}
