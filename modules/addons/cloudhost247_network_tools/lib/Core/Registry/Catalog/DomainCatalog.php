<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Domain tools (docs sections 38, 39).
 */
final class DomainCatalog
{
    public static function definitions()
    {
        return array(
            'domain/punycode' => array(
                'name' => 'Punycode Converter',
                'category' => 'domain',
                'icon' => 'language',
                'summary' => 'Convert internationalised domain names between Unicode and Punycode.',
                'description' => 'Converts a Unicode domain (or a single label) to its ASCII/Punycode form and back, using the intl extension when it is present and the module\'s own tested RFC 3492 implementation otherwise.',
                'explanation' => 'Punycode is what the DNS actually carries for names containing non-ASCII characters. Homograph attacks abuse exactly this: visually similar characters produce different ASCII names, so check the converted form before you trust a link.',
                'fields' => array(
                    array('name' => 'value', 'type' => 'text', 'label' => 'Domain or label', 'required' => true, 'placeholder' => 'münchen.de or xn--mnchen-3ya.de', 'target' => true, 'maxlength' => 255),
                    array('name' => 'direction', 'type' => 'select', 'label' => 'Direction', 'required' => false, 'default' => 'to_ascii', 'options' => array('to_ascii' => 'Unicode → Punycode', 'to_unicode' => 'Punycode → Unicode', 'auto' => 'Detect automatically')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Domain\\PunycodeService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv'),
                'result_view' => 'details',
            ),
            'domain/search' => array(
                'name' => 'Domain Availability',
                'category' => 'domain',
                'icon' => 'check-circle',
                'summary' => 'Check whether a domain can be registered, through the configured registrar.',
                'description' => 'Uses CloudHost247\'s configured domain registrar integration for the lookup and reports available, registered, premium, unsupported or unknown, with the price when the registrar returns one.',
                'explanation' => 'Availability comes from the registrar\'s own response at the moment of the query and can change before registration completes. When no registrar is configured the tool says CONFIGURATION_REQUIRED and never guesses.',
                'fields' => array(
                    array('name' => 'domain', 'type' => 'domain', 'label' => 'Domain', 'required' => true, 'placeholder' => 'example.com', 'target' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Domain\\AvailabilityService',
                'requires_provider' => true,
                'providers' => array('godaddy', 'sedo'),
                'target_field' => 'domain',
                'cache_seconds' => 300,
                'exports' => array('json', 'csv', 'pdf'),
                'result_view' => 'availability',
            ),
        );
    }
}
