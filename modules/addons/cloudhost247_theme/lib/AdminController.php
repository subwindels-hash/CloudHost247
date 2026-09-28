<?php
namespace CloudHost247\Theme;

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\Logger;
use CloudHost247\Foundation\Support\AuditLogger;
use WHMCS\Database\Capsule;

final class AdminController
{
    private $repository;
    public function __construct(ThemeRepository $repository) { $this->repository = $repository; }
    public function handle()
    {
        $notice = ''; $error = ''; $preview = null;
        try {
            AdminGuard::requireAdmin();
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                AdminGuard::requirePostToken();
                $operation = isset($_POST['operation']) ? $_POST['operation'] : '';
                $capability = in_array($operation,array('delete','content','translation','localized_preview'),true) ? 'content.manage' : 'settings.manage';
                AdminGuard::requireCapability('cloudhost247_theme',$capability);
                if (($operation === 'delete' || ($operation === 'content' && !empty($_POST['published']))) && empty($_POST['confirm'])) throw new \InvalidArgumentException('Explicit publication or deletion confirmation is required.');
                $before = $operation === 'settings' ? $this->repository->settings() : $this->repository->all();
                if ($operation === 'settings') { $this->repository->saveSettings($_POST); $notice = 'Theme settings saved.'; }
                elseif ($operation === 'content') { $this->repository->saveContent($_POST); $notice = 'Content saved and is reflected in the client theme according to its publication state.'; }
                elseif ($operation === 'translation') { $this->repository->saveTranslation($_POST); $notice = 'Localized content saved with base-content fallback.'; }
                elseif ($operation === 'localized_preview') { $preview = $this->repository->previewTranslation($_POST); $notice = 'Localized preview generated without saving or publishing.'; }
                elseif ($operation === 'preview') { $preview = $this->repository->preview($_POST); $notice = 'Safe preview generated without publishing or saving.'; }
                elseif ($operation === 'delete') { $this->repository->deleteContent((int) $_POST['id']); $notice = 'Content deleted.'; }
                else throw new \InvalidArgumentException('Unknown operation.');
                Logger::write('cloudhost247_theme', 'info', 'admin.' . $operation, array('admin_id' => $_SESSION['adminid']));
                if (!in_array($operation,array('preview','localized_preview'),true)) AuditLogger::record('cloudhost247_theme','content.'.$operation,'cms',$operation,$before,$operation==='settings'?$this->repository->settings():$this->repository->all(),'success',null,$_SESSION['adminid']);
            }
        } catch (\Throwable $e) { $error = $e->getMessage(); Logger::write('cloudhost247_theme', 'error', 'admin.error', array('message' => $error)); }
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        return array('settings' => $this->repository->settings(), 'content' => $this->repository->all(), 'preview' => $preview, 'notice' => $notice, 'error' => $error, 'token' => $token, 'audit'=>Capsule::table('mod_cloudhost247_audit_events')->where('module','cloudhost247_theme')->orderBy('id','desc')->limit(100)->get()->all());
    }
}
