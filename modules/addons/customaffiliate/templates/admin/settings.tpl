<?php
/**
 * Admin > Settings
 *
 * @var array $vars
 * @var array $notice
 * @var array $settings     raw setting values
 * @var array $groups       [groupId => name]
 * @var array $selected     selected group ids
 * @var int   $whmcsDelay   effective clearing delay in days
 * @var bool  $affiliatesOn WHMCS affiliate system enabled?
 */

require __DIR__ . '/_helpers.php';

$checked = static function ($value): string {
    return in_array(strtolower((string) $value), ['1', 'on', 'yes', 'true'], true) ? 'checked' : '';
};
?>
<div class="customaffiliate-settings">

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <?php if (!$affiliatesOn) : ?>
        <div class="alert alert-warning">
            The WHMCS affiliate system is switched off. Enable it under
            <strong>Configuration &gt; System Settings &gt; General Settings &gt; Affiliates</strong>,
            otherwise no referrals are recorded and this module has nothing to pay commission on.
        </div>
    <?php endif; ?>

    <form method="post" action="<?php echo $moduleLink; ?>&amp;action=settings">
        <?php echo \CustomAffiliate\Admin::tokenField(); ?>

        <div class="panel panel-default">
            <div class="panel-heading"><strong>Commission structure</strong></div>
            <div class="panel-body">
                <div class="row">
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ca-first">First payment commission (%)</label>
                            <input type="number" step="0.01" min="0" max="100" class="form-control" id="ca-first"
                                   name="first_commission_percent"
                                   value="<?php echo $e($settings['first_commission_percent']); ?>">
                            <span class="help-block">Paid once, on the first successful payment for a referred hosting service.</span>
                        </div>
                    </div>
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ca-recurring">Recurring commission (%)</label>
                            <input type="number" step="0.01" min="0" max="100" class="form-control" id="ca-recurring"
                                   name="recurring_commission_percent"
                                   value="<?php echo $e($settings['recurring_commission_percent']); ?>">
                            <span class="help-block">Paid on every renewal of that same service.</span>
                        </div>
                    </div>
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ca-minimum">Minimum commissionable amount</label>
                            <input type="number" step="0.01" min="0" class="form-control" id="ca-minimum"
                                   name="minimum_base_amount"
                                   value="<?php echo $e($settings['minimum_base_amount']); ?>">
                            <span class="help-block">Line items below this value are ignored.</span>
                        </div>
                    </div>
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ca-delay">Clearing delay (days)</label>
                            <input type="number" min="0" class="form-control" id="ca-delay"
                                   name="commission_delay_days"
                                   placeholder="inherit WHMCS (<?php echo (int) $whmcsDelay; ?>)"
                                   value="<?php echo $e($settings['commission_delay_days']); ?>">
                            <span class="help-block">Blank inherits the WHMCS affiliate commission delay.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading"><strong>Product scope</strong> &mdash; only these groups earn commission</div>
            <div class="panel-body">
                <?php if (!$groups) : ?>
                    <div class="alert alert-danger" style="margin-bottom:0;">No product groups exist in this installation.</div>
                <?php else : ?>
                    <div class="row">
                        <?php foreach ($groups as $groupId => $groupName) : ?>
                            <div class="col-sm-4">
                                <div class="checkbox">
                                    <label>
                                        <input type="checkbox" name="product_group_ids[]" value="<?php echo (int) $groupId; ?>"
                                            <?php echo in_array((int) $groupId, $selected, true) ? 'checked' : ''; ?>>
                                        <?php echo $e($groupName); ?>
                                        <span class="text-muted">(#<?php echo (int) $groupId; ?>)</span>
                                    </label>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                    <p class="help-block" style="margin-bottom:0;">
                        Select your <strong>Web Hosting</strong> group. Everything not selected &mdash; domains, RDP,
                        SSL, email hosting, add-ons, billable items &mdash; is excluded from affiliate tracking and payouts.
                    </p>
                <?php endif; ?>
            </div>
        </div>

        <div class="panel panel-default">
            <div class="panel-heading"><strong>Behaviour</strong></div>
            <div class="panel-body">
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="enabled" value="1" <?php echo $checked($settings['enabled']); ?>>
                        <strong>Enable this module</strong> &mdash; when off, WHMCS's stock affiliate behaviour applies untouched.
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="exclusive_mode" value="1" <?php echo $checked($settings['exclusive_mode']); ?>>
                        <strong>Suppress the WHMCS default commission</strong> &mdash; required for the custom rates and the
                        product exclusions to be the only thing that pays out.
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="require_new_client" value="1" <?php echo $checked($settings['require_new_client']); ?>>
                        <strong>First-payment rate for new clients only</strong> &mdash; an existing customer's new hosting
                        service earns the recurring rate from the start.
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="apply_discounts" value="1" <?php echo $checked($settings['apply_discounts']); ?>>
                        <strong>Apply invoice discounts</strong> &mdash; promotions and credits are spread across the
                        commissionable line items before the rate is applied.
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="reverse_on_refund" value="1" <?php echo $checked($settings['reverse_on_refund']); ?>>
                        <strong>Reverse commission on refund</strong> (also covers an invoice being marked unpaid).
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="reverse_on_cancel" value="1" <?php echo $checked($settings['reverse_on_cancel']); ?>>
                        <strong>Reverse commission when an invoice is cancelled.</strong>
                    </label>
                </div>
                <div class="checkbox">
                    <label>
                        <input type="checkbox" name="debug_logging" value="1" <?php echo $checked($settings['debug_logging']); ?>>
                        <strong>Debug logging</strong> &mdash; records every evaluated line item, including skips.
                    </label>
                </div>

                <div class="row" style="margin-top:10px;">
                    <div class="col-sm-3">
                        <div class="form-group">
                            <label for="ca-retention">Audit log retention (days)</label>
                            <input type="number" min="0" class="form-control" id="ca-retention"
                                   name="log_retention_days"
                                   value="<?php echo $e($settings['log_retention_days'] ?? 180); ?>">
                            <span class="help-block">0 keeps everything. Pruned by the daily cron.</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <button type="submit" class="btn btn-primary">Save settings</button>
        <a href="<?php echo $moduleLink; ?>" class="btn btn-default">Back to dashboard</a>
    </form>
</div>
