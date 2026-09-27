<?php
namespace CloudHost247\Theme;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\Logger;

final class AdminController
{
    private $repository;
    public function __construct(ThemeRepository $repository) { $this->repository = $repository; }
    public function handle()
    {
        $notice = ''; $error = '';
        try {
            AdminGuard::requireAdmin();
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                AdminGuard::requirePostToken();
                $operation = isset($_POST['operation']) ? $_POST['operation'] : '';
                if ($operation === 'settings') { $this->repository->saveSettings($_POST); $notice = 'Theme settings saved.'; }
                elseif ($operation === 'content') { $this->repository->saveContent($_POST); $notice = 'Content saved and is reflected in the client theme according to its publication state.'; }
                elseif ($operation === 'delete') { $this->repository->deleteContent((int) $_POST['id']); $notice = 'Content deleted.'; }
                else throw new \InvalidArgumentException('Unknown operation.');
                Logger::write('cloudhost247_theme', 'info', 'admin.' . $operation, array('admin_id' => $_SESSION['adminid']));
            }
        } catch (\Throwable $e) { $error = $e->getMessage(); Logger::write('cloudhost247_theme', 'error', 'admin.error', array('message' => $error)); }
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        return array('settings' => $this->repository->settings(), 'content' => $this->repository->all(), 'notice' => $notice, 'error' => $error, 'token' => $token);
    }
}
