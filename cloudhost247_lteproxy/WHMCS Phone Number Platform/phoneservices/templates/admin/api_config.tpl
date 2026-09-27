<div class="phoneservices-api-config">
    <div class="row">
        <div class="col-sm-12">
            <h2>API Configuration</h2>
            <p class="lead">Configure provider credentials and service toggles</p>
        </div>
    </div>

    <?php if (isset($_GET['success'])): ?>
    <div class="alert alert-success">Configuration saved successfully.</div>
    <?php endif; ?>

    <form method="post" action="<?php echo $vars['modulelink']; ?>&action=api_config">
        <div class="panel panel-default">
            <div class="panel-heading">General Settings</div>
            <div class="panel-body">
                <div class="form-group">
                    <label>API Mode</label>
                    <select name="api_mode" class="form-control">
                        <option value="sandbox" <?php echo $config->get('api_mode') === 'sandbox' ? 'selected' : ''; ?>>Sandbox</option>
                        <option value="live" <?php echo $config->get('api_mode') === 'live' ? 'selected' : ''; ?>>Live</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Default Provider</label>
                    <select name="default_provider" class="form-control">
                        <?php foreach ($providers as $key => $name): ?>
                        <option value="<?php echo $key; ?>" <?php echo $config->get('default_provider') === $key ? 'selected' : ''; ?>><?php echo $name; ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading">Twilio Credentials</div>
            <div class="panel-body">
                <div class="form-group">
                    <label>Account SID</label>
                    <input type="password" name="twilio_account_sid" class="form-control" value="<?php echo $config->get('twilio_account_sid'); ?>">
                </div>
                <div class="form-group">
                    <label>Auth Token</label>
                    <input type="password" name="twilio_auth_token" class="form-control" value="<?php echo $config->get('twilio_auth_token'); ?>">
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading">Vonage Credentials</div>
            <div class="panel-body">
                <div class="form-group">
                    <label>API Key</label>
                    <input type="password" name="vonage_api_key" class="form-control" value="<?php echo $config->get('vonage_api_key'); ?>">
                </div>
                <div class="form-group">
                    <label>API Secret</label>
                    <input type="password" name="vonage_api_secret" class="form-control" value="<?php echo $config->get('vonage_api_secret'); ?>">
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading">eSIM Providers</div>
            <div class="panel-body">
                <div class="form-group">
                    <label>Airalo API Token</label>
                    <input type="password" name="airalo_api_token" class="form-control" value="<?php echo $config->get('airalo_api_token'); ?>">
                </div>
                <div class="form-group">
                    <label>Truphone API Key</label>
                    <input type="password" name="truphone_api_key" class="form-control" value="<?php echo $config->get('truphone_api_key'); ?>">
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading">Messaging</div>
            <div class="panel-body">
                <div class="form-group">
                    <label>SendGrid API Key</label>
                    <input type="password" name="sendgrid_api_key" class="form-control" value="<?php echo $config->get('sendgrid_api_key'); ?>">
                </div>
                <div class="form-group">
                    <label>WhatsApp Business Token</label>
                    <input type="password" name="whatsapp_business_token" class="form-control" value="<?php echo $config->get('whatsapp_business_token'); ?>">
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading">Feature Toggles</div>
            <div class="panel-body">
                <div class="form-group">
                    <label class="checkbox-inline">
                        <input type="checkbox" name="enable_numbers" value="1" <?php echo $config->get('enable_numbers') === '1' ? 'checked' : ''; ?>> Enable Virtual Numbers
                    </label>
                </div>
                <div class="form-group">
                    <label class="checkbox-inline">
                        <input type="checkbox" name="enable_voip" value="1" <?php echo $config->get('enable_voip') === '1' ? 'checked' : ''; ?>> Enable VoIP
                    </label>
                </div>
                <div class="form-group">
                    <label class="checkbox-inline">
                        <input type="checkbox" name="enable_sms" value="1" <?php echo $config->get('enable_sms') === '1' ? 'checked' : ''; ?>> Enable SMS
                    </label>
                </div>
                <div class="form-group">
                    <label class="checkbox-inline">
                        <input type="checkbox" name="enable_esim" value="1" <?php echo $config->get('enable_esim') === '1' ? 'checked' : ''; ?>> Enable eSIM
                    </label>
                </div>
            </div>
        </div>

        <button type="submit" class="btn btn-primary">Save Configuration</button>
    </form>
</div>
