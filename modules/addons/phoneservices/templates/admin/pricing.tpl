<?php
/**
 * Admin > Pricing control
 *
 * @var array  $vars
 * @var array  $notice  ['type','message']|null
 * @var array  $pricing rate-card rows
 * @var string $csrf
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
};
$serviceTypes = ['voice', 'sms', 'whatsapp', 'email', 'number', 'esim', 'data'];

// One always-empty row so a new rate can be added without leaving the page.
$rows = $pricing;
$rows[] = ['service_type' => '', 'country' => '', 'rate_per_minute' => '', 'rate_per_unit' => '',
           'monthly_cost' => '', 'setup_cost' => '', 'currency' => 'USD'];
?>
<div class="phoneservices-admin phoneservices-pricing">

    <div class="ps-page-head">
        <h2>Pricing control</h2>
        <p class="ps-muted">
            Rates are matched on service type + country. A row with country <code>*</code> acts as
            the default for that service. Leave the last row blank unless you are adding a rate.
        </p>
    </div>

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <form method="post" action="<?php echo $moduleLink; ?>&amp;action=pricing">
        <?php echo $csrf; ?>

        <div class="table-responsive">
            <table class="table table-striped table-condensed">
                <thead>
                    <tr>
                        <th>Service</th>
                        <th>Country</th>
                        <th>Rate / minute</th>
                        <th>Rate / unit</th>
                        <th>Monthly</th>
                        <th>Setup</th>
                        <th>Currency</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($rows as $index => $item) : ?>
                    <tr>
                        <td>
                            <select name="pricing[<?php echo (int) $index; ?>][service_type]" class="form-control">
                                <option value="">—</option>
                                <?php foreach ($serviceTypes as $type) : ?>
                                    <option value="<?php echo $e($type); ?>" <?php echo $item['service_type'] === $type ? 'selected' : ''; ?>>
                                        <?php echo $e(ucfirst($type)); ?>
                                    </option>
                                <?php endforeach; ?>
                            </select>
                        </td>
                        <td>
                            <input type="text" maxlength="2" size="4" class="form-control"
                                   name="pricing[<?php echo (int) $index; ?>][country]"
                                   value="<?php echo $e($item['country']); ?>">
                        </td>
                        <?php foreach (['rate_per_minute' => '0.000001', 'rate_per_unit' => '0.000001',
                                         'monthly_cost' => '0.01', 'setup_cost' => '0.01'] as $field => $step) : ?>
                            <td>
                                <input type="number" step="<?php echo $e($step); ?>" min="0" class="form-control"
                                       name="pricing[<?php echo (int) $index; ?>][<?php echo $e($field); ?>]"
                                       value="<?php echo $e($item[$field]); ?>">
                            </td>
                        <?php endforeach; ?>
                        <td>
                            <input type="text" maxlength="3" size="4" class="form-control"
                                   name="pricing[<?php echo (int) $index; ?>][currency]"
                                   value="<?php echo $e($item['currency']); ?>">
                        </td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
        </div>

        <div class="ps-form-actions">
            <button type="submit" class="btn btn-primary">Save pricing</button>
        </div>
    </form>
</div>
