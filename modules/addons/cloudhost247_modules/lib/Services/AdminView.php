<?php
namespace CloudHost247\ModuleManager\Services;

use CloudHost247\ModuleManager\Install\InstallationPlan;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
use CloudHost247\ModuleManager\Support\Checksum;

/**
 * Server-rendered Module Manager UI.
 *
 * Every status shown here is read from the database or the filesystem; nothing
 * is simulated. No JavaScript is emitted, so no privileged action can be
 * triggered by a script, and every state change is a POST form carrying the
 * WHMCS CSRF token.
 */
final class AdminView
{
    private $link;

    public function __construct($moduleLink)
    {
        $this->link = (string) $moduleLink;
    }

    public function render(array $data)
    {
        $html = $this->header($data);
        switch ($data['view']) {
            case 'upload':
                $html .= $this->upload($data);
                break;
            case 'preview':
                $html .= $this->preview($data);
                break;
            case 'packages':
                $html .= $this->packages($data);
                break;
            case 'logs':
                $html .= $this->logs($data);
                break;
            case 'details':
                $html .= $this->details($data);
                break;
            default:
                $html .= $this->dashboard($data);
        }
        return $html . $this->footer($data);
    }

    /* -------------------------------------------------------------- chrome */

    private function header(array $data)
    {
        $html = '<h2>Module Manager</h2>'
            . '<p class="text-muted">Upload, validate, install, update, enable, disable and uninstall modules from this page. '
            . 'Installing a module places executable code on this server, so every action below is authenticated, authorised, CSRF protected and written to the administrator audit log.</p>';

        if (!$data['zip_available']) {
            $html .= '<div class="alert alert-danger"><strong>The PHP zip extension is not loaded.</strong> Module packages cannot be inspected or installed until it is enabled.</div>';
        }
        $storage = $data['storage'];
        if (!$storage['available']) {
            $html .= '<div class="alert alert-danger"><strong>Package storage is unavailable.</strong> ' . $this->e($storage['reason'])
                . ' Uploads are disabled until this is resolved.</div>';
        } else {
            $html .= '<p class="text-muted">Package storage: <code>' . $this->e($storage['root']) . '</code> (source: ' . $this->e($storage['source']) . ').'
                . ' Maximum package size ' . $this->e(round($data['max_upload'] / 1048576, 1)) . ' MiB.'
                . ' Runtime: PHP ' . $this->e($data['php_version'])
                . ($data['application_version'] !== '' ? ', application ' . $this->e($data['application_version']) : ', application version not detected') . '.</p>';
            if ($storage['inside_document_root']) {
                $html .= '<div class="alert alert-warning"><strong>Package storage is inside the web root.</strong> The directory has been restricted and web access denied, '
                    . 'but you should set <code>CH247_MODULE_STORAGE</code> to a path outside the document root.</div>';
            }
        }

        if ($data['notice']) { $html .= '<div class="alert alert-success">' . $this->e($data['notice']) . '</div>'; }
        if ($data['error']) { $html .= '<div class="alert alert-danger">' . $this->e($data['error']) . '</div>'; }

        $tabs = array('dashboard' => 'Installed modules', 'upload' => 'Upload module', 'packages' => 'Uploaded packages', 'logs' => 'Module logs');
        $html .= '<ul class="nav nav-tabs" style="margin-bottom:14px">';
        foreach ($tabs as $view => $label) {
            $active = ($data['view'] === $view || ($view === 'dashboard' && in_array($data['view'], array('details', 'preview'), true))) ? ' class="active"' : '';
            $html .= '<li' . $active . '><a href="' . $this->url(array('view' => $view)) . '">' . $this->e($label) . '</a></li>';
        }
        return $html . '</ul>';
    }

    private function footer(array $data)
    {
        $html = '<hr><h4>Your Module Manager permissions</h4><p class="text-muted">'
            . 'Module installation places executable code on this server, so these capabilities are restricted to Super Admin roles by default. '
            . 'They are managed under CloudHost247 Foundation.</p><ul>';
        foreach ($data['capabilities'] as $capability => $label) {
            $granted = $this->may($data, $capability);
            $html .= '<li><code>' . $this->e($capability) . '</code> — ' . $this->e($label) . ': '
                . '<span class="label ' . ($granted ? 'label-success' : 'label-default') . '">' . ($granted ? 'GRANTED' : 'NOT GRANTED') . '</span></li>';
        }
        return $html . '</ul><p class="text-muted">Every status on this page reflects the real state of the filesystem and the installation registry. '
            . 'A module is reported as installed only after its package was validated, inspected, extracted inside its own directory and verified against the recorded checksums.</p>';
    }

    /* ----------------------------------------------------------- dashboard */

