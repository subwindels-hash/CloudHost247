<?php
namespace CloudHost247\Marketing\Services;

use CloudHost247\Marketing\Security\InputValidator;

/**
 * Conservative DSN (delivery status notification) parser (requirement #29).
 *
 * Bounce handling starts from real evidence: an operator pastes the bounce
 * message a mail server returned, and this class extracts *only* what it can
 * prove — the final recipient address and whether the failure was permanent
 * (5.x.x) or temporary (4.x.x). If a line is ambiguous it is skipped, because a
 * wrong suppression costs a real subscriber and a wrong retry costs a real
 * inbox. The raw message is never stored.
 */
final class BounceParser
{
    /**
     * @return array{hard:string[],soft:string[],unrecognised:int}
     */
    public function parse($evidence)
    {
        $evidence = (string) $evidence;
        $hard = array();
        $soft = array();
        $unrecognised = 0;

        foreach ($this->blocks($evidence) as $block) {
            $email = $this->recipient($block);
            if ($email === '') {
                // A block without a recipient may still carry an address on a
                // Final-Recipient line; if not, it is reported as unrecognised.
                $unrecognised++;
                continue;
            }
            $status = $this->status($block);
            if ($status === '') { $unrecognised++; continue; }
            if ($status === 'hard') { $hard[] = $email; }
            else { $soft[] = $email; }
        }

        // A message with no per-message blocks (a single-line report) still gets
        // one honest attempt at a recipient + status pair.
        if ($hard === array() && $soft === array() && $unrecognised === 0) {
            $email = $this->recipient($evidence);
            $status = $this->status($evidence);
            if ($email !== '' && $status !== '') {
                if ($status === 'hard') { $hard[] = $email; } else { $soft[] = $email; }
            } elseif ($email !== '' || $status !== '') {
                $unrecognised++;
            }
        }

        return array(
            'hard' => array_values(array_unique($hard)),
            'soft' => array_values(array_unique($soft)),
            'unrecognised' => $unrecognised,
        );
    }

    /** Splits a DSN into per-message blocks when it has them. */
    private function blocks($evidence)
    {
        $parts = preg_split('/\\n(?=(?:Final-Recipient|Original-Recipient|Reporting-MTA|To|X-Failed-Recipients)\\s*:)/i', $evidence);
        $blocks = array();
        foreach ($parts as $part) {
            $part = trim((string) $part);
            if ($part !== '') { $blocks[] = $part; }
        }
        return $blocks ? $blocks : array(trim($evidence));
    }

    /** The recipient a block is about: Final-Recipient wins, then To: headers. */
    private function recipient($block)
    {
        if (preg_match('/^Final-Recipient\\s*:\\s*[^;\\n]*;\\s*([^\\s;]+)/im', $block, $match)) {
            return $this->address($match[1]);
        }
        if (preg_match('/^X-Failed-Recipients\\s*:\\s*([^\\s,;]+)/im', $block, $match)) {
            return $this->address($match[1]);
        }
        if (preg_match('/^Original-Recipient\\s*:\\s*[^;\\n]*;\\s*([^\\s;]+)/im', $block, $match)) {
            return $this->address($match[1]);
        }
        if (preg_match('/^To\\s*:\\s*(?:.*<)?([^\\s<>,;]+@[^\\s<>,;]+)>?/im', $block, $match)) {
            return $this->address($match[1]);
        }
        if (preg_match('/^\\s*(?:<)?([^\\s<>,;]+@[^\\s<>,;]+)>?\\s+.*(?:host|domain|user)\\s+unknown/im', $block, $match)) {
            return $this->address($match[1]);
        }
        return '';
    }

    /** 5.x.x = permanent (suppress); 4.x.x = temporary (retry), else unknown. */
    private function status($block)
    {
        if (preg_match('/^Status\\s*:\\s*([245])\\./im', $block, $match)) {
            return $match[1] === '5' ? 'hard' : ($match[1] === '4' ? 'soft' : '');
        }
        if (preg_match('/^Action\\s*:\\s*failed/im', $block) && preg_match('/(?:^|\\s)(5[0-9]{2})\\s/s', $block)) {
            return 'hard';
        }
        if (preg_match('/(?:^|\\s)(4[0-9]{2})\\s/', $block)) { return 'soft'; }
        if (preg_match('/(?:^|\\s)(5[0-9]{2})\\s/', $block)) { return 'hard'; }
        if (preg_match('/(?:user|mailbox|address)\\s+(?:unknown|not found|unavailable)/i', $block)) { return 'hard'; }
        if (preg_match('/mailbox full|over quota|try again|temporar/i', $block)) { return 'soft'; }
        return '';
    }

    private function address($candidate)
    {
        $candidate = trim((string) $candidate, "<> \t\r\n,;");
        $candidate = preg_replace('/^rfc822;\\s*/i', '', $candidate);
        try {
            $email = InputValidator::email($candidate);
        } catch (\InvalidArgumentException $error) {
            return InputValidator::isPlausibleEmail($candidate) ? strtolower($candidate) : '';
        }
        return strtolower($email);
    }
}
