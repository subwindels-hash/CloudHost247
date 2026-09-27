<div class="smm-logs">
    <h2>API Logs</h2>

    <?php if ($flash): ?>
    <div class="alert alert-<?php echo $flash['type'] === 'success' ? 'success' : 'danger'; ?>">
        <?php echo $flash['message']; ?>
    </div>
    <?php endif; ?>

    <div class="row" style="margin-bottom:20px;">
        <div class="col-sm-6">
            <form method="post" action="<?php echo $modulelink; ?>&action=clear_logs" class="form-inline">
                <input type="hidden" name="action" value="clear_logs">
                <div class="form-group">
                    <label>Delete logs older than </label>
                    <select name="days" class="form-control">
                        <option value="7">7 days</option>
                        <option value="30" selected>30 days</option>
                        <option value="90">90 days</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-danger" onclick="return confirm('Are you sure?');">
                    <i class="fas fa-trash"></i> Clear
                </button>
            </form>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading"><h4>Recent API Requests</h4></div>
        <div class="panel-body">
            <?php if (count($logs) > 0): ?>
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Action</th>
                        <th>Endpoint</th>
                        <th>HTTP Code</th>
                        <th>Error</th>
                        <th>Request</th>
                        <th>Response</th>
                        <th>Time</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($logs as $log): ?>
                    <tr>
                        <td><?php echo $log->id; ?></td>
                        <td><?php echo $log->action; ?></td>
                        <td><?php echo substr($log->endpoint, 0, 60); ?>...</td>
                        <td><?php echo $log->http_code; ?></td>
                        <td>
                            <?php if ($log->error): ?>
                            <span class="label label-danger"><?php echo substr($log->error, 0, 50); ?></span>
                            <?php else: ?>
                            <span class="label label-success">OK</span>
                            <?php endif; ?>
                        </td>
                        <td>
                            <pre style="max-width:200px;max-height:100px;overflow:auto;"><?php echo htmlspecialchars(substr($log->request, 0, 500)); ?></pre>
                        </td>
                        <td>
                            <pre style="max-width:200px;max-height:100px;overflow:auto;"><?php echo htmlspecialchars(substr($log->response, 0, 500)); ?></pre>
                        </td>
                        <td><?php echo $log->created_at; ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php else: ?>
            <p>No logs found.</p>
            <?php endif; ?>
        </div>
    </div>
</div>
