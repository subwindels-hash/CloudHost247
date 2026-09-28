<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\Node;
use CloudHost247\Builder\Schema\SchemaValidator;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Ids;

/**
 * Reusable templates, and the import/export format.
 *
 * A template package is JSON, never PHP and never a ZIP of code. Import runs
 * the document through the same validator an editor save uses, so an imported
 * template cannot introduce an unknown widget, an unvalidated style, a script
 * tag or a URL the policy rejects. Nothing in a template is executed, and no
 * file is written to disk by an import.
 *
 * Packages are checksummed on export and re-checksummed on import, so an
 * administrator can tell whether what they received is what was sent.
 */
class TemplateService
{
    const PACKAGE_FORMAT = 'cloudhost247-template/v1';
    const MAX_PACKAGE_BYTES = 1048576;

    private $library;
    private $events;
    private $validator;
    private $sanitizer;

    public function __construct(
        LibraryRepository $library = null,
        EventRepository $events = null,
        SchemaValidator $validator = null,
        HtmlSanitizer $sanitizer = null
    ) {
        $this->library = $library ? $library : new LibraryRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->validator = $validator ? $validator : new SchemaValidator();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
    }

    public function all($category = '') { return $this->library->templates($category); }

    public function find($id) { return $this->library->template($id); }

    /** Save a whole page, or one selected branch of it, as a template. */
    public function saveFromDocument(array $input, Document $document, $adminId)
    {
        $key = isset($input['template_key']) && $input['template_key'] !== ''
            ? (string) $input['template_key']
            : $this->deriveKey(isset($input['name']) ? $input['name'] : 'template');
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A template key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        if ($document->isEmpty()) {
            throw BuilderException::validation('There is nothing to save as a template.');
        }
        $id = $this->library->saveTemplate(array(
            'template_key' => $key,
            'name' => $this->sanitizer->text(isset($input['name']) ? $input['name'] : $key, 160),
            'category' => isset($input['category']) ? $input['category'] : 'section',
            'description' => $this->sanitizer->text(isset($input['description']) ? $input['description'] : '', 300),
        ), $document, $adminId);

        $this->events->record('template.save', array(
            'entity_type' => 'template', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Saved template "' . $key . '" with ' . $document->nodeCount() . ' element(s)',
        ));
        return $this->library->template($id);
    }

    /**
     * Extract one node (and its children) as a reusable template document.
     *
     * A section can be stored as-is; anything smaller is wrapped so the result
     * is still a valid document that the editor can insert anywhere.
     */
    public function documentFromNode(Document $document, $nodeId)
    {
        $node = $document->find($nodeId);
        if ($node === null) {
            throw BuilderException::notFound('That element is no longer part of the page.');
        }
        $node = Node::regenerateIds($node);
        if (Node::type($node) === 'section') {
            return Document::fromArray(array('children' => array($node)), $this->validator, true);
        }
        $column = Node::type($node) === 'column' ? $node : null;
        $container = Node::make('container', '', array('html_tag' => 'div', 'layout' => 'flex'));
        $container['children'] = array($column !== null ? $column : $node);
        if ($column === null && Node::type($node) === 'container') { $container = $node; }
        $section = Node::make('section', '', array('html_tag' => 'section', 'content_width' => 'boxed'));
        $section['children'] = array($container);
        return Document::fromArray(array('children' => array($section)), $this->validator, true);
    }

    public function delete($id, $adminId)
    {
        $template = $this->library->template($id);
        if (!$template) { throw BuilderException::notFound('That template no longer exists.'); }
        if ($template['is_builtin']) {
            throw BuilderException::permission('Built-in templates cannot be deleted.');
        }
        $this->library->deleteTemplate($id);
        $this->events->record('template.delete', array(
            'entity_type' => 'template', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Deleted template "' . $template['template_key'] . '"',
        ));
        return true;
    }

    /* --------------------------------------------------------------- export */

