<?php
namespace CloudHost247\ModuleManager\Package;

use CloudHost247\ModuleManager\Manifest\Manifest;

/**
 * The accepted, read-only description of an uploaded archive.
 *
 * Produced by ArchiveInspector before a single byte is written. Everything the
 * preview screen shows, and everything the extractor is allowed to write, comes
 * from this object.
 */
final class PackageInspection
{
    private $data;

    public function __construct(array $data)
    {
        $this->data = $data;
    }

    /** @return Manifest */
    public function manifest() { return $this->data['manifest']; }
    public function manifestJson() { return $this->data['manifest_json']; }
    public function archivePath() { return $this->data['archive_path']; }
    public function rootPrefix() { return $this->data['root_prefix']; }
    public function entries() { return $this->data['entries']; }
    public function fileCount() { return (int) $this->data['file_count']; }
    public function totalBytes() { return (int) $this->data['total_bytes']; }

    public function relativePaths()
    {
        $paths = array();
        foreach ($this->data['entries'] as $entry) { $paths[] = $entry['relative']; }
        return $paths;
    }

    /** CRC-32 per installed path, taken from the archive's central directory. */
    public function crcMap()
    {
        $map = array();
        foreach ($this->data['entries'] as $entry) { $map[$entry['relative']] = $entry['crc']; }
        return $map;
    }

    public function has($relativePath)
    {
        foreach ($this->data['entries'] as $entry) {
            if ($entry['relative'] === $relativePath) { return true; }
        }
        return false;
    }

    public function humanSize()
    {
        $bytes = $this->totalBytes();
        if ($bytes < 1024) { return $bytes . ' B'; }
        if ($bytes < 1048576) { return round($bytes / 1024, 1) . ' KiB'; }
        return round($bytes / 1048576, 2) . ' MiB';
    }
}
