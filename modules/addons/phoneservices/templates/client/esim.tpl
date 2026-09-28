<?php
/**
 * Client > eSIM & data
 *
 * @var array  $esims profiles owned by this client
 * @var array  $plans available data plans from the active eSIM provider
 * @var string $currency
 * @var string $csrf
 */

require __DIR__ . '/_helpers.php';
?>
<div class="phoneservices-client-esim">

    <h2>eSIM &amp; data</h2>
    <p class="ps-muted">Buy a data plan, scan the QR code and you're online — no physical SIM required.</p>

    <div id="ps-esim-status" class="alert" style="display:none;"></div>

    <div class="row">
        <div class="col-md-8">
            <div class="panel panel-default">
                <div class="panel-heading">Your eSIM profiles</div>
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>Plan</th>
                                <th>ICCID</th>
                                <th>Status</th>
                                <th>Data</th>
                                <th>Expires</th>
                                <th class="text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($esims as $esim) : ?>
                            <?php
                            $total = (int) ($esim['data_total_mb'] ?? 0);
                            $used = (int) ($esim['data_used_mb'] ?? 0);
                            $pct = $total > 0 ? min(100, (int) round(($used / $total) * 100)) : 0;
                            ?>
                            <tr>
                                <td><?php echo $e($esim['friendly_name'] ?: $esim['plan_id']); ?></td>
                                <td><code><?php echo $e($esim['iccid'] ?: '—'); ?></code></td>
                                <td>
                                    <span class="label label-<?php echo $e($labelFor((string) $esim['status'])); ?>">
                                        <?php echo $e($esim['status']); ?>
                                    </span>
                                </td>
                                <td style="min-width:150px;">
                                    <div class="progress ps-progress">
                                        <div class="progress-bar <?php echo $pct >= 90 ? 'progress-bar-danger' : 'progress-bar-success'; ?>"
                                             style="width: <?php echo $pct; ?>%"></div>
                                    </div>
                                    <span id="ps-esim-usage-<?php echo (int) $esim['id']; ?>" class="ps-muted small">
                                        <?php echo $e($used); ?> MB<?php echo $total > 0 ? ' / ' . $e($total) . ' MB' : ''; ?>
                                    </span>
                                </td>
                                <td><?php echo $e($esim['expires_at'] ?: '—'); ?></td>
                                <td class="text-right">
                                    <button class="btn btn-xs btn-primary" data-esim-qr="<?php echo (int) $esim['id']; ?>">QR code</button>
                                    <button class="btn btn-xs btn-default" data-esim-usage="<?php echo (int) $esim['id']; ?>">Refresh</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$esims) : ?>
                            <tr><td colspan="6" class="text-center ps-muted">No eSIM profiles yet.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading">Available plans</div>
                <div class="table-responsive">
                    <table class="table table-condensed">
                        <thead>
                            <tr><th>Plan</th><th>Coverage</th><th>Data</th><th>Validity</th><th>Price</th><th></th></tr>
                        </thead>
                        <tbody>
                        <?php foreach ($plans as $plan) : ?>
                            <tr>
                                <td><?php echo $e($plan['name']); ?></td>
                                <td><?php echo $e(!empty($plan['is_global']) ? 'Global' : ($plan['country'] ?? '—')); ?></td>
                                <td><?php echo $e($plan['data']); ?></td>
                                <td><?php echo $e($plan['validity']); ?> days</td>
                                <td><?php echo $money($plan['price'] ?? 0); ?></td>
                                <td class="text-right">
                                    <button class="btn btn-xs btn-success" data-esim-buy="<?php echo $e($plan['plan_id']); ?>">Buy</button>
                                </td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$plans) : ?>
                            <tr><td colspan="6" class="text-center ps-muted">No plans are currently available.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>

        <div class="col-md-4">
            <div class="panel panel-default">
                <div class="panel-heading">Installation</div>
                <div class="panel-body text-center" id="ps-esim-qr">
                    <p class="ps-muted">Select <strong>QR code</strong> on a profile to display its activation details.</p>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
window.psConfig = window.psConfig || <?php echo json_encode([
    'apiBase'  => 'modules/addons/phoneservices/api/rest.php',
    'csrf'     => $csrf,
    'currency' => $currency,
], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;
</script>
