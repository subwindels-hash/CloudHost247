<?php
namespace CloudHost247\ModuleManager\Manifest;

use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\ModuleType;
use CloudHost247\ModuleManager\Support\Paths;
use CloudHost247\ModuleManager\Support\Version;

/**
 * Validated module.json contract.
 *
 * A package describes itself with data, never with code: the Module Manager
 * reads this manifest to decide what a package is, what it needs and where it
 * may be installed. No PHP from the archive is ever loaded to answer those
 * questions, so uploading an archive can never by itself execute anything.
 */
final class Manifest
{
    const FILENAME = 'module.json';
    const MAX_BYTES = 262144;
    const MAX_SETTING_LENGTH = 512;

    /**
     * Setting keys that are credentials by name. Module settings are stored in
     * clear operational storage, so these are pushed to the encrypted vault.
     */
    const CREDENTIAL_KEY_PATTERN = '/(^|_)(password|passwd|pwd|secret|token|key|apikey|credential|credentials|passphrase|auth|signature|certificate|privatekey)($|_)/';

    /** Manifest keys the platform understands. Unknown keys are reported, not silently accepted. */
    private static $known = array(
        'schema', 'id', 'name', 'version', 'description', 'author', 'author_url', 'license', 'type',
        'entry_point', 'min_application_version', 'max_application_version', 'min_php_version',
        'max_php_version', 'php_extensions', 'dependencies', 'conflicts', 'permissions', 'migrations',
        'configuration', 'integrations', 'health_check', 'documentation',
    );

    private $data;

    private function __construct(array $data)
    {
        $this->data = $data;
    }

    public static function decode($json)
    {
        if (!is_string($json) || $json === '') {
            throw new ModuleException('The package does not contain a readable ' . self::FILENAME . '.', ModuleException::REASON_MANIFEST);
        }
        if (strlen($json) > self::MAX_BYTES) {
            throw new ModuleException('The package manifest is unreasonably large.', ModuleException::REASON_MANIFEST);
        }
        $decoded = json_decode($json, true);
        if (!is_array($decoded) || json_last_error() !== JSON_ERROR_NONE) {
            throw new ModuleException('The package manifest is not valid JSON.', ModuleException::REASON_MANIFEST);
        }
        return self::fromArray($decoded);
    }

