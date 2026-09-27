<div class="phoneservices-client-usage">
    <div class="row">
        <div class="col-sm-12">
            <h2>Usage & Billing</h2>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Usage Summary</div>
                <div class="panel-body">
                    <?php if (!empty($usage)): ?>
                    <table class="table table-striped">
                        <thead>
                            <tr><th>Service</th><th>Records</th><th>Total Used</th><th>Last Recorded</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($usage as $type => $u): ?>
                            <tr>
                                <td><?php echo ucfirst($type); ?></td>
                                <td><?php echo number_format($u['total_records']); ?></td>
                                <td><?php echo number_format($u['total_used'], 2); ?></td>
                                <td><?php echo date('Y-m-d H:i', strtotime($u['last_recorded'])); ?></td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                    <?php else: ?>
                    <div class="alert alert-info">No usage data available yet.</div>
                    <?php endif; ?>
                </div>
            </div>
        </div>
        <div class="col-sm-6">
            <div class="panel panel-default">
                <div class="panel-heading">Recent Transactions</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr><th>ID</th><th>Service</th><th>Amount</th><th>Status</th><th>Date</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($transactions as $tx): ?>
                            <tr>
                                <td>#<?php echo $tx['id']; ?></td>
                                <td><?php echo $tx['service_type']; ?></td>
                                <td>$<?php echo number_format($tx['amount'], 2); ?></td>
                                <td><span class="label label-<?php echo $tx['status'] === 'completed' ? 'success' : 'warning'; ?>"><?php echo $tx['status']; ?></span></td>
                                <td><?php echo date('Y-m-d', strtotime($tx['created_at'])); ?></td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>
