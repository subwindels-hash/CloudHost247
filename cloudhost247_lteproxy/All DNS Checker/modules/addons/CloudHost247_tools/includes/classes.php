<?php
/**
 * CloudHost247 Tools - Core Classes
 */

if (!defined("WHMCS")) {
    die("This file cannot be accessed directly");
}

use Illuminate\Database\Capsule\Manager as Capsule;

/**
 * Admin Area Controller
 */
class CloudHost247ToolsAdmin
{
    protected $vars;
    protected $moduleLink;

    public function __construct($vars)
    {
        $this->vars = $vars;
        $this->moduleLink = $vars['modulelink'];
    }

    public function renderNavigation($active)
    {
        $tabs = [
            'dashboard' => ['label' => 'Dashboard', 'icon' => 'fa-tachometer-alt'],
            'tools' => ['label' => 'Tools Manager', 'icon' => 'fa-tools'],
            'logs' => ['label' => 'Activity Logs', 'icon' => 'fa-history'],
            'settings' => ['label' => 'Settings', 'icon' => 'fa-cog'],
        ];

        $html = '<div class="CloudHost247-admin-nav">
            <ul class="nav nav-tabs" role="tablist">';
        foreach ($tabs as $key => $tab) {
            $class = $active === $key ? 'active' : '';
            $html .= '<li class="' . $class . '">
                <a href="' . $this->moduleLink . '&action=' . $key . '">
                    <i class="fas ' . $tab['icon'] . '"></i> ' . $tab['label'] . '
                </a>
            </li>';
        }
        $html .= '</ul></div>';
        return $html;
    }

    public function renderDashboard()
    {
        $totalTools = Capsule::table('mod_CloudHost247_tools_status')->count();
        $enabledTools = Capsule::table('mod_CloudHost247_tools_status')->where('enabled', 1)->count();
        $totalLogs = Capsule::table('mod_CloudHost247_tools_logs')->count();
        $todayLogs = Capsule::table('mod_CloudHost247_tools_logs')
            ->where('created_at', '>=', date('Y-m-d 00:00:00'))
            ->count();

        $topTools = Capsule::table('mod_CloudHost247_tools_logs')
            ->select('tool_id', Capsule::raw('COUNT(*) as count'))
            ->groupBy('tool_id')
            ->orderBy('count', 'desc')
            ->limit(10)
            ->get();

        $recentLogs = Capsule::table('mod_CloudHost247_tools_logs')
            ->orderBy('id', 'desc')
            ->limit(10)
            ->get();

        return '<div class="CloudHost247-admin-content">
            <h2>Dashboard</h2>
            <div class="row">
                <div class="col-sm-3">
                    <div class="CloudHost247-stat-card">
                        <div class="stat-number">' . $totalTools . '</div>
                        <div class="stat-label">Total Tools</div>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="CloudHost247-stat-card CloudHost247-stat-success">
                        <div class="stat-number">' . $enabledTools . '</div>
                        <div class="stat-label">Enabled</div>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="CloudHost247-stat-card CloudHost247-stat-info">
                        <div class="stat-number">' . $todayLogs . '</div>
                        <div class="stat-label">Today Usage</div>
                    </div>
                </div>
                <div class="col-sm-3">
                    <div class="CloudHost247-stat-card CloudHost247-stat-warning">
                        <div class="stat-number">' . $totalLogs . '</div>
                        <div class="stat-label">Total Logs</div>
                    </div>
                </div>
            </div>
            <div class="row" style="margin-top:20px;">
                <div class="col-sm-6">
                    <div class="panel panel-default">
                        <div class="panel-heading"><i class="fa fa-chart-bar"></i> Top 10 Tools</div>
                        <div class="panel-body">
                            <table class="table table-striped table-condensed">
                                <thead><tr><th>Tool</th><th>Uses</th></tr></thead>
                                <tbody>';
        foreach ($topTools as $tool) {
            $toolInfo = CloudHost247_tools_get_tool_info($tool->tool_id);
            $name = $toolInfo ? $toolInfo['name'] : $tool->tool_id;
            $html .= '<tr><td>' . htmlspecialchars($name) . '</td><td>' . $tool->count . '</td></tr>';
        }
        $html .= '</tbody></table></div></div></div>
                <div class="col-sm-6">
                    <div class="panel panel-default">
                        <div class="panel-heading"><i class="fa fa-history"></i> Recent Activity</div>
                        <div class="panel-body">
                            <table class="table table-striped table-condensed">
                                <thead><tr><th>Tool</th><th>IP</th><th>Time</th></tr></thead>
                                <tbody>';
        foreach ($recentLogs as $log) {
            $toolInfo = CloudHost247_tools_get_tool_info($log->tool_id);
            $name = $toolInfo ? $toolInfo['name'] : $log->tool_id;
            $html .= '<tr>
                <td>' . htmlspecialchars($name) . '</td>
                <td>' . htmlspecialchars($log->ip_address) . '</td>
                <td>' . $log->created_at . '</td>
            </tr>';
        }
        $html .= '</tbody></table></div></div></div></div></div>';
        return $html;
    }

