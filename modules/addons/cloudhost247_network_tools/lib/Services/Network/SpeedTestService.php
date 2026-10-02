<?php
namespace CloudHost247\NetworkTools\Services\Network;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Internet speed test (docs section 52).
 *
 * The measurement happens in the browser against the module's own endpoint; this
 * service only declares the budget the client must respect (maximum bytes,
 * maximum duration) and the way the numbers must be interpreted. The endpoint
 * that serves the payload is a separate, rate-limited route
 * (see lib/Core/Http/SpeedTestEndpoint.php) and generates data in memory rather
 * than reading anything.
 */
final class SpeedTestService extends Service
{
    protected function execute()
    {
        $maxMegabytes = max(1, min(8, $this->intSetting('speedtest_max_megabytes', 8)));
        $maxSeconds = max(3, min(20, $this->intSetting('speedtest_max_seconds', 20)));
        $requestedMegabytes = min($maxMegabytes, max(1, (int) $this->input['size_megabytes']));
        $requestedSeconds = min($maxSeconds, max(3, (int) $this->input['duration_seconds']));
        return ToolResult::success(array(
            'endpoint' => 'modules/addons/cloudhost247_network_tools/speedtest.php',
            'max_bytes' => $requestedMegabytes * 1048576,
            'max_seconds' => $requestedSeconds,
            'method' => 'The browser downloads and uploads generated blocks, timing each transfer, and reports throughput, latency and jitter from the same series of requests.',
            'limits' => array(
                'hard_max_bytes' => $maxMegabytes * 1048576,
                'hard_max_seconds' => $maxSeconds,
                'enforced_by' => 'Both the browser loop and the server endpoint, so a stalled or malicious client cannot transfer more than the budget.',
            ),
            'interpretation' => 'This measures the path between your browser and the CloudHost247 server that served this page. It is not a measurement of your line rate, and it says nothing about other destinations.',
            'summary' => 'Ready: up to ' . $requestedMegabytes . ' MB over at most ' . $requestedSeconds . ' seconds.',
            'client_side' => true,
        ), array(), array('measurement' => 'client'));
    }
}
