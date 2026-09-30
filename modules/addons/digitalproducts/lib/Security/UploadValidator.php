<?php
namespace DigitalProducts\Security;

final class UploadValidator
{
    const DEFAULT_MAX_BYTES = 524288000; // 500 MiB

    private $allowedExtensions;
    private $maxBytes;
    private $uploadedFileCheck;

    public function __construct(array $settings = array(), $uploadedFileCheck = null)
    {
        $allowed = isset($settings['allowed_extensions']) ? (string) $settings['allowed_extensions'] : '';
        if ($allowed === '') { $allowed = 'zip,tar.gz,pdf,js,css,php,json,xml,txt,md,html,htm'; }
        $this->allowedExtensions = $this->parseExtensions($allowed);
        $configuredMax = isset($settings['max_upload_size']) ? (int) $settings['max_upload_size'] : 0;
        $this->maxBytes = $configuredMax > 0 ? min($configuredMax, 2147483647) : self::DEFAULT_MAX_BYTES;
        $this->uploadedFileCheck = $uploadedFileCheck ? $uploadedFileCheck : 'is_uploaded_file';
    }

    public function validate($file)
    {
        if (!is_array($file) || !isset($file['error'])) { throw new \RuntimeException('No file was submitted.'); }
        $this->assertUploadStatus((int) $file['error']);
        $temporary = isset($file['tmp_name']) ? (string) $file['tmp_name'] : '';
        if ($temporary === '' || !is_file($temporary)) { throw new \RuntimeException('The uploaded file was not received completely.'); }
        $check = $this->uploadedFileCheck;
        if (!$check($temporary)) { throw new \RuntimeException('The submitted path is not a genuine PHP upload.'); }

        $original = $this->sanitizeName(isset($file['name']) ? (string) $file['name'] : 'download.bin');
        $extension = $this->extension($original);
        if ($extension === '' || !in_array($extension, $this->allowedExtensions, true)) {
            throw new \RuntimeException('This file type is not allowed. Allowed extensions: ' . implode(', ', $this->allowedExtensions));
        }
        $this->assertNoDangerousDoubleExtension($original, $extension);

        $size = (int) filesize($temporary);
        if ($size <= 0) { throw new \RuntimeException('The uploaded file is empty.'); }
        if ($size > $this->maxBytes) { throw new \RuntimeException('The uploaded file exceeds the configured limit of ' . round($this->maxBytes / 1048576, 1) . ' MiB.'); }

        $mime = $this->detectMime($temporary);
        $this->assertMimeAllowed($extension, $mime);
        if ($extension === 'zip') { $this->inspectZip($temporary); }

        $checksum = hash_file('sha256', $temporary);
        if (!$checksum || !preg_match('/^[a-f0-9]{64}$/', $checksum)) { throw new \RuntimeException('Unable to calculate a SHA-256 checksum for the uploaded file.'); }

        return array(
            'path' => $temporary,
            'original_name' => $original,
            'extension' => $extension,
            'bytes' => $size,
            'checksum' => $checksum,
            'mime' => $mime,
        );
    }

    public function allowedExtensions()
    {
        return $this->allowedExtensions;
    }

    private function assertUploadStatus($error)
    {
        if ($error === UPLOAD_ERR_OK) { return; }
        $messages = array(
            UPLOAD_ERR_INI_SIZE => 'The file is larger than the server upload_max_filesize limit.',
            UPLOAD_ERR_FORM_SIZE => 'The file is larger than the submitted form limit.',
            UPLOAD_ERR_PARTIAL => 'The file was only partially uploaded.',
            UPLOAD_ERR_NO_FILE => 'No file was selected.',
            UPLOAD_ERR_NO_TMP_DIR => 'The server has no writable temporary upload directory.',
            UPLOAD_ERR_CANT_WRITE => 'The server could not write the uploaded file.',
            UPLOAD_ERR_EXTENSION => 'A PHP extension stopped the upload.',
        );
        throw new \RuntimeException(isset($messages[$error]) ? $messages[$error] : 'The upload failed.');
    }

