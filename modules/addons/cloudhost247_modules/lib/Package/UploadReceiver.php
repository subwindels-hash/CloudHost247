<?php
namespace CloudHost247\ModuleManager\Package;

use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;

/**
 * First gate for an uploaded package.
 *
 * Nothing here trusts the browser. The client-supplied filename and MIME type
 * are treated as hints only; acceptance is decided by the PHP upload status,
 * the real byte size, the file signature and, later, the archive inspector.
 */
final class UploadReceiver
{
    const ENV_MAX_BYTES = 'CH247_MODULE_MAX_UPLOAD_BYTES';
    const DEFAULT_MAX_BYTES = 33554432; // 32 MiB
    const MIN_BYTES = 128;
    const ZIP_SIGNATURES = array("PK\x03\x04", "PK\x05\x06", "PK\x07\x08");

    private $uploadedFileCheck;

    /** @param callable|null $uploadedFileCheck test seam for is_uploaded_file() */
    public function __construct($uploadedFileCheck = null)
    {
        $this->uploadedFileCheck = $uploadedFileCheck ? $uploadedFileCheck : 'is_uploaded_file';
    }

    public static function maxBytes()
    {
        $configured = getenv(self::ENV_MAX_BYTES);
        if (is_string($configured) && ctype_digit(trim($configured))) {
            $value = (int) trim($configured);
            if ($value >= 65536 && $value <= 268435456) { return $value; }
        }
        return self::DEFAULT_MAX_BYTES;
    }

    /**
     * @param array $file one entry from $_FILES
     * @return array array('path' => temp path, 'name' => sanitized original name, 'bytes' => int, 'checksum' => sha256)
     */
    public function receive($file)
    {
        if (!is_array($file) || !isset($file['error'])) {
            throw new ModuleException('No module package was submitted.', ModuleException::REASON_UPLOAD);
        }
        $this->assertUploadStatus((int) $file['error']);

        $temporary = isset($file['tmp_name']) ? (string) $file['tmp_name'] : '';
        if ($temporary === '' || !is_file($temporary)) {
            throw new ModuleException('The uploaded package was not received completely.', ModuleException::REASON_UPLOAD);
        }
        $check = $this->uploadedFileCheck;
        if (!$check($temporary)) {
            throw new ModuleException('The submitted path is not a genuine PHP upload and was rejected.', ModuleException::REASON_UPLOAD);
        }

        $name = $this->sanitizeName(isset($file['name']) ? (string) $file['name'] : '');
        if (substr(strtolower($name), -4) !== '.zip') {
            throw new ModuleException('Only .zip module packages are supported.', ModuleException::REASON_UPLOAD);
        }

        $bytes = (int) filesize($temporary);
        $maximum = self::maxBytes();
        if ($bytes < self::MIN_BYTES) {
            throw new ModuleException('The uploaded package is too small to be a module archive.', ModuleException::REASON_UPLOAD);
        }
        if ($bytes > $maximum) {
            throw new ModuleException('The uploaded package exceeds the ' . round($maximum / 1048576, 1) . ' MiB limit.', ModuleException::REASON_UPLOAD);
        }

        $this->assertZipSignature($temporary);
        $this->assertDeclaredMimeType($temporary);

        $checksum = Checksum::ofFile($temporary);
        if ($checksum === '') {
            throw new ModuleException('The package checksum could not be calculated.', ModuleException::REASON_UPLOAD);
        }

        return array('path' => $temporary, 'name' => $name, 'bytes' => $bytes, 'checksum' => $checksum);
    }

    private function assertUploadStatus($error)
    {
        if ($error === UPLOAD_ERR_OK) { return; }
        $messages = array(
            UPLOAD_ERR_INI_SIZE => 'The package is larger than the server upload_max_filesize limit.',
            UPLOAD_ERR_FORM_SIZE => 'The package is larger than the form upload limit.',
            UPLOAD_ERR_PARTIAL => 'The package was only partially uploaded. Please retry.',
            UPLOAD_ERR_NO_FILE => 'No module package was selected.',
            UPLOAD_ERR_NO_TMP_DIR => 'The server has no writable temporary upload directory.',
            UPLOAD_ERR_CANT_WRITE => 'The server could not write the uploaded package to disk.',
            UPLOAD_ERR_EXTENSION => 'A PHP extension stopped the upload.',
        );
        $message = isset($messages[$error]) ? $messages[$error] : 'The package upload failed.';
        throw new ModuleException($message, ModuleException::REASON_UPLOAD);
    }

    private function sanitizeName($name)
    {
        $name = basename(str_replace('\\', '/', $name));
        $name = preg_replace('/[^A-Za-z0-9._-]/', '_', $name);
        return substr((string) $name, 0, 128);
    }

    private function assertZipSignature($path)
    {
        $handle = @fopen($path, 'rb');
        if (!is_resource($handle)) {
            throw new ModuleException('The uploaded package could not be read.', ModuleException::REASON_UPLOAD);
        }
        $magic = (string) fread($handle, 4);
        fclose($handle);
        if (!in_array($magic, self::ZIP_SIGNATURES, true)) {
            throw new ModuleException('The uploaded file is not a ZIP archive regardless of its file name.', ModuleException::REASON_UPLOAD);
        }
    }

    private function assertDeclaredMimeType($path)
    {
        if (!function_exists('finfo_open')) { return; }
        $finfo = @finfo_open(FILEINFO_MIME_TYPE);
        if (!$finfo) { return; }
        $detected = (string) @finfo_file($finfo, $path);
        finfo_close($finfo);
        $acceptable = array('application/zip', 'application/x-zip', 'application/x-zip-compressed', 'application/octet-stream', 'multipart/x-zip');
        if ($detected !== '' && !in_array($detected, $acceptable, true)) {
            throw new ModuleException('The uploaded file is detected as "' . preg_replace('/[^\x20-\x7E]/', '', $detected) . '" rather than a ZIP archive.', ModuleException::REASON_UPLOAD);
        }
    }
}
