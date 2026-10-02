<?php
namespace CloudHost247\NetworkTools\Core\Controller;

use CloudHost247\NetworkTools\Core\Repository\ExecutionLogRepository;
use CloudHost247\NetworkTools\Core\Repository\FavoritesRepository;
use CloudHost247\NetworkTools\Core\Repository\ReportRepository;
use CloudHost247\NetworkTools\Core\Registry\ToolCategories;
use CloudHost247\NetworkTools\Core\Registry\ToolDefinition;
use CloudHost247\NetworkTools\Core\Registry\ToolRegistry;
use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Core\Runner\ToolRunner;
use CloudHost247\NetworkTools\Ui\ResultPresenter;

/**
 * Shared controller used by the client-area front controller, the admin control
 * centre and the REST endpoint.
 *
 * It owns no permission decision of its own: the actor is derived from the real
 * WHMCS session (or from an authenticated API token), and every run goes through
 * ToolRunner, which re-checks visibility, operator state, provider readiness,
 * capability availability, input validation and rate limits. A controller that
 * skips this class cannot reach a service.
 */
final class ToolController
{
    /** @var ToolRunner */
    private $runner;
    /** @var FavoritesRepository */
    private $favorites;
    /** @var ExecutionLogRepository */
    private $executions;
    /** @var ReportRepository */
    private $reports;
    /** @var ResultPresenter */
    private $presenter;

    public function __construct(ToolRunner $runner = null)
    {
        $this->runner = $runner ?: new ToolRunner();
        $this->favorites = new FavoritesRepository();
        $this->executions = new ExecutionLogRepository();
        $this->reports = new ReportRepository();
        $this->presenter = new ResultPresenter();
    }

    public function runner()
    {
        return $this->runner;
    }

    /**
     * Actor context.
     *
     * @param string $area client|admin|api
     * @return array
     */
    public function context($area = 'client', array $overrides = array())
    {
        $clientId = isset($_SESSION['uid']) ? (int) $_SESSION['uid'] : 0;
        $adminId = isset($_SESSION['adminid']) ? (int) $_SESSION['adminid'] : 0;
        $actor = 'guest';
        if ($area === 'api') {
            $actor = 'api';
        } elseif ($area === 'admin' && $adminId > 0) {
            $actor = 'admin';
        } elseif ($clientId > 0) {
            $actor = 'customer';
        }
        $context = array(
            'actor' => $actor,
            'client_id' => $clientId,
            'admin_id' => $adminId,
            'ip' => isset($_SERVER['REMOTE_ADDR']) ? (string) $_SERVER['REMOTE_ADDR'] : '',
            'request' => $area,
        );
        return array_merge($context, $overrides);
    }

    /** The catalogue, filtered and annotated for one audience. */
    public function catalog(array $options = array())
    {
        $audience = isset($options['audience']) ? $options['audience'] : 'public';
        $category = isset($options['category']) ? (string) $options['category'] : '';
        $term = isset($options['q']) ? (string) $options['q'] : '';
        $clientId = isset($options['client_id']) ? (int) $options['client_id'] : 0;
        $definitions = $term !== '' ? ToolRegistry::search($term, $audience) : ToolRegistry::visibleTo($audience);
        $favoriteSlugs = $clientId > 0 ? $this->favorites->all($clientId) : array();
        $items = array();
        foreach ($definitions as $definition) {
            if ($category !== '' && $definition->category() !== $category) {
                continue;
            }
            if ($audience !== 'admin' && $definition->isAdminOnly()) {
                continue;
            }
            $status = $this->runner->status($definition);
            $items[] = array_merge($definition->toArray(), array(
                'status' => $status,
                'available' => in_array($status['state'], array('ACTIVE', 'CONFIGURATION_REQUIRED', 'SERVICE_UNAVAILABLE'), true),
                'favorite' => in_array($definition->slug(), $favoriteSlugs, true),
                'url' => $this->url($definition->slug()),
            ));
        }
        usort($items, function ($a, $b) {
            $aReady = $a['status']['state'] === 'ACTIVE' ? 0 : 1;
            $bReady = $b['status']['state'] === 'ACTIVE' ? 0 : 1;
            if ($aReady !== $bReady) {
                return $aReady - $bReady;
            }
            return strcmp($a['name'], $b['name']);
        });
        return array(
            'items' => $items,
            'total' => count($items),
            'categories' => $this->categoryCounts($audience, $clientId),
            'filters' => array('q' => $term, 'category' => $category),
        );
    }

