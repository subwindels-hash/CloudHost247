<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\MediaRepository;
use CloudHost247\Builder\Repositories\PageRepository;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Paths;

/**
 * Media uploads.
 *
 * Uploaded media is data, never code. The pipeline is: PHP upload error check,
 * size check against the configured limit, extension allowlist, MIME sniff
 * with finfo, magic-byte check, image decode check, then a server-generated
 * file name written inside the media root with a 0644 mode and no execute bit.
 *
 * SVG is refused on purpose: it is an XML document that can carry script, and
 * there is no safe way to serve an arbitrary one from the same origin as the
 * client area. The message says so rather than failing silently.
 */
class MediaService
{
    /** extension => accepted MIME types. */
    const ALLOWED = array(
        'jpg' => array('image/jpeg'), 'jpeg' => array('image/jpeg'), 'png' => array('image/png'),
        'gif' => array('image/gif'), 'webp' => array('image/webp'),
        'ico' => array('image/x-icon', 'image/vnd.microsoft.icon'),
        'mp4' => array('video/mp4'), 'webm' => array('video/webm'),
        'pdf' => array('application/pdf'),
    );
    /** Leading bytes each accepted format must start with. */
    const MAGIC = array(
        'jpg' => array("\xFF\xD8\xFF"), 'jpeg' => array("\xFF\xD8\xFF"),
        'png' => array("\x89PNG\r\n\x1a\n"), 'gif' => array('GIF87a', 'GIF89a'),
        'webp' => array('RIFF'), 'ico' => array("\x00\x00\x01\x00"),
        'mp4' => array(), 'webm' => array("\x1A\x45\xDF\xA3"), 'pdf' => array('%PDF-'),
    );
    const REFUSED_EXPLANATION = array(
        'svg' => 'SVG files can contain script, so they are not accepted. Upload a PNG or WebP instead.',
        'svgz' => 'SVG files can contain script, so they are not accepted. Upload a PNG or WebP instead.',
        'html' => 'HTML files cannot be uploaded to the media library.',
        'htm' => 'HTML files cannot be uploaded to the media library.',
        'php' => 'Executable files are never accepted by the media library.',
        'phtml' => 'Executable files are never accepted by the media library.',
        'js' => 'JavaScript files cannot be uploaded to the media library.',
    );
    const MAX_NAME_LENGTH = 80;

    private $media;
    private $events;
    private $settings;
    private $pages;
    private $sanitizer;