    public static function fromArray(array $raw)
    {
        // "unknown_keys" is emitted by toArray(); re-reading a stored manifest must not
        // report the platform's own bookkeeping key as an unknown manifest key.
        $unknown = array_diff(array_keys($raw), self::$known, array('unknown_keys'));

        $id = isset($raw['id']) ? (string) $raw['id'] : '';
        if (!Paths::isValidModuleId($id)) {
            $detail = Paths::isReserved($id)
                ? 'The module id "' . self::printable($id) . '" is reserved by the platform.'
                : 'The manifest must declare an "id" of 3-64 lowercase letters, digits or underscores, starting with a letter.';
            throw new ModuleException($detail, ModuleException::REASON_MANIFEST);
        }

        $version = isset($raw['version']) ? (string) $raw['version'] : '';
        if (!Version::isValid($version)) {
            throw new ModuleException('The manifest must declare a dotted numeric "version", for example 1.2.0.', ModuleException::REASON_MANIFEST);
        }

        $type = isset($raw['type']) ? (string) $raw['type'] : '';
        if (!ModuleType::isSupported($type)) {
            throw new ModuleException('The manifest declares an unsupported module "type". Supported: ' . implode(', ', ModuleType::keys()) . '.', ModuleException::REASON_MANIFEST);
        }

        $name = self::text($raw, 'name', 128);
        if ($name === '') {
            throw new ModuleException('The manifest must declare a human readable "name".', ModuleException::REASON_MANIFEST);
        }
        $author = self::text($raw, 'author', 128);
        if ($author === '') {
            throw new ModuleException('The manifest must declare an "author".', ModuleException::REASON_MANIFEST);
        }
        $license = self::text($raw, 'license', 64);
        if ($license === '') {
            throw new ModuleException('The manifest must declare a "license".', ModuleException::REASON_MANIFEST);
        }

        $entryPoint = isset($raw['entry_point']) ? (string) $raw['entry_point'] : ModuleType::conventionalEntryPoint($type, $id);
        if (!self::isSafeRelativeFile($entryPoint) || substr($entryPoint, -4) !== '.php') {
            throw new ModuleException('The manifest "entry_point" must be a relative .php path inside the module directory.', ModuleException::REASON_MANIFEST);
        }

        $minPhp = self::versionOrEmpty($raw, 'min_php_version');
        $maxPhp = self::versionOrEmpty($raw, 'max_php_version');
        if ($minPhp === '') {
            throw new ModuleException('The manifest must declare "min_php_version".', ModuleException::REASON_MANIFEST);
        }
        if ($maxPhp !== '' && Version::compare($maxPhp, $minPhp) < 0) {
            throw new ModuleException('The manifest declares a maximum PHP version below its minimum.', ModuleException::REASON_MANIFEST);
        }

        $minApp = self::versionOrEmpty($raw, 'min_application_version');
        $maxApp = self::versionOrEmpty($raw, 'max_application_version');
        if ($maxApp !== '' && $minApp !== '' && Version::compare($maxApp, $minApp) < 0) {
            throw new ModuleException('The manifest declares a maximum application version below its minimum.', ModuleException::REASON_MANIFEST);
        }

        $data = array(
            'schema' => self::text($raw, 'schema', 32) ?: 'cloudhost247-module/v1',
            'id' => $id,
            'name' => $name,
            'version' => $version,
            'description' => self::text($raw, 'description', 500),
            'author' => $author,
            'author_url' => self::url($raw, 'author_url'),
            'license' => $license,
            'type' => $type,
            'entry_point' => $entryPoint,
            'min_application_version' => $minApp,
            'max_application_version' => $maxApp,
            'min_php_version' => $minPhp,
            'max_php_version' => $maxPhp,
            'php_extensions' => self::identifierList($raw, 'php_extensions', '/^[a-z0-9_]{1,32}$/i'),
            'dependencies' => self::parseDependencies($raw),
            'conflicts' => self::identifierList($raw, 'conflicts', Paths::MODULE_ID_PATTERN),
            'permissions' => self::identifierList($raw, 'permissions', '/^[a-z0-9_.-]{1,64}$/'),
            'migrations' => self::parseMigrations($raw),
            'configuration' => self::parseConfiguration($raw),
            'integrations' => self::parseIntegrations($raw),
            'health_check' => self::parseHealthCheck($raw),
            'documentation' => self::url($raw, 'documentation'),
            'unknown_keys' => array_values($unknown),
        );
        return new self($data);
    }

    /* ------------------------------------------------------------ section parsers */