    private function categoryCounts($audience, $clientId)
    {
        $counts = array();
        foreach (ToolRegistry::visibleTo($audience) as $definition) {
            if ($audience !== 'admin' && $definition->isAdminOnly()) {
                continue;
            }
            $category = $definition->category();
            if (!isset($counts[$category])) {
                $counts[$category] = array(
                    'id' => $category,
                    'name' => ToolCategories::name($category),
                    'icon' => ToolCategories::icon($category),
                    'count' => 0,
                );
            }
            $counts[$category]['count']++;
        }
        return array_values($counts);
    }

    public function definition($slug)
    {
        return ToolRegistry::get($slug);
    }

    /**
     * Form descriptors for one tool, with dynamic option lists resolved from
     * the registry the field declares (currently the resolver registry).
     *
     * @return array
     */
    public function fields(ToolDefinition $definition, array $prefill = array())
    {
        $fields = array();
        foreach ($definition->fields() as $field) {
            $descriptor = $field->definition();
            $descriptor['sensitive'] = $field->isSensitive();
            $descriptor['required'] = $field->isRequired();
            $descriptor['value'] = null;
            if (!$descriptor['sensitive'] && array_key_exists($field->name(), $prefill)) {
                $descriptor['value'] = is_scalar($prefill[$field->name()]) ? (string) $prefill[$field->name()] : null;
            }
            if (!empty($descriptor['dynamic']) && in_array($descriptor['type'], array('select', 'multiselect'), true)) {
                $descriptor['options'] = $this->dynamicOptions($field->name());
                $descriptor['dynamic'] = true;
            }
            if ($descriptor['type'] === 'multiselect' && !isset($descriptor['options'])) {
                $descriptor['options'] = array();
            }
            $fields[] = $descriptor;
        }
        return $fields;
    }

    /**
     * Dynamic option lists. Only the resolver registry is dynamic today; every
     * other dynamic field stays empty and the template shows the field's help
     * text instead of inventing choices.
     */
    private function dynamicOptions($fieldName)
    {
        if (strpos(strtolower((string) $fieldName), 'resolver') === false) {
            return array();
        }
        $options = array();
        $repository = new \CloudHost247\NetworkTools\Core\Repository\ResolverRepository();
        foreach ($repository->all(true) as $row) {
            $label = (string) $row->name . ' — ' . (string) $row->ip_address . ' (' . strtoupper((string) $row->protocol) . ')';
            $options[(string) $row->id] = $label;
        }
        return $options;
    }

    /** Presented result of one run, ready for the template or the JSON envelope. */
    public function run($slug, array $rawInput, array $context = array(), $area = 'client')
    {
        $context = $context ?: $this->context($area);
        $definition = ToolRegistry::get($slug);
        if ($definition === null) {
            $result = ToolResult::failure('NOT_FOUND', 'That tool does not exist.');
            return array('ok' => false, 'definition' => null, 'result' => $result, 'presented' => $this->presenter->present($result), 'status' => array('state' => 'UNKNOWN', 'label' => 'Unknown', 'tone' => 'info', 'detail' => '', 'operator_state' => 'UNKNOWN'));
        }
        $clean = null;
        $validation = $definition->validateInput($rawInput);
        if ($validation['ok']) {
            $clean = $validation['input'];
        }
        $outcome = $this->runner->run($slug, $rawInput, $context);
        $result = $outcome['result'];
        if ($clean !== null && !$definition->isClientOnly()) {
            $this->runner->recordHistory($definition, $context, $clean, $result);
        }
        return array(
            'ok' => $result->isOk(),
            'definition' => $definition,
            'input' => $clean === null ? array() : $this->safeInput($definition, $clean),
            'result' => $result,
            'presented' => $this->presenter->present($result, $slug, array('slug' => $slug, 'exports' => $definition->exports())),
            'status' => $outcome['status'],
        );
    }

