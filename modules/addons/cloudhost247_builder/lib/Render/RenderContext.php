<?php
namespace CloudHost247\Builder\Render;

use CloudHost247\Builder\Contracts\LiveDataSource;

/**
 * What the renderer is allowed to know.
 *
 * The same Renderer produces the editor canvas, the draft preview and the
 * published page; the only difference is the context. Editor mode adds
 * selection hooks and shows honest "data unavailable" notices; publish mode
 * emits clean markup and silently omits a block whose live data is missing,
 * because a visitor must never see a half-rendered offer.
 */
final class RenderContext
{
    const MODE_EDITOR = 'editor';
    const MODE_PREVIEW = 'preview';
    const MODE_PUBLISH = 'publish';

    private $mode;
    private $data;
    private $options;
    private $notices = array();

    public function __construct($mode, LiveDataSource $data = null, array $options = array())
    {
        $this->mode = in_array($mode, array(self::MODE_EDITOR, self::MODE_PREVIEW, self::MODE_PUBLISH), true)
            ? $mode : self::MODE_PUBLISH;
        $this->data = $data;
        $this->options = $options;
    }

    public static function editor(LiveDataSource $data = null, array $options = array())
    {
        return new self(self::MODE_EDITOR, $data, $options);
    }

    public static function preview(LiveDataSource $data = null, array $options = array())
    {
        return new self(self::MODE_PREVIEW, $data, $options);
    }

    public static function publish(LiveDataSource $data = null, array $options = array())
    {
        return new self(self::MODE_PUBLISH, $data, $options);
    }

    public function mode() { return $this->mode; }

    public function isEditor() { return $this->mode === self::MODE_EDITOR; }

    public function isPreview() { return $this->mode === self::MODE_PREVIEW; }

    public function isPublish() { return $this->mode === self::MODE_PUBLISH; }

    /** @return LiveDataSource|null */
    public function data() { return $this->data; }

    public function option($key, $default = null)
    {
        return array_key_exists($key, $this->options) ? $this->options[$key] : $default;
    }

    /** Resolve a navigation menu by id through the injected resolver. */
    public function menu($id)
    {
        return $this->resolve('menus', $id);
    }

    /** Resolve a builder form definition by id through the injected resolver. */
    public function form($id)
    {
        return $this->resolve('forms', $id);
    }

    /**
     * Single-use token for a public form submission.
     *
     * Public pages are served to anonymous visitors, so the WHMCS admin CSRF
     * token does not apply; the form service issues its own signed token and
     * verifies it on submit.
     */
    public function formToken($formId)
    {
        $issuer = $this->option('form_token');
        if (!is_callable($issuer)) { return ''; }
        $token = $issuer($formId);
        return is_string($token) ? $token : '';
    }

    /** URL the public form posts back to. */
    public function formAction()
    {
        $action = $this->option('form_action', '');
        return is_string($action) ? $action : '';
    }

    /** Record an editor-only notice, e.g. "product no longer exists". */
    public function note($message)
    {
        $message = (string) $message;
        if ($message === '' || in_array($message, $this->notices, true)) { return; }
        $this->notices[] = $message;
    }

    public function notices() { return $this->notices; }

    private function resolve($bucket, $id)
    {
        $resolver = $this->option($bucket);
        if (!is_callable($resolver)) { return null; }
        $resolved = $resolver((int) $id);
        return is_array($resolved) ? $resolved : null;
    }
}
