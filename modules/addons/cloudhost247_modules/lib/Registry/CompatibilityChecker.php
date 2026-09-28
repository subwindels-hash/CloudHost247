<?php
namespace CloudHost247\ModuleManager\Registry;

use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Support\ModuleType;
use CloudHost247\ModuleManager\Support\Version;

/**
 * Does this package actually run on this server?
 *
 * Every answer is derived from the live runtime — the real PHP version, the
 * real loaded extensions, the real WHMCS version — never from a value supplied
 * by the package.
 */
final class CompatibilityChecker
{
    private $phpVersion;
    private $applicationVersion;
    private $loadedExtensions;

    public function __construct($phpVersion = null, $applicationVersion = null, array $loadedExtensions = null)
    {
        $this->phpVersion = Version::normalizeRuntime($phpVersion !== null ? $phpVersion : PHP_VERSION);
        $resolved = $applicationVersion !== null
            ? Version::normalizeRuntime($applicationVersion)
            : self::detectApplicationVersion();
        // "0" means nothing usable could be parsed: report it as undetected rather
        // than comparing a fabricated version against the manifest.
        $this->applicationVersion = $resolved === '0' ? '' : $resolved;
        $this->loadedExtensions = $loadedExtensions !== null
            ? array_map('strtolower', $loadedExtensions)
            : array_map('strtolower', get_loaded_extensions());
    }

    public static function detectApplicationVersion()
    {
        if (defined('WHMCS_VERSION') && is_string(constant('WHMCS_VERSION'))) {
            return Version::normalizeRuntime(constant('WHMCS_VERSION'));
        }
        if (class_exists('WHMCS\\Application')) {
            try {
                $application = \WHMCS\Application::getInstance();
                if (is_object($application) && method_exists($application, 'getVersion')) {
                    return Version::normalizeRuntime((string) $application->getVersion());
                }
            } catch (\Throwable $ignored) {
                // Fall through to "unknown" rather than guessing a version.
            }
        }
        return '';
    }

    public function phpVersion() { return $this->phpVersion; }
    public function applicationVersion() { return $this->applicationVersion; }

    /**
     * @return array array('compatible' => bool, 'problems' => string[], 'warnings' => string[], 'checks' => array)
     */
    public function check(Manifest $manifest)
    {
        $problems = array();
        $warnings = array();
        $checks = array();

        $minPhp = $manifest->minPhpVersion();
        $maxPhp = $manifest->maxPhpVersion();
        $phpOk = Version::satisfies($this->phpVersion, $minPhp, $maxPhp);
        $checks[] = array(
            'name' => 'PHP version',
            'required' => $manifest->phpRange(),
            'actual' => $this->phpVersion,
            'ok' => $phpOk,
        );
        if (!$phpOk) {
            $problems[] = 'This module requires PHP ' . $manifest->phpRange() . '; this server runs PHP ' . $this->phpVersion . '.';
        }

        $minApp = $manifest->minApplicationVersion();
        $maxApp = $manifest->maxApplicationVersion();
        if ($minApp !== '' || $maxApp !== '') {
            if ($this->applicationVersion === '') {
                $checks[] = array('name' => 'Application version', 'required' => $this->describeRange($minApp, $maxApp), 'actual' => 'not detected', 'ok' => false);
                $warnings[] = 'The application version could not be detected, so the declared application compatibility range could not be verified.';
            } else {
                $appOk = Version::satisfies($this->applicationVersion, $minApp, $maxApp);
                $checks[] = array('name' => 'Application version', 'required' => $this->describeRange($minApp, $maxApp), 'actual' => $this->applicationVersion, 'ok' => $appOk);
                if (!$appOk) {
                    $problems[] = 'This module supports application version ' . $this->describeRange($minApp, $maxApp) . '; this installation reports ' . $this->applicationVersion . '.';
                }
            }
        }

        foreach ($manifest->phpExtensions() as $extension) {
            $present = in_array(strtolower($extension), $this->loadedExtensions, true);
            $checks[] = array('name' => 'PHP extension: ' . $extension, 'required' => 'loaded', 'actual' => $present ? 'loaded' : 'missing', 'ok' => $present);
            if (!$present) {
                $problems[] = 'The PHP extension "' . $extension . '" is required by this module but is not loaded.';
            }
        }

        $typeOk = ModuleType::isSupported($manifest->type());
        $checks[] = array('name' => 'Module type', 'required' => 'supported type', 'actual' => $manifest->typeLabel(), 'ok' => $typeOk);
        if (!$typeOk) { $problems[] = 'This module declares a type this platform cannot install.'; }

        if ($manifest->unknownKeys()) {
            $warnings[] = 'The manifest contains keys this platform does not understand and will ignore: '
                . implode(', ', array_slice($manifest->unknownKeys(), 0, 8)) . '.';
        }

        return array(
            'compatible' => $problems === array(),
            'problems' => $problems,
            'warnings' => $warnings,
            'checks' => $checks,
        );
    }

    private function describeRange($minimum, $maximum)
    {
        if ($minimum !== '' && $maximum !== '') { return $minimum . '–' . $maximum; }
        if ($minimum !== '') { return $minimum . ' and above'; }
        if ($maximum !== '') { return 'up to ' . $maximum; }
        return 'any';
    }
}
