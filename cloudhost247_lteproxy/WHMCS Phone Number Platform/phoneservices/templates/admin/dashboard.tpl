<div class="phoneservices-dashboard">
    <div class="row">
        <div class="col-sm-12">
            <h2>Phone Services Dashboard</h2>
            <p class="lead">System overview and key metrics</p>
        </div>
    </div>

    <div class="row stats-row">
        <div class="col-sm-2">
            <div class="stat-card">
                <div class="stat-value"><?php echo $stats['total_numbers']; ?></div>
                <div class="stat-label">Total Numbers</div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="stat-card">
                <div class="stat-value"><?php echo $stats['active_numbers']; ?></div>
                <div class="stat-label">Active Numbers</div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="stat-card">
                <div class="stat-value"><?php echo $stats['total_calls']; ?></div>
                <div class="stat-label">Total Calls</div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="stat-card">
                <div class="stat-value"><?php echo $stats['total_messages']; ?></div>
                <div class="stat-label">Messages</div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="stat-card">
                <div class="stat-value"><?php echo $stats['active_esims']; ?></div>
                <div class="stat-label">Active eSIMs</div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="stat-card revenue">
                <div class="stat-value">$<?php echo number_format($stats['total_revenue'], 2); ?></div>
                <div class="stat-label">Revenue</div>
            </div>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Recent Calls</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr><th>ID</th><th>From</th><th>To</th><th>Status</th><th>Duration</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($stats['recent_calls'] as $call): ?>
                            <tr>
                                <td><?php echo substr($call['call_id'], 0, 15); ?>...</td>
                                <td><?php echo $call['from_number']; ?></td>
                                <td><?php echo $call['to_number']; ?></td>
                                <td><span class="label label-<?php echo $call['status'] === 'completed' ? 'success' : 'info'; ?>"><?php echo $call['status']; ?></span></td>
                                <td><?php echo $call['duration']; ?>s</td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Recent Transactions</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr><th>ID</th><th>Service</th><th>Amount</th><th>Status</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($stats['recent_transactions'] as $tx): ?>
                            <tr>
                                <td>#<?php echo $tx['id']; ?></td>
                                <td><?php echo $tx['service_type']; ?></td>
                                <td>$<?php echo number_format($tx['amount'], 2); ?></td>
                                <td><span class="label label-<?php echo $tx['status'] === 'completed' ? 'success' : 'warning'; ?>"><?php echo $tx['status']; ?></span></td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.phoneservices-dashboard { padding: 20px; }
.stats-row { margin-bottom: 30px; }
.stat-card { background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 20px; text-align: center; margin-bottom: 15px; }
.stat-value { font-size: 28px; font-weight: bold; color: #2d3a4a; }
.stat-card.revenue .stat-value { color: #27ae60; }
.stat-label { font-size: 12px; color: #888; text-transform: uppercase; margin-top: 5px; }
</style>
