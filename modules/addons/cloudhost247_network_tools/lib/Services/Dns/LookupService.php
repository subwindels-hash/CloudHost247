<?php
namespace CloudHost247\NetworkTools\Services\Dns;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Dns\DnsClient;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/** DNS Lookup (docs section 5): one record type, one resolver, real answers. */
final class LookupService extends Service
{
    protected function execute()
    {
        $name = $this->input['domain'];
        $type = strtoupper($this->input['type']);
        if (!DnsClient::isSupportedType($type) || $type === 'ANY') {
            throw new InvalidArgumentException('That record type is not supported by this tool.');
        }
        if ($type === 'PTR') {
            // A PTR question is asked about a reverse name, not a domain.
            $reverse = $this->reverseNameFor($name);
            if ($reverse === null) {
                throw new InvalidArgumentException('Enter the IP address in the Reverse DNS tool to look up a PTR record.');
            }
            $name = $reverse;
        }
        $client = $this->clientForRequest(isset($this->input['resolver']) ? $this->input['resolver'] : '');
        $response = $client->query($name, $type);
        $warnings = array();
        if (!$response['ok']) {
            $failure = $this->dnsFailure($response, 'The lookup did not return an answer');
            $failure->withMeta($this->meta($response, array('records' => array(), 'type' => $type, 'query_name' => $name)));
            return $failure;
        }
        if (empty($response['records'])) {
            $warnings[] = 'The resolver answered successfully but published no ' . $type . ' record for that name.';
        }
        $data = array(
            'query_name' => $name,
            'type' => $type,
            'records' => $this->recordRows($response),
            'record_count' => count($response['records']),
            'summary' => count($response['records']) . ' ' . $type . ' record(s) returned by ' . $client->resolverLabel() . '.',
        );
        if (!empty($this->input['include_authority'])) {
            $data['authority'] = $this->recordRows(array('records' => $response['authority']));
        }
        return ToolResult::success($data, $warnings, $this->meta($response, array('type' => $type, 'query_name' => $name)));
    }

    /** Build the in-addr.arpa / ip6.arpa name for an IP, or null. */
    private function reverseNameFor($value)
    {
        if (filter_var($value, FILTER_VALIDATE_IP) === false) {
            return null;
        }
        return \CloudHost247\NetworkTools\Dns\ReverseName::forIp($value);
    }
}
