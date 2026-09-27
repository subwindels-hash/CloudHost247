<?php
/**
 * Base API Controller
 * Provides common utilities for REST controllers
 */

namespace PhoneServices\API\Controllers;

use PhoneServices\Core\Logger;

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
        if (isset($_SESSION['uid'])) {
            return (int) $_SESSION['uid'];
        }
        if (isset($_SESSION['api_user_id'])) {
            return (int) $_SESSION['api_user_id'];
        }
        return 0;
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