    private function dashboard(array $data)
    {
        $html = '<h3>Installed modules</h3>';
        if (!$data['modules']) {
            return $html . '<p>No modules have been installed through the Module Manager yet. '
                . 'Use <a href="' . $this->url(array('view' => 'upload')) . '">Upload module</a> to add one.</p>';
        }
        $html .= '<table class="table table-striped"><thead><tr>'
            . '<th>Module</th><th>Version</th><th>Type</th><th>Status</th><th>Health</th><th>Last checked</th><th>Actions</th>'
            . '</tr></thead><tbody>';
        foreach ($data['modules'] as $entry) {
            $row = $entry['row'];
            $html .= '<tr><td><strong>' . $this->e($row->name) . '</strong><br><span class="text-muted">' . $this->e($row->module_id)
                . ' · ' . $this->e($row->author) . '</span></td>'
                . '<td>' . $this->e($row->version)
                . ($row->previous_version !== '' ? '<br><span class="text-muted">was ' . $this->e($row->previous_version) . '</span>' : '') . '</td>'
                . '<td>' . $this->e($entry['type_label']) . '</td>'
                . '<td>' . $this->statusLabel($row) . '</td>'
                . '<td>' . $this->healthLabel((string) $row->health_status) . '</td>'
                . '<td>' . $this->e($row->health_checked_at ? $row->health_checked_at : 'never') . '</td>'
                . '<td>' . $this->rowActions($row, $entry, $data) . '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function rowActions($row, array $entry, array $data)
    {
        $html = '<a class="btn btn-xs btn-primary" href="' . $this->url(array('view' => 'details', 'module' => $row->module_id)) . '">Details</a> ';
        if ($this->may($data, 'modules.configure')) {
            $html .= '<a class="btn btn-xs btn-default" href="' . $this->url(array('view' => 'details', 'module' => $row->module_id)) . '#configuration">Configure</a> ';
        }
        $html .= $this->miniForm($data['token'], 'verify', array('module_id' => $row->module_id), 'Verify', 'btn-default');
        if (!$entry['present']) {
            return $html . ' <span class="label label-danger">FILES MISSING</span>';
        }
        if ($this->may($data, 'modules.toggle')) {
            $html .= $this->miniForm(
                $data['token'],
                'toggle',
                array('module_id' => $row->module_id, 'enabled' => $row->enabled ? '0' : '1'),
                $row->enabled ? 'Disable' : 'Enable',
                $row->enabled ? 'btn-warning' : 'btn-success'
            );
        }
        return $html;
    }

    /* -------------------------------------------------------------- upload */

    private function upload(array $data)
    {
        $html = '<h3>Upload module package</h3>'
            . '<p>Select a <code>.zip</code> package containing a validated <code>module.json</code> manifest at its root. '
            . 'The package is inspected before anything is written to disk, and you will be shown an installation preview to confirm.</p>';

        if (!$this->may($data, 'modules.upload')) {
            return $html . '<div class="alert alert-warning">Your administrator role is not permitted to upload module packages. '
                . 'Module installation rights are restricted to Super Admin roles by default and can be granted under CloudHost247 Foundation.</div>';
        }
        if (!$data['storage']['available'] || !$data['zip_available']) {
            return $html . '<div class="alert alert-danger">Uploads are currently unavailable. Resolve the problem reported above and reload this page.</div>';
        }

        $html .= '<form method="post" enctype="multipart/form-data">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="upload">'
            . '<input type="hidden" name="MAX_FILE_SIZE" value="' . (int) $data['max_upload'] . '">'
            . '<div class="form-group"><label for="ch247-package">Module package (.zip)</label>'
            . '<input class="form-control" type="file" id="ch247-package" name="package" accept=".zip,application/zip" required></div>'
            . '<button class="btn btn-primary">Upload and validate</button> '
            . '<a class="btn btn-default" href="' . $this->url(array('view' => 'dashboard')) . '">Cancel</a></form>';

        $html .= '<hr><h4>What the platform checks before installing</h4><ol>'
            . '<li>PHP upload status, real byte size and the ' . $this->e(round($data['max_upload'] / 1048576, 1)) . ' MiB size limit.</li>'
            . '<li>File type: <code>.zip</code> name, ZIP signature bytes and detected MIME type.</li>'
            . '<li>SHA-256 checksum of the received bytes, recorded against every later event.</li>'
            . '<li>Archive inspection without extraction: entry names, sizes, compression ratios and permission bits.</li>'
            . '<li>Rejection of path traversal, absolute paths, symbolic links, special files, executable or setuid entries, encrypted entries, duplicate names and disallowed file types.</li>'
            . '<li>A valid <code>module.json</code> manifest declaring the module id, version, type and entry point.</li>'
            . '<li>Compatibility with this PHP version, this application version and the required PHP extensions.</li>'
            . '<li>Dependency and conflict resolution against the modules already installed.</li>'
            . '<li>Whether the module already exists, and whether this is an install, an update, a reinstall or a downgrade.</li>'
            . '<li>An installation preview that you must confirm before a single file is written.</li>'
            . '</ol>'
            . '<h4>Supported module types</h4><table class="table"><thead><tr><th>Type</th><th>Installed to</th></tr></thead><tbody>';
        foreach ($data['module_types'] as $key => $type) {
            $html .= '<tr><td><code>' . $this->e($key) . '</code> — ' . $this->e($type['label']) . '</td><td><code>' . $this->e($type['directory']) . '/&lt;module id&gt;</code></td></tr>';
        }
        return $html . '</tbody></table>';
    }

    /* ------------------------------------------------------------- preview */

    private function preview(array $data)
    {
        /** @var InstallationPlan $plan */
        $plan = $data['preview']['plan'];
        $summary = $data['preview']['summary'];
        $manifest = $plan->manifest();
        $files = $plan->files();

        $html = '<h3>Installation preview</h3>';
        $html .= '<dl class="dl-horizontal">'
            . '<dt>Module</dt><dd><strong>' . $this->e($summary['module']) . '</strong> <span class="text-muted">(' . $this->e($summary['module_id']) . ')</span></dd>'
            . '<dt>Version</dt><dd>' . $this->e($summary['version'])
            . ($summary['existing_version'] !== '' ? ' <span class="text-muted">(installed: ' . $this->e($summary['existing_version']) . ')</span>' : '') . '</dd>'
            . '<dt>Author</dt><dd>' . $this->e($summary['author']) . '</dd>'
            . '<dt>License</dt><dd>' . $this->e($summary['license']) . '</dd>'
            . '<dt>Type</dt><dd>' . $this->e($summary['type']) . '</dd>'
            . '<dt>PHP</dt><dd>' . $this->e($summary['php']) . '</dd>'
            . '<dt>Install path</dt><dd><code>' . $this->e($summary['install_path']) . '</code></dd>'
            . '<dt>Files</dt><dd>' . (int) $summary['files'] . ' (' . $this->e($summary['size']) . ')</dd>'
            . '<dt>Database changes</dt><dd>' . $this->e($summary['database_changes'])
            . ($plan->declaredTables() ? ' — ' . $this->e(implode(', ', $plan->declaredTables())) : '') . '</dd>'
            . '<dt>Configuration required</dt><dd>' . $this->e($summary['configuration_required']) . '</dd>'
            . '<dt>Permissions required</dt><dd>' . $this->e($summary['permissions'] ? implode(', ', $summary['permissions']) : 'none declared') . '</dd>'
            . '<dt>API integrations</dt><dd>' . $this->e($plan->integrations() ? implode(', ', $plan->integrations()) : 'none declared') . '</dd>'
            . '<dt>Checksum</dt><dd><code>' . $this->e($summary['checksum']) . '</code></dd>'
            . '</dl>';

        $html .= $this->checkTable('Compatibility', $plan->compatibility()['checks']);
        $html .= $this->dependencyTable($plan->dependencies()['rows']);

        $html .= '<h4>File changes</h4><p>'
            . '<span class="label label-success">' . count($files['new']) . ' new</span> '
            . '<span class="label label-warning">' . count($files['replaced']) . ' replaced</span> '
            . '<span class="label label-default">' . count($files['unchanged']) . ' unchanged</span> '
            . '<span class="label label-danger">' . count($files['orphaned']) . ' removed</span></p>';
        $html .= $this->fileList('Files that will be replaced', $files['replaced']);
        $html .= $this->fileList('Files that will be removed', $files['orphaned']);

        foreach ($plan->warnings() as $warning) {
            $html .= '<div class="alert alert-warning">' . $this->e($warning) . '</div>';
        }
        foreach ($plan->blockers() as $blocker) {
            $html .= '<div class="alert alert-danger">' . $this->e($blocker) . '</div>';
        }

        $html .= '<hr><form method="post">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="install">'
            . '<input type="hidden" name="checksum" value="' . $this->e($plan->checksum()) . '">';

        if (!$plan->installable()) {
            $html .= '<p class="text-danger"><strong>This package cannot be installed until the problems above are resolved.</strong></p>'
                . '<a class="btn btn-default" href="' . $this->url(array('view' => 'packages')) . '">Back to uploaded packages</a></form>';
            return $html;
        }

        $capability = $plan->isFreshInstall() ? 'modules.install' : 'modules.update';
        if (!$this->may($data, $capability)) {
            return $html . '<div class="alert alert-warning">Your administrator role is not permitted to '
                . ($plan->isFreshInstall() ? 'install new modules' : 'update installed modules')
                . '. This package was validated but not installed.</div>'
                . '<a class="btn btn-default" href="' . $this->url(array('view' => 'packages')) . '">Back to uploaded packages</a></form>';
        }

        if ($plan->requiresDowngradeConfirmation()) {
            $html .= '<div class="alert alert-danger"><strong>Downgrade warning.</strong> The uploaded version ' . $this->e($manifest->version())
                . ' is older than the installed version ' . $this->e($plan->existingVersion()) . '. Database changes made by the newer version are not reverted.'
                . '<div class="checkbox"><label><input type="checkbox" name="confirm_downgrade" value="1" required> I understand this is a downgrade.</label></div></div>';
        }
        $html .= '<div class="checkbox"><label><input type="checkbox" name="confirm_install" value="1" required> '
            . 'I confirm this package is from a trusted source and authorise it to install executable code on this server.</label></div>'
            . '<button class="btn btn-primary">' . $this->e($plan->actionLabel()) . '</button> '
            . '<a class="btn btn-default" href="' . $this->url(array('view' => 'packages')) . '">Cancel</a></form>';

        $html .= '<p class="text-muted" style="margin-top:10px">The existing module directory is backed up before any file is written. '
            . 'If any step fails, the previous version is restored and the failure is recorded in the module log.</p>';
        return $html;
    }

    /* ------------------------------------------------------------ packages */

    private function packages(array $data)
    {
        $html = '<h3>Uploaded packages</h3><p>Packages accepted by validation are stored outside the web root and can be previewed and installed. '
            . 'Rejected packages are recorded with the reason and are never stored.</p>';
        if (!count($data['packages'])) {
            return $html . '<p>No packages have been uploaded yet.</p>';
        }
        $html .= '<table class="table table-striped"><thead><tr><th>Package</th><th>Module</th><th>Version</th><th>Status</th><th>Uploaded</th><th>Checksum</th><th>Actions</th></tr></thead><tbody>';
        foreach ($data['packages'] as $package) {
            $html .= '<tr><td>' . $this->e($package->original_name) . '<br><span class="text-muted">' . (int) $package->file_count . ' file(s), '
                . $this->e(round(((int) $package->size_bytes) / 1024, 1)) . ' KiB</span></td>'
                . '<td>' . $this->e($package->module_name !== '' ? $package->module_name : '—') . '<br><span class="text-muted">' . $this->e($package->module_id) . '</span></td>'
                . '<td>' . $this->e($package->version) . '</td>'
                . '<td>' . $this->packageStatus($package) . '</td>'
                . '<td>' . $this->e($package->uploaded_at) . '</td>'
                . '<td><code>' . $this->e(Checksum::short($package->checksum)) . '</code></td><td>';
            if ((string) $package->status === 'validated' || (string) $package->status === 'installed') {
                $html .= $this->miniForm($data['token'], 'preview', array('checksum' => $package->checksum), 'Preview', 'btn-primary');
                if ($this->may($data, 'modules.upload')) {
                    $html .= $this->miniForm($data['token'], 'discard', array('checksum' => $package->checksum), 'Delete package', 'btn-default');
                }
            }
            $html .= '</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function packageStatus($package)
    {
        $status = (string) $package->status;
        $classes = array('validated' => 'label-info', 'installed' => 'label-success', 'rejected' => 'label-danger', 'uploaded' => 'label-default');
        $class = isset($classes[$status]) ? $classes[$status] : 'label-default';
        $html = '<span class="label ' . $class . '">' . $this->e(strtoupper($status)) . '</span>';
        if ($status === 'rejected' && (string) $package->rejected_reason !== '') {
            $html .= '<br><span class="text-muted">' . $this->e($package->rejected_reason) . '</span>';
        }
        return $html;
    }

    /* ------------------------------------------------------------- details */

    private function details(array $data)
    {
        $row = $data['module'];
        $manifest = $data['manifest'];
        $health = $data['health'];

        $html = '<h3>' . $this->e($row->name) . ' <small>' . $this->e($row->module_id) . '</small></h3>'
            . '<p>' . $this->e($row->description) . '</p>'
            . '<dl class="dl-horizontal">'
            . '<dt>Version</dt><dd>' . $this->e($row->version) . ($row->previous_version !== '' ? ' <span class="text-muted">(previously ' . $this->e($row->previous_version) . ')</span>' : '') . '</dd>'
            . '<dt>Type</dt><dd>' . $this->e(\CloudHost247\ModuleManager\Support\ModuleType::label((string) $row->module_type)) . '</dd>'
            . '<dt>Author</dt><dd>' . $this->e($row->author) . '</dd>'
            . '<dt>License</dt><dd>' . $this->e($row->license) . '</dd>'
            . '<dt>Install path</dt><dd><code>' . $this->e($row->install_path) . '</code></dd>'
            . '<dt>Entry point</dt><dd><code>' . $this->e($row->entry_point) . '</code></dd>'
            . '<dt>Status</dt><dd>' . $this->statusLabel($row) . '</dd>'
            . '<dt>Files</dt><dd>' . (int) $row->file_count . ' (' . $this->e(round(((int) $row->installed_bytes) / 1024, 1)) . ' KiB)</dd>'
            . '<dt>Package checksum</dt><dd><code>' . $this->e($row->package_checksum) . '</code></dd>'
            . '<dt>Installed</dt><dd>' . $this->e($row->installed_at) . ' by admin #' . (int) $row->installed_by . '</dd>'
            . '<dt>Last change</dt><dd>' . $this->e($row->updated_at) . '</dd>';
        if ($manifest) {
            $html .= '<dt>PHP</dt><dd>' . $this->e($manifest->phpRange()) . '</dd>'
                . '<dt>Permissions</dt><dd>' . $this->e($manifest->permissions() ? implode(', ', $manifest->permissions()) : 'none declared') . '</dd>'
                . '<dt>Database tables</dt><dd>' . $this->e($manifest->declaredTables() ? implode(', ', $manifest->declaredTables()) : 'none declared') . '</dd>';
            if ($manifest->documentation() !== '') {
                $html .= '<dt>Documentation</dt><dd><a href="' . $this->e($manifest->documentation()) . '" rel="noopener noreferrer" target="_blank">' . $this->e($manifest->documentation()) . '</a></dd>';
            }
        }
        $html .= '</dl>';

        $html .= '<h4>Integrity</h4><div class="alert ' . ($health['status'] === 'healthy' ? 'alert-success' : 'alert-warning') . '">'
            . '<strong>' . $this->e($this->healthText($health['status'])) . '.</strong> ' . $this->e($health['detail']) . '</div>';
        $html .= '<form method="post" style="display:inline">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="verify">'
            . '<input type="hidden" name="module_id" value="' . $this->e($row->module_id) . '">'
            . '<button class="btn btn-default">Re-verify files</button></form> ';
        if ($this->may($data, 'modules.toggle')) {
            $html .= $this->miniForm(
                $data['token'], 'toggle',
                array('module_id' => $row->module_id, 'enabled' => $row->enabled ? '0' : '1'),
                $row->enabled ? 'Disable module' : 'Enable module',
                $row->enabled ? 'btn-warning' : 'btn-success'
            );
        }

        if ($data['reinstall_checksum'] !== '' && ($this->may($data, 'modules.install') || $this->may($data, 'modules.update'))) {
            $html .= $this->miniForm(
                $data['token'], 'preview',
                array('checksum' => $data['reinstall_checksum']),
                'Reinstall from stored package',
                'btn-default'
            );
        }

        $html .= $this->configurationPanel($data, $manifest);
        $html .= $this->compatibilityPanel($data);
        $html .= $this->dependencyPanel($manifest, isset($data['dependency_check']) ? $data['dependency_check'] : null);
        $html .= $this->filesPanel($data['files']);
        $html .= $this->moduleEvents($data['module_events']);
        $html .= $this->uninstallPanel($data);
        return $html;
    }

    private function configurationPanel(array $data, $manifest)
    {
        $row = $data['module'];
        $html = '<hr><h4 id="configuration">Configuration</h4>';
        if ((string) $row->module_type === 'addon' && $row->enabled) {
            $html .= '<p><a class="btn btn-default" href="addonmodules.php?module=' . $this->e($row->module_id) . '">Open this module\'s own settings page</a></p>';
        } elseif ((string) $row->module_type === 'addon') {
            $html .= '<p class="text-muted">Enable the module to reach its own settings page.</p>';
        } elseif (in_array((string) $row->module_type, array('server', 'gateway', 'registrar'), true)) {
            $html .= '<p class="text-muted">Per-server and per-product settings for a ' . $this->e(\CloudHost247\ModuleManager\Support\ModuleType::label((string) $row->module_type))
                . ' are configured in the standard WHMCS screens (Setup &rarr; Products/Services). Credentials belong in the API &amp; Integrations vault below.</p>';
        }
        $integrations = isset($data['integration_status']) ? $data['integration_status'] : array();
        if (!$manifest || (!$manifest->requiresConfiguration() && !$integrations)) {
            return $html . '<p class="text-muted">This module declares no configuration requirements.</p>';
        }
        if ($integrations) {
            $html .= '<p>This module declares API requirements. Credentials are stored, encrypted and connection-tested by the central '
                . '<strong>API &amp; Integrations</strong> centre, never by the module itself.</p>'
                . '<table class="table"><thead><tr><th>Integration</th><th>Configured</th><th>Connection status</th><th>Action</th></tr></thead><tbody>';
            foreach ($integrations as $integration) {
                $html .= '<tr><td>' . $this->e($integration['label']) . '<br><span class="text-muted">' . $this->e($integration['provider']) . '</span></td>'
                    . '<td>' . ($integration['configured'] ? 'Yes' : 'No') . '</td>'
                    . '<td>' . $this->e($integration['status_label']) . '</td><td>';
                if ($integration['known']) {
                    $html .= '<a class="btn btn-xs btn-primary" href="' . $this->e(ModuleManager::integrationLink($integration['provider'])) . '">Configure</a> ';
                    if ($integration['configured'] && $this->may($data, 'modules.configure')) {
                        $html .= $this->miniForm(
                            $data['token'],
                            'test_integration',
                            array('module_id' => $row->module_id, 'provider' => $integration['provider']),
                            'Test connection',
                            'btn-default'
                        );
                    }
                } else {
                    $html .= '<span class="text-muted">Provider not registered</span>';
                }
                $html .= '</td></tr>';
            }
            $html .= '</tbody></table>';
        }
        if ($manifest->requiresConfiguration()) {
            $html .= $this->settingsForm($data, $manifest);
        }
        return $html;
    }

    /**
     * Editable form for the non-secret settings the manifest declares.
     * Values are stored by the Module Manager; credentials never appear here.
     */
    private function settingsForm(array $data, $manifest)
    {
        $row = $data['module'];
        $values = isset($data['settings']) ? $data['settings'] : array();
        $editable = $this->may($data, 'modules.configure');

        $html = '<h5>Module settings</h5>';
        $html .= '<form method="post">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="configure">'
            . '<input type="hidden" name="module_id" value="' . $this->e($row->module_id) . '">';

        foreach ($manifest->configuration()['fields'] as $field) {
            $key = $field['key'];
            $value = isset($values[$key]) ? (string) $values[$key] : '';
            $id = 'ch247-setting-' . preg_replace('/[^a-z0-9_]/', '', $key);
            $html .= '<div class="form-group"><label for="' . $this->e($id) . '">' . $this->e($field['label'])
                . ($field['required'] ? ' <span class="text-danger">*</span>' : '') . '</label>';

            if ($field['type'] === 'boolean') {
                $html .= '<div class="checkbox"><label><input type="checkbox" id="' . $this->e($id) . '" name="' . $this->e($key) . '" value="1"'
                    . ($value === '1' ? ' checked' : '') . ($editable ? '' : ' disabled') . '> Enabled</label></div>';
            } elseif ($field['type'] === 'select') {
                $html .= '<select class="form-control" id="' . $this->e($id) . '" name="' . $this->e($key) . '"' . ($editable ? '' : ' disabled') . '>';
                foreach ($field['options'] as $option) {
                    $html .= '<option value="' . $this->e($option) . '"' . ($option === $value ? ' selected' : '') . '>' . $this->e($option) . '</option>';
                }
                $html .= '</select>';
            } else {
                $bounds = '';
                if ($field['type'] === 'number') {
                    $bounds = ($field['min'] !== '' ? ' min="' . $this->e($field['min']) . '"' : '')
                        . ($field['max'] !== '' ? ' max="' . $this->e($field['max']) . '"' : '');
                }
                $html .= '<input class="form-control" id="' . $this->e($id) . '" type="' . ($field['type'] === 'number' ? 'number' : 'text') . '"'
                    . ' name="' . $this->e($key) . '" value="' . $this->e($value) . '"' . $bounds
                    . ($field['required'] ? ' required' : '') . ($editable ? '' : ' disabled') . ' autocomplete="off">';
            }

            $notes = $field['help'];
            if ($field['type'] === 'number' && ($field['min'] !== '' || $field['max'] !== '')) {
                $notes = trim($notes . ' Allowed range: ' . ($field['min'] !== '' ? $field['min'] : '−∞') . ' to ' . ($field['max'] !== '' ? $field['max'] : '∞') . '.');
            }
            if ($notes !== '') { $html .= '<span class="help-block">' . $this->e($notes) . '</span>'; }
            $html .= '</div>';
        }

        if ($editable) {
            $html .= '<button class="btn btn-primary">Save settings</button>';
        } else {
            $html .= '<div class="alert alert-warning">Your administrator role is not permitted to configure modules.</div>';
        }
        $html .= '</form>'
            . '<p class="text-muted" style="margin-top:8px">These are operational settings only. A manifest may not declare secret fields and '
            . 'credential-shaped keys are rejected at validation, so API keys, passwords and tokens are always stored in the encrypted '
            . 'API &amp; Integrations vault instead.</p>';
        return $html;
    }

    /** Live compatibility of an installed module with the runtime it is on today. */
    private function compatibilityPanel(array $data)
    {
        if (empty($data['compatibility_check'])) { return ''; }
        $check = $data['compatibility_check'];
        $html = '<hr><p class="text-muted">Compatibility is re-checked against this server right now, not against the values recorded at install time.</p>'
            . $this->checkTable('Compatibility check', $check['checks']);
        foreach ($check['problems'] as $problem) {
            $html .= '<div class="alert alert-danger">' . $this->e($problem) . '</div>';
        }
        foreach ($check['warnings'] as $warning) {
            $html .= '<div class="alert alert-warning">' . $this->e($warning) . '</div>';
        }
        return $html;
    }

    /**
     * Declared dependencies. When a live resolution is available the real
     * current state of each dependency is shown next to the requirement.
     */
    private function dependencyPanel($manifest, array $check = null)
    {
        if (!$manifest || (!$manifest->dependencies() && !$manifest->conflicts())) { return ''; }
        if ($check) {
            $html = '<hr>' . $this->dependencyTable($check['rows']);
            foreach ($check['problems'] as $problem) {
                $html .= '<div class="alert alert-danger">' . $this->e($problem) . '</div>';
            }
            foreach ($check['warnings'] as $warning) {
                $html .= '<div class="alert alert-warning">' . $this->e($warning) . '</div>';
            }
            return $html;
        }

        $html = '<hr><h4>Dependencies</h4><table class="table"><thead><tr><th>Module</th><th>Requirement</th><th>Optional</th></tr></thead><tbody>';
        foreach ($manifest->dependencies() as $dependency) {
            $range = $dependency['min_version'] !== '' ? $dependency['min_version'] . ' and above' : 'any version';
            if ($dependency['max_version'] !== '') { $range = $dependency['min_version'] . '–' . $dependency['max_version']; }
            $html .= '<tr><td><code>' . $this->e($dependency['id']) . '</code></td><td>' . $this->e($range) . '</td><td>'
                . ($dependency['optional'] ? 'Yes' : 'No') . '</td></tr>';
        }
        foreach ($manifest->conflicts() as $conflict) {
            $html .= '<tr><td><code>' . $this->e($conflict) . '</code></td><td>must not be installed</td><td>No</td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function filesPanel($files)
    {
        $count = count($files);
        $html = '<hr><h4>Installed files (' . (int) $count . ')</h4>';
        if (!$count) { return $html . '<p class="text-muted">No file manifest was recorded for this module.</p>'; }
        $html .= '<table class="table table-condensed"><thead><tr><th>Path</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>';
        $shown = 0;
        foreach ($files as $file) {
            if ($shown++ >= 200) { break; }
            $html .= '<tr><td><code>' . $this->e($file->relative_path) . '</code></td><td>' . (int) $file->bytes . '</td>'
                . '<td><code>' . $this->e(substr((string) $file->sha256, 0, 16)) . '…</code></td></tr>';
        }
        $html .= '</tbody></table>';
        if ($count > 200) { $html .= '<p class="text-muted">Showing the first 200 of ' . (int) $count . ' files.</p>'; }
        return $html;
    }

    private function uninstallPanel(array $data)
    {
        $impact = isset($data['uninstall_impact']) ? $data['uninstall_impact'] : null;
        if (!$impact) { return ''; }
        $row = $data['module'];

        $html = '<hr><h4>Uninstall</h4><p>Review exactly what will happen before confirming.</p><ul>'
            . '<li><strong>' . (int) $impact['file_count'] . ' file(s)</strong> recorded in the installation manifest will be removed from <code>' . $this->e($impact['directory']) . '</code>. Files added after installation are left in place.</li>'
            . '<li><strong>Database tables:</strong> ' . $this->e($impact['tables'] ? implode(', ', $impact['tables']) : 'none declared by this module')
            . '. These are <strong>retained</strong>. The Module Manager never drops a table or deletes customer or service data.</li>'
            . '<li><strong>API integrations:</strong> ' . $this->e($impact['integrations'] ? implode(', ', $impact['integrations']) : 'none declared')
            . '. Stored credentials remain in the API &amp; Integrations vault and can be removed there.</li>'
            . '<li><strong>Dependent modules:</strong> ' . $this->e($impact['dependents'] ? $this->dependentNames($impact['dependents']) : 'none') . '.</li>'
            . '<li><strong>Stored settings:</strong> ' . (int) $impact['settings_retained'] . ' saved value(s) are retained, not deleted.</li>'
            . '<li><strong>Currently ' . ($impact['enabled'] ? 'enabled' : 'disabled') . '.</strong> '
            . ($impact['enabled'] ? 'Services provisioned through this module stop working once its files are removed.' : '') . '</li>'
            . '</ul>';

        $html .= $this->usagePanel($impact['usage']);

        if (!$this->may($data, 'modules.uninstall')) {
            return $html . '<div class="alert alert-warning">Your administrator role is not permitted to uninstall modules.</div>';
        }
        if ($impact['dependents']) {
            return $html . '<div class="alert alert-danger">This module cannot be uninstalled while '
                . $this->e($this->dependentNames($impact['dependents'])) . ' depend(s) on it.</div>';
        }

        $html .= '<form method="post">'
            . '<input type="hidden" name="token" value="' . $this->e($data['token']) . '">'
            . '<input type="hidden" name="operation" value="uninstall">'
            . '<input type="hidden" name="module_id" value="' . $this->e($row->module_id) . '">'
            . '<div class="form-group"><label for="ch247-confirm-id">Type <code>' . $this->e($row->module_id) . '</code> to confirm</label>'
            . '<input class="form-control" id="ch247-confirm-id" name="confirm_module_id" autocomplete="off" required></div>';

        $usage = $impact['usage'];
        if ($usage['live'] === null || $usage['live'] > 0) {
            $html .= '<div class="checkbox"><label><input type="checkbox" name="confirm_usage" value="1" required> '
                . $this->e($usage['live'] === null
                    ? 'I understand that the live usage of this module could not be measured on this deployment.'
                    : 'I understand that ' . $usage['live'] . ' live record(s) still reference this module and will stop working.')
                . '</label></div>';
        }

        return $html . '<div class="checkbox"><label><input type="checkbox" name="confirm_uninstall" value="1" required> '
            . 'I have reviewed the impact above and authorise removal of this module\'s files.</label></div>'
            . '<button class="btn btn-danger">Uninstall module</button></form>';
    }

    /** Real WHMCS usage of the module, counted at render time. */
    private function usagePanel(array $usage)
    {
        $html = '<h5>Customers and services using this module</h5>'
            . '<table class="table table-condensed"><thead><tr><th>What</th><th>Count</th><th>Detail</th></tr></thead><tbody>';
        foreach ($usage['rows'] as $row) {
            $count = $row['known'] ? (string) (int) $row['count'] : 'unknown';
            $class = '';
            if ($row['known'] && $row['blocking'] && (int) $row['count'] > 0) { $class = ' class="warning"'; }
            if (!$row['known']) { $class = ' class="danger"'; }
            $html .= '<tr' . $class . '><td>' . $this->e($row['label']) . '</td>'
                . '<td><strong>' . $this->e($count) . '</strong></td>'
                . '<td>' . $this->e($row['detail']) . '</td></tr>';
        }
        $html .= '</tbody></table>';

        if (!$usage['measured']) {
            $html .= '<div class="alert alert-danger">Live usage could not be measured for: ' . $this->e(implode(', ', $usage['unmeasured']))
                . '. Confirm manually in WHMCS before uninstalling — no assumption is made here.</div>';
        } elseif ($usage['live'] > 0) {
            $html .= '<div class="alert alert-warning">' . (int) $usage['live'] . ' live record(s) still use this module. '
                . 'Uninstalling removes the module files only: customer accounts, services, invoices and domains are left exactly as they are, '
                . 'but they will no longer be manageable through this module.</div>';
        } else {
            $html .= '<div class="alert alert-success">No live customer service, domain or payment currently references this module.</div>';
        }
        return $html;
    }

    private function dependentNames(array $dependents)
    {
        $names = array();
        foreach ($dependents as $dependent) { $names[] = $dependent['id']; }
        return implode(', ', $names);
    }

    private function moduleEvents($events)
    {
        $html = '<hr><h4>Recent activity</h4>';
        if (!count($events['rows'])) { return $html . '<p class="text-muted">No events recorded for this module.</p>'; }
        return $html . $this->eventTable($events['rows']);
    }

    /* ---------------------------------------------------------------- logs */

    private function logs(array $data)
    {
        $events = $data['events'];
        $html = '<h3>Module logs</h3><p>Every upload, rejection, installation, update, enable, disable, uninstall, rollback and verification, '
            . 'with the administrator, the package checksum and the outcome. Credentials are never written here.</p>';

        $html .= '<form method="get" class="form-inline">' . $this->getContext(array('view' => 'logs'))
            . '<label>Module <input class="form-control" name="module_id" value="' . $this->e(isset($data['event_filters']['module_id']) ? $data['event_filters']['module_id'] : '') . '"></label> '
            . '<label>Type <select class="form-control" name="event_type"><option value="">All</option>';
        foreach ($data['event_types'] as $type => $label) {
            $selected = isset($data['event_filters']['event_type']) && $data['event_filters']['event_type'] === $type ? ' selected' : '';
            $html .= '<option value="' . $this->e($type) . '"' . $selected . '>' . $this->e($label) . '</option>';
        }
        $html .= '</select></label> <label>Result <select class="form-control" name="result"><option value="">All</option>';
        foreach (array('success' => 'Success', 'failed' => 'Failed', 'denied' => 'Denied') as $result => $label) {
            $selected = isset($data['event_filters']['result']) && $data['event_filters']['result'] === $result ? ' selected' : '';
            $html .= '<option value="' . $this->e($result) . '"' . $selected . '>' . $this->e($label) . '</option>';
        }
        $html .= '</select></label> <label>Page <input class="form-control" type="number" min="1" name="event_page" value="' . (int) $events['page'] . '" style="width:80px"></label> '
            . '<button class="btn btn-default">Filter</button></form><br>';

        if (!count($events['rows'])) { return $html . '<p>No module events recorded for this filter.</p>'; }
        return $html . $this->eventTable($events['rows'])
            . '<p class="text-muted">Page ' . (int) $events['page'] . ' of ' . (int) $events['pages'] . ' · ' . (int) $events['total'] . ' events.</p>';
    }

    private function eventTable($rows)
    {
        $html = '<table class="table table-striped"><thead><tr><th>When</th><th>Module</th><th>Event</th><th>Result</th><th>Version</th><th>Checksum</th><th>Admin</th><th>Detail</th><th>Reference</th></tr></thead><tbody>';
        foreach ($rows as $event) {
            $types = ModuleRepository::EVENT_TYPES;
            $label = isset($types[$event->event_type]) ? $types[$event->event_type] : $event->event_type;
            $version = trim((string) $event->version_from . ' → ' . (string) $event->version_to, ' →');
            $html .= '<tr><td>' . $this->e($event->created_at) . '</td>'
                . '<td>' . $this->e($event->module_id) . '</td>'
                . '<td>' . $this->e($label) . '</td>'
                . '<td><span class="label ' . ($event->result === 'success' ? 'label-success' : ($event->result === 'denied' ? 'label-warning' : 'label-danger')) . '">'
                . $this->e(strtoupper((string) $event->result)) . '</span></td>'
                . '<td>' . $this->e($version !== '' ? $version : '—') . '</td>'
                . '<td><code>' . $this->e($event->package_checksum !== '' ? Checksum::short($event->package_checksum) : '—') . '</code></td>'
                . '<td>' . ($event->admin_id ? '#' . (int) $event->admin_id : '—')
                . ($event->admin_ip !== '' ? '<br><span class="text-muted">' . $this->e($event->admin_ip) . '</span>' : '') . '</td>'
                . '<td>' . $this->e($event->detail) . '</td>'
                . '<td><code>' . $this->e(substr((string) $event->correlation_id, 0, 12)) . '</code></td></tr>';
        }
        return $html . '</tbody></table>';
    }

    /* ------------------------------------------------------------- helpers */

    private function checkTable($title, array $checks)
    {
        if (!$checks) { return ''; }
        $html = '<h4>' . $this->e($title) . '</h4><table class="table table-condensed"><thead><tr><th>Check</th><th>Required</th><th>This server</th><th>Result</th></tr></thead><tbody>';
        foreach ($checks as $check) {
            $html .= '<tr><td>' . $this->e($check['name']) . '</td><td>' . $this->e($check['required']) . '</td><td>' . $this->e($check['actual']) . '</td>'
                . '<td><span class="label ' . ($check['ok'] ? 'label-success' : 'label-danger') . '">' . ($check['ok'] ? 'PASS' : 'FAIL') . '</span></td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function dependencyTable(array $rows)
    {
        if (!$rows) { return '<h4>Dependencies</h4><p class="text-muted">This module declares no dependencies or conflicts.</p>'; }
        $labels = array('satisfied' => 'label-success', 'missing' => 'label-danger', 'version' => 'label-danger', 'disabled' => 'label-warning', 'conflict' => 'label-danger');
        $html = '<h4>Dependencies</h4><table class="table table-condensed"><thead><tr><th>Module</th><th>Required</th><th>Installed</th><th>Optional</th><th>Result</th></tr></thead><tbody>';
        foreach ($rows as $row) {
            $class = isset($labels[$row['status']]) ? $labels[$row['status']] : 'label-default';
            $html .= '<tr><td><code>' . $this->e($row['id']) . '</code></td><td>' . $this->e($row['required']) . '</td><td>' . $this->e($row['installed']) . '</td>'
                . '<td>' . ($row['optional'] ? 'Yes' : 'No') . '</td>'
                . '<td><span class="label ' . $class . '">' . $this->e(strtoupper($row['status'])) . '</span></td></tr>';
        }
        return $html . '</tbody></table>';
    }

    private function fileList($title, array $files)
    {
        if (!$files) { return ''; }
        $html = '<p><strong>' . $this->e($title) . ' (' . count($files) . ')</strong></p><ul>';
        foreach (array_slice($files, 0, 50) as $file) { $html .= '<li><code>' . $this->e($file) . '</code></li>'; }
        $html .= '</ul>';
        if (count($files) > 50) { $html .= '<p class="text-muted">…and ' . (count($files) - 50) . ' more.</p>'; }
        return $html;
    }

    private function miniForm($token, $operation, array $fields, $label, $class)
    {
        $html = '<form method="post" style="display:inline">'
            . '<input type="hidden" name="token" value="' . $this->e($token) . '">'
            . '<input type="hidden" name="operation" value="' . $this->e($operation) . '">';
        foreach ($fields as $name => $value) {
            $html .= '<input type="hidden" name="' . $this->e($name) . '" value="' . $this->e($value) . '">';
        }
        return $html . ' <button class="btn btn-xs ' . $this->e($class) . '">' . $this->e($label) . '</button></form> ';
    }

    private function statusLabel($row)
    {
        if ((string) $row->status === 'failed') { return '<span class="label label-danger">FAILED</span>'; }
        if ($row->enabled) { return '<span class="label label-success">ENABLED</span>'; }
        return '<span class="label label-default">DISABLED</span>';
    }

    private function healthLabel($status)
    {
        $map = array(
            'healthy' => array('label-success', 'VERIFIED'),
            'modified' => array('label-warning', 'MODIFIED'),
            'missing_files' => array('label-danger', 'FILES MISSING'),
            'not_installed' => array('label-danger', 'NOT INSTALLED'),
            'failed' => array('label-danger', 'FAILED'),
        );
        $entry = isset($map[$status]) ? $map[$status] : array('label-default', 'NOT VERIFIED');
        return '<span class="label ' . $entry[0] . '">' . $entry[1] . '</span>';
    }

    private function healthText($status)
    {
        $map = array(
            'healthy' => 'Files verified',
            'modified' => 'Files modified since installation',
            'missing_files' => 'Installed files are missing',
            'not_installed' => 'Not installed',
            'failed' => 'Last operation failed',
        );
        return isset($map[$status]) ? $map[$status] : 'Not verified yet';
    }

    private function getContext(array $parameters)
    {
        $html = '';
        parse_str((string) parse_url($this->link, PHP_URL_QUERY), $existing);
        foreach (array_merge(is_array($existing) ? $existing : array(), $parameters) as $key => $value) {
            if (!is_scalar($value)) { continue; }
            $html .= '<input type="hidden" name="' . $this->e($key) . '" value="' . $this->e($value) . '">';
        }
        return $html;
    }

    private function url(array $parameters)
    {
        $separator = strpos($this->link, '?') === false ? '?' : '&';
        return $this->e($this->link . $separator . http_build_query($parameters));
    }

    private function may(array $data, $capability)
    {
        return !isset($data['permitted'][$capability]) || !empty($data['permitted'][$capability]);
    }

    private function e($value)
    {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    }
}
