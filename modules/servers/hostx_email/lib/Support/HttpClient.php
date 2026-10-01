<?php
/**
 * HTTP transport contract.
 *
 * Provider adapters depend on this interface, never on curl directly, so the
 * automated tests can drive them with a mock transport (see
 * lib/Testing/MockHttpClient.php) without touching the network.
 *
 * @package    WHMCS
 * @subpackage CloudHost247 Email Hosting
 */

namespace CloudHost247\Email\Support;

interface HttpClient
{
    /**
     * Perform an HTTP request.
     *
     * Implementations must never throw: transport problems are returned as
     * ['status' => 0, 'error' => '...'] so the caller can distinguish a refused
     * connection (safe to retry) from a timeout after the request was sent
     * (NOT safe to retry - reconcile instead).
     *
     * @param  string               $method  GET|POST|PUT|PATCH|DELETE
     * @param  string               $url     absolute https URL
     * @param  array<string,string> $headers
     * @param  string|null          $body    raw request body
     * @return array{status:int,headers:array<string,string>,body:string,error:string,timed_out:bool,duration_ms:int}
     */
    public function request(string $method, string $url, array $headers = [], ?string $body = null, int $timeout = 20): array;
}
