<?php
/**
 * Client > Usage & billing
 *
 * @var array  $usage        [serviceType => ['total_records','total_used','unit','last_recorded']]
 * @var array  $transactions recent transactions
 * @var array  $daily        [['date','service_type','events','total_used'], ...]
 * @var string $currency
 * @var string $csrf
 */

require __DIR__ . '/_helpers.php';

// Pivot the daily rows into one point per day for the chart.
$series = [];
foreach ($daily as $row) {
    $date = (string) $row['date'];
    $series[$date] = $series[$date] ?? ['date' => $date, 'call' => 0, 'sms' => 0, 'data' => 0];

    $bucket = ['call' => 'call', 'sms' => 'sms', 'whatsapp' => 'sms', 'email' => 'sms', 'data' => 'data', 'esim' => 'data'];
    $key = $bucket[(string) $row['service_type']] ?? null;

    if ($key !== null) {
        $series[$date][$key] += round((float) $row['total_used'], 2);
    }
}
$series = array_values($series);
?>
<div class="phoneservices-client-usage">

    <h2>Usage &amp; billing</h2>
    <p class="ps-muted">Everything you have consumed across calls, messaging and data.</p>

    <div class="row">
        <?php foreach ($usage as $serviceType => $row) : ?>
            <div class="col-sm-3">
                <div class="panel panel-default">
                    <div class="panel-body text-center">
                        <div style="font-size:24px;font-weight:600;">
                            <?php echo $e(round((float) $row['total_used'], 2)); ?>
                            <small class="ps-muted"><?php echo $e($row['unit']); ?></small>
                        </div>
                        <div class="ps-muted text-uppercase small"><?php echo $e($serviceType); ?></div>
                    </div>
                </div>
            </div>
        <?php endforeach; ?>
        <?php if (!$usage) : ?>
            <div class="col-sm-12"><div class="alert alert-info">No usage recorded yet.</div></div>
        <?php endif; ?>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading">Last 30 days</div>
        <div class="panel-body" style="height:300px;">
            <canvas id="ps-usage-chart"></canvas>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading">Transactions</div>
        <div class="table-responsive">
            <table class="table table-striped table-condensed">
                <thead>
                    <tr><th>Date</th><th>Service</th><th>Amount</th><th>Status</th><th>Invoice</th></tr>
                </thead>
                <tbody>
                <?php foreach ($transactions as $transaction) : ?>
                    <tr>
                        <td><?php echo $e($transaction['created_at']); ?></td>
                        <td><?php echo $e($transaction['service_type']); ?></td>
                        <td><?php echo $money($transaction['amount']); ?></td>
                        <td>
                            <span class="label label-<?php echo $e($labelFor((string) $transaction['status'])); ?>">
                                <?php echo $e($transaction['status']); ?>
                            </span>
                        </td>
                        <td>
                            <?php if (!empty($transaction['invoice_id'])) : ?>
                                <a href="viewinvoice.php?id=<?php echo (int) $transaction['invoice_id']; ?>">
                                    #<?php echo (int) $transaction['invoice_id']; ?>
                                </a>
                            <?php else : ?>
                                <span class="ps-muted">—</span>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$transactions) : ?>
                    <tr><td colspan="5" class="text-center ps-muted">No transactions yet.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>

<script>
window.psUsageSeries = <?php echo json_encode($series, JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;
</script>
