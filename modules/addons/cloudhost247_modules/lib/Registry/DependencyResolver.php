<?php
namespace CloudHost247\ModuleManager\Registry;

use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Support\Version;

/**
 * Dependency and conflict arithmetic over the installed-module set.
 *
 * Used in three directions: before installing (are my dependencies present?),
 * before disabling (would anything break?) and before uninstalling (who still
 * needs me?).
 */
final class DependencyResolver
{
    /**
     * Platform components that are always present and may be depended upon.
     * Their versions come from the real addon files, not from a hard-coded list.
     */
    private $platform;

    /** @var array module_id => array('version' => string, 'enabled' => bool, 'name' => string) */
    private $installed;

    public function __construct(array $installed, array $platform = array())
    {
        $this->installed = $installed;
        $this->platform = $platform;
    }

    public function known()
    {
        return array_merge($this->platform, $this->installed);
    }

    /**
     * @return array array('satisfied' => bool, 'problems' => string[], 'warnings' => string[], 'rows' => array)
     */
    public function check(Manifest $manifest)
    {
        $problems = array();
        $warnings = array();
        $rows = array();
        $known = $this->known();

        foreach ($manifest->dependencies() as $dependency) {
            $id = $dependency['id'];
            $present = isset($known[$id]);
            $installedVersion = $present ? (string) $known[$id]['version'] : '';
            $enabled = $present ? !empty($known[$id]['enabled']) : false;
            $rangeOk = $present && Version::satisfies($installedVersion, $dependency['min_version'], $dependency['max_version']);

            $status = 'satisfied';
            if (!$present) {
                $status = 'missing';
            } elseif (!$rangeOk) {
                $status = 'version';
            } elseif (!$enabled) {
                $status = 'disabled';
            }

            $rows[] = array(
                'id' => $id,
                'required' => $this->describeRange($dependency['min_version'], $dependency['max_version']),
                'installed' => $present ? $installedVersion : 'not installed',
                'optional' => !empty($dependency['optional']),
                'status' => $status,
            );

            if ($status === 'satisfied') { continue; }
            $message = $this->describeProblem($id, $status, $dependency, $installedVersion);
            if (!empty($dependency['optional'])) { $warnings[] = $message; } else { $problems[] = $message; }
        }

        foreach ($manifest->conflicts() as $conflict) {
            if (!isset($known[$conflict])) { continue; }
            $rows[] = array('id' => $conflict, 'required' => 'must not be installed', 'installed' => (string) $known[$conflict]['version'], 'optional' => false, 'status' => 'conflict');
            $problems[] = 'This module conflicts with "' . $conflict . '", which is currently installed.';
        }

        return array('satisfied' => $problems === array(), 'problems' => $problems, 'warnings' => $warnings, 'rows' => $rows);
    }

    /**
     * Installed, enabled modules that declare a non-optional dependency on $moduleId.
     *
     * @return array list of array('id','name','required')
     */
    public function dependents($moduleId, $includeDisabled = false)
    {
        $dependents = array();
        foreach ($this->installed as $id => $module) {
            if ($id === $moduleId) { continue; }
            if (!$includeDisabled && empty($module['enabled'])) { continue; }
            $dependencies = isset($module['dependencies']) ? (array) $module['dependencies'] : array();
            if (!isset($dependencies[$moduleId])) { continue; }
            if (!empty($dependencies[$moduleId]['optional'])) { continue; }
            $dependents[] = array(
                'id' => $id,
                'name' => isset($module['name']) ? $module['name'] : $id,
                'required' => $this->describeRange(
                    isset($dependencies[$moduleId]['min_version']) ? $dependencies[$moduleId]['min_version'] : '',
                    isset($dependencies[$moduleId]['max_version']) ? $dependencies[$moduleId]['max_version'] : ''
                ),
            );
        }
        return $dependents;
    }

    private function describeProblem($id, $status, array $dependency, $installedVersion)
    {
        switch ($status) {
            case 'missing':
                return 'Required module "' . $id . '" (' . $this->describeRange($dependency['min_version'], $dependency['max_version']) . ') is not installed.';
            case 'version':
                return 'Required module "' . $id . '" is installed at ' . $installedVersion . ' but this module needs '
                    . $this->describeRange($dependency['min_version'], $dependency['max_version']) . '.';
            case 'disabled':
                return 'Required module "' . $id . '" is installed but currently disabled.';
            default:
                return 'Required module "' . $id . '" is unavailable.';
        }
    }

    private function describeRange($minimum, $maximum)
    {
        if ($minimum !== '' && $maximum !== '') { return $minimum . '–' . $maximum; }
        if ($minimum !== '') { return $minimum . ' and above'; }
        if ($maximum !== '') { return 'up to ' . $maximum; }
        return 'any version';
    }
}