    /** @return string JSON package, safe to hand to another installation */
    public function export($id, $adminId = 0)
    {
        $template = $this->library->template($id);
        if (!$template) { throw BuilderException::notFound('That template no longer exists.'); }
        $document = Document::fromJson($template['document_json'], $this->validator, false);
        $package = array(
            'format' => self::PACKAGE_FORMAT,
            'exported_at' => gmdate('c'),
            'template' => array(
                'key' => $template['template_key'],
                'name' => $template['name'],
                'category' => $template['category'],
                'description' => $template['description'],
            ),
            'document' => $document->toArray(),
            'checksum' => $document->checksum(),
        );
        $this->events->record('template.export', array(
            'entity_type' => 'template', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Exported template "' . $template['template_key'] . '"',
        ));
        return (string) json_encode($package, JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    }

    /* --------------------------------------------------------------- import */

    /**
     * Read a package without saving it, for the import preview.
     *
     * @return array array('template', 'document', 'checksum_matches', 'widgets', 'elements', 'warnings')
     */
    public function inspect($json)
    {
        $json = (string) $json;
        if (strlen($json) > self::MAX_PACKAGE_BYTES) {
            throw BuilderException::import('The template package exceeds ' . round(self::MAX_PACKAGE_BYTES / 1024) . ' KiB.');
        }
        if (trim($json) === '') {
            throw BuilderException::import('Paste or upload a template package first.');
        }
        $data = json_decode($json, true, 64);
        if (json_last_error() !== JSON_ERROR_NONE) {
            throw BuilderException::import('The template package is not valid JSON (' . json_last_error_msg() . ').');
        }
        if (!is_array($data)) {
            throw BuilderException::import('The template package must be a JSON object.');
        }
        $format = isset($data['format']) ? (string) $data['format'] : '';
        if ($format !== self::PACKAGE_FORMAT) {
            throw BuilderException::import('Unsupported template format. Expected ' . self::PACKAGE_FORMAT . '.');
        }
        if (!isset($data['document']) || !is_array($data['document'])) {
            throw BuilderException::import('The package does not contain a page document.');
        }

        $warnings = array();
        // Strict validation: an imported document must satisfy exactly the same
        // rules as one an administrator built in the editor.
        $document = Document::fromArray($data['document'], $this->validator, true);
        $declared = isset($data['checksum']) ? (string) $data['checksum'] : '';
        $matches = $declared !== '' && hash_equals($declared, $document->checksum());
        if ($declared === '') {
            $warnings[] = 'The package has no checksum, so its integrity cannot be confirmed.';
        } elseif (!$matches) {
            $warnings[] = 'The package checksum does not match its contents. It was edited or truncated after export.';
        }

        $meta = isset($data['template']) && is_array($data['template']) ? $data['template'] : array();
        $key = isset($meta['key']) ? (string) $meta['key'] : '';
        if (!Ids::isKey($key)) { $key = $this->deriveKey(isset($meta['name']) ? $meta['name'] : 'imported-template'); }
        if ($this->library->templateByKey($key)) {
            $warnings[] = 'A template with the key "' . $key . '" already exists and will be replaced.';
        }

        return array(
            'template' => array(
                'key' => $key,
                'name' => $this->sanitizer->text(isset($meta['name']) ? $meta['name'] : $key, 160),
                'category' => isset($meta['category']) && in_array($meta['category'], LibraryRepository::TEMPLATE_CATEGORIES, true)
                    ? $meta['category'] : 'section',
                'description' => $this->sanitizer->text(isset($meta['description']) ? $meta['description'] : '', 300),
            ),
            'document' => $document,
            'checksum' => $document->checksum(),
            'declared_checksum' => $declared,
            'checksum_matches' => $matches,
            'elements' => $document->nodeCount(),
            'widgets' => $document->widgetKeys(),
            'warnings' => $warnings,
        );
    }

    public function import($json, $adminId)
    {
        $inspection = $this->inspect($json);
        $id = $this->library->saveTemplate(array(
            'template_key' => $inspection['template']['key'],
            'name' => $inspection['template']['name'],
            'category' => $inspection['template']['category'],
            'description' => $inspection['template']['description'],
        ), $inspection['document'], $adminId);

        $this->events->record('template.import', array(
            'entity_type' => 'template', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Imported template "' . $inspection['template']['key'] . '" ('
                . $inspection['elements'] . ' elements, checksum '
                . ($inspection['checksum_matches'] ? 'verified' : 'not verified') . ')',
            'metadata' => array('widgets' => $inspection['widgets'], 'warnings' => $inspection['warnings']),
        ));
        return array('template' => $this->library->template($id), 'inspection' => $inspection);
    }

    private function deriveKey($name)
    {
        $key = strtolower(preg_replace('/[^A-Za-z0-9]+/', '-', (string) $name));
        $key = trim((string) $key, '-');
        if ($key === '' || preg_match('/^[a-z]/', $key) !== 1) { $key = 'tpl-' . substr(bin2hex(random_bytes(4)), 0, 8); }
        return substr($key, 0, 64);
    }
}