    public function renderToolsManager()
    {
        if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['tool_action'])) {
            $this->handleToolAction();
        }

        $categories = CloudHost247_tools_get_all_tools();
        $statuses = Capsule::table('mod_CloudHost247_tools_status')
            ->pluck('enabled', 'tool_id')
            ->toArray();

        $html = '<div class="CloudHost247-admin-content">
            <h2>Tools Manager</h2>
            <form method="post" action="' . $this->moduleLink . '&action=tools">';

        foreach ($categories as $category => $tools) {
            $catLabel = ucfirst($category);
            $html .= '<div class="panel panel-default">
                <div class="panel-heading"><i class="fa fa-folder"></i> ' . $catLabel . ' Tools</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th width="40"><input type="checkbox" class="check-all" data-cat="' . $category . '"></th>
                                <th>Tool Name</th>
                                <th>Tool ID</th>
                                <th>Status</th>
                            </tr>
                        </thead>
                        <tbody>';
            foreach ($tools as $toolId => $toolData) {
                $isEnabled = isset($statuses[$toolId]) ? (int) $statuses[$toolId] : 1;
                $statusBadge = $isEnabled
                    ? '<span class="label label-success">Enabled</span>'
                    : '<span class="label label-default">Disabled</span>';
                $html .= '<tr>
                    <td><input type="checkbox" name="tools[]" value="' . $toolId . '" class="tool-check-' . $category . '" ' . ($isEnabled ? 'checked' : '') . '></td>
                    <td><i class="fas ' . $toolData['icon'] . '"></i> ' . htmlspecialchars($toolData['name']) . '</td>
                    <td><code>' . $toolId . '</code></td>
                    <td>' . $statusBadge . '</td>
                </tr>';
            }
            $html .= '</tbody></table></div></div>';
        }

        $html .= '<div class="form-group">
            <button type="submit" name="tool_action" value="save" class="btn btn-primary">
                <i class="fa fa-save"></i> Save Changes
            </button>
        </div></form></div>';

        return $html;
    }

    protected function handleToolAction()
    {
        if ($_POST['tool_action'] === 'save') {
            $selected = $_POST['tools'] ?? [];
            $allTools = [];
            foreach (CloudHost247_tools_get_all_tools() as $cat => $tools) {
                foreach ($tools as $id => $data) {
                    $allTools[] = $id;
                }
            }

            foreach ($allTools as $toolId) {
                Capsule::table('mod_CloudHost247_tools_status')
                    ->where('tool_id', $toolId)
                    ->update(['enabled' => in_array($toolId, $selected) ? 1 : 0]);
            }

            echo '<div class="alert alert-success">Tool settings saved successfully.</div>';
        }
    }

    public function renderLogs()
    {
        $page = isset($_GET['page']) ? max(1, (int) $_GET['page']) : 1;
        $perPage = 50;
        $toolFilter = isset($_GET['tool_filter']) ? htmlspecialchars($_GET['tool_filter']) : '';

        $query = Capsule::table('mod_CloudHost247_tools_logs')->orderBy('id', 'desc');
        if ($toolFilter) {
            $query->where('tool_id', $toolFilter);
        }

        $total = $query->count();
        $logs = $query->offset(($page - 1) * $perPage)->limit($perPage)->get();
        $totalPages = ceil($total / $perPage);

        $html = '<div class="CloudHost247-admin-content">
            <h2>Activity Logs</h2>
            <div class="well well-sm">
                <form method="get" action="' . $this->moduleLink . '" class="form-inline">
                    <input type="hidden" name="module" value="CloudHost247_tools">
                    <input type="hidden" name="action" value="logs">
                    <div class="form-group">
                        <select name="tool_filter" class="form-control">
                            <option value="">All Tools</option>';
        foreach (CloudHost247_tools_get_all_tools() as $cat => $tools) {
            foreach ($tools as $id => $data) {
                $sel = $toolFilter === $id ? 'selected' : '';
                $html .= '<option value="' . $id . '" ' . $sel . '>' . htmlspecialchars($data['name']) . '</option>';
            }
        }
        $html .= '</select>
                    </div>
                    <button type="submit" class="btn btn-default">Filter</button>
                </form>
            </div>
            <table class="table table-striped table-bordered">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Tool</th>
                        <th>Input</th>
                        <th>IP Address</th>
                        <th>User ID</th>
                        <th>Status</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>';
        foreach ($logs as $log) {
            $toolInfo = CloudHost247_tools_get_tool_info($log->tool_id);
            $name = $toolInfo ? $toolInfo['name'] : $log->tool_id;
            $statusClass = $log->status === 'success' ? 'label-success' : 'label-danger';
            $html .= '<tr>
                <td>' . $log->id . '</td>
                <td>' . htmlspecialchars($name) . '</td>
                <td>' . htmlspecialchars(substr($log->input, 0, 80)) . '</td>
                <td>' . htmlspecialchars($log->ip_address) . '</td>
                <td>' . ($log->user_id ?: 'Guest') . '</td>
                <td><span class="label ' . $statusClass . '">' . $log->status . '</span></td>
                <td>' . $log->created_at . '</td>
            </tr>';
        }
        $html .= '</tbody></table>';

        if ($totalPages > 1) {
            $html .= '<nav><ul class="pagination">';
            for ($i = 1; $i <= $totalPages; $i++) {
                $class = $i === $page ? 'active' : '';
                $html .= '<li class="' . $class . '"><a href="' . $this->moduleLink . '&action=logs&page=' . $i . '&tool_filter=' . $toolFilter . '">' . $i . '</a></li>';
            }
            $html .= '</ul></nav>';
        }

        $html .= '</div>';
        return $html;
    }

    public function renderSettings()
    {
        return '<div class="CloudHost247-admin-content">
            <h2>Settings</h2>
            <div class="alert alert-info">
                <i class="fa fa-info-circle"></i> Module settings are configured through the <strong>Addon Modules</strong> list. Click "Configure" next to CloudHost247 Tools Platform to manage API keys and global settings.
            </div>
            <div class="panel panel-default">
                <div class="panel-heading">Cache Management</div>
                <div class="panel-body">
                    <p>Cached tool results will expire automatically based on the configured duration.</p>
                    <a href="' . $this->moduleLink . '&action=settings&clear_cache=1" class="btn btn-warning" onclick="return confirm(\'Clear all cached results?\');">
                        <i class="fa fa-trash"></i> Clear Cache Now
                    </a>
                </div>
            </div>
        </div>';
    }
}

