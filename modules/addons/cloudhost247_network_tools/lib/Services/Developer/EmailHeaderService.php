<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Email header analyser (docs section 33).
 *
 * Parses the Received chain, the identity headers, the authentication results
 * and the timestamps, and computes the delay between each hop. The header text
 * is processed in memory for this request only: the tool declares its input
 * sensitive, so the runner records no target, no history value and no log
 * payload, and nothing is saved unless the customer explicitly saves a report.
 */
final class EmailHeaderService extends Service
{
    protected function execute()
    {
        $raw = (string) $this->input['headers'];
        $headers = $this->parseHeaders($raw);
        if (!$headers) {
            return ToolResult::invalid('That does not look like an email header: no "Name: value" lines were found.');
        }
        $received = array();
        $previousTime = null;
        $index = 0;
        foreach ($headers as $header) {
            if (strcasecmp($header['name'], 'received') !== 0) {
                continue;
            }
            $index++;
            $timestamp = $this->extractTimestamp($header['value']);
            $delay = ($previousTime !== null && $timestamp !== null) ? ($previousTime - $timestamp) : null;
            $received[] = array(
                'position' => $index,
                'from' => $this->extractClause($header['value'], 'from'),
                'by' => $this->extractClause($header['value'], 'by'),
                'with' => $this->extractClause($header['value'], 'with'),
                'for' => $this->extractClause($header['value'], 'for'),
                'ip' => $this->extractIp($header['value']),
                'timestamp' => $timestamp !== null ? gmdate('c', $timestamp) : '',
                'delay_from_previous_seconds' => $delay,
                'raw' => $header['value'],
            );
            if ($timestamp !== null) {
                $previousTime = $timestamp;
            }
        }
        $authResults = array();
        $authHeaders = array('authentication-results', 'arc-authentication-results', 'dkim-signature', 'received-spf');
        foreach ($headers as $header) {
            if (in_array(strtolower($header['name']), $authHeaders, true)) {
                $authResults[] = array('header' => $header['name'], 'value' => $header['value']);
            }
        }
        $single = array();
        foreach ($headers as $header) {
            $lower = strtolower($header['name']);
            if (in_array($lower, array('from', 'to', 'return-path', 'message-id', 'subject', 'date', 'reply-to', 'list-unsubscribe'), true) && !isset($single[$lower])) {
                $single[$lower] = $header['value'];
            }
        }
        $hops = array();
        foreach ($authResults as $entry) {
            if (preg_match_all('/\b(spf|dkim|dmarc|arc)=([a-z]+)/i', $entry['value'], $matches, PREG_SET_ORDER)) {
                foreach ($matches as $match) {
                    $hops[] = array('mechanism' => strtoupper($match[1]), 'result' => strtolower($match[2]), 'header' => $entry['header']);
                }
            }
        }
        $sendingIp = '';
        foreach (array_reverse($received) as $hop) {
            if ($hop['ip'] !== '') {
                $sendingIp = $hop['ip'];
                break;
            }
        }
        $warnings = array();
        $lookingLikeAddress = function ($value) {
            return preg_match('/[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/i', (string) $value) ? true : false;
        };
        foreach ($received as $hop) {
            if ($hop['delay_from_previous_seconds'] !== null && $hop['delay_from_previous_seconds'] > 300) {
                $warnings[] = 'Hop ' . $hop['position'] . ' was delayed by ' . $hop['delay_from_previous_seconds'] . ' seconds, which usually means a queue or a greylisting decision.';
            }
            if ($hop['timestamp'] === '') {
                $warnings[] = 'Hop ' . $hop['position'] . ' has no parseable timestamp, so its delay could not be calculated.';
            }
        }
        if (isset($single['return-path']) && isset($single['from']) && $lookingLikeAddress($single['return-path']) && $lookingLikeAddress($single['from'])) {
            if (strcasecmp($this->domainOf($single['return-path']), $this->domainOf($single['from'])) !== 0) {
                $warnings[] = 'The Return-Path domain differs from the From domain. That is normal for mailing lists and some relays, and is also a common sign of spoofing or forwarding.';
            }
        }
        return ToolResult::success(array(
            'received_chain' => $received,
            'hop_count' => count($received),
            'identity' => array(
                'from' => isset($single['from']) ? $single['from'] : '',
                'to' => isset($single['to']) ? $single['to'] : '',
                'return_path' => isset($single['return-path']) ? $single['return-path'] : '',
                'message_id' => isset($single['message-id']) ? $single['message-id'] : '',
                'subject' => isset($single['subject']) ? $single['subject'] : '',
                'date' => isset($single['date']) ? $single['date'] : '',
                'reply_to' => isset($single['reply-to']) ? $single['reply-to'] : '',
            ),
            'authentication_results' => $authResults,
            'auth_summary' => $hops,
            'sending_ip' => $sendingIp,
            'servers' => array_values(array_filter(array_unique(array_map(function ($hop) {
                return $hop['by'];
            }, $received)))),
            'summary' => count($received) . ' Received hop(s); sending address reported by the earliest hop: ' . ($sendingIp !== '' ? $sendingIp : 'none present') . '.',
            'explanation' => 'Received headers are added by each server that handled the message, so they read bottom-up (the last line is the closest to the sender). Authentication-Results is written by the receiving server that evaluated SPF, DKIM and DMARC.',
            'privacy' => 'This analysis was performed for your request only. The header was not stored; saving a report is an explicit action you can take from the result.',
        ), $warnings, array('stored' => false));
    }

    private function parseHeaders($raw)
    {
        $raw = str_replace("\r\n", "\n", (string) $raw);
        $lines = explode("\n", $raw);
        $headers = array();
        $current = null;
        foreach ($lines as $line) {
            if (trim($line) === '') {
                if ($current !== null) {
                    $headers[] = $current;
                    $current = null;
                }
                continue;
            }
            if (preg_match('/^\s+/', $line) && $current !== null) {
                $current['value'] .= ' ' . trim($line);
                continue;
            }
            $position = strpos($line, ':');
            if ($position === false) {
                continue;
            }
            if ($current !== null) {
                $headers[] = $current;
            }
            $current = array('name' => trim(substr($line, 0, $position)), 'value' => trim(substr($line, $position + 1)));
        }
        if ($current !== null) {
            $headers[] = $current;
        }
        return $headers;
    }

    private function extractClause($value, $keyword)
    {
        if (preg_match('/\b' . preg_quote($keyword, '/') . '\s+([^\s;()]+|\([^)]*\))/i', $value, $matches)) {
            return trim($matches[1], '()');
        }
        return '';
    }

    private function extractIp($value)
    {
        if (preg_match('/\[?((?:\d{1,3}\.){3}\d{1,3}|[0-9a-f:]{6,})\]?/i', $value, $matches)) {
            $candidate = trim($matches[1], '[]');
            return filter_var($candidate, FILTER_VALIDATE_IP) !== false ? $candidate : '';
        }
        return '';
    }

    private function extractTimestamp($value)
    {
        if (preg_match('/;\s*(.+)$/', $value, $matches)) {
            $timestamp = strtotime(trim($matches[1]));
            return $timestamp === false ? null : $timestamp;
        }
        return null;
    }

    private function domainOf($address)
    {
        if (preg_match('/@([^\s>]+)/', (string) $address, $matches)) {
            return strtolower(trim($matches[1], '>'));
        }
        return '';
    }
}