    /**
     * Input as it may be echoed back into a form: a field declared sensitive is
     * never returned to the browser, in the page or in any JSON payload.
     */
    private function safeInput(ToolDefinition $definition, array $clean)
    {
        $safe = array();
        foreach ($definition->fields() as $field) {
            $name = $field->name();
            if ($field->isSensitive()) {
                continue;
            }
            if (array_key_exists($name, $clean)) {
                $safe[$name] = $clean[$name];
            }
        }
        return $safe;
    }

    public function toggleFavorite($clientId, $slug)
    {
        $definition = ToolRegistry::get($slug);
        if ($definition === null || (int) $clientId <= 0) {
            return false;
        }
        if ($this->favorites->has($clientId, $slug)) {
            return $this->favorites->remove($clientId, $slug);
        }
        return $this->favorites->add($clientId, $slug);
    }

    public function favorites($clientId)
    {
        $items = array();
        foreach ($this->favorites->all((int) $clientId) as $slug) {
            $definition = ToolRegistry::get($slug);
            if ($definition === null) {
                continue;
            }
            $items[] = array_merge($definition->toArray(), array('url' => $this->url($slug)));
        }
        return $items;
    }

    public function history($clientId, $limit = 50)
    {
        $rows = $this->executions->historyFor((int) $clientId, $limit);
        $items = array();
        foreach ($rows as $row) {
            $definition = ToolRegistry::get(isset($row->tool_slug) ? $row->tool_slug : '');
            $items[] = array(
                'tool_slug' => isset($row->tool_slug) ? (string) $row->tool_slug : '',
                'tool_name' => $definition ? $definition->name() : (string) $row->tool_slug,
                'url' => $definition ? $this->url($definition->slug()) : '',
                'target' => isset($row->target_label) ? (string) $row->target_label : '',
                'result_code' => isset($row->result_code) ? (string) $row->result_code : '',
                'ok' => !empty($row->ok),
                'summary' => isset($row->summary) ? (string) $row->summary : '',
                'created_at' => isset($row->created_at) ? (string) $row->created_at : '',
            );
        }
        return $items;
    }

    public function clearHistory($clientId)
    {
        return $this->executions->clearHistory((int) $clientId);
    }

    public function reports($clientId)
    {
        return $this->reports->all((int) $clientId);
    }

    public function saveReport($clientId, $slug, $targetLabel, array $payload, $title = '')
    {
        $definition = ToolRegistry::get($slug);
        if ($definition === null || (int) $clientId <= 0) {
            return 0;
        }
        if ($title === '') {
            $title = $definition->name() . ($targetLabel !== '' ? ' — ' . $targetLabel : '') . ' (' . gmdate('Y-m-d H:i') . ' UTC)';
        }
        $id = $this->reports->create((int) $clientId, $slug, $targetLabel, $payload, $title);
        if ($id > 0) {
            $this->reports->retention((int) $clientId, 60);
        }
        return $id;
    }

