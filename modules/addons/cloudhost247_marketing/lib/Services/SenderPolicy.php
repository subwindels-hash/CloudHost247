<?php
namespace CloudHost247\Marketing\Services;

/**
 * A delivery provider that restricts which sender domains it will accept.
 *
 * This exists so the campaign checklist and the transport itself agree on the
 * answer before a message reaches the wire. A provider that cannot state a
 * policy simply does not implement this interface, and the checklist reports the
 * policy as not enforced rather than pretending it passed.
 */
interface SenderPolicy
{
    /**
     * @param string $fromEmail the campaign's sender address
     * @return array{ok:bool,detail:string,enforced:bool}
     */
    public function senderPolicy($fromEmail);
}