    public function __construct(
        MediaRepository $media = null,
        EventRepository $events = null,
        Settings $settings = null,
        PageRepository $pages = null,
        HtmlSanitizer $sanitizer = null
    ) {
        $this->media = $media ? $media : new MediaRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->settings = $settings ? $settings : new Settings();
        $this->pages = $pages ? $pages : new PageRepository();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function repository() { return $this->media; }

    public function maxBytes()
    {
        return max(1, min(256, $this->settings->integer('media_max_mib'))) * 1048576;
    }

    public function storageReady()
    {
        return Paths::mediaRootIsWritable();
    }

    /**
     * Validate and store one uploaded file.
     *
     * @param array $file  one entry of $_FILES
     * @param bool  $trustUploadedFlag false only in tests, where there is no real upload
     */
    public function upload(array $file, $adminId, array $meta = array(), $trustUploadedFlag = true)
    {
        $temporary = isset($file['tmp_name']) ? (string) $file['tmp_name'] : '';
        $originalName = isset($file['name']) ? (string) $file['name'] : '';
        $error = isset($file['error']) ? (int) $file['error'] : UPLOAD_ERR_NO_FILE;

        $this->assertUploadOk($error);
        if ($temporary === '' || !is_file($temporary)) {
            throw BuilderException::upload('The upload did not arrive on the server.');
        }
        if ($trustUploadedFlag && !is_uploaded_file($temporary)) {
            throw BuilderException::upload('That file was not received through an upload and was refused.');
        }

        $size = (int) @filesize($temporary);
        if ($size <= 0) { throw BuilderException::upload('The uploaded file is empty.'); }
        if ($size > $this->maxBytes()) {
            throw BuilderException::upload('The file is ' . $this->human($size) . '; the limit is ' . $this->human($this->maxBytes()) . '.');
        }

        $extension = strtolower((string) pathinfo($originalName, PATHINFO_EXTENSION));
        if (isset(self::REFUSED_EXPLANATION[$extension])) {
            throw BuilderException::upload(self::REFUSED_EXPLANATION[$extension]);
        }
        if (!isset(self::ALLOWED[$extension])) {
            throw BuilderException::upload('"' . $this->safeName($originalName) . '" is not an accepted file type. Allowed: '
                . implode(', ', array_keys(self::ALLOWED)) . '.');
        }
        // A name with two extensions (logo.php.png) is normalised away below, but
        // reject the obvious attempt outright so it is visible in the log.
        $base = (string) pathinfo($originalName, PATHINFO_FILENAME);
        if (preg_match('/\.(php[0-9]?|phtml|phar|pl|py|cgi|sh|htaccess)$/i', $base) === 1) {
            throw BuilderException::upload('That file name looks like an executable file and was refused.');
        }

        $mime = $this->detectMime($temporary);
        if ($mime === '' || !in_array($mime, self::ALLOWED[$extension], true)) {
            throw BuilderException::upload('The file contents (' . ($mime === '' ? 'unrecognised' : $this->safeName($mime))
                . ') do not match a .' . $extension . ' file.');
        }
        $this->assertMagicBytes($temporary, $extension);

        $width = 0;
        $height = 0;
        if (strncmp($mime, 'image/', 6) === 0 && $extension !== 'ico') {
            $info = @getimagesize($temporary);
            if ($info === false || empty($info[0]) || empty($info[1])) {
                throw BuilderException::upload('That image could not be decoded, so it was not stored.');
            }
            $width = (int) $info[0];
            $height = (int) $info[1];
        }

        $checksum = hash_file('sha256', $temporary);
        $existing = $this->media->findByChecksum($checksum);
        if ($existing) {
            // Identical bytes already in the library: reuse rather than duplicate.
            return array('media' => $existing, 'duplicate' => true);
        }

        $root = Paths::mediaRoot();
        if (!Paths::ensureDirectory($root)) {
            throw BuilderException::storage('The media directory could not be created: ' . $root);
        }
        Paths::protectDirectory($root);

        $relativeDirectory = date('Y') . '/' . date('m');
        $directory = Paths::containedPath($root, $relativeDirectory);
        if ($directory === false) { throw BuilderException::storage('The media path could not be resolved.'); }
        if (!Paths::ensureDirectory($directory)) {
            throw BuilderException::storage('The media directory could not be created.');
        }
        Paths::protectDirectory($directory);

        $fileName = $this->buildFileName($base, $extension, $checksum);
        $destination = Paths::containedPath($root, $relativeDirectory . '/' . $fileName);
        if ($destination === false) { throw BuilderException::storage('The destination path was rejected.'); }

        $moved = $trustUploadedFlag ? @move_uploaded_file($temporary, $destination) : @copy($temporary, $destination);
        if (!$moved || !is_file($destination)) {
            throw BuilderException::storage('The file could not be written to the media directory.');
        }
        @chmod($destination, 0644);

        $id = $this->media->insert(array(
            'file_name' => $fileName,
            'stored_path' => $relativeDirectory . '/' . $fileName,
            'url_path' => Paths::mediaUrlBase() . '/' . $relativeDirectory . '/' . $fileName,
            'mime' => $mime,
            'extension' => $extension,
            'size_bytes' => $size,
            'width' => $width,
            'height' => $height,
            'checksum' => $checksum,
            'alt_text' => $this->sanitizer->text(isset($meta['alt_text']) ? $meta['alt_text'] : '', 250),
            'title' => $this->sanitizer->text(isset($meta['title']) ? $meta['title'] : $base, 200),
            'category' => isset($meta['category']) && in_array($meta['category'], MediaRepository::CATEGORIES, true)
                ? $meta['category'] : 'general',
            'uploaded_by' => (int) $adminId,
        ));

        $this->events->record('media.upload', array(
            'entity_type' => 'media', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Uploaded ' . $fileName . ' (' . $this->human($size) . ', ' . $mime . ')',
            'metadata' => array('checksum' => $checksum, 'width' => $width, 'height' => $height),
        ));
        return array('media' => $this->media->find($id), 'duplicate' => false);
    }

    public function updateMeta($id, array $data, $adminId)
    {
        $item = $this->media->find($id);
        if (!$item) { throw BuilderException::notFound('That media item no longer exists.'); }
        $updated = $this->media->updateMeta($id, $data);
        $this->events->record('media.update', array(
            'entity_type' => 'media', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Updated media details for ' . $item['file_name'],
        ));
        return $updated;
    }

    /**
     * Pages that reference a media item.
     *
     * Shown before deletion so nobody removes an image that is live on the
     * site without being told which pages use it.
     */
    public function usage($id)
    {
        $id = (int) $id;
        $needle = '"id":' . $id . ',';
        $rows = array();
        $listing = $this->pages->all(array(), 1, 100);
        foreach ($listing['rows'] as $page) {
            $inDraft = strpos((string) $page['document_json'], $needle) !== false;
            $inLive = strpos((string) $page['published_json'], $needle) !== false;
            if (!$inDraft && !$inLive) { continue; }
            $rows[] = array(
                'id' => $page['id'], 'title' => $page['title'], 'slug' => $page['slug'],
                'status' => $page['status'], 'published' => $inLive,
            );
        }
        return $rows;
    }

    public function delete($id, $adminId)
    {
        $item = $this->media->find($id);
        if (!$item) { throw BuilderException::notFound('That media item no longer exists.'); }
        $usage = $this->usage($id);
        $absolute = Paths::containedPath(Paths::mediaRoot(), $item['stored_path']);
        $removed = $absolute !== false ? Paths::removeFile($absolute, Paths::mediaRoot()) : false;
        $this->media->delete($id);
        $this->events->record('media.delete', array(
            'entity_type' => 'media', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Deleted media ' . $item['file_name'] . ($removed ? '' : ' (database row only; the file was already gone)'),
            'metadata' => array('pages_referencing' => count($usage)),
        ));
        return array('file_removed' => $removed, 'usage' => $usage);
    }

    /* --------------------------------------------------------------- helpers */

    private function assertUploadOk($error)
    {
        switch ($error) {
            case UPLOAD_ERR_OK: return;
            case UPLOAD_ERR_INI_SIZE:
            case UPLOAD_ERR_FORM_SIZE:
                throw BuilderException::upload('The file is larger than the server upload limit.');
            case UPLOAD_ERR_PARTIAL:
                throw BuilderException::upload('The upload was interrupted. Try again.');
            case UPLOAD_ERR_NO_FILE:
                throw BuilderException::upload('Choose a file to upload.');
            case UPLOAD_ERR_NO_TMP_DIR:
            case UPLOAD_ERR_CANT_WRITE:
                throw BuilderException::storage('The server could not write the uploaded file to temporary storage.');
            case UPLOAD_ERR_EXTENSION:
                throw BuilderException::upload('A PHP extension stopped this upload.');
            default:
                throw BuilderException::upload('The upload failed (code ' . (int) $error . ').');
        }
    }

    private function detectMime($path)
    {
        if (function_exists('finfo_open')) {
            $finfo = @finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo) {
                $mime = @finfo_file($finfo, $path);
                @finfo_close($finfo);
                if (is_string($mime) && $mime !== '') { return strtolower($mime); }
            }
        }
        if (function_exists('mime_content_type')) {
            $mime = @mime_content_type($path);
            if (is_string($mime) && $mime !== '') { return strtolower($mime); }
        }
        return '';
    }

