<?php
namespace CloudHost247\ModuleManager\Package;

use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Support\ModuleException;
use ZipArchive;

/**
 * Reads an uploaded archive without extracting any of it.
 *
 * Every entry is judged from the central directory first. If a single entry is
 * unacceptable the whole package is rejected: partial extraction of a hostile
 * archive is never attempted, and nothing is written to disk until the entire
 * archive has been accepted.
 */
final class ArchiveInspector
{
    const MAX_ENTRIES = 3000;
    const MAX_TOTAL_BYTES = 134217728;   // 128 MiB uncompressed
    const MAX_ENTRY_BYTES = 33554432;    // 32 MiB per file
    const MAX_COMPRESSION_RATIO = 200;   // guards against zip bombs
    const MAX_PATH_LENGTH = 200;
    const MAX_DEPTH = 12;

    /** File types a module is allowed to ship. */
    private static $allowedExtensions = array(
        'php', 'tpl', 'json', 'md', 'txt', 'html', 'htm', 'css', 'js', 'map',
        'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp',
        'woff', 'woff2', 'ttf', 'otf', 'eot',
        'xml', 'yml', 'yaml', 'csv', 'lang', 'po', 'mo', 'sql', 'dist', 'lock',
    );

    /** Extensions that must never be written by a module installer. */
    private static $forbiddenExtensions = array(
        'phar', 'phtml', 'php3', 'php4', 'php5', 'php7', 'phps', 'pht', 'inc',
        'sh', 'bash', 'zsh', 'ksh', 'csh', 'bat', 'cmd', 'ps1', 'psm1',
        'exe', 'dll', 'so', 'dylib', 'bin', 'com', 'msi', 'app', 'run',
        'py', 'pyc', 'pl', 'rb', 'cgi', 'jar', 'class', 'war',
        'pem', 'key', 'p12', 'pfx', 'crt', 'cer', 'kdbx', 'env', 'ini', 'conf', 'cnf',
    );

    /** Extensionless files a module may legitimately ship. */
    private static $allowedBareNames = array('license', 'licence', 'readme', 'changelog', 'notice', 'authors', 'copying', 'version');

    /** Path segments that indicate a dangerous or unwanted archive structure. */
    private static $forbiddenSegments = array(
        '.git', '.github', '.svn', '.hg', '.idea', '.vscode', '.ssh', '.aws', '.docker',
        '__macosx', 'node_modules', 'vendor-bin', '.env', '.htaccess', '.htpasswd',
        '.user.ini', 'web.config', '.npmrc', '.netrc', '.git-credentials',
    );

    /**
     * @return PackageInspection
     * @throws ModuleException when the archive must not be extracted
     */
    public function inspect($archivePath)
    {
        if (!class_exists('ZipArchive')) {
            throw new ModuleException('The PHP zip extension is required to install modules.', ModuleException::REASON_ARCHIVE);
        }
        if (!is_file($archivePath) || !is_readable($archivePath)) {
            throw new ModuleException('The uploaded package could not be read.', ModuleException::REASON_ARCHIVE);
        }

        $zip = new ZipArchive();
        $flags = defined('ZipArchive::CHECKCONS') ? ZipArchive::CHECKCONS : 0;
        $opened = $zip->open($archivePath, $flags);
        if ($opened !== true) {
            // Retry without consistency checks only to produce a clearer message, never to accept the file.
            throw new ModuleException('The uploaded file is not a readable ZIP archive.', ModuleException::REASON_ARCHIVE);
        }

        try {
            return $this->readEntries($zip, $archivePath);
        } finally {
            $zip->close();
        }
    }

