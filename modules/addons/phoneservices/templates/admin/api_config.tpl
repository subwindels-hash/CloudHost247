<?php
/**
 * Admin > API Configuration
 *
 * Rendered by \PhoneServices\Core\Module::renderApiConfig().
 *
 * @var array  $vars            WHMCS addon vars (modulelink, version, ...)
 * @var array  $notice          ['type' => 'success|danger', 'message' => string]|null
 * @var string $apiMode         sandbox|live
 * @var array  $providers       [providerId => label]
 * @var array  $providerFields  [providerId => [['name','label','value','required','is_set'], ...]]
 * @var array  $routing         [capability => ['selected' => id, 'candidates' => [id => label]]]
 * @var array  $toggles         [service => bool]
 * @var string $defaultProvider
 * @var string $webhookBase
 * @var string $allowedOrigins
 * @var int    $apiRateLimit
 * @var bool   $debugLogging
 * @var string $csrf            hidden input markup
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
?>
<div class="phoneservices-admin phoneservices-api-config">

    <div class="ps-page-head">
        <h2>API Configuration</h2>
        <p class="ps-muted">
            Credentials are encrypted at rest and never displayed in full. Leave a field blank
            (or untouched) to keep the stored value.
        </p>
    </div>

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo htmlspecialchars((string) $notice['type'], ENT_QUOTES, 'UTF-8'); ?>">
            <?php echo htmlspecialchars((string) $notice['message'], ENT_QUOTES, 'UTF-8'); ?>
        </div>
    <?php endif; ?>

    <form method="post" action="<?php echo $moduleLink; ?>&amp;action=api_config" autocomplete="off">
        <?php echo $csrf; ?>

        <!-- ------------------------------------------------ General -->
        <div class="panel panel-default">
            <div class="panel-heading"><strong>General</strong></div>
            <div class="panel-body">
                <div class="row">
                    <div class="col-sm-4">
                        <div class="form-group">
                            <label for="ps-api-mode">Operating mode</label>
                            <select id="ps-api-mode" name="api_mode" class="form-control">
                                <option value="sandbox" <?php echo $apiMode === 'sandbox' ? 'selected' : ''; ?>>Sandbox (test credentials)</option>
                                <option value="live" <?php echo $apiMode === 'live' ? 'selected' : ''; ?>>Live (billable traffic)</option>
                            </select>
                            <span class="help-block">Sandbox exposes verbose API errors and disables live charging.</span>
                        </div>
                    </div>
                    <div class="col-sm-4">
                        <div class="form-group">
                            <label for="ps-default-provider">Fallback provider</label>
                            <select id="ps-default-provider" name="default_provider" class="form-control">
                                <?php foreach ($providers as $key => $name) : ?>
                                    <option value="<?php echo htmlspecialchars((string) $key, ENT_QUOTES, 'UTF-8'); ?>"
                                        <?php echo $defaultProvider === $key ? 'selected' : ''; ?>>
                                        <?php echo htmlspecialchars((string) $name, ENT_QUOTES, 'UTF-8'); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                            <span class="help-block">Used when a capability has no explicit routing below.</span>
                        </div>
                    </div>
                    <div class="col-sm-4">
                        <div class="form-group">
                            <label for="ps-webhook-base">Webhook base URL</label>
                            <input type="url" id="ps-webhook-base" name="webhook_base_url" class="form-control"
                                   value="<?php echo htmlspecialchars((string) $webhookBase, ENT_QUOTES, 'UTF-8'); ?>">
                            <span class="help-block">Providers post callbacks to <code>&lt;base&gt;/&lt;provider&gt;.php</code>.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- --------------------------------------- Capability routing -->
        <div class="panel panel-default">
            <div class="panel-heading"><strong>Provider routing</strong> &mdash; switch providers without touching code</div>
            <div class="panel-body">
                <div class="row">
                    <?php foreach ($routing as $capability => $route) : ?>
                        <div class="col-sm-3">
                            <div class="form-group">
                                <label for="ps-route-<?php echo htmlspecialchars((string) $capability, ENT_QUOTES, 'UTF-8'); ?>">
                                    <?php echo htmlspecialchars(ucfirst((string) $capability), ENT_QUOTES, 'UTF-8'); ?>
                                </label>
                                <select id="ps-route-<?php echo htmlspecialchars((string) $capability, ENT_QUOTES, 'UTF-8'); ?>"
                                        name="provider_<?php echo htmlspecialchars((string) $capability, ENT_QUOTES, 'UTF-8'); ?>"
                                        class="form-control">
                                    <?php foreach ($route['candidates'] as $id => $label) : ?>
                                        <option value="<?php echo htmlspecialchars((string) $id, ENT_QUOTES, 'UTF-8'); ?>"
                                            <?php echo $route['selected'] === $id ? 'selected' : ''; ?>>
                                            <?php echo htmlspecialchars((string) $label, ENT_QUOTES, 'UTF-8'); ?>
                                        </option>
                                    <?php endforeach; ?>
                                </select>
                            </div>
                        </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>

        <!-- ------------------------------------------- Feature toggles -->
        <div class="panel panel-default">
            <div class="panel-heading"><strong>Services</strong></div>
            <div class="panel-body">
                <?php foreach ($toggles as $service => $enabled) : ?>
                    <label class="checkbox-inline ps-toggle">
                        <input type="checkbox" name="enable_<?php echo htmlspecialchars((string) $service, ENT_QUOTES, 'UTF-8'); ?>"
                               value="1" <?php echo $enabled ? 'checked' : ''; ?>>
                        <?php echo htmlspecialchars(ucfirst((string) $service), ENT_QUOTES, 'UTF-8'); ?>
                    </label>
                <?php endforeach; ?>
                <p class="help-block">Disabled services are hidden from the client area and rejected by the REST API.</p>
            </div>
        </div>

        <!-- --------------------------------------- Provider credentials -->
        <?php foreach ($providerFields as $providerId => $fields) : ?>
            <div class="panel panel-default">
                <div class="panel-heading">
                    <strong><?php echo htmlspecialchars((string) ($providers[$providerId] ?? $providerId), ENT_QUOTES, 'UTF-8'); ?></strong>
                    credentials
                </div>
                <div class="panel-body">
                    <div class="row">
                        <?php foreach ($fields as $field) : ?>
                            <div class="col-sm-6">
                                <div class="form-group">
                                    <label for="ps-<?php echo htmlspecialchars((string) $field['name'], ENT_QUOTES, 'UTF-8'); ?>">
                                        <?php echo htmlspecialchars((string) $field['label'], ENT_QUOTES, 'UTF-8'); ?>
                                        <?php if (!empty($field['required'])) : ?>
                                            <span class="text-danger" title="Required">*</span>
                                        <?php endif; ?>
                                        <?php if (!empty($field['is_set'])) : ?>
                                            <span class="label label-success">set</span>
                                        <?php else : ?>
                                            <span class="label label-default">empty</span>
                                        <?php endif; ?>
                                    </label>
                                    <input type="text"
                                           id="ps-<?php echo htmlspecialchars((string) $field['name'], ENT_QUOTES, 'UTF-8'); ?>"
                                           name="<?php echo htmlspecialchars((string) $field['name'], ENT_QUOTES, 'UTF-8'); ?>"
                                           class="form-control"
                                           autocomplete="off"
                                           spellcheck="false"
                                           placeholder="<?php echo htmlspecialchars((string) $field['value'], ENT_QUOTES, 'UTF-8'); ?>">
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    <p class="help-block">
                        Webhook endpoint:
                        <code><?php echo htmlspecialchars(rtrim((string) $webhookBase, '/') . '/' . $providerId . '.php', ENT_QUOTES, 'UTF-8'); ?></code>
                    </p>
                </div>
            </div>
        <?php endforeach; ?>

        <!-- ------------------------------------------------ REST API -->
        <div class="panel panel-default">
            <div class="panel-heading"><strong>REST API &amp; diagnostics</strong></div>
            <div class="panel-body">
                <div class="row">
                    <div class="col-sm-6">
                        <div class="form-group">
                            <label for="ps-origins">Allowed CORS origins</label>
                            <input type="text" id="ps-origins" name="api_allowed_origins" class="form-control"
                                   value="<?php echo htmlspecialchars((string) $allowedOrigins, ENT_QUOTES, 'UTF-8'); ?>"
                                   placeholder="https://app.example.com, https://portal.example.com">
                            <span class="help-block">
                                Comma separated absolute origins. Leave empty for same-origin only &mdash;
                                no <code>Access-Control-Allow-Origin</code> header is sent.
                            </span>
                        </div>
                    </div>
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ps-rate-limit">Rate limit (req/min per key)</label>
                            <input type="number" id="ps-rate-limit" name="api_rate_limit" class="form-control"
                                   min="0" max="10000" value="<?php echo (int) $apiRateLimit; ?>">
                            <span class="help-block">0 disables throttling.</span>
                        </div>
                    </div>
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label>Debugging</label>
                            <div class="checkbox">
                                <label>
                                    <input type="checkbox" name="debug_logging" value="1" <?php echo $debugLogging ? 'checked' : ''; ?>>
                                    Verbose request logging
                                </label>
                            </div>
                            <span class="help-block">Logs redacted request/response payloads.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="ps-form-actions">
            <button type="submit" class="btn btn-primary">Save configuration</button>
            <a href="<?php echo $moduleLink; ?>&amp;action=providers" class="btn btn-default">Test connectivity &rarr;</a>
        </div>
    </form>
</div>
