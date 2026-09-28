<?php
namespace CloudHost247\Builder\Schema;

use CloudHost247\Builder\Support\BuilderException;

/**
 * Versioned page schemas.
 *
 * Stored documents carry their schema name and version. Anything older is
 * upgraded in memory before validation, so a page authored against an earlier
 * release keeps rendering after an upgrade; anything newer than this release
 * understands is refused rather than rendered incorrectly.
 */
final class DocumentMigrator
{
    /** Shapes accepted as input, oldest first. */
    const KNOWN_SCHEMAS = array('cloudhost247-page/v1');

    public static function upgrade($data, array &$errors = array())
    {
        if (!is_array($data)) {
            throw BuilderException::schema('The page document must be an object.');
        }

        // A bare list of sections: the shape the editor posts before a document
        // has ever been saved.
        if (!isset($data['children']) && !isset($data['schema']) && self::isNodeList($data)) {
            $data = array('children' => array_values($data));
        }

        $schema = isset($data['schema']) && is_string($data['schema']) ? $data['schema'] : Document::SCHEMA;
        if (!in_array($schema, self::KNOWN_SCHEMAS, true)) {
            throw BuilderException::schema('Unsupported page schema "' . preg_replace('/[^\x20-\x7E]/', '', $schema) . '".');
        }

        $version = isset($data['version']) ? (int) $data['version'] : Document::VERSION;
        if ($version > Document::VERSION) {
            throw BuilderException::schema(
                'This page was created by a newer version of the Website Builder (schema v' . $version
                . '; this installation understands v' . Document::VERSION . '). Update the module before editing it.'
            );
        }
        if ($version < 1) {
            $errors[] = 'document: schema version ' . $version . ' upgraded to v' . Document::VERSION . '.';
            $version = Document::VERSION;
        }

        $data['schema'] = Document::SCHEMA;
        $data['version'] = Document::VERSION;
        if (!isset($data['children']) || !is_array($data['children'])) { $data['children'] = array(); }
        if (!isset($data['meta']) || !is_array($data['meta'])) { $data['meta'] = array(); }
        return $data;
    }

    private static function isNodeList(array $data)
    {
        if (!$data) { return true; }
        foreach ($data as $key => $value) {
            if (!is_int($key) || !is_array($value) || !isset($value['type'])) { return false; }
        }
        return true;
    }
}
