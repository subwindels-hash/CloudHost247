<?php
namespace CloudHost247\NetworkTools\Core\Registry;

/**
 * One registered tool.
 *
 * A definition is code-owned data: slug, category, description, inputs, the
 * service that performs the work, which capabilities and providers it needs,
 * its risk tier, cache TTL and export formats. What an administrator may change
 * (status, visibility, limits, timeouts, provider binding) lives in the
 * database and is merged by the runner, never edited here.
 */
final class ToolDefinition
{
    const VISIBILITY_PUBLIC = 'public';
    const VISIBILITY_CUSTOMER = 'customer';
    const VISIBILITY_ADMIN = 'admin';

    private $data;
    private $fields = array();

    public function __construct($slug, array $data)
    {
        $this->data = array_merge(array(
            'slug' => $slug,
            'name' => $slug,
            'category' => 'developer',
            'icon' => 'tool',
            'summary' => '',
            'description' => '',
            'explanation' => '',
            'visibility' => self::VISIBILITY_PUBLIC,
            'rate_tier' => 'standard',
            'timeout_seconds' => 15,
            'cache_seconds' => 0,
            'providers' => array(),
            'capabilities' => array(),
            'exports' => array('json'),
            'fields' => array(),
            'handler' => '',
            'method' => 'run',
            'target_field' => '',
            'result_view' => 'table',
            'notes' => array(),
            'high_risk' => false,
            'client_only' => false,
            'requires_provider' => false,
            'history' => 'metadata',
        ), $data);
        $this->data['slug'] = $slug;
        foreach ((array) $this->data['fields'] as $field) {
            $this->fields[] = $field instanceof ToolField ? $field : new ToolField((array) $field);
        }
    }

    public function slug()
    {
        return (string) $this->data['slug'];
    }

    public function name()
    {
        return (string) $this->data['name'];
    }

    public function category()
    {
        return (string) $this->data['category'];
    }

    public function icon()
    {
        return (string) $this->data['icon'];
    }

    public function summary()
    {
        return (string) $this->data['summary'];
    }

    public function description()
    {
        return $this->data['description'] !== '' ? (string) $this->data['description'] : (string) $this->data['summary'];
    }

    public function explanation()
    {
        return (string) $this->data['explanation'];
    }

    public function visibility()
    {
        return (string) $this->data['visibility'];
    }

    public function requiresAuth()
    {
        return $this->visibility() !== self::VISIBILITY_PUBLIC;
    }

    public function isAdminOnly()
    {
        return $this->visibility() === self::VISIBILITY_ADMIN;
    }

    public function rateTier()
    {
        return (string) $this->data['rate_tier'];
    }

    public function isHighRisk()
    {
        return (bool) $this->data['high_risk'] || $this->rateTier() === 'high_risk';
    }

    public function timeoutSeconds()
    {
        return max(1, min(60, (int) $this->data['timeout_seconds']));
    }

    public function cacheSeconds()
    {
        return max(0, min(86400, (int) $this->data['cache_seconds']));
    }

    public function providers()
    {
        return (array) $this->data['providers'];
    }

    public function capabilities()
    {
        return (array) $this->data['capabilities'];
    }

    public function exports()
    {
        return (array) $this->data['exports'];
    }

    public function handler()
    {
        return (string) $this->data['handler'];
    }

    public function method()
    {
        return (string) $this->data['method'];
    }

    public function targetField()
    {
        return (string) $this->data['target_field'];
    }

    public function resultView()
    {
        return (string) $this->data['result_view'];
    }

    /** True when the work happens in the browser and the server never sees the data. */
    public function isClientOnly()
    {
        return (bool) $this->data['client_only'];
    }

    /** True when the tool cannot produce any result without a configured provider. */
    public function requiresProvider()
    {
        return (bool) $this->data['requires_provider'];
    }

    public function historyPolicy()
    {
        $policy = (string) $this->data['history'];
        return in_array($policy, array('metadata', 'tool_only', 'none'), true) ? $policy : 'metadata';
    }

    /** True when at least one input field carries a credential or private content. */
    public function hasSensitiveInput()
    {
        foreach ($this->fields as $field) {
            if ($field->isSensitive() || $field->type() === 'password') {
                return true;
            }
        }
        return false;
    }

    public function notes()
    {
        return (array) $this->data['notes'];
    }

    /** @return ToolField[] */
    public function fields()
    {
        return $this->fields;
    }

    public function field($name)
    {
        foreach ($this->fields as $field) {
            if ($field->name() === $name) {
                return $field;
            }
        }
        return null;
    }

    /** @return array<string,mixed> raw catalog row (for the admin UI) */
    public function raw()
    {
        return $this->data;
    }

    /**
     * Validate a whole submission against the schema.
     *
     * @return array array('ok'=>bool,'input'=>array,'message'=>string)
     */
    public function validateInput(array $input)
    {
        $clean = array();
        foreach ($this->fields as $field) {
            if ($field->type() === 'checkbox') {
                $clean[$field->name()] = $field->validate(isset($input[$field->name()]) ? $input[$field->name()] : false);
                continue;
            }
            $value = isset($input[$field->name()]) ? $input[$field->name()] : '';
            try {
                $clean[$field->name()] = $field->validate($value);
            } catch (\InvalidArgumentException $invalid) {
                return array('ok' => false, 'input' => array(), 'message' => $invalid->getMessage());
            }
        }
        return array('ok' => true, 'input' => $clean, 'message' => '');
    }

    /** A safe label for logs/history: the declared target field only. */
    public function targetLabel(array $input)
    {
        $field = $this->targetField();
        if ($field === '' || !isset($input[$field])) {
            return '';
        }
        $value = $input[$field];
        if (is_array($value)) {
            $value = implode(',', array_slice($value, 0, 8));
        }
        return substr((string) $value, 0, 191);
    }

    /** Serialisable descriptor for templates and the tool catalog API. */
    public function toArray()
    {
        $fields = array();
        foreach ($this->fields as $field) {
            $fields[] = $field->toArray();
        }
        return array(
            'slug' => $this->slug(),
            'name' => $this->name(),
            'category' => $this->category(),
            'icon' => $this->icon(),
            'summary' => $this->summary(),
            'description' => $this->description(),
            'explanation' => $this->explanation(),
            'visibility' => $this->visibility(),
            'requires_auth' => $this->requiresAuth(),
            'rate_tier' => $this->rateTier(),
            'timeout_seconds' => $this->timeoutSeconds(),
            'cache_seconds' => $this->cacheSeconds(),
            'providers' => $this->providers(),
            'capabilities' => $this->capabilities(),
            'exports' => $this->exports(),
            'fields' => $fields,
            'result_view' => $this->resultView(),
            'notes' => $this->notes(),
            'client_only' => $this->isClientOnly(),
            'requires_provider' => $this->requiresProvider(),
            'history_policy' => $this->historyPolicy(),
            'has_sensitive_input' => $this->hasSensitiveInput(),
        );
    }
}