    private function readEntries(ZipArchive $zip, $archivePath)
    {
        $count = $zip->numFiles;
        if ($count <= 0) {
            throw new ModuleException('The uploaded archive is empty.', ModuleException::REASON_ARCHIVE);
        }
        if ($count > self::MAX_ENTRIES) {
            throw new ModuleException('The archive contains more than ' . self::MAX_ENTRIES . ' entries.', ModuleException::REASON_ARCHIVE);
        }

        $entries = array();
        $seen = array();
        $totalBytes = 0;
        $roots = array();

        for ($index = 0; $index < $count; $index++) {
            $stat = $zip->statIndex($index);
            if (!is_array($stat) || !isset($stat['name'])) {
                throw new ModuleException('The archive contains an unreadable entry.', ModuleException::REASON_ARCHIVE);
            }
            $name = (string) $stat['name'];
            $this->assertEntryName($name);
            $this->assertNotEncrypted($stat, $name);

            $isDirectory = substr($name, -1) === '/';
            $normalized = trim($name, '/');
            if ($normalized === '') { continue; }

            $mode = $this->unixMode($zip, $index);
            $this->assertRegularType($mode, $name, $isDirectory);
            $this->assertNoPrivilegeBits($mode, $name);

            if (isset($seen[strtolower($normalized)])) {
                throw new ModuleException('The archive contains duplicate entries for "' . $this->printable($normalized) . '".', ModuleException::REASON_ARCHIVE);
            }
            $seen[strtolower($normalized)] = true;

            $segments = explode('/', $normalized);
            $roots[$segments[0]] = true;

            if ($isDirectory) {
                $entries[] = array('name' => $name, 'path' => $normalized, 'directory' => true, 'size' => 0, 'compressed' => 0, 'crc' => 0);
                continue;
            }

            $size = isset($stat['size']) ? (int) $stat['size'] : 0;
            $compressed = isset($stat['comp_size']) ? (int) $stat['comp_size'] : 0;
            $this->assertSize($normalized, $size, $compressed);
            $totalBytes += $size;
            if ($totalBytes > self::MAX_TOTAL_BYTES) {
                throw new ModuleException('The archive expands to more than ' . (self::MAX_TOTAL_BYTES >> 20) . ' MiB.', ModuleException::REASON_ARCHIVE);
            }

            $entries[] = array(
                'name' => $name,
                'path' => $normalized,
                'directory' => false,
                'size' => $size,
                'compressed' => $compressed,
                'crc' => isset($stat['crc']) ? (int) $stat['crc'] : 0,
            );
        }

        $prefix = $this->commonRoot($roots, $entries);
        $files = $this->rebase($entries, $prefix);
        $manifestJson = $this->readManifest($zip, $prefix);

        return new PackageInspection(array(
            'archive_path' => $archivePath,
            'root_prefix' => $prefix,
            'entries' => $files,
            'file_count' => count($files),
            'total_bytes' => $totalBytes,
            'manifest_json' => $manifestJson,
            'manifest' => Manifest::decode($manifestJson),
        ));
    }

    /* -------------------------------------------------------------- assertions */