    private function sanitizeName($name)
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[^A-Za-z0-9._ -]/', '_', $name);
        $name = trim((string) $name, ' ._-');
        return substr($name !== '' ? $name : 'download.bin', 0, 180);
    }

    private function extension($name)
    {
        $lower = strtolower($name);
        if (substr($lower, -7) === '.tar.gz') { return 'tar.gz'; }
        if (substr($lower, -8) === '.tar.bz2') { return 'tar.bz2'; }
        $pos = strrpos($lower, '.');
        return $pos === false ? '' : substr($lower, $pos + 1);
    }

    private function assertNoDangerousDoubleExtension($name, $extension)
    {
        $forbidden = array('phtml', 'phar', 'cgi', 'pl', 'exe', 'sh', 'bat', 'cmd', 'com', 'scr');
        $lower = strtolower($name);
        $without = substr($lower, 0, -strlen($extension));
        $without = rtrim($without, '.');
        foreach (explode('.', $without) as $part) {
            if (in_array($part, $forbidden, true)) {
                throw new \RuntimeException('The filename contains a dangerous double extension.');
            }
        }
    }

    private function detectMime($path)
    {
        if (!function_exists('finfo_open')) { return ''; }
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if (!$finfo) { return ''; }
        $mime = (string) @finfo_file($finfo, $path);
        @finfo_close($finfo);
        return $mime;
    }

    private function assertMimeAllowed($extension, $mime)
    {
        if ($mime === '') { return; }
        $acceptable = array(
            'zip' => array('application/zip', 'application/x-zip', 'application/x-zip-compressed', 'application/octet-stream'),
            'tar.gz' => array('application/gzip', 'application/x-gzip', 'application/octet-stream'),
            'tar.bz2' => array('application/x-bzip2', 'application/octet-stream'),
            'pdf' => array('application/pdf', 'application/octet-stream'),
            'js' => array('text/plain', 'application/javascript', 'text/javascript', 'application/x-javascript', 'application/octet-stream'),
            'css' => array('text/plain', 'text/css', 'application/octet-stream'),
            'php' => array('text/plain', 'text/x-php', 'application/x-php', 'application/octet-stream'),
            'json' => array('application/json', 'text/plain', 'application/octet-stream'),
            'xml' => array('application/xml', 'text/xml', 'text/plain', 'application/octet-stream'),
            'txt' => array('text/plain', 'application/octet-stream'),
            'md' => array('text/plain', 'text/markdown', 'application/octet-stream'),
            'html' => array('text/html', 'text/plain', 'application/octet-stream'),
            'htm' => array('text/html', 'text/plain', 'application/octet-stream'),
        );
        if (isset($acceptable[$extension]) && !in_array($mime, $acceptable[$extension], true)) {
            throw new \RuntimeException('The uploaded file MIME type (' . preg_replace('/[^\x20-\x7E]/', '', $mime) . ') does not match the file extension.');
        }
    }

    private function inspectZip($path)
    {
        if (!class_exists('ZipArchive')) { return; }
        $zip = new \ZipArchive();
        if ($zip->open($path) !== true) { throw new \RuntimeException('The ZIP archive could not be opened for inspection.'); }
        $totalUncompressed = 0;
        $maxEntries = 5000;
        $maxRatio = 200;
        if ($zip->numFiles > $maxEntries) { $zip->close(); throw new \RuntimeException('The ZIP archive contains too many entries.'); }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $stat = $zip->statIndex($i);
            if (!$stat || !isset($stat['name'])) { continue; }
            $name = str_replace('\\', '/', (string) $stat['name']);
            if ($name === '' || strpos($name, "\0") !== false || preg_match('#(^|/)\.\.(?:/|$)#', $name) || preg_match('#^[A-Za-z]:/#', $name) || substr($name, 0, 1) === '/') {
                $zip->close(); throw new \RuntimeException('The ZIP archive contains an unsafe path.');
            }
            $base = basename($name);
            if ($base !== '' && $base !== '.' && $base !== '..') { $this->assertNoDangerousDoubleExtension($base, $this->extension($base)); }
            $external = isset($stat['external_attributes']) ? (int) $stat['external_attributes'] : null;
            if ($external !== null) {
                $mode = ($external >> 16) & 0xF000;
                if ($mode === 0xA000) { $zip->close(); throw new \RuntimeException('The ZIP archive contains a symbolic link.'); }
                if ($mode !== 0 && $mode !== 0x8000 && $mode !== 0x4000) { $zip->close(); throw new \RuntimeException('The ZIP archive contains a special file.'); }
            }
            $totalUncompressed += isset($stat['size']) ? (int) $stat['size'] : 0;
        }
        $zip->close();
        $compressed = max(1, (int) filesize($path));
        if ($totalUncompressed > $this->maxBytes * 5 || ($totalUncompressed / $compressed) > $maxRatio) {
            throw new \RuntimeException('The ZIP archive has an unsafe compression ratio.');
        }
    }

    private function parseExtensions($value)
    {
        $parts = preg_split('/[\s,]+/', strtolower((string) $value));
        $extensions = array();
        foreach ($parts as $part) {
            $part = trim($part, '. ');
            if ($part !== '' && preg_match('/^[a-z0-9]+(?:\.[a-z0-9]+)?$/', $part)) { $extensions[] = $part; }
        }
        $extensions = array_values(array_unique($extensions));
        return $extensions ? $extensions : array('zip');
    }
}