    private function assertMagicBytes($path, $extension)
    {
        $expected = isset(self::MAGIC[$extension]) ? self::MAGIC[$extension] : array();
        if (!$expected) { return; }
        $handle = @fopen($path, 'rb');
        if (!$handle) { throw BuilderException::upload('The uploaded file could not be read.'); }
        $head = (string) fread($handle, 16);
        fclose($handle);
        foreach ($expected as $signature) {
            if (strncmp($head, $signature, strlen($signature)) === 0) { return; }
        }
        throw BuilderException::upload('The file does not start like a valid .' . $extension . ' file.');
    }

    /**
     * Server-generated file name.
     *
     * The original name only contributes a slug; the extension comes from the
     * validated allowlist and a checksum fragment guarantees uniqueness, so a
     * crafted name cannot produce a path, a hidden file or a second extension.
     */
    private function buildFileName($base, $extension, $checksum)
    {
        $slug = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', (string) $base));
        $slug = trim((string) $slug, '-');
        if ($slug === '') { $slug = 'file'; }
        if (strlen($slug) > self::MAX_NAME_LENGTH) { $slug = substr($slug, 0, self::MAX_NAME_LENGTH); }
        return $slug . '-' . substr($checksum, 0, 10) . '.' . $extension;
    }

    private function safeName($value)
    {
        $value = preg_replace('/[^\x20-\x7E]/', '', (string) $value);
        return htmlspecialchars(substr((string) $value, 0, 120), ENT_QUOTES, 'UTF-8');
    }

    private function human($bytes)
    {
        $bytes = (int) $bytes;
        if ($bytes >= 1048576) { return round($bytes / 1048576, 1) . ' MiB'; }
        if ($bytes >= 1024) { return round($bytes / 1024) . ' KiB'; }
        return $bytes . ' B';
    }
}
