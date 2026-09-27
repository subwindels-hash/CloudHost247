<?php

declare(strict_types=1);

namespace CloudHost247\LTEProxy;

/**
 * CloudHost247 LTE Proxy API Exception
 *
 * Custom exception class for API-related errors with additional context.
 *
 * @package CloudHost247\LTEProxy
 * @version 1.0.0
 */
class ApiException extends \Exception
{
    /** @var array|null Additional error data */
    private ?array $errorData;

    /** @var string|null Error code from API */
    private ?string $errorCode;

    /** @var string|null Request endpoint that caused the error */
    private ?string $endpoint;

    /** @var string|null HTTP method used */
    private ?string $httpMethod;

    /** @var array|null Request body sent */
    private ?array $requestBody;

    /** @var string Timestamp when the error occurred */
    private string $timestamp;

    /**
     * Constructor
     *
     * @param string $message Error message
     * @param int $code HTTP status code or error code
     * @param array|null $errorData Additional error data from API
     * @param string|null $endpoint API endpoint
     * @param string|null $httpMethod HTTP method
     * @param array|null $requestBody Request body
     * @param \Throwable|null $previous Previous exception
     */
    public function __construct(
        string $message = '',
        int $code = 0,
        ?array $errorData = null,
        ?string $endpoint = null,
        ?string $httpMethod = null,
        ?array $requestBody = null,
        ?\Throwable $previous = null
    ) {
        parent::__construct($message, $code, $previous);

        $this->errorData = $errorData;
        $this->errorCode = $errorData['code'] ?? $errorData['error_code'] ?? null;
        $this->endpoint = $endpoint;
        $this->httpMethod = $httpMethod;
        $this->requestBody = $requestBody;
        $this->timestamp = date('Y-m-d H:i:s');
    }

    /**
     * Get additional error data
     *
     * @return array|null
     */
    public function getErrorData(): ?array
    {
        return $this->errorData;
    }

    /**
     * Get API error code
     *
     * @return string|null
     */
    public function getErrorCode(): ?string
    {
        return $this->errorCode;
    }

    /**
     * Get request endpoint
     *
     * @return string|null
     */
    public function getEndpoint(): ?string
    {
        return $this->endpoint;
    }

    /**
     * Get HTTP method
     *
     * @return string|null
     */
    public function getHttpMethod(): ?string
    {
        return $this->httpMethod;
    }

    /**
     * Get request body
     *
     * @return array|null
     */
    public function getRequestBody(): ?array
    {
        return $this->requestBody;
    }

    /**
     * Get error timestamp
     *
     * @return string
     */
    public function getTimestamp(): string
    {
        return $this->timestamp;
    }

    /**
     * Check if error is an authentication error
     *
     * @return bool
     */
    public function isAuthError(): bool
    {
        return $this->code === 401 || $this->code === 403;
    }

    /**
     * Check if error is a rate limit error
     *
     * @return bool
     */
    public function isRateLimitError(): bool
    {
        return $this->code === 429;
    }

    /**
     * Check if error is a server error
     *
     * @return bool
     */
    public function isServerError(): bool
    {
        return $this->code >= 500;
    }

    /**
     * Check if error is a client error (4xx)
     *
     * @return bool
     */
    public function isClientError(): bool
    {
        return $this->code >= 400 && $this->code < 500;
    }

    /**
     * Check if error is retryable
     *
     * @return bool
     */
    public function isRetryable(): bool
    {
        return $this->isServerError() || $this->isRateLimitError() || $this->code === 0;
    }

    /**
     * Get detailed error information as array
     *
     * @return array
     */
    public function toArray(): array
    {
        return [
            'message' => $this->getMessage(),
            'code' => $this->getCode(),
            'error_code' => $this->errorCode,
            'endpoint' => $this->endpoint,
            'http_method' => $this->httpMethod,
            'timestamp' => $this->timestamp,
            'error_data' => $this->errorData,
            'is_auth_error' => $this->isAuthError(),
            'is_rate_limit' => $this->isRateLimitError(),
            'is_retryable' => $this->isRetryable(),
        ];
    }

    /**
     * Get user-friendly error message
     *
     * @return string
     */
    public function getUserMessage(): string
    {
        if ($this->isAuthError()) {
            return 'Authentication failed. Please check your API credentials.';
        }

        if ($this->isRateLimitError()) {
            return 'Too many requests. Please wait a moment and try again.';
        }

        if ($this->isServerError()) {
            return 'The proxy service is temporarily unavailable. Please try again later.';
        }

        return $this->getMessage();
    }
}
