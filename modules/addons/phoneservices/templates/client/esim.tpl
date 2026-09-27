<div class="phoneservices-client-esim">
    <div class="row">
        <div class="col-sm-12">
            <h2>eSIM & Data</h2>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-4">
            <div class="panel panel-default">
                <div class="panel-heading">My eSIMs</div>
                <div class="panel-body esim-list">
                    <?php foreach ($esims as $esim): ?>
                    <div class="esim-item">
                        <h4><?php echo htmlspecialchars($esim['friendly_name']); ?> <span class="label label-<?php echo $esim['status'] === 'active' ? 'success' : 'warning'; ?>"><?php echo $esim['status']; ?></span></h4>
                        <p><strong>ICCID:</strong> <?php echo $esim['iccid']; ?></p>
                        <p><strong>Expires:</strong> <?php echo $esim['expires_at'] ? date('Y-m-d', strtotime($esim['expires_at'])) : '-'; ?></p>
                        <a href="<?php echo $vars['modulelink']; ?>&action=esim&do=qrcode&id=<?php echo $esim['id']; ?>" class="btn btn-sm btn-info">QR Code</a>
                        <a href="<?php echo $vars['modulelink']; ?>&action=esim&do=usage&id=<?php echo $esim['id']; ?>" class="btn btn-sm btn-default">Usage</a>
                        <a href="<?php echo $vars['modulelink']; ?>&action=esim&do=renew&id=<?php echo $esim['id']; ?>" class="btn btn-sm btn-success">Renew</a>
                    </div>
                    <?php endforeach; ?>
                </div>
            </div>
        </div>
        <div class="col-sm-8">
            <div class="panel panel-default">
                <div class="panel-heading">Available Plans</div>
                <div class="panel-body">
                    <?php if (!empty($plans) && !isset($plans['error'])): ?>
                    <div class="row">
                        <?php foreach ($plans as $plan): ?>
                        <div class="col-sm-6">
                            <div class="plan-card">
                                <h4><?php echo htmlspecialchars($plan['name']); ?></h4>
                                <p class="plan-meta"><?php echo $plan['data']; ?> &middot; <?php echo $plan['validity']; ?> days</p>
                                <p class="plan-price">$<?php echo number_format($plan['price'], 2); ?> <small><?php echo $plan['currency']; ?></small></p>
                                <p class="plan-countries"><small><?php echo implode(', ', array_slice($plan['countries'], 0, 5)); ?>...</small></p>
                                <a href="<?php echo $vars['modulelink']; ?>&action=esim&do=purchase&plan=<?php echo $plan['plan_id']; ?>" class="btn btn-primary btn-block">Purchase</a>
                            </div>
                        </div>
                        <?php endforeach; ?>
                    </div>
                    <?php else: ?>
                    <div class="alert alert-info">No plans available. Please configure an eSIM provider.</div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.esim-list .esim-item { border-bottom: 1px solid #eee; padding: 15px 0; }
.esim-list .esim-item:last-child { border-bottom: none; }
.plan-card { border: 1px solid #eee; border-radius: 6px; padding: 20px; margin-bottom: 20px; text-align: center; }
.plan-card h4 { margin-top: 0; font-weight: bold; }
.plan-meta { color: #888; }
.plan-price { font-size: 22px; font-weight: bold; color: #27ae60; }
.plan-countries { color: #aaa; }
</style>