    /**
     * A downloadable representation of a result.
     *
     * JSON and CSV are produced server-side from the exact payload. PDF is
     * produced by the browser's print pipeline (a print view, so no PDF library
     * is bundled into a WHMCS addon), and PNG/SVG are drawn client-side from the
     * same data. The export list says which engine handles each format instead
     * of pretending a file was generated.
     *
     * @return array{ok:bool,filename:string,content_type:string,body:string,generator:string}
     */
    public function export(array $presented, $format, $slug)
    {
        $format = strtolower((string) $format);
        $definition = ToolRegistry::get($slug);
        $base = 'cloudhost247-' . str_replace('/', '-', $slug) . '-' . gmdate('Ymd-His');
        if ($format === 'json') {
            return array(
                'ok' => true,
                'filename' => $base . '.json',
                'content_type' => 'application/json; charset=utf-8',
                'body' => json_encode(array(
                    'tool' => $slug,
                    'tool_name' => $definition ? $definition->name() : $slug,
                    'generated_at' => gmdate('c'),
                    'generated_by' => 'CloudHost247 Network Tools',
                    'success' => $presented['ok'],
                    'code' => $presented['code'],
                    'message' => $presented['message'],
                    'warnings' => $presented['warnings'],
                    'data' => json_decode($presented['json'], true),
                ), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE),
                'generator' => 'server',
            );
        }
        if ($format === 'csv') {
            $lines = array();
            $lines[] = $this->csvRow(array('CloudHost247 Network Tools', $definition ? $definition->name() : $slug, $slug));
            $lines[] = $this->csvRow(array('Generated', gmdate('c')));
            $lines[] = $this->csvRow(array('Status', $presented['ok'] ? 'Success' : $presented['code'], $presented['message']));
            foreach ($presented['warnings'] as $warning) {
                $lines[] = $this->csvRow(array('Warning', $warning));
            }
            foreach ($presented['rows'] as $row) {
                $lines[] = $this->csvRow(array($row['label'], $row['value']));
            }
            foreach ($presented['sections'] as $section) {
                foreach ($section['rows'] as $row) {
                    $lines[] = $this->csvRow(array($section['label'] . ' / ' . $row['label'], $row['value']));
                }
            }
            foreach ($presented['tables'] as $table) {
                $lines[] = '';
                $lines[] = $this->csvRow(array($table['label']));
                $lines[] = $this->csvRow(array_map(function ($column) {
                    return $column['label'];
                }, $table['columns']));
                foreach ($table['rows'] as $cells) {
                    $lines[] = $this->csvRow(array_map(function ($cell) {
                        return $cell['value'];
                    }, $cells));
                }
            }
            return array('ok' => true, 'filename' => $base . '.csv', 'content_type' => 'text/csv; charset=utf-8', 'body' => implode("\r\n", $lines) . "\r\n", 'generator' => 'server');
        }
        if ($format === 'txt') {
            $body = '';
            foreach ($presented['rows'] as $row) {
                $body .= $row['label'] . ': ' . $row['value'] . "\n";
            }
            foreach ($presented['tables'] as $table) {
                $body .= "\n" . $table['label'] . "\n";
                foreach ($table['rows'] as $cells) {
                    $parts = array();
                    foreach ($cells as $cell) {
                        $parts[] = $cell['label'] . '=' . $cell['value'];
                    }
                    $body .= implode(' | ', $parts) . "\n";
                }
            }
            if ($body === '') {
                $body = json_encode(json_decode($presented['json'], true), JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n";
            }
            return array('ok' => true, 'filename' => $base . '.txt', 'content_type' => 'text/plain; charset=utf-8', 'body' => $body, 'generator' => 'server');
        }
        return array('ok' => false, 'filename' => '', 'content_type' => 'text/plain; charset=utf-8', 'body' => '', 'generator' => 'browser');
    }

    private function csvRow(array $values)
    {
        $cells = array();
        foreach ($values as $value) {
            $value = (string) $value;
            $value = preg_replace('/[\r\n]+/', ' ', $value);
            $cells[] = '"' . str_replace('"', '""', $value) . '"';
        }
        return implode(',', $cells);
    }

    /** Canonical URL builder so a route change is a one-line edit. */
    public function url($slug = '', array $params = array())
    {
        $url = 'tools.php';
        if ($slug !== '') {
            $params = array_merge(array('tool' => $slug), $params);
        }
        return $params ? $url . '?' . http_build_query($params) : $url;
    }

    /**
     * Tools that make sense in the context of one domain the customer owns.
     * Only the domain string is passed on; the runner still validates it.
     */
    public function domainShortcuts($domain)
    {
        $shortcuts = array(
            'dns/health' => 'DNS health',
            'dns/propagation' => 'DNS propagation',
            'dns/mx' => 'MX records',
            'dns/spf' => 'SPF',
            'dns/dkim' => 'DKIM',
            'dns/dmarc' => 'DMARC',
            'dns/dnssec' => 'DNSSEC',
            'security/ssl' => 'SSL certificate',
            'developer/http-headers' => 'HTTP headers',
            'diagnostics/domain-health' => 'Domain health centre',
        );
        $items = array();
        foreach ($shortcuts as $slug => $label) {
            $definition = ToolRegistry::get($slug);
            if ($definition === null) {
                continue;
            }
            $status = $this->runner->status($definition);
            $items[] = array(
                'slug' => $slug,
                'label' => $label,
                'state' => $status['state'],
                'url' => $this->url($slug, $this->prefill($slug, $domain)),
            );
        }
        return $items;
    }

    private function prefill($slug, $domain)
    {
        $definition = ToolRegistry::get($slug);
        if ($definition === null) {
            return array();
        }
        $target = $definition->targetField();
        return $target ? array($target => $domain) : array();
    }
}