/**
 * Client Area Controller
 */
class CloudHost247ToolsClient
{
    protected $vars;
    protected $baseUrl;
    protected $templatePath;
    protected $assetsUrl;

    public function __construct($vars)
    {
        $this->vars = $vars;
        $this->baseUrl = 'index.php?m=CloudHost247_tools';
        $this->templatePath = __DIR__ . '/templates/client/';
        $this->assetsUrl = 'modules/addons/CloudHost247_tools/assets/';
    }

    public function handleRequest()
    {
        $action = isset($_GET['action']) ? htmlspecialchars($_GET['action']) : 'dashboard';
        $tool = isset($_GET['tool']) ? htmlspecialchars($_GET['tool']) : '';

        // AJAX handler
        if ($action === 'ajax' && $_SERVER['REQUEST_METHOD'] === 'POST') {
            return $this->handleAjax();
        }

        // Individual tool page
        if ($action === 'tool' && $tool) {
            return $this->renderToolPage($tool);
        }

        // Category page
        if ($action === 'category' && isset($_GET['cat'])) {
            return $this->renderCategoryPage(htmlspecialchars($_GET['cat']));
        }

        // Dashboard
        return $this->renderDashboard();
    }

    protected function renderDashboard()
    {
        $categories = CloudHost247_tools_get_enabled_tools();
        $csrf = CloudHost247_tools_generate_csrf();

        return [
            'pagetitle' => 'Online Tools Platform',
            'breadcrumb' => [
                'index.php?m=CloudHost247_tools' => 'Tools Platform',
            ],
            'templatefile' => 'dashboard',
            'requirelogin' => false,
            'vars' => [
                'categories' => $categories,
                'csrf_token' => $csrf,
                'base_url' => $this->baseUrl,
                'assets_url' => $this->assetsUrl,
            ],
        ];
    }

