<?php
namespace CloudHost247\Builder\Services;

use CloudHost247\Builder\Repositories\EventRepository;
use CloudHost247\Builder\Repositories\FormRepository;
use CloudHost247\Builder\Repositories\LibraryRepository;
use CloudHost247\Builder\Support\BuilderException;
use CloudHost247\Builder\Support\HtmlSanitizer;
use CloudHost247\Builder\Support\Ids;
use CloudHost247\Builder\Support\UrlPolicy;

/**
 * Form definitions, submissions and notifications.
 *
 * Public pages are served to anonymous visitors, so a form submission cannot
 * rely on the WHMCS admin CSRF token. Instead each rendered form carries a
 * signed, time-limited token bound to that form, backed by a signing key that
 * is generated once and never displayed. On top of that: a honeypot field, a
 * minimum fill time, and a per-address rate limit.
 *
 * Notification goes through WHMCS itself -- a support ticket or an admin
 * notification email -- so mail transport and SMTP credentials stay where they
 * already are. The builder neither stores nor sends credentials of its own.
 */
class FormService
{
    const FIELD_TYPES = array('text', 'email', 'tel', 'number', 'url', 'date', 'textarea', 'select', 'checkbox');
    const MAX_FIELDS = 30;
    const MAX_VALUE = 5000;
    const TOKEN_TTL = 7200;
    const MIN_FILL_SECONDS = 2;
    const SIGNING_KEY_SETTING = 'form_signing_key';

    private $forms;
    private $events;
    private $settings;
    private $library;
    private $sanitizer;
    private $api;

    /**
     * @param callable|null $api function($action, array $params): array — WHMCS localAPI seam
     */
    public function __construct(
        FormRepository $forms = null,
        EventRepository $events = null,
        Settings $settings = null,
        LibraryRepository $library = null,
        HtmlSanitizer $sanitizer = null,
        $api = null
    ) {
        $this->forms = $forms ? $forms : new FormRepository();
        $this->events = $events ? $events : new EventRepository();
        $this->settings = $settings ? $settings : new Settings();
        $this->library = $library ? $library : new LibraryRepository();
        $this->sanitizer = $sanitizer ? $sanitizer : new HtmlSanitizer();
        $this->api = is_callable($api) ? $api : function ($action, array $params) {
            if (!function_exists('localAPI')) { return array('result' => 'unavailable'); }
            return localAPI($action, $params);
        };
    }

    public function repository() { return $this->forms; }

    /* ----------------------------------------------------------- definition */

    public function save(array $input, $adminId)
    {
        $key = isset($input['form_key']) ? (string) $input['form_key'] : '';
        if (!Ids::isKey($key)) {
            throw BuilderException::validation('A form key may contain lowercase letters, numbers, hyphen and underscore.');
        }
        $fields = $this->validateFields(isset($input['fields']) ? $input['fields'] : array());
        if (!$fields) {
            throw BuilderException::validation('Add at least one field to the form.');
        }
        $settings = $this->validateSettings(isset($input['settings']) ? $input['settings'] : array());
        $id = $this->forms->save(array(
            'form_key' => $key,
            'name' => $this->sanitizer->text(isset($input['name']) ? $input['name'] : $key, 160),
            'enabled' => !isset($input['enabled']) || !empty($input['enabled']),
        ), $fields, $settings, $adminId);

        $this->events->record('form.save', array(
            'entity_type' => 'form', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Saved form "' . $key . '" with ' . count($fields) . ' field(s)',
            'metadata' => array('fields' => array_column($fields, 'name')),
        ));
        return $this->forms->find($id);
    }

    public function delete($id, $adminId)
    {
        $form = $this->forms->find($id);
        if (!$form) { throw BuilderException::notFound('That form no longer exists.'); }
        $this->forms->delete($id);
        $this->events->record('form.delete', array(
            'entity_type' => 'form', 'entity_id' => (string) $id, 'admin_id' => $adminId,
            'summary' => 'Deleted form "' . $form['form_key'] . '" and ' . $form['submission_count'] . ' stored submission(s)',
        ));
        return true;
    }

