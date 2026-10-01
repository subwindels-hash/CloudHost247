<?php
namespace DigitalProducts\Storage;

use WHMCS\Database\Capsule;

final class LocalPrivateStorage implements StorageInterface
{
    const ENV_VARIABLE = 'CH247_MODULE_STORAGE';

    private $root;
    private $source;

    public function __construct($settings = null)
    {
        $settings = is_array($settings) ? $settings : $this->settings();
        $configured = isset($settings['storage_path']) ? trim((string) $settings['storage_path']) : '';
        if ($configured !== '') {
            $this->root = rtrim($configured, DIRECTORY_SEPARATOR);
            $this->source = 'module setting';
        } elseif (($env = getenv(self::ENV_VARIABLE)) && trim($env) !== '') {
            $this->root = rtrim(trim($env), DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'digital-products';
            $this->source = self::ENV_VARIABLE;
        } else {
            $this->root = rtrim(ROOTDIR, DIRECTORY_SEPARATOR) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'digitalproducts';
            $this->source = 'WHMCS storage default';
        }
    }

    public function storeUploadedFile($temporaryPath, $productId, $versionId, $originalName, $extension)
    {
        if (!$this->available()) {
            throw new \RuntimeException('Digital product storage is not writable: ' . $this->root);
        }
        $directory = $this->root . DIRECTORY_SEPARATOR . 'product-' . (int) $productId . DIRECTORY_SEPARATOR . 'version-' . (int) $versionId;
        $this->ensureDirectory($directory);
        $extension = strtolower(preg_replace('/[^a-z0-9.]/', '', (string) $extension));
        $extension = $extension !== '' ? '.' . ltrim($extension, '.') : '';
        $filename = bin2hex(random_bytes(20)) . $extension;
        $destination = $directory . DIRECTORY_SEPARATOR . $filename;
        if (!@move_uploaded_file($temporaryPath, $destination)) {
            if (!@rename($temporaryPath, $destination)) {
                throw new \RuntimeException('Failed to move uploaded file into private storage.');
            }
        }
        @chmod($destination, 0640);
        $relative = 'product-' . (int) $productId . '/version-' . (int) $versionId . '/' . $filename;
        return array(
            'storage_provider' => 'local',
            'storage_key' => $relative,
            'file_path' => $destination,
            'filename' => $filename,
        );
    }

    public function absolutePath($storageKey, $legacyPath = null)
    {
        $storageKey = str_replace('\\', '/', (string) $storageKey);
        if ($storageKey !== '' && !$this->containsTraversal($storageKey)) {
            $path = $this->root . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, ltrim($storageKey, '/'));
            $realRoot = realpath($this->root);
            $realPath = realpath($path);
            if ($realRoot && $realPath && strpos($realPath, $realRoot . DIRECTORY_SEPARATOR) === 0) {
                return $realPath;
            }
        }
        if ($legacyPath && is_file($legacyPath)) {
            return (string) $legacyPath;
        }
        return null;
    }

    public function available()
    {
        try {
            $this->ensureDirectory($this->root);
            return is_dir($this->root) && is_writable($this->root);
        } catch (\Throwable $e) {
            return false;
        }
    }

    public function root()
    {
        return $this->root;
    }

    public function isInsideDocumentRoot()
    {
        $root = realpath(ROOTDIR);
        $storage = realpath($this->root);
        if (!$root || !$storage) { return false; }
        return $storage === $root || strpos($storage, $root . DIRECTORY_SEPARATOR) === 0;
    }

    public function describeSource()
    {
        return $this->source;
    }

    private function settings()
    {
        $settings = array();
        try {
            foreach (Capsule::table('tbladdonmodules')->where('module', 'digitalproducts')->get() as $row) {
                $settings[$row->setting] = $row->value;
            }
        } catch (\Throwable $ignored) {}
        return $settings;
    }

    private function ensureDirectory($directory)
    {
        if (!is_dir($directory) && !@mkdir($directory, 0750, true)) {
            throw new \RuntimeException('Unable to create storage directory.');
        }
        $this->writeProtectionFiles($directory);
        $root = $this->root;
        while ($directory !== $root && strpos($directory, $root) === 0) {
            $this->writeProtectionFiles($directory);
            $parent = dirname($directory);
            if ($parent === $directory) { break; }
            $directory = $parent;
        }
    }

    private function writeProtectionFiles($directory)
    {
        $htaccess = $directory . DIRECTORY_SEPARATOR . '.htaccess';
        if (!is_file($htaccess)) {
            @file_put_contents($htaccess, "Options -Indexes\n<FilesMatch \".*\">\nRequire all denied\nDeny from all\n</FilesMatch>\n");
            @chmod($htaccess, 0640);
        }
        $index = $directory . DIRECTORY_SEPARATOR . 'index.html';
        if (!is_file($index)) { @file_put_contents($index, ''); @chmod($index, 0640); }
    }

    private function containsTraversal($path)
    {
        return preg_match('#(^|/)\.\.(?:/|$)#', $path) === 1 || strpos($path, "\0") !== false;
    }
}
