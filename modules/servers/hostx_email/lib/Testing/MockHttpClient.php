<?php
/**
 * Mock HTTP transport - AUTOMATED TESTS ONLY.
 *
 * Never used by the runtime module: the provider adapters receive a CurlClient
 * in production. Results produced with this transport are MOCK results and are
 * labelled as such in the test output and documentation; they do not prove that
 * a real Microsoft/Google/provider tenant behaves identically.
 *
 * @package    WHMCS
 * @subpackage hostx_email
 */

namespace HostxEmail\Testing;

use HostxEmail\Support\HttpClient;

final class MockHttpClient implements HttpClient
{
    /** @var array<int,array<string,mixed>> Queued responses (FIFO per matcher). */
    private $responses = [];

    /** @var array<int,array<string,mixed>> Every request that was made. */
    public $requests = [];

    /**
     * Queue a canned response.
     *
     * @param string $match substring matched against "METHOD url"
     * @param array<string,mixed>|string $body
     */
    public function on(string $match, int $status, $body = [], array $headers = [], bool $timedOut = false, string $error = ''): self
    {
        $this->responses[] = [
            'match'     => $match,
            'status'    => $status,
            'body'      => is_string($body) ? $body : (string) json_encode($body),
            'headers'   => $headers,
            'timed_out' => $timedOut,
            'error'     => $error,
            'used'      => false,
        ];

        return $this;
    }

    /**
     * {@inheritDoc}
     */
    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 20): array
    {
        $signature = strtoupper($method) . ' ' . $url;

        $this->requests[] = [
            'method'  => strtoupper($method),
            'url'     => $url,
            'headers' => $headers,
            'body'    => $body,
            'timeout' => $timeout,
        ];

        foreach ($this->responses as $index => $response) {
            if ($response['used'] || strpos($signature, $response['match']) === false) {
                continue;
            }

            $this->responses[$index]['used'] = true;

            return [
                'status'      => (int) $response['status'],
                'headers'     => (array) $response['headers'],
                'body'        => (string) $response['body'],
                'error'       => (string) $response['error'],
                'timed_out'   => (bool) $response['timed_out'],
                'duration_ms' => 1,
            ];
        }

        return [
            'status'      => 0,
            'headers'     => [],
            'body'        => '',
            'error'       => 'No mock response queued for ' . $signature,
            'timed_out'   => false,
            'duration_ms' => 0,
        ];
    }

    /**
     * The last request made, for assertions.
     *
     * @return array<string,mixed>|null
     */
    public function lastRequest(): ?array
    {
        return $this->requests ? $this->requests[count($this->requests) - 1] : null;
    }

    /**
     * Find the first recorded request whose URL contains $needle.
     *
     * @return array<string,mixed>|null
     */
    public function requestMatching(string $needle): ?array
    {
        foreach ($this->requests as $request) {
            if (strpos($request['url'], $needle) !== false) {
                return $request;
            }
        }

        return null;
    }

    public function reset(): void
    {
        $this->responses = [];
        $this->requests = [];
    }
}
