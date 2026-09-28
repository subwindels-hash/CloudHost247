<?php
namespace CloudHost247\ModuleManager\Package;

use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\Paths;

/**
 * Where uploaded packages and pre-install backups are kept.
 *
 * Uploaded archives contain executable server-side code, so they are never
 * written anywhere the web server will serve them. The location is resolved
 * from deployment configuration; if no safe location can be established the
 * Module Manager reports that uploads are unavailable rather than falling back
 * to a guessable directory inside the document root.
 */
final class PackageStorage
{
    const ENV_VARIABLE = 'CH247_MODULE_STORAGE';
    const GLOBAL_VARIABLE = 'ch247_module_storage';

    private $root;
    private $source;
    private $insideDocumentRoot = false;

    public function __construct($root = null, $source = 'explicit')
    {
        if ($root !== null) {
            $this->root = rtrim((string) $root, '/');
            $this->source = (string) $source;
            return;
        }
        $resolved = self::resolveConfiguredRoot();
        $this->root = $resolved['path'];
        $this->source = $resolved['source'];
    }

    public static function resolveConfiguredRoot()
    {
        $environment = getenv(self::ENV_VARIABLE);
        if (is_string($environment) && trim($environment) !== '') {
            return array('path' => rtrim(trim($environment), '/'), 'source' => self::ENV_VARIABLE . ' environment variable');
        }
        if (isset($GLOBALS[self::GLOBAL_VARIABLE]) && is_string($GLOBALS[self::GLOBAL_VARIABLE]) && trim($GLOBALS[self::GLOBAL_VARIABLE]) !== '') {
            return array('path' => rtrim(trim($GLOBALS[self::GLOBAL_VARIABLE]), '/'), 'source' => '$' . self::GLOBAL_VARIABLE . ' in configuration.php');
        }
        if (isset($GLOBALS['attachments_dir']) && is_string($GLOBALS['attachments_dir']) && trim($GLOBALS['attachments_dir']) !== '') {
            return array(
                'path' => rtrim(trim($GLOBALS['attachments_dir']), '/') . '/cloudhost247-modules',
                'source' => 'WHMCS $attachments_dir (set ' . self::ENV_VARIABLE . ' to use a dedicated location)',
            );
        }
        return array('path' => '', 'source' => 'not configured');
    }

    public function describeSource()
    {
        return $this->source;
    }

    public function root()
    {
        return $this->root;
    }

    public function isInsideDocumentRoot()
    {
        $this->insideDocumentRoot = false;
        if ($this->root === '' || !is_dir($this->root)) { return false; }
        $this->insideDocumentRoot = Paths::isInside(Paths::applicationRoot(), $this->root);
        return $this->insideDocumentRoot;
    }

    /** True when packages can actually be received and stored right now. */
    public function available()
    {
        if ($this->root === '') { return false; }
        if (!is_dir($this->root) && !Paths::ensureDirectory($this->root, 0700)) { return false; }
        return is_writable($this->root);
    }

    public function unavailableReason()
    {
        if ($this->root === '') {
            return 'No module package directory is configured. Set the ' . self::ENV_VARIABLE
                . ' environment variable to an absolute path outside the web root before uploading modules.';
        }
        if (!is_dir($this->root)) {
            return 'The configured module package directory does not exist and could not be created.';
        }
        if (!is_writable($this->root)) {
            return 'The configured module package directory is not writable by the web server user.';
        }
        return '';
    }

    public function packagesDirectory()
    {
        return $this->subdirectory('packages');
    }

    public function backupsDirectory()
    {
        return $this->subdirectory('backups');
    }

    /**
     * Move a received upload into managed storage under a name derived from
     * its checksum. The original client-supplied filename is never used on
     * disk.
     */
    public function store($temporaryPath, $checksum, $mover = null)
    {
        if (!$this->available()) {
            throw new ModuleException($this->unavailableReason(), ModuleException::REASON_STORAGE);
        }
        if (!preg_match('/^[0-9a-f]{64}$/', (string) $checksum)) {
            throw new ModuleException('The package checksum could not be calculated.', ModuleException::REASON_UPLOAD);
        }
        $target = $this->packagesDirectory() . '/' . $checksum . '.zip';
        if (is_file($target)) {
            @unlink($temporaryPath);
            return $target;
        }
        $mover = $mover ? $mover : function ($from, $to) { return @rename($from, $to) || (@copy($from, $to) && @unlink($from)); };
        if (!$mover($temporaryPath, $target)) {
            throw new ModuleException('The uploaded package could not be stored.', ModuleException::REASON_STORAGE);
        }
        @chmod($target, 0600);
        return $target;
    }

    public function packagePath($checksum)
    {
        if (!preg_match('/^[0-9a-f]{64}$/', (string) $checksum)) { return ''; }
        $path = $this->packagesDirectory() . '/' . $checksum . '.zip';
        return is_file($path) ? $path : '';
    }

    public function forget($checksum)
    {
        $path = $this->packagePath($checksum);
        if ($path !== '') { @unlink($path); }
        return true;
    }

    /** A fresh, empty backup directory for one installation transaction. */
    public function createBackupDirectory($moduleId, $reference)
    {
        $name = preg_replace('/[^a-z0-9_-]/', '', strtolower($moduleId . '-' . $reference));
        $path = $this->backupsDirectory() . '/' . $name;
        if (is_dir($path)) { Paths::removeTree($path, $this->backupsDirectory()); }
        if (!Paths::ensureDirectory($path, 0700)) {
            throw new ModuleException('A pre-installation backup directory could not be created.', ModuleException::REASON_STORAGE);
        }
        return $path;
    }

    private function subdirectory($name)
    {
        $path = $this->root . '/' . $name;
        if (!is_dir($path)) {
            Paths::ensureDirectory($path, 0700);
            $this->harden($path);
        }
        return $path;
    }

    /**
     * Defence in depth for deployments whose only writable location is inside
     * the document root: deny web access and hide directory listings.
     */
    private function harden($path)
    {
        @chmod($path, 0700);
        $htaccess = $path . '/.htaccess';
        if (!is_file($htaccess)) {
            @file_put_contents($htaccess, "Require all denied\n<IfModule !mod_authz_core.c>\nDeny from all\n</IfModule>\n");
        }
        $index = $path . '/index.html';
        if (!is_file($index)) { @file_put_contents($index, ''); }
    }

    /** Human-readable storage report for the administration screen. */
    public function report()
    {
        $available = $this->available();
        return array(
            'root' => $this->root,
            'source' => $this->source,
            'available' => $available,
            'reason' => $available ? '' : $this->unavailableReason(),
            'inside_document_root' => $available ? $this->isInsideDocumentRoot() : false,
        );
    }

    public static function checksumOf($path)
    {
        return Checksum::ofFile($path);
    }
}