    public function validateFields($fields)
    {
        if (!is_array($fields)) { return array(); }
        $clean = array();
        $seen = array();
        foreach ($fields as $field) {
            if (count($clean) >= self::MAX_FIELDS) { break; }
            if (!is_array($field)) { continue; }
            $name = strtolower(trim((string) (isset($field['name']) ? $field['name'] : '')));
            $name = preg_replace('/[^a-z0-9_]/', '_', $name);
            if (preg_match('/^[a-z][a-z0-9_]{0,39}$/', (string) $name) !== 1) { continue; }
            if (isset($seen[$name])) { continue; }
            $seen[$name] = true;
            $type = isset($field['type']) && in_array($field['type'], self::FIELD_TYPES, true) ? $field['type'] : 'text';
            $options = array();
            if ($type === 'select') {
                foreach (isset($field['options']) && is_array($field['options']) ? $field['options'] : array() as $option) {
                    $option = $this->sanitizer->text($option, 120);
                    if ($option !== '') { $options[] = $option; }
                    if (count($options) >= 40) { break; }
                }
                if (!$options) { continue; }
            }
            $clean[] = array(
                'name' => $name,
                'label' => $this->sanitizer->text(isset($field['label']) ? $field['label'] : $name, 120),
                'type' => $type,
                'required' => !empty($field['required']),
                'placeholder' => $this->sanitizer->text(isset($field['placeholder']) ? $field['placeholder'] : '', 120),
                'help' => $this->sanitizer->text(isset($field['help']) ? $field['help'] : '', 200),
                'options' => $options,
            );
        }
        return $clean;
    }

    public function validateSettings($settings)
    {
        if (!is_array($settings)) { $settings = array(); }
        $redirect = isset($settings['redirect_url']) ? UrlPolicy::link($settings['redirect_url']) : '';
        if ($redirect === null) {
            throw BuilderException::validation('The confirmation redirect URL is not acceptable.');
        }
        $email = isset($settings['notify_email']) ? trim((string) $settings['notify_email']) : '';
        if ($email !== '' && !filter_var($email, FILTER_VALIDATE_EMAIL)) {
            throw BuilderException::validation('The notification email address is not valid.');
        }
        return array(
            'success_message' => $this->sanitizer->text(
                isset($settings['success_message']) ? $settings['success_message'] : 'Thank you. Your message has been received.', 300),
            'redirect_url' => (string) $redirect,
            'notify_email' => $email,
            'create_ticket' => !empty($settings['create_ticket']),
            'ticket_department' => isset($settings['ticket_department']) ? (int) $settings['ticket_department'] : 0,
            'ticket_subject' => $this->sanitizer->text(
                isset($settings['ticket_subject']) ? $settings['ticket_subject'] : 'Website enquiry', 150),
            'link_client' => !isset($settings['link_client']) || !empty($settings['link_client']),
        );
    }

    /** Definition handed to the renderer: enabled forms only, fields only. */
    public function publicDefinition($id)
    {
        $form = $this->forms->find($id);
        if (!$form || !$form['enabled']) { return null; }
        return array('id' => $form['id'], 'name' => $form['name'], 'fields' => $form['fields']);
    }

    /* ---------------------------------------------------------------- tokens */

    public function issueToken($formId)
    {
        $formId = (int) $formId;
        $issued = time();
        return $issued . '.' . hash_hmac('sha256', $formId . '|' . $issued, $this->signingKey());
    }

    public function verifyToken($formId, $token)
    {
        if (!is_string($token) || strpos($token, '.') === false) { return false; }
        list($issued, $signature) = explode('.', $token, 2);
        if (preg_match('/^\d{9,12}$/', $issued) !== 1) { return false; }
        $age = time() - (int) $issued;
        if ($age < 0 || $age > self::TOKEN_TTL) { return false; }
        $expected = hash_hmac('sha256', ((int) $formId) . '|' . (int) $issued, $this->signingKey());
        return hash_equals($expected, (string) $signature);
    }

    /**
     * Signing key for public form tokens.
     *
     * Generated on first use and stored in the builder settings table. It is
     * not an API credential and is never rendered anywhere in the UI; it exists
     * only so an anonymous submission can be proved to come from a form this
     * installation rendered.
     */
    private function signingKey()
    {
        $key = $this->library->setting(self::SIGNING_KEY_SETTING, '');
        if ($key === '') {
            $key = bin2hex(random_bytes(32));
            $this->library->saveSetting(self::SIGNING_KEY_SETTING, $key, 0);
        }
        return $key;
    }

    /* ------------------------------------------------------------ submission */

