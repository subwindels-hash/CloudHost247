<?php
/**
 * Base API Controller
 * Provides common utilities for REST controllers
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\API\Middleware\AuthMiddleware;
use PhoneServices\Core\Logger;
use PhoneServices\Core\Security;

class BaseController
{
    /**
     * Get JSON input from request body
     */
    protected function getInput(): array
    {
        $input = file_get_contents('php://input');
        $data = json_decode($input, true);
        return is_array($data) ? $data : [];
    }
    
    /**
     * Get authenticated user ID
     */
    protected function getUserId(): int
    {
        $contextUser = AuthMiddleware::userId();

        return $contextUser > 0 ? $contextUser : Security::currentClientId();
    }

    /**
     * Is the caller an internal/system principal (no specific client)?
     */
    protected function isSystemContext(): bool
    {
        $context = AuthMiddleware::getContext();

        return ($context['method'] ?? null) === 'webhook' || $this->getUserId() === 0;
    }

    /**
     * Reject the request unless the record belongs to the caller.
     */
    protected function ownsOrFail(string $table, int $recordId): bool
    {
        $userId = $this->getUserId();

        return $userId > 0 && Security::assertOwnership($table, $recordId, $userId);
    }

    /**
     * Uniform error envelope.
     *
     * @return array<string,mixed>
     */
    protected function error(string $message, int $status = 400): array
    {
        return ['success' => false, 'error' => $message, 'status_code' => $status];
    }

    /**
     * Uniform success envelope.
     *
     * @param mixed $data
     * @return array<string,mixed>
     */
    protected function ok($data = null, array $extra = []): array
    {
        return array_merge(['success' => true, 'data' => $data], $extra);
    }

    /**
     * Pagination helper: returns [limit, offset].
     *
     * @return array{0:int,1:int}
     */
    protected function pagination(int $defaultLimit = 50, int $maxLimit = 200): array
    {
        $limit = (int) ($_GET['limit'] ?? $defaultLimit);
        $limit = max(1, min($limit, $maxLimit));
        $page = max(1, (int) ($_GET['page'] ?? 1));

        return [$limit, ($page - 1) * $limit];
    }
    
    /**
     * Send JSON response
     */
    protected function json(array $data, int $status = 200): void
    {
        http_response_code($status);
        header('Content-Type: application/json');
        echo json_encode($data);
        exit;
    }
    
    /**
     * Validate required fields
     */
    protected function validate(array $data, array $required): ?string
    {
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return "Missing required field: {$field}";
            }
        }
        return null;
    }
    
    /**
     * Log API action
     */
    protected function log(string $action, array $context = []): void
    {
        Logger::info('[API] ' . $action, $context);
    }
}