    private function assertEntryName($name)
    {
        if ($name === '' || strlen($name) > 1024) {
            throw new ModuleException('The archive contains an entry with an unusable name.', ModuleException::REASON_ARCHIVE);
        }
        if (strpos($name, "\0") !== false || preg_match('/[\x00-\x1F\x7F]/', $name)) {
            throw new ModuleException('The archive contains an entry name with control characters.', ModuleException::REASON_ARCHIVE);
        }
        if ($name[0] === '/' || $name[0] === '\\') {
            throw new ModuleException('The archive contains an absolute path: "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
        if (preg_match('#^[A-Za-z]:[\\\\/]#', $name)) {
            throw new ModuleException('The archive contains an absolute Windows path: "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
        if (strpos($name, '\\') !== false) {
            throw new ModuleException('The archive contains a backslash separated path: "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
        foreach (explode('/', $name) as $segment) {
            if ($segment === '..') {
                throw new ModuleException('The archive attempts directory traversal with "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
            }
            if (strlen($segment) > self::MAX_PATH_LENGTH) {
                throw new ModuleException('The archive contains an excessively long path segment.', ModuleException::REASON_ARCHIVE);
            }
            if ($segment !== '' && in_array(strtolower($segment), self::$forbiddenSegments, true)) {
                throw new ModuleException('The archive contains a disallowed path component "' . $this->printable($segment) . '".', ModuleException::REASON_ARCHIVE);
            }
        }
        if (substr_count(trim($name, '/'), '/') > self::MAX_DEPTH) {
            throw new ModuleException('The archive nests directories more deeply than the installer permits.', ModuleException::REASON_ARCHIVE);
        }
        if (substr($name, -1) !== '/') { $this->assertFileName(basename($name), $name); }
    }

    private function assertFileName($basename, $fullName)
    {
        $lower = strtolower($basename);
        if ($lower === '' || $lower === '.' || $lower === '..') {
            throw new ModuleException('The archive contains an invalid file name.', ModuleException::REASON_ARCHIVE);
        }
        $dot = strrpos($lower, '.');
        $extension = $dot === false ? '' : substr($lower, $dot + 1);
        if ($extension === '') {
            $bare = preg_replace('/[^a-z]/', '', $lower);
            if (!in_array($bare, self::$allowedBareNames, true)) {
                throw new ModuleException('The archive contains a file without a recognised type: "' . $this->printable($fullName) . '".', ModuleException::REASON_ARCHIVE);
            }
            return;
        }
        if (in_array($extension, self::$forbiddenExtensions, true)) {
            throw new ModuleException('The archive contains a disallowed file type ".' . $this->printable($extension) . '" at "' . $this->printable($fullName) . '".', ModuleException::REASON_ARCHIVE);
        }
        if (!in_array($extension, self::$allowedExtensions, true)) {
            throw new ModuleException('The archive contains an unsupported file type ".' . $this->printable($extension) . '" at "' . $this->printable($fullName) . '".', ModuleException::REASON_ARCHIVE);
        }
        // Double extensions such as payload.php.txt or payload.jpg.php are rejected outright.
        $withoutExtension = substr($lower, 0, $dot);
        $innerDot = strrpos($withoutExtension, '.');
        if ($innerDot !== false) {
            $inner = substr($withoutExtension, $innerDot + 1);
            if (in_array($inner, self::$forbiddenExtensions, true) || in_array($inner, array('php', 'phtml'), true)) {
                throw new ModuleException('The archive contains a double extension file name: "' . $this->printable($fullName) . '".', ModuleException::REASON_ARCHIVE);
            }
        }
    }

    private function assertNotEncrypted(array $stat, $name)
    {
        if (!isset($stat['encryption_method'])) { return; }
        $none = defined('ZipArchive::EM_NONE') ? ZipArchive::EM_NONE : 0;
        if ((int) $stat['encryption_method'] !== (int) $none) {
            throw new ModuleException('The archive contains an encrypted entry: "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
    }

    private function assertRegularType($mode, $name, $isDirectory)
    {
        if ($mode === null) { return; }
        $type = $mode & 0xF000;
        if ($type === 0xA000) {
            throw new ModuleException('The archive contains a symbolic link: "' . $this->printable($name) . '". Symlinks are never extracted.', ModuleException::REASON_ARCHIVE);
        }
        if ($type !== 0 && $type !== 0x8000 && $type !== 0x4000) {
            throw new ModuleException('The archive contains a special file (device, socket or FIFO): "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
        if ($type === 0x4000 && !$isDirectory) {
            throw new ModuleException('The archive declares a directory as a file: "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
    }

    private function assertNoPrivilegeBits($mode, $name)
    {
        if ($mode === null) { return; }
        if (($mode & 04000) || ($mode & 02000) || ($mode & 01000)) {
            throw new ModuleException('The archive sets setuid, setgid or sticky permissions on "' . $this->printable($name) . '".', ModuleException::REASON_ARCHIVE);
        }
        if ($mode & 0111) {
            throw new ModuleException('The archive marks "' . $this->printable($name) . '" executable. Module files are installed non-executable.', ModuleException::REASON_ARCHIVE);
        }
    }

    private function assertSize($path, $size, $compressed)
    {
        if ($size > self::MAX_ENTRY_BYTES) {
            throw new ModuleException('Archive entry "' . $this->printable($path) . '" exceeds the ' . (self::MAX_ENTRY_BYTES >> 20) . ' MiB per-file limit.', ModuleException::REASON_ARCHIVE);
        }
        if ($compressed > 0 && $size / $compressed > self::MAX_COMPRESSION_RATIO && $size > 1048576) {
            throw new ModuleException('Archive entry "' . $this->printable($path) . '" has an implausible compression ratio and is rejected as a decompression bomb.', ModuleException::REASON_ARCHIVE);
        }
    }

    /* ----------------------------------------------------------------- helpers */

    /** Unix permission bits from the ZIP external attributes, or null on non-unix archives. */
    private function unixMode(ZipArchive $zip, $index)
    {
        if (!method_exists($zip, 'getExternalAttributesIndex')) { return null; }
        $opsys = null;
        $attributes = null;
        if (!@$zip->getExternalAttributesIndex($index, $opsys, $attributes)) { return null; }
        $unix = defined('ZipArchive::OPSYS_UNIX') ? ZipArchive::OPSYS_UNIX : 3;
        if ((int) $opsys !== (int) $unix) { return null; }
        return ((int) $attributes >> 16) & 0xFFFF;
    }

    /**
     * Packages are normally wrapped in a single directory. Strip it when there
     * is exactly one, otherwise require the manifest at the archive root.
     */
    private function commonRoot(array $roots, array $entries)
    {
        if (count($roots) !== 1) { return ''; }
        $root = (string) key($roots);
        foreach ($entries as $entry) {
            if ($entry['path'] === $root) { continue; }
            if (strncmp($entry['path'], $root . '/', strlen($root) + 1) !== 0) { return ''; }
        }
        // Only strip a wrapper directory; never strip the manifest itself.
        return $root === Manifest::FILENAME ? '' : $root;
    }

    private function rebase(array $entries, $prefix)
    {
        $files = array();
        $offset = $prefix === '' ? 0 : strlen($prefix) + 1;
        foreach ($entries as $entry) {
            if ($entry['directory']) { continue; }
            $relative = $offset > 0 ? substr($entry['path'], $offset) : $entry['path'];
            if ($relative === '' || $relative === false) { continue; }
            $entry['relative'] = $relative;
            $files[] = $entry;
        }
        if (!$files) {
            throw new ModuleException('The archive contains no installable files.', ModuleException::REASON_ARCHIVE);
        }
        usort($files, function ($a, $b) { return strcmp($a['relative'], $b['relative']); });
        return $files;
    }

    private function readManifest(ZipArchive $zip, $prefix)
    {
        $name = ($prefix === '' ? '' : $prefix . '/') . Manifest::FILENAME;
        $index = $zip->locateName($name);
        if ($index === false) {
            throw new ModuleException('The package is missing ' . Manifest::FILENAME . ' at its root.', ModuleException::REASON_MANIFEST);
        }
        $stat = $zip->statIndex($index);
        if (!is_array($stat) || (int) $stat['size'] > Manifest::MAX_BYTES) {
            throw new ModuleException('The package manifest is unreasonably large.', ModuleException::REASON_MANIFEST);
        }
        $contents = $zip->getFromIndex($index, Manifest::MAX_BYTES);
        if ($contents === false) {
            throw new ModuleException('The package manifest could not be read.', ModuleException::REASON_MANIFEST);
        }
        return $contents;
    }

    private function printable($value)
    {
        return substr(preg_replace('/[^\x20-\x7E]/', '', (string) $value), 0, 96);
    }
}