    private static function parseDependencies(array $raw)
    {
        $dependencies = array();
        if (!isset($raw['dependencies']) || !is_array($raw['dependencies'])) { return $dependencies; }
        foreach ($raw['dependencies'] as $key => $value) {
            // Accept the {"id": ">=1.0.0"} shorthand and the explicit object form. The object
            // form is also what toArray() emits, so a manifest re-read from the registry keeps
            // its version constraints instead of degrading to "any version".
            if (is_array($value)) {
                $id = isset($value['id']) ? (string) $value['id'] : (is_int($key) ? '' : (string) $key);
                $minimum = isset($value['min_version']) ? (string) $value['min_version'] : '';
                $maximum = isset($value['max_version']) ? (string) $value['max_version'] : '';
                $optional = !empty($value['optional']);
            } elseif (is_int($key)) {
                // A plain list of module ids: ["cloudhost247_core"] — no version constraint.
                $id = is_scalar($value) ? (string) $value : '';
                $minimum = '';
                $maximum = '';
                $optional = false;
            } else {
                $id = (string) $key;
                $minimum = is_scalar($value) ? ltrim((string) $value, '>=v ') : '';
                $maximum = '';
                $optional = false;
            }
            if (!Paths::isValidModuleId($id) && !preg_match('/^[a-z][a-z0-9_]{2,63}$/', $id)) {
                throw new ModuleException('A declared dependency has an invalid module id.', ModuleException::REASON_MANIFEST);
            }
            if ($minimum !== '' && !Version::isValid($minimum)) {
                throw new ModuleException('Dependency "' . self::printable($id) . '" declares an invalid minimum version.', ModuleException::REASON_MANIFEST);
            }
            if ($maximum !== '' && !Version::isValid($maximum)) {
                throw new ModuleException('Dependency "' . self::printable($id) . '" declares an invalid maximum version.', ModuleException::REASON_MANIFEST);
            }
            $dependencies[$id] = array('id' => $id, 'min_version' => $minimum, 'max_version' => $maximum, 'optional' => $optional);
        }
        return $dependencies;
    }

    private static function parseMigrations(array $raw)
    {
        $section = isset($raw['migrations']) && is_array($raw['migrations']) ? $raw['migrations'] : array();
        $tables = array();
        foreach (isset($section['tables']) ? (array) $section['tables'] : array() as $table) {
            $table = (string) $table;
            // A module may only ever declare namespaced tables. WHMCS core tables are off limits.
            if (!preg_match('/^mod_[a-z0-9_]{1,56}$/', $table)) {
                throw new ModuleException('Declared database table "' . self::printable($table) . '" is not a mod_ prefixed module table.', ModuleException::REASON_MANIFEST);
            }
            $tables[] = $table;
        }
        $directory = isset($section['directory']) ? (string) $section['directory'] : '';
        if ($directory !== '' && !self::isSafeRelativeFile($directory)) {
            throw new ModuleException('The manifest declares an unsafe migrations directory.', ModuleException::REASON_MANIFEST);
        }
        return array(
            'required' => !empty($section['required']) || $tables !== array(),
            'directory' => $directory,
            'tables' => $tables,
        );
    }

