<?php
namespace CloudHost247\NetworkTools\Core\Registry;

use CloudHost247\NetworkTools\Core\Security\TargetValidator;
use InvalidArgumentException;

/**
 * One input field of one tool.
 *
 * The same schema renders the form, validates the submission server-side and
 * documents the REST API, so validation can never drift from the UI. Fields
 * marked sensitive are never logged, never cached, never exported and never
 * included in a support ticket; the runner strips them from the recorded
 * payload.
 */
final class ToolField
{
    private $definition;

    public function __construct(array $definition)
    {
        $this->definition = array_merge(array(
            'name' => '',
            'type' => 'text',
            'label' => '',
            'required' => false,
            'default' => '',
            'placeholder' => '',
            'help' => '',
            'options' => array(),
            'min' => null,
            'max' => null,
            'maxlength' => 255,
            'sensitive' => false,
            'target' => false,
            'rows' => 6,
            'autocomplete' => 'off',
        ), $definition);
    }

    public function name()
    {
        return (string) $this->definition['name'];
    }

    public function type()
    {
        return (string) $this->definition['type'];
    }

    public function label()
    {
        return $this->definition['label'] !== '' ? (string) $this->definition['label'] : ucfirst(str_replace('_', ' ', $this->name()));
    }

    public function isRequired()
    {
        return (bool) $this->definition['required'];
    }

    public function isSensitive()
    {
        return (bool) $this->definition['sensitive'];
    }

    public function isTarget()
    {
        return (bool) $this->definition['target'];
    }

    public function definition()
    {
        return $this->definition;
    }

    public function default_()
    {
        return $this->definition['default'];
    }

    public function options()
    {
        return is_array($this->definition['options']) ? $this->definition['options'] : array();
    }

    public function help()
    {
        return (string) $this->definition['help'];
    }

    /**
     * Validate and normalise one submitted value.
     *
     * @param mixed $value
     * @return mixed normalised value
     * @throws InvalidArgumentException with a safe, user-facing message
     */
    public function validate($value)
    {
        $type = $this->type();
        if ($type === 'checkbox') {
            return in_array($value, array(true, 1, '1', 'on', 'true', 'yes'), true);
        }
        $value = is_array($value) ? $value : (string) $value;
        $isEmpty = is_array($value) ? count($value) === 0 : trim((string) $value) === '';
        if ($isEmpty) {
            if ($this->isRequired()) {
                throw new InvalidArgumentException($this->label() . ' is required.');
            }
            return $this->default_();
        }
        switch ($type) {
            case 'number':
                $min = $this->definition['min'] === null ? 0 : (int) $this->definition['min'];
                $max = $this->definition['max'] === null ? PHP_INT_MAX : (int) $this->definition['max'];
                return TargetValidator::integer($value, $min, $max, strtolower($this->label()));
            case 'select':
                if (!empty($this->definition['dynamic'])) {
                    // The option list is built at render time (for example the
                    // resolver registry); the value is checked by the service.
                    return TargetValidator::text($value, 96, strtolower($this->label()));
                }
                $options = array();
                foreach ($this->options() as $key => $label) {
                    $options[] = (string) $key;
                }
                return TargetValidator::choice($value, $options, strtolower($this->label()));
            case 'multiselect':
                if (!empty($this->definition['dynamic'])) {
                    $items = is_array($value) ? $value : preg_split('/[\s,]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY);
                    $out = array();
                    foreach ((array) $items as $item) {
                        $out[] = TargetValidator::text($item, 96, strtolower($this->label()));
                    }
                    return array_values(array_unique($out));
                }
                $options = array();
                foreach ($this->options() as $key => $label) {
                    $options[] = (string) $key;
                }
                $selected = is_array($value) ? $value : preg_split('/[\s,]+/', (string) $value, -1, PREG_SPLIT_NO_EMPTY);
                $out = array();
                foreach ((array) $selected as $item) {
                    $out[] = TargetValidator::choice($item, $options, strtolower($this->label()));
                }
                return array_values(array_unique($out));
            case 'url':
                $parts = TargetValidator::url($value);
                return $parts['url'];
            case 'domain':
                return TargetValidator::domain($value, strtolower($this->label()));
            case 'hostname':
                return TargetValidator::hostname($value, strtolower($this->label()));
            case 'ip':
                return TargetValidator::ip($value, true, $this->label());
            case 'public_ip':
                return TargetValidator::ip($value, false, $this->label());
            case 'ip_or_host':
                $candidate = trim((string) $value, " \t\n\r[]");
                if (filter_var($candidate, FILTER_VALIDATE_IP) !== false) {
                    return TargetValidator::ip($candidate, true, $this->label());
                }
                return TargetValidator::hostname($candidate, strtolower($this->label()));
            case 'mac':
                return TargetValidator::mac($value);
            case 'asn':
                return TargetValidator::asn($value);
            case 'ports':
                return TargetValidator::portSet($value, $this->definition['max'] === null ? TargetValidator::MAX_PORT_SPAN : (int) $this->definition['max']);
            case 'port':
                return TargetValidator::port($value, strtolower($this->label()));
            case 'cidr':
                $cidr = TargetValidator::cidr($value);
                return $cidr['cidr'];
            case 'email':
                return TargetValidator::email($value, strtolower($this->label()));
            case 'dkim_selector':
                return TargetValidator::dkimSelector($value);
            case 'selector':
                return TargetValidator::dkimSelector($value);
            case 'color':
                $value = trim((string) $value);
                if (!preg_match('/^#?[0-9a-fA-F]{3}$|^#?[0-9a-fA-F]{6}$|^#?[0-9a-fA-F]{8}$/', $value)) {
                    throw new InvalidArgumentException($this->label() . ' must be a hexadecimal colour such as #0B5FFF.');
                }
                return '#' . strtoupper(ltrim($value, '#'));
            case 'json':
                $decoded = json_decode((string) $value, true);
                if (json_last_error() !== JSON_ERROR_NONE) {
                    throw new InvalidArgumentException('That is not valid JSON: ' . json_last_error_msg() . '.');
                }
                return $value;
            case 'textarea':
                return TargetValidator::text($value, (int) $this->definition['maxlength'], strtolower($this->label()), !$this->isRequired());
            case 'password':
                return TargetValidator::text($value, 512, strtolower($this->label()), !$this->isRequired());
            default:
                return TargetValidator::text($value, (int) $this->definition['maxlength'], strtolower($this->label()), !$this->isRequired());
        }
    }

    /** Field descriptor safe to render into a template or return from the API. */
    public function toArray()
    {
        $definition = $this->definition;
        // Never render a sensitive default back to the browser.
        if ($this->isSensitive() || $definition['type'] === 'password') {
            $definition['default'] = '';
        }
        return $definition;
    }
}