    /**
     * Handle one public submission.
     *
     * @return array array('status', 'message', 'redirect', 'submission_id')
     */
    public function submit(array $request, array $context = array())
    {
        $formId = isset($request['ch247_form_id']) ? (int) $request['ch247_form_id'] : 0;
        $form = $this->forms->find($formId);
        if (!$form || !$form['enabled']) {
            throw BuilderException::notFound('That form is no longer available.');
        }
        if (!empty($request['ch247_hp'])) {
            // Honeypot: a real browser leaves this empty. Accept quietly and drop.
            return array('status' => 'ignored', 'message' => $form['settings']['success_message'], 'redirect' => '', 'submission_id' => 0);
        }
        if (!$this->verifyToken($formId, isset($request['ch247_form_token']) ? $request['ch247_form_token'] : '')) {
            throw BuilderException::validation('This form has expired. Reload the page and try again.');
        }
        $started = isset($request['ch247_form_ts']) ? (int) $request['ch247_form_ts'] : 0;
        if ($started > 0 && time() - $started < self::MIN_FILL_SECONDS) {
            throw BuilderException::rateLimit('That was submitted too quickly. Please try again.');
        }
        $ipHash = EventRepository::ipHash();
        $limit = max(1, $this->settings->integer('form_rate_limit'));
        if ($ipHash !== '' && $this->forms->recentSubmissionCount($ipHash, 300) >= $limit) {
            throw BuilderException::rateLimit('Too many submissions from this connection. Please wait a few minutes.');
        }

        $values = array();
        $errors = array();
        foreach ($form['fields'] as $field) {
            $value = isset($request[$field['name']]) ? $request[$field['name']] : null;
            $clean = $this->validateValue($field, $value, $errors);
            if ($clean !== null) { $values[$field['name']] = $clean; }
        }
        if ($errors) {
            throw BuilderException::validation(implode(' ', array_slice($errors, 0, 3)), $errors);
        }

        $clientId = 0;
        if (!empty($form['settings']['link_client'])) {
            $clientId = $this->findClient($values);
        }

        $submissionId = $this->forms->addSubmission(array(
            'form_id' => $form['id'],
            'page_id' => isset($context['page_id']) ? (int) $context['page_id'] : 0,
            'payload_json' => json_encode($values),
            'client_id' => $clientId,
            'ticket_id' => 0,
            'status' => 'received',
            'notify_result' => '',
            'ip_hash' => $ipHash,
            'user_agent' => substr((string) (isset($_SERVER['HTTP_USER_AGENT']) ? $_SERVER['HTTP_USER_AGENT'] : ''), 0, 200),
        ));

        $notification = $this->notify($form, $values, $clientId);
        $this->forms->updateSubmission($submissionId, array(
            'ticket_id' => (int) $notification['ticket_id'],
            'notify_result' => substr($notification['result'], 0, 120),
            'status' => $notification['ticket_id'] > 0 ? 'ticketed' : 'received',
        ));

        $this->events->record('form.submission', array(
            'entity_type' => 'form', 'entity_id' => (string) $form['id'],
            'summary' => 'Submission received for "' . $form['name'] . '" (' . $notification['result'] . ')',
            'metadata' => array('submission_id' => $submissionId, 'fields' => array_keys($values), 'client_id' => $clientId),
        ));

        return array(
            'status' => 'received',
            'message' => $form['settings']['success_message'],
            'redirect' => $form['settings']['redirect_url'],
            'submission_id' => $submissionId,
            'notification' => $notification['result'],
        );
    }

