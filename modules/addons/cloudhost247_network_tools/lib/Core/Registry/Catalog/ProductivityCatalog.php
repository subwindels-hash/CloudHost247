<?php
namespace CloudHost247\NetworkTools\Core\Registry\Catalog;

/**
 * Productivity tools (docs sections 45, 46, 47, 53, 54, 55).
 *
 * Most of these run entirely in the browser: the server never receives the
 * text, the image, the WiFi password or the colour values, which is both the
 * privacy-preserving and the cheapest design. The registry still describes them
 * so they appear in the dashboard, search, favourites and history.
 */
final class ProductivityCatalog
{
    public static function definitions()
    {
        return array(
            'productivity/text' => array(
                'name' => 'Word & Character Counter',
                'category' => 'productivity',
                'icon' => 'type',
                'summary' => 'Count words, characters, sentences and paragraphs as you type.',
                'description' => 'Live counters for words, characters with and without spaces, sentences and paragraphs, plus estimated reading time and case conversions.',
                'explanation' => 'Counting happens in your browser. The text is never sent to the server, so nothing is stored or logged.',
                'fields' => array(
                    array('name' => 'text', 'type' => 'textarea', 'label' => 'Text', 'required' => false, 'rows' => 10, 'maxlength' => 200000, 'help' => 'Optional: counting is performed in the browser as you type.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'method' => 'count',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'client_only' => true,
                'exports' => array('json', 'txt'),
                'result_view' => 'text',
            ),
            'productivity/lorem-ipsum' => array(
                'name' => 'Lorem Ipsum Generator',
                'category' => 'productivity',
                'icon' => 'paragraph',
                'summary' => 'Generate placeholder paragraphs, sentences or words.',
                'description' => 'Produces classical Lorem Ipsum placeholder text in the quantity and unit you choose.',
                'explanation' => 'The text is generated locally and is not a translation of anything; it is intended only as layout filler.',
                'fields' => array(
                    array('name' => 'unit', 'type' => 'select', 'label' => 'Unit', 'required' => true, 'default' => 'paragraphs', 'options' => array('paragraphs' => 'Paragraphs', 'sentences' => 'Sentences', 'words' => 'Words')),
                    array('name' => 'count', 'type' => 'number', 'label' => 'How many', 'required' => false, 'default' => 3, 'min' => 1, 'max' => 50),
                    array('name' => 'start_classic', 'type' => 'checkbox', 'label' => 'Start with "Lorem ipsum dolor sit amet"', 'default' => true),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'lorem',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'code',
            ),
            'productivity/notepad' => array(
                'name' => 'Online Notepad',
                'category' => 'productivity',
                'icon' => 'clipboard',
                'summary' => 'A scratchpad that stays in your browser.',
                'description' => 'A simple editor with word count, optional browser-local autosave and download/copy actions.',
                'explanation' => 'Notes are kept in this browser\'s local storage only. They are never transmitted to CloudHost247, so they are not backed up, not synced and not recoverable on another device.',
                'fields' => array(
                    array('name' => 'text', 'type' => 'textarea', 'label' => 'Notes', 'required' => false, 'rows' => 12, 'maxlength' => 200000),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'method' => 'notepad',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'client_only' => true,
                'exports' => array('txt'),
                'result_view' => 'text',
            ),
            'productivity/small-text' => array(
                'name' => 'Small Text Generator',
                'category' => 'productivity',
                'icon' => 'font',
                'summary' => 'Convert text into small, superscript, subscript and other Unicode styles.',
                'description' => 'Maps Latin text to Unicode look-alike characters for small caps, superscript, subscript and enclosed styles, reporting any character that has no mapping.',
                'explanation' => 'These are Unicode characters that merely look smaller; screen readers may read them letter by letter, and they are not suitable for meaningful content.',
                'fields' => array(
                    array('name' => 'text', 'type' => 'text', 'label' => 'Text', 'required' => true, 'maxlength' => 500),
                    array('name' => 'style', 'type' => 'select', 'label' => 'Style', 'required' => false, 'default' => 'small_caps', 'options' => array('small_caps' => 'Small caps', 'superscript' => 'Superscript', 'subscript' => 'Subscript', 'fullwidth' => 'Full width')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'smallText',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'code',
            ),
            'productivity/invisible-characters' => array(
                'name' => 'Invisible Character Generator',
                'category' => 'productivity',
                'icon' => 'eye-off',
                'summary' => 'Produce invisible Unicode characters for spacing and form tests.',
                'description' => 'Generates a chosen number of invisible or blank characters and shows exactly which code points were produced.',
                'explanation' => 'The characters are real code points, not spaces; the tool always states which ones it used so the result can be audited.',
                'fields' => array(
                    array('name' => 'count', 'type' => 'number', 'label' => 'How many characters', 'required' => false, 'default' => 10, 'min' => 1, 'max' => 500),
                    array('name' => 'kind', 'type' => 'select', 'label' => 'Character', 'required' => false, 'default' => 'braille', 'options' => array('braille' => 'Braille blank (U+2800)', 'hangul' => 'Hangul filler (U+3164)', 'space' => 'No-break space (U+00A0)')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'invisible',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json'),
                'result_view' => 'code',
            ),
            'productivity/runic' => array(
                'name' => 'Runic Translator',
                'category' => 'productivity',
                'icon' => 'feather',
                'summary' => 'Transliterate Latin text into runic Unicode characters.',
                'description' => 'Maps Latin letters to Elder Futhark Unicode characters, reports unmappable characters and can reverse the mapping.',
                'explanation' => 'This is a character substitution for decoration, not a translation into a historical language, and the mapping is shown so it can be checked.',
                'fields' => array(
                    array('name' => 'text', 'type' => 'textarea', 'label' => 'Text', 'required' => true, 'rows' => 4, 'maxlength' => 2000),
                    array('name' => 'direction', 'type' => 'select', 'label' => 'Direction', 'required' => false, 'default' => 'to_runic', 'options' => array('to_runic' => 'Latin → Runic', 'to_latin' => 'Runic → Latin')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TextService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'method' => 'runic',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'code',
            ),
            'productivity/qr-generator' => array(
                'name' => 'QR Code Generator',
                'category' => 'productivity',
                'icon' => 'qrcode',
                'summary' => 'Create QR codes for links, text, email, phone, WiFi and vCards.',
                'description' => 'Builds the QR payload for the type you choose and renders the code in your browser as SVG or PNG. Payload construction follows the documented formats for each type.',
                'explanation' => 'The QR code is rendered client-side: the payload never leaves your browser. The encoder verifies each generated symbol by decoding it again before it is rendered, so a code that cannot be read back is reported instead of displayed.',
                'fields' => array(
                    array('name' => 'kind', 'type' => 'select', 'label' => 'Type', 'required' => true, 'default' => 'url', 'options' => array('url' => 'URL', 'text' => 'Text', 'email' => 'Email', 'phone' => 'Phone', 'sms' => 'SMS', 'wifi' => 'WiFi', 'vcard' => 'Contact (vCard)')),
                    array('name' => 'payload', 'type' => 'textarea', 'label' => 'Content', 'required' => true, 'rows' => 3, 'maxlength' => 2000, 'help' => 'For WiFi use SSID;password;encryption on separate lines. For vCard use NAME;ORG;TITLE;PHONE;EMAIL.'),
                    array('name' => 'error_correction', 'type' => 'select', 'label' => 'Error correction', 'required' => false, 'default' => 'M', 'options' => array('L' => 'Low (7%)', 'M' => 'Medium (15%)', 'Q' => 'Quartile (25%)', 'H' => 'High (30%)')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\QrService',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'client_only' => true,
                'exports' => array('json', 'png', 'svg'),
                'result_view' => 'qr',
            ),
            'productivity/qr-scanner' => array(
                'name' => 'QR Code Scanner',
                'category' => 'productivity',
                'icon' => 'camera',
                'summary' => 'Read a QR code from your camera or an image, in your browser.',
                'description' => 'Uses the browser\'s native BarcodeDetector interface when available and reports which payload it decoded, with a clear message when the browser does not support scanning.',
                'explanation' => 'Camera frames and uploaded images are processed by the browser and are never uploaded. A scanned code is displayed but not stored unless you choose to save it.',
                'fields' => array(
                    array('name' => 'store', 'type' => 'checkbox', 'label' => 'Include the decoded value in my history', 'default' => false, 'help' => 'Off by default: scanned values are usually sensitive.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\QrService',
                'method' => 'scanner',
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'client_only' => true,
                'exports' => array('json'),
                'result_view' => 'qr',
            ),
            'productivity/color' => array(
                'name' => 'Colour Converter',
                'category' => 'productivity',
                'icon' => 'droplet',
                'summary' => 'Convert between HEX, RGB, HSL, HSV and CMYK with a live preview.',
                'description' => 'Converts a colour between the common models, shows the values, the contrast ratio against white and black, and a preview swatch.',
                'explanation' => 'RGB/HEX/HSL/HSV conversions are exact within the displayed precision. CMYK is a printing model, so its conversion is an approximation: a real press profile will differ.',
                'fields' => array(
                    array('name' => 'value', 'type' => 'text', 'label' => 'Colour', 'required' => true, 'placeholder' => '#0B5FFF, rgb(11,95,255), hsl(219,100%,52%)', 'maxlength' => 64),
                    array('name' => 'output', 'type' => 'select', 'label' => 'Show as', 'required' => false, 'default' => 'all', 'options' => array('all' => 'All models', 'hex' => 'HEX', 'rgb' => 'RGB', 'hsl' => 'HSL', 'hsv' => 'HSV', 'cmyk' => 'CMYK')),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\ColorService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'txt'),
                'result_view' => 'color',
            ),
            'productivity/time-card' => array(
                'name' => 'Time Card Calculator',
                'category' => 'productivity',
                'icon' => 'clock',
                'summary' => 'Work out hours worked, breaks and overtime from clock-in and clock-out times.',
                'description' => 'Accepts one or more shifts with break minutes, adds them up and computes regular versus overtime hours against the threshold you set.',
                'explanation' => 'Arithmetic is local and shown step by step so the totals can be checked. Overtime rules vary by jurisdiction and are not implied by this tool.',
                'fields' => array(
                    array('name' => 'shifts', 'type' => 'textarea', 'label' => 'Shifts', 'required' => true, 'rows' => 6, 'maxlength' => 4000, 'default' => "09:00-17:00,30\n09:00-17:30,45", 'help' => 'One line per shift: clock-in-clock-out,break-in-minutes. Overnight shifts are supported (22:00-06:00).'),
                    array('name' => 'overtime_after', 'type' => 'number', 'label' => 'Overtime after (hours per day)', 'required' => false, 'default' => 8, 'min' => 1, 'max' => 24),
                    array('name' => 'rate', 'type' => 'text', 'label' => 'Hourly rate (optional)', 'required' => false, 'maxlength' => 16, 'help' => 'Used only to show a pay estimate; stored nowhere.'),
                ),
                'handler' => 'CloudHost247\\NetworkTools\\Services\\Productivity\\TimeCardService',
                'target_field' => '',  // offline calculator: there is no remote target to label.
                'rate_tier' => 'local',
                'cache_seconds' => 0,
                'exports' => array('json', 'csv', 'txt'),
                'result_view' => 'timecard',
            ),
        );
    }
}