    private static function parseConfiguration(array $raw)
    {
        $section = isset($raw['configuration']) && is_array($raw['configuration']) ? $raw['configuration'] : array();
        $fields = array();
        foreach (isset($section['fields']) ? (array) $section['fields'] : array() as $field) {
            $field = (array) $field;
            $key = isset($field['key']) ? (string) $field['key'] : '';
            if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', $key)) {
                throw new ModuleException('A configuration field declares an invalid key.', ModuleException::REASON_MANIFEST);
            }
            $secret = !empty($field['secret']);
            if ($secret) {
                // Credentials belong to the API & Integrations vault, never to a module settings table.
                throw new ModuleException(
                    'Configuration field "' . self::printable($key) . '" is marked secret. Declare credentials under "integrations" so they are stored in the encrypted API & Integrations vault.',
                    ModuleException::REASON_MANIFEST
                );
            }
            if (self::looksLikeCredential($key)) {
                // A field can also be a credential by name only. Module settings are stored
                // in clear operational storage, so credential-shaped keys are refused here
                // whatever the module author called the "secret" flag.
                throw new ModuleException(
                    'Configuration field "' . self::printable($key) . '" looks like a credential. Declare it under "integrations" so it is stored in the encrypted API & Integrations vault instead of module settings.',
                    ModuleException::REASON_MANIFEST
                );
            }
            $type = in_array(isset($field['type']) ? $field['type'] : 'text', array('text', 'number', 'boolean', 'select'), true) ? (string) $field['type'] : 'text';
            $options = array();
            foreach (isset($field['options']) ? (array) $field['options'] : array() as $option) {
                if (!is_scalar($option)) { continue; }
                $option = self::text(array('v' => $option), 'v', 64);
                if ($option !== '') { $options[] = $option; }
            }
            $options = array_values(array_unique($options));
            if ($type === 'select' && !$options) {
                throw new ModuleException(
                    'Configuration field "' . self::printable($key) . '" is a select but declares no options.',
                    ModuleException::REASON_MANIFEST
                );
            }
            $default = self::text($field, 'default', self::MAX_SETTING_LENGTH);
            if ($type === 'select' && $default !== '' && !in_array($default, $options, true)) {
                throw new ModuleException(
                    'Configuration field "' . self::printable($key) . '" declares a default that is not one of its options.',
                    ModuleException::REASON_MANIFEST
                );
            }
            $minimum = isset($field['min']) && is_numeric($field['min']) ? (string) $field['min'] : '';
            $maximum = isset($field['max']) && is_numeric($field['max']) ? (string) $field['max'] : '';
            if ($minimum !== '' && $maximum !== '' && $maximum + 0 < $minimum + 0) {
                throw new ModuleException(
                    'Configuration field "' . self::printable($key) . '" declares a maximum below its minimum.',
                    ModuleException::REASON_MANIFEST
                );
            }
            $fields[] = array(
                'key' => $key,
                'label' => self::text($field, 'label', 128) ?: $key,
                'type' => $type,
                'required' => !empty($field['required']),
                'help' => self::text($field, 'help', 240),
                'options' => $options,
                'default' => $default,
                'min' => $type === 'number' ? $minimum : '',
                'max' => $type === 'number' ? $maximum : '',
            );
        }
        return array('required' => !empty($section['required']) || $fields !== array(), 'fields' => $fields);
    }

    private static function parseIntegrations(array $raw)
    {
        $section = isset($raw['integrations']) && is_array($raw['integrations']) ? $raw['integrations'] : array();
        $providers = array();
        foreach (isset($section['providers']) ? (array) $section['providers'] : array() as $provider) {
            $provider = (string) $provider;
            if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', $provider)) {
                throw new ModuleException('A declared integration provider key is invalid.', ModuleException::REASON_MANIFEST);
            }
            $providers[] = $provider;
        }
        $definitions = array();
        foreach (isset($section['definitions']) ? (array) $section['definitions'] : array() as $definition) {
            $definition = (array) $definition;
            $key = isset($definition['key']) ? (string) $definition['key'] : '';
            if (!preg_match('/^[a-z][a-z0-9_]{1,63}$/', $key)) {
                throw new ModuleException('A declared integration definition is missing a valid key.', ModuleException::REASON_MANIFEST);
            }
            $definitions[$key] = $definition;
            if (!in_array($key, $providers, true)) { $providers[] = $key; }
        }
        return array('providers' => array_values(array_unique($providers)), 'definitions' => $definitions);
    }

    private static function parseHealthCheck(array $raw)
    {
        $section = isset($raw['health_check']) && is_array($raw['health_check']) ? $raw['health_check'] : array();
        $files = array();
        foreach (isset($section['files']) ? (array) $section['files'] : array() as $file) {
            $file = (string) $file;
            if (!self::isSafeRelativeFile($file)) {
                throw new ModuleException('The manifest health check declares an unsafe file path.', ModuleException::REASON_MANIFEST);
            }
            $files[] = $file;
        }
        return array('files' => $files);
    }

    /* ------------------------------------------------------------------ helpers */

    /** True when a configuration key names a credential rather than an operational setting. */
    private static function looksLikeCredential($key)
    {
        return (bool) preg_match(self::CREDENTIAL_KEY_PATTERN, (string) $key);
    }

    private static function text(array $raw, $key, $maximum)
    {
        if (!isset($raw[$key]) || !is_scalar($raw[$key])) { return ''; }
        $value = trim(preg_replace('/[\x00-\x1F\x7F]/u', '', (string) $raw[$key]));
        return substr($value, 0, $maximum);
    }

    private static function url(array $raw, $key)
    {
        $value = self::text($raw, $key, 255);
        if ($value === '') { return ''; }
        if (!preg_match('#^https://[A-Za-z0-9.-]+\.[A-Za-z]{2,}(/[^\s"\'<>]*)?$#', $value)) { return ''; }
        return $value;
    }

    private static function versionOrEmpty(array $raw, $key)
    {
        $value = self::text($raw, $key, 32);
        if ($value === '') { return ''; }
        if (!Version::isValid($value)) {
            throw new ModuleException('The manifest key "' . $key . '" is not a valid version.', ModuleException::REASON_MANIFEST);
        }
        return $value;
    }

    private static function identifierList(array $raw, $key, $pattern)
    {
        $values = array();
        foreach (isset($raw[$key]) ? (array) $raw[$key] : array() as $value) {
            if (!is_scalar($value)) { continue; }
            $value = (string) $value;
            if (!preg_match($pattern, $value)) {
                throw new ModuleException('The manifest key "' . $key . '" contains an invalid entry.', ModuleException::REASON_MANIFEST);
            }
            $values[] = $value;
        }
        return array_values(array_unique($values));
    }

    private static function isSafeRelativeFile($path)
    {
        $path = (string) $path;
        if ($path === '' || strlen($path) > 255) { return false; }
        if (strpos($path, "\0") !== false || preg_match('/[\x00-\x1F\x7F]/', $path)) { return false; }
        if ($path[0] === '/' || $path[0] === '\\' || strpos($path, '..') !== false) { return false; }
        if (preg_match('/^[A-Za-z]:/', $path)) { return false; }
        return (bool) preg_match('#^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$#', $path);
    }

    private static function printable($value)
    {
        return substr(preg_replace('/[^\x20-\x7E]/', '', (string) $value), 0, 64);
    }

    /* --------------------------------------------------------------- accessors */

    public function id() { return $this->data['id']; }
    public function name() { return $this->data['name']; }
    public function version() { return $this->data['version']; }
    public function description() { return $this->data['description']; }
    public function author() { return $this->data['author']; }
    public function authorUrl() { return $this->data['author_url']; }
    public function license() { return $this->data['license']; }
    public function type() { return $this->data['type']; }
    public function typeLabel() { return ModuleType::label($this->data['type']); }
    public function entryPoint() { return $this->data['entry_point']; }
    public function minApplicationVersion() { return $this->data['min_application_version']; }
    public function maxApplicationVersion() { return $this->data['max_application_version']; }
    public function minPhpVersion() { return $this->data['min_php_version']; }
    public function maxPhpVersion() { return $this->data['max_php_version']; }
    public function phpExtensions() { return $this->data['php_extensions']; }
    public function dependencies() { return $this->data['dependencies']; }
    public function conflicts() { return $this->data['conflicts']; }
    public function permissions() { return $this->data['permissions']; }
    public function migrations() { return $this->data['migrations']; }
    public function hasMigrations() { return !empty($this->data['migrations']['required']); }
    public function declaredTables() { return $this->data['migrations']['tables']; }
    public function configuration() { return $this->data['configuration']; }
    public function requiresConfiguration() { return !empty($this->data['configuration']['required']); }
    public function integrationProviders() { return $this->data['integrations']['providers']; }
    public function integrationDefinitions() { return $this->data['integrations']['definitions']; }
    public function healthCheckFiles() { return $this->data['health_check']['files']; }
    public function documentation() { return $this->data['documentation']; }
    public function unknownKeys() { return $this->data['unknown_keys']; }
    public function relativeDirectory() { return Paths::relativeModuleDirectory($this->type(), $this->id()); }

    public function phpRange()
    {
        return $this->minPhpVersion() . ($this->maxPhpVersion() !== '' ? '–' . $this->maxPhpVersion() : ' and above');
    }

    public function toArray()
    {
        return $this->data;
    }

    public function toJson()
    {
        return json_encode($this->data);
    }
}
