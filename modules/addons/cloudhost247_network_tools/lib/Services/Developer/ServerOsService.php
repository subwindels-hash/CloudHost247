<?php
namespace CloudHost247\NetworkTools\Services\Developer;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;

/**
 * Website server / technology checker (docs section 31).
 *
 * Every finding carries a confidence level:
 *   Confirmed — the server stated it in a header or in generated markup;
 *   Likely    — a strong indicator (a distinctive header or asset path);
 *   Unknown   — it could not be determined.
 * Nothing is presented as certain when it was inferred from public responses.
 */
final class ServerOsService extends Service
{
    protected function execute()
    {
        $url = $this->input['url'];
        $fetcher = $this->fetcher(3);
        $response = $fetcher->request('GET', $url, array('Accept: text/html,application/xhtml+xml,*/*;q=0.8'), null, array(
            'max_bytes' => min(262144, max(65536, $this->intSetting('http_max_response_bytes', 262144))),
            'timeout' => max(3, (int) $this->setting('default_timeout_seconds', 10)),
        ));
        if (!$response['ok']) {
            return ToolResult::failure($response['code'], $response['message']);
        }
        $headers = $response['headers'];
        $body = (string) $response['body'];
        $findings = array();
        $server = isset($headers['server']) ? (string) $headers['server'] : '';
        if ($server !== '') {
            $findings[] = $this->finding('web_server', 'Web server', $server, 'Confirmed', 'The Server response header states it.');
        } else {
            $findings[] = $this->finding('web_server', 'Web server', '', 'Unknown', 'No Server header was sent (this is normal and is itself good practice).');
        }
        if (isset($headers['x-powered-by'])) {
            $findings[] = $this->finding('language', 'Application platform', (string) $headers['x-powered-by'], 'Confirmed', 'The X-Powered-By header states it; exposing it is usually turned off in production.');
        }
        $clues = array(
            'php' => array('marker' => 'X-PHP', 'label' => 'PHP', 'header' => ''),
            'aspnet' => array('marker' => '', 'label' => 'ASP.NET', 'header' => 'x-aspnet-version'),
            'cloudflare' => array('marker' => '', 'label' => 'Cloudflare', 'header' => 'cf-ray'),
            'akamai' => array('marker' => '', 'label' => 'Akamai', 'header' => 'x-akamai-transformed'),
            'fastly' => array('marker' => '', 'label' => 'Fastly', 'header' => 'x-served-by'),
            'sucuri' => array('marker' => '', 'label' => 'Sucuri', 'header' => 'x-sucuri-id'),
            'varnish' => array('marker' => '', 'label' => 'Varnish', 'header' => 'x-varnish'),
            'nginx' => array('marker' => '', 'label' => 'Nginx', 'header' => 'server:nginx'),
            'wordpress' => array('marker' => 'wp-content', 'label' => 'WordPress', 'header' => ''),
            'elementor' => array('marker' => 'elementor', 'label' => 'Elementor (WordPress)', 'header' => ''),
            'woocommerce' => array('marker' => 'woocommerce', 'label' => 'WooCommerce', 'header' => ''),
            'jquery' => array('marker' => 'jquery', 'label' => 'jQuery', 'header' => ''),
            'bootstrap' => array('marker' => 'bootstrap', 'label' => 'Bootstrap', 'header' => ''),
            'react' => array('marker' => 'data-reactroot', 'label' => 'React', 'header' => ''),
            'nextjs' => array('marker' => '__next', 'label' => 'Next.js', 'header' => 'x-nextjs-cache'),
            'google_analytics' => array('marker' => 'googletagmanager.com', 'label' => 'Google Tag Manager/Analytics', 'header' => ''),
        );
        foreach ($clues as $key => $clue) {
            if ($clue['header'] !== '') {
                $parts = explode(':', $clue['header'], 2);
                if (isset($headers[$parts[0]])) {
                    $value = (string) $headers[$parts[0]];
                    if (count($parts) === 1 || stripos($value, $parts[1]) !== false) {
                        $findings[] = $this->finding($key, $clue['label'], $value, 'Likely', 'The ' . $parts[0] . ' header was present in this response.');
                    }
                }
                continue;
            }
            if ($clue['marker'] !== '' && stripos($body, $clue['marker']) !== false) {
                $findings[] = $this->finding($key, $clue['label'], '', 'Likely', 'Markup for ' . $clue['label'] . ' was found in the returned page.');
            }
        }
        if (isset($headers['x-generator'])) {
            $findings[] = $this->finding('generator', 'Generator', (string) $headers['x-generator'], 'Confirmed', 'The X-Generator header states it.');
        }
        if (preg_match('/<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)/i', $body, $matches)) {
            $findings[] = $this->finding('generator_meta', 'Generator (meta tag)', $matches[1], 'Confirmed', 'The page declares it in a generator meta tag.');
        }
        return ToolResult::success(array(
            'url' => $response['url'],
            'status_code' => (int) $response['status'],
            'findings' => $findings,
            'detected_count' => count($findings),
            'confidence_note' => 'Confirmed means the server stated it about itself. Likely means a distinctive indicator was observed. Everything else is Unknown and is not reported as a fact. Headers can be removed or altered, so this is fingerprinting, not proof.',
            'summary' => $server !== '' ? 'Server header: ' . $server : 'No server header; technology identified from response content only.',
        ), array());
    }

    private function finding($key, $label, $value, $confidence, $evidence)
    {
        return array('key' => $key, 'label' => $label, 'value' => (string) $value, 'confidence' => $confidence, 'evidence' => $evidence);
    }
}
