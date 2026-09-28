<?php
/**
 * Client > Dashboard
 *
 * @var array  $stats   ['numbers','calls','sms','esims','spend']
 * @var array  $usage   [serviceType => aggregate row]
 * @var array  $toggles
 * @var string $currency
 */

require __DIR__ . '/_helpers.php';

$link = 'index.php?m=phoneservices&action=';
$cards = [
    ['label' => 'Active numbers', 'value' => (int) $stats['numbers'], 'icon' => 'fa-phone',      'page' => 'numbers', 'toggle' => 'numbers'],
    ['label' => 'Calls',          'value' => (int) $stats['calls'],   'icon' => 'fa-microphone', 'page' => 'voip',    'toggle' => 'voip'],
    ['label' => 'Messages',       'value' => (int) $stats['sms'],     'icon' => 'fa-comment',    'page' => 'sms',     'toggle' => 'sms'],
    ['label' => 'eSIM profiles',  'value' => (int) $stats['esims'],   'icon' => 'fa-sim-card',   'page' => 'esim',    'toggle' => 'esim'],
];
?>
<div class="phoneservices-client-dashboard">

    <h2>Phone Services</h2>
    <p class="ps-muted">Your numbers, calling, messaging and data in one place.</p>

    <?php if (!empty($error)) : ?>
        <div class="alert alert-warning"><?php echo $e($error); ?></div>
    <?php endif; ?>

    <div class="row">
        <?php foreach ($cards as $card) : ?>
            <?php if (empty($toggles[$card['toggle']])) { continue; } ?>
            <div class="col-sm-3">
                <a class="panel panel-default" style="display:block;text-decoration:none;color:inherit;"
                   href="<?php echo $e($link . $card['page']); ?>">
                    <div class="panel-body text-center">
                        <i class="fas <?php echo $e($card['icon']); ?> fa-2x ps-muted"></i>
                        <div style="font-size:26px;font-weight:600;"><?php echo (int) $card['value']; ?></div>
                        <div class="ps-muted text-uppercase small"><?php echo $e($card['label']); ?></div>
                    </div>
                </a>
            </div>
        <?php endforeach; ?>
    </div>

    <div class="row">
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Spend to date</div>
                <div class="panel-body">
                    <p style="font-size:30px;font-weight:600;margin:0;"><?php echo $money($stats['spend'] ?? 0); ?></p>
                    <a href="<?php echo $e($link . 'usage'); ?>">View usage &amp; billing &rarr;</a>
                </div>
            </div>
        </div>
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Usage summary</div>
                <table class="table table-condensed" style="margin-bottom:0;">
                    <tbody>
                    <?php foreach ($usage as $serviceType => $row) : ?>
                        <tr>
                            <td><?php echo $e(ucfirst((string) $serviceType)); ?></td>
                            <td class="text-right">
                                <?php echo $e(round((float) $row['total_used'], 2)); ?>
                                <span class="ps-muted"><?php echo $e($row['unit']); ?></span>
                            </td>
                        </tr>
                    <?php endforeach; ?>
                    <?php if (!$usage) : ?>
                        <tr><td class="text-center ps-muted">Nothing recorded yet.</td></tr>
                    <?php endif; ?>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
</div>
