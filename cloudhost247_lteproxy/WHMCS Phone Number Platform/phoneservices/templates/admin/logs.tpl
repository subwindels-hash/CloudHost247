<div class="phoneservices-admin-logs">
    <div class="row">
        <div class="col-sm-12">
            <h2>System Logs</h2>
            <p class="lead">Recent system activity</p>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <table class="table table-striped table-bordered">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Level</th>
                        <th>Message</th>
                        <th>Source</th>
                        <th>IP</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($logs as $log): ?>
                    <tr class="<?php echo $log['level'] === 'error' ? 'danger' : ($log['level'] === 'warning' ? 'warning' : ''); ?>">
                        <td>#<?php echo $log['id']; ?></td>
                        <td><span class="label label-<?php echo $log['level'] === 'error' ? 'danger' : ($log['level'] === 'warning' ? 'warning' : ($log['level'] === 'debug' ? 'info' : 'success')); ?>"><?php echo ucfirst($log['level']); ?></span></td>
                        <td><?php echo htmlspecialchars(substr($log['message'], 0, 100)); ?></td>
                        <td><?php echo htmlspecialchars($log['source']); ?></td>
                        <td><?php echo $log['ip_address']; ?></td>
                        <td><?php echo $log['created_at']; ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
