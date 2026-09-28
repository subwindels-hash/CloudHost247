<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Schema\Document;
use CloudHost247\Builder\Schema\SchemaValidator;
use CloudHost247\Builder\Support\BuilderException;

/**
 * Theme parts: global headers, footers and layout templates.
 *
 * Parts are additive. They are rendered by the builder's own page renderer and
 * by an optional client-area hook; no CloudHost247 template file is read, written or
 * replaced by this service, and a site with no published parts behaves exactly
 * as it did before the module was installed.
 *
 * Drafts and published copies are separate, exactly as for pages, so editing
 * the global header cannot change every page on the site by accident.
 */
class ThemeService
{
    private $library;
    private $events;
    private $validator;

    public function __construct(LibraryRepository $library = null, EventRepository $events = null, SchemaValidator $validator = null)
    {
        $this->library = $library ? $library : new LibraryRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->validator = $validator ? $validator : new SchemaValidator();
    }

    public function types() { return LibraryRepository::PART_TYPES; }

    public function all($type = '') { return $this->library->parts($type); }

    public function find($id) { return $this->library->part($id); }

    public function create(array $input, $adminId)
    {
        $id = $this->library->createPart(array(
            'part_key' => isset($input['part_key']) ? $input['part_key'] : '',
            'name' => isset($input['name']) ? $input['name'] : '',
            'part_type' => isset($input['part_type']) ? $input['part_type'] : 'header',
            'priority' => isset($input['priority']) ? $input['priority'] : 10,
            'conditions' => DisplayConditions::normalize(isset($input['conditions']) ? $input['conditions'] : array()),
            'document' => Document::blank(),
        ), $adminId);
        $part = $this->library->part($id);
        $this->events->record('part.create', array(
            'entity_type' => 'part', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Created ' . $part['part_type'] . ' part "' . $part['part_key'] . '"',
        ));
        return $part;
    }

    public function update($id, array $input, $adminId)
    {
        $part = $this->mustFind($id);
        $data = array();
        foreach (array('name', 'part_type', 'priority') as $field) {
            if (isset($input[$field])) { $data[$field] = $input[$field]; }
        }
        if (isset($input['conditions'])) { $data['conditions'] = DisplayConditions::normalize($input['conditions']); }
        if (isset($input['status']) && in_array($input['status'], LibraryRepository::PART_STATUSES, true)) {
            $data['status'] = $input['status'];
        }
        $updated = $this->library->updatePart($id, $data, $adminId);
        $this->events->record('part.update', array(
            'entity_type' => 'part', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Updated part "' . $part['part_key'] . '"',
            'metadata' => array('fields' => array_keys($data)),
        ));
        return $updated;
    }

    public function saveDraft($id, $documentData, $adminId)
    {
        $this->mustFind($id);
        $document = $documentData instanceof Document
            ? $documentData
            : Document::fromArray($documentData, $this->validator, true);
        return $this->library->savePartDraft($id, $document, $adminId);
    }

    public function publish($id, $adminId)
    {
        $part = $this->mustFind($id);
        $document = $this->draft($part);
        if ($document->isEmpty()) {
            throw BuilderException::state('There is nothing to publish in this part yet.');
        }
        $updated = $this->library->publishPart($id, $document, $adminId);
        $this->events->record('part.publish', array(
            'entity_type' => 'part', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Published ' . $part['part_type'] . ' part "' . $part['part_key'] . '"',
            'metadata' => array('conditions' => DisplayConditions::describe($part['conditions'])),
        ));
        return $updated;
    }

    public function disable($id, $adminId)
    {
        $part = $this->mustFind($id);
        $updated = $this->library->updatePart($id, array('status' => 'disabled'), $adminId);
        $this->events->record('part.update', array(
            'entity_type' => 'part', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Disabled part "' . $part['part_key'] . '"; it no longer appears on the site',
        ));
        return $updated;
    }

    public function delete($id, $adminId)
    {
        $part = $this->mustFind($id);
        $this->library->deletePart($id);
        $this->events->record('part.delete', array(
            'entity_type' => 'part', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Deleted part "' . $part['part_key'] . '"',
        ));
        return true;
    }

    public function draft(array $part)
    {
        return Document::fromStorage($part['document_json'], $this->validator);
    }

    public function published(array $part)
    {
        return Document::fromStorage($part['published_json'], $this->validator);
    }

    /**
     * The published part of one type that applies to a page, if any.
     *
     * Lowest priority number wins, so a specific landing-page header can
     * override the site-wide one without disabling it.
     */
    public function resolve($type, array $context)
    {
        foreach ($this->library->publishedParts($type) as $part) {
            if (DisplayConditions::matches($part['conditions'], $context)) { return $part; }
        }
        return null;
    }

    private function mustFind($id)
    {
        $part = $this->library->part($id);
        if (!$part) { throw BuilderException::notFound('That theme part no longer exists.'); }
        return $part;
    }
}
