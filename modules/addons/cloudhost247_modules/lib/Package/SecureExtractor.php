<?php
namespace CloudHost247\ModuleManager\Package;

use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\Paths;
use ZipArchive;

/**
 * Writes an already-inspected archive into one destination directory.
 *
 * ZipArchive::extractTo() is never used: it resolves entry names itself, which
 * is exactly the behaviour a malicious archive relies on. Instead each accepted
 * entry is streamed individually to a path this class derives, re-checked for
 * containment immediately before the write, size-capped while copying, and
 * verified against the archive CRC afterwards.
 */
final class SecureExtractor
{
    const CHUNK = 65536;

    /**
     * @return array list of array('path' => relative, 'sha256' => …, 'bytes' => int)
     * @throws ModuleException
     */
    public function extract(PackageInspection $inspection, $destination)
    {
        if (!Paths::ensureDirectory($destination, 0755)) {
            throw new ModuleException('The module directory could not be created.', ModuleException::REASON_INSTALL);
        }
        $resolved = realpath($destination);
        if ($resolved === false) {
            throw new ModuleException('The module directory could not be resolved.', ModuleException::REASON_INSTALL);
        }

        $zip = new ZipArchive();
        if ($zip->open($inspection->archivePath()) !== true) {
            throw new ModuleException('The package could not be reopened for extraction.', ModuleException::REASON_ARCHIVE);
        }

        $written = array();
        try {
            foreach ($inspection->entries() as $entry) {
                $written[] = $this->writeEntry($zip, $entry, $resolved);
            }
        } catch (ModuleException $failure) {
            $this->discard($written, $resolved);
            throw $failure;
        } catch (\Throwable $failure) {
            $this->discard($written, $resolved);
            throw new ModuleException('The package could not be extracted safely.', ModuleException::REASON_INSTALL);
        } finally {
            $zip->close();
        }
        return $written;
    }

    private function writeEntry(ZipArchive $zip, array $entry, $destinationRoot)
    {
        $relative = $entry['relative'];
        $target = Paths::containedPath($destinationRoot, $relative);
        if ($target === false) {
            throw new ModuleException('Extraction was stopped: "' . $this->printable($relative) . '" resolves outside the module directory.', ModuleException::REASON_ARCHIVE);
        }

        $directory = dirname($target);
        if (!is_dir($directory)) {
            if (is_link($directory) || !Paths::ensureDirectory($directory, 0755)) {
                throw new ModuleException('A directory inside the module could not be created safely.', ModuleException::REASON_INSTALL);
            }
        }
        if (is_link($directory) || is_link($target)) {
            throw new ModuleException('Extraction was stopped: a symbolic link is present at the destination.', ModuleException::REASON_ARCHIVE);
        }
        if (!Paths::isInside($destinationRoot, $directory)) {
            throw new ModuleException('Extraction was stopped: the destination directory escaped the module root.', ModuleException::REASON_ARCHIVE);
        }

        $stream = $zip->getStream($entry['name']);
        if (!is_resource($stream)) {
            throw new ModuleException('An archive entry could not be read during extraction.', ModuleException::REASON_ARCHIVE);
        }
        $handle = @fopen($target, 'wb');
        if (!is_resource($handle)) {
            fclose($stream);
            throw new ModuleException('A module file could not be written.', ModuleException::REASON_INSTALL);
        }

        $limit = (int) $entry['size'];
        $copied = 0;
        $hash = hash_init(Checksum::ALGORITHM);
        $crc = hash_init('crc32b');
        while (!feof($stream)) {
            $chunk = fread($stream, self::CHUNK);
            if ($chunk === false) { break; }
            $copied += strlen($chunk);
            if ($copied > $limit) {
                fclose($stream);
                fclose($handle);
                @unlink($target);
                throw new ModuleException('Archive entry "' . $this->printable($relative) . '" is larger than its declared size and was rejected.', ModuleException::REASON_ARCHIVE);
            }
            hash_update($hash, $chunk);
            hash_update($crc, $chunk);
            if (fwrite($handle, $chunk) === false) {
                fclose($stream);
                fclose($handle);
                @unlink($target);
                throw new ModuleException('A module file could not be written completely.', ModuleException::REASON_INSTALL);
            }
        }
        fclose($stream);
        fclose($handle);

        if ($copied !== $limit) {
            @unlink($target);
            throw new ModuleException('Archive entry "' . $this->printable($relative) . '" did not match its declared size.', ModuleException::REASON_ARCHIVE);
        }
        $actualCrc = hexdec(hash_final($crc));
        if ((int) $entry['crc'] !== 0 && $actualCrc !== (int) sprintf('%u', $entry['crc'])) {
            @unlink($target);
            throw new ModuleException('Archive entry "' . $this->printable($relative) . '" failed its integrity check.', ModuleException::REASON_ARCHIVE);
        }
        @chmod($target, 0644);

        return array('path' => $relative, 'sha256' => hash_final($hash), 'bytes' => $copied);
    }

    /** Remove anything this extractor created after a mid-flight failure. */
    private function discard(array $written, $destinationRoot)
    {
        foreach ($written as $file) {
            $path = Paths::containedPath($destinationRoot, $file['path']);
            if ($path !== false && is_file($path)) { @unlink($path); }
        }
    }

    private function printable($value)
    {
        return substr(preg_replace('/[^\x20-\x7E]/', '', (string) $value), 0, 96);
    }
}