    private function validateValue(array $field, $value, array &$errors)
    {
        $required = !empty($field['required']);
        if ($field['type'] === 'checkbox') {
            $checked = !empty($value);
            if ($required && !$checked) { $errors[] = $field['label'] . ' is required.'; return null; }
            return $checked ? '1' : '0';
        }
        if (is_array($value) || is_object($value)) { $errors[] = $field['label'] . ' is not valid.'; return null; }
        $value = trim((string) $value);
        if ($value === '') {
            if ($required) { $errors[] = $field['label'] . ' is required.'; return null; }
            return '';
        }
        if (strlen($value) > self::MAX_VALUE) { $value = substr($value, 0, self::MAX_VALUE); }

        switch ($field['type']) {
            case 'email':
                if (!filter_var($value, FILTER_VALIDATE_EMAIL)) { $errors[] = $field['label'] . ' must be a valid email address.'; return null; }
                return $value;
            case 'number':
                if (!is_numeric($value)) { $errors[] = $field['label'] . ' must be a number.'; return null; }
                return (string) (0 + $value);
            case 'url':
                $url = UrlPolicy::link($value);
                if ($url === null || $url === '') { $errors[] = $field['label'] . ' must be a valid URL.'; return null; }
                return $url;
            case 'date':
                if (!strtotime($value)) { $errors[] = $field['label'] . ' must be a valid date.'; return null; }
                return date('Y-m-d', (int) strtotime($value));
            case 'tel':
                if (preg_match('/^[0-9 +().-]{5,32}$/', $value) !== 1) { $errors[] = $field['label'] . ' must be a valid phone number.'; return null; }
                return $value;
            case 'select':
                if (!in_array($value, $field['options'], true)) { $errors[] = $field['label'] . ' is not one of the available choices.'; return null; }
                return $value;
            case 'textarea':
                return $this->sanitizer->text($value, self::MAX_VALUE, true);
            default:
                return $this->sanitizer->text($value, 500);
        }
    }

    /** Link the submission to an existing WHMCS client when the email matches. */
    private function findClient(array $values)
    {
        $email = '';
        foreach ($values as $value) {
            if (is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL)) { $email = $value; break; }
        }
        if ($email === '' || !class_exists('WHMCS\\Database\\Capsule')) { return 0; }
        try {
            $row = \WHMCS\Database\Capsule::table('tblclients')->where('email', $email)->first();
        } catch (\Throwable $unavailable) {
            return 0;
        }
        return $row ? (int) $row->id : 0;
    }

    /**
     * Notify through WHMCS.
     *
     * Either action can fail without losing the submission: the row is already
     * stored, and the outcome string records exactly what happened.
     */
    private function notify(array $form, array $values, $clientId)
    {
        $settings = $form['settings'];
        $lines = array();
        foreach ($form['fields'] as $field) {
            $name = $field['name'];
            if (!array_key_exists($name, $values)) { continue; }
            $lines[] = $field['label'] . ': ' . $values[$name];
        }
        $body = implode("\n", $lines);
        $results = array();
        $ticketId = 0;

        if (!empty($settings['create_ticket']) && (int) $settings['ticket_department'] > 0) {
            $email = '';
            $name = '';
            foreach ($values as $key => $value) {
                if ($email === '' && is_string($value) && filter_var($value, FILTER_VALIDATE_EMAIL)) { $email = $value; }
                if ($name === '' && strpos($key, 'name') !== false && is_string($value)) { $name = $value; }
            }
            $params = array(
                'deptid' => (int) $settings['ticket_department'],
                'subject' => $settings['ticket_subject'],
                'message' => $body,
                'priority' => 'Medium',
                'markdown' => false,
            );
            if ($clientId > 0) {
                $params['clientid'] = $clientId;
            } else {
                $params['name'] = $name !== '' ? $name : 'Website visitor';
                $params['email'] = $email !== '' ? $email : '';
            }
            if ($clientId > 0 || $params['email'] !== '') {
                $response = $this->call('OpenTicket', $params);
                if (isset($response['result']) && $response['result'] === 'success' && !empty($response['id'])) {
                    $ticketId = (int) $response['id'];
                    $results[] = 'ticket #' . $ticketId;
                } else {
                    $results[] = 'ticket not created';
                }
            } else {
                $results[] = 'ticket skipped: no contact address in the submission';
            }
        }

        if ($settings['notify_email'] !== '') {
            $response = $this->call('SendAdminEmail', array(
                'customsubject' => 'Website form: ' . $form['name'],
                'custommessage' => nl2br(htmlspecialchars($body, ENT_QUOTES, 'UTF-8')),
                'type' => 'system',
            ));
            $results[] = isset($response['result']) && $response['result'] === 'success'
                ? 'admin email sent' : 'admin email not sent';
        }

        if (!$results) { $results[] = 'stored only'; }
        return array('result' => implode(', ', $results), 'ticket_id' => $ticketId);
    }

    private function call($action, array $params)
    {
        try {
            $response = call_user_func($this->api, $action, $params);
        } catch (\Throwable $failure) {
            return array('result' => 'error');
        }
        return is_array($response) ? $response : array('result' => 'error');
    }
}