    protected function renderCategoryPage($category)
    {
        $allTools = CloudHost247_tools_get_enabled_tools();
        if (!isset($allTools[$category])) {
            return $this->renderDashboard();
        }

        $categoryLabel = ucfirst($category);

        return [
            'pagetitle' => $categoryLabel . ' Tools',
            'breadcrumb' => [
                'index.php?m=CloudHost247_tools' => 'Tools Platform',
                'index.php?m=CloudHost247_tools&action=category&cat=' . $category => $categoryLabel . ' Tools',
            ],
            'templatefile' => 'category',
            'requirelogin' => false,
            'vars' => [
                'category' => $category,
                'category_label' => $categoryLabel,
                'tools' => $allTools[$category],
                'csrf_token' => CloudHost247_tools_generate_csrf(),
                'base_url' => $this->baseUrl,
                'assets_url' => $this->assetsUrl,
            ],
        ];
    }

    protected function renderToolPage($toolId)
    {
        $toolInfo = CloudHost247_tools_get_tool_info($toolId);
        if (!$toolInfo || !CloudHost247_tools_is_tool_enabled($toolId)) {
            return $this->renderDashboard();
        }

        $categoryLabel = ucfirst($toolInfo['category']);

        return [
            'pagetitle' => $toolInfo['name'],
            'breadcrumb' => [
                'index.php?m=CloudHost247_tools' => 'Tools Platform',
                'index.php?m=CloudHost247_tools&action=category&cat=' . $toolInfo['category'] => $categoryLabel . ' Tools',
                'index.php?m=CloudHost247_tools&action=tool&tool=' . $toolId => $toolInfo['name'],
            ],
            'templatefile' => 'tool',
            'requirelogin' => false,
            'vars' => [
                'tool' => $toolInfo,
                'categories' => CloudHost247_tools_get_enabled_tools(),
                'csrf_token' => CloudHost247_tools_generate_csrf(),
                'base_url' => $this->baseUrl,
                'assets_url' => $this->assetsUrl,
            ],
        ];
    }

    protected function handleAjax()
    {
        header('Content-Type: application/json');

        $ip = CloudHost247_tools_get_client_ip();
        $maxRequests = (int) CloudHost247_tools_get_setting('rate_limit_requests', '60');

        if (!CloudHost247_tools_check_rate_limit($ip, $maxRequests)) {
            echo json_encode(['success' => false, 'message' => 'Rate limit exceeded. Please wait a moment.']);
            exit;
        }

        $toolId = $_POST['tool'] ?? '';
        $token = $_POST['csrf_token'] ?? '';

        if (!CloudHost247_tools_verify_csrf($token)) {
            echo json_encode(['success' => false, 'message' => 'Invalid security token.']);
            exit;
        }

        if (!$toolId || !CloudHost247_tools_is_tool_enabled($toolId)) {
            echo json_encode(['success' => false, 'message' => 'Tool not found or disabled.']);
            exit;
        }

        // Include tool implementations
        $category = CloudHost247_tools_get_tool_info($toolId)['category'] ?? '';
        $toolFile = __DIR__ . '/includes/tools/' . $category . '_tools.php';

        if (!file_exists($toolFile)) {
            echo json_encode(['success' => false, 'message' => 'Tool implementation not found.']);
            exit;
        }

        require_once $toolFile;

        $handler = 'CloudHost247_tool_' . str_replace(['-', '.'], '_', $toolId);

        if (!function_exists($handler)) {
            echo json_encode(['success' => false, 'message' => 'Tool handler not implemented yet: ' . $handler]);
            exit;
        }

        try {
            $result = call_user_func($handler, $_POST);
            CloudHost247_tools_log($toolId, $_POST, $result, 'success');
            echo json_encode(['success' => true, 'data' => $result]);
        } catch (\Exception $e) {
            CloudHost247_tools_log($toolId, $_POST, '', 'error', $e->getMessage());
            echo json_encode(['success' => false, 'message' => $e->getMessage()]);
        }

        exit;
    }
}
