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
        $notice = ''; $error = ''; $preview = null; $visual = null;
        try {
            AdminGuard::requireAdmin();
            if ($_SERVER['REQUEST_METHOD'] === 'POST') {
                AdminGuard::requirePostToken();
                // Kept together with the operations that decide the guard: the
                // capability and the CSRF token are both required before any
                // posted value reaches the repository.
                $operation = isset($_POST['operation']) ? $_POST['operation'] : '';
                $capability = in_array($operation,array('delete','content','translation','localized_preview','reorder','visual_preview'),true) ? 'content.manage' : 'settings.manage';
                AdminGuard::requireCapability('cloudhost247_theme',$capability);
                if (($operation === 'delete' || ($operation === 'content' && !empty($_POST['published']))) && empty($_POST['confirm'])) throw new \InvalidArgumentException('Explicit publication or deletion confirmation is required.');
                $before = $operation === 'settings' ? $this->repository->settings() : $this->repository->all();
                if ($operation === 'settings') { $this->repository->saveSettings($_POST); $notice = 'Theme settings saved.'; }
                elseif ($operation === 'content') { $this->repository->saveContent($_POST); $notice = 'Content saved and is reflected in the client theme according to its publication state.'; }
                elseif ($operation === 'translation') { $this->repository->saveTranslation($_POST); $notice = 'Localized content saved with base-content fallback.'; }
                elseif ($operation === 'reorder') { $moved = $this->repository->reorder($_POST); $notice = 'Content order saved (' . $moved . ' items).'; }
                elseif ($operation === 'visual_preview') { $visual = $this->visualPreview($_POST); $notice = 'Visual preview generated from the submitted values without saving.'; }
                elseif ($operation === 'localized_preview') { $preview = $this->repository->previewTranslation($_POST); $notice = 'Localized preview generated without saving or publishing.'; }
                elseif ($operation === 'preview') { $preview = $this->repository->preview($_POST); $notice = 'Safe preview generated without publishing or saving.'; }
                elseif ($operation === 'delete') { $this->repository->deleteContent((int) $_POST['id']); $notice = 'Content deleted.'; }
                else throw new \InvalidArgumentException('Unknown operation.');
                Logger::write('cloudhost247_theme', 'info', 'admin.' . $operation, array('admin_id' => $_SESSION['adminid']));
                if (!in_array($operation,array('preview','localized_preview','visual_preview'),true)) AuditLogger::record('cloudhost247_theme','content.'.$operation,'cms',$operation,$before,$operation==='settings'?$this->repository->settings():$this->repository->all(),'success',null,$_SESSION['adminid']);
            }
        } catch (\Throwable $e) { $error = $e->getMessage(); Logger::write('cloudhost247_theme', 'error', 'admin.error', array('message' => $error)); }
        $token = function_exists('generate_token') ? generate_token('plain') : '';
        return array('settings' => $this->repository->settings(), 'content' => $this->repository->all(), 'preview' => $preview, 'visual' => $visual, 'notice' => $notice, 'error' => $error, 'token' => $token, 'audit'=>Capsule::table('mod_cloudhost247_audit_events')->where('module','cloudhost247_theme')->orderBy('id','desc')->limit(100)->get()->all());
    }

    /**
     * Preview of the submitted values: saved settings overlaid with the posted
     * ones, plus an unsaved content row when the form carried one. Read-only.
     */
    private function visualPreview(array $input)
    {
        $saved = $this->repository->settings();
        $settings = array_merge($saved, array_intersect_key($input, $saved));
        $content = array();
        $title = trim(strip_tags(isset($input['title']) ? (string) $input['title'] : ''));
        if ($title !== '') {
            $type = isset($input['content_type']) && in_array($input['content_type'], ThemeRepository::TYPES, true) ? (string) $input['content_type'] : 'page';
            $content[] = array(
                'id' => 0, 'content_type' => $type, 'slug' => '', 'title' => $title,
                'published' => true, 'sort_order' => 0,
                'summary' => isset($input['summary']) ? (string) $input['summary'] : '',
                'body' => isset($input['body']) ? (string) $input['body'] : '',
            );
        }
        foreach ($this->repository->all() as $item) { $content[] = $item; }
        return $this->repository->visualPreview($settings, $content);
    }
}
