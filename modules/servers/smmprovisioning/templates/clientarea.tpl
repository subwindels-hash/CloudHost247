<div class="smm-client-area">
    <h2>SMM Order Details</h2>

    <?php if (isset($error) && $error): ?>
    <div class="alert alert-danger"><?php echo $error; ?></div>
    <?php else: ?>
    <div class="panel panel-<?php echo $status_color; ?>">
        <div class="panel-heading">
            <h4>Order Status: <?php echo ucfirst($order['status']); ?></h4>
        </div>
        <div class="panel-body">
            <div class="row">
                <div class="col-sm-6">
                    <table class="table table-bordered">
                        <tr>
                            <th>SMM Order ID</th>
                            <td><?php echo $order['smm_order_id']; ?></td>
                        </tr>
                        <tr>
                            <th>SMM Service ID</th>
                            <td><?php echo $order['smm_service_id']; ?></td>
                        </tr>
                        <tr>
                            <th>Quantity</th>
                            <td><?php echo $order['quantity']; ?></td>
                        </tr>
                        <tr>
                            <th>Link</th>
                            <td><a href="<?php echo $order['link']; ?>" target="_blank"><?php echo $order['link']; ?></a></td>
                        </tr>
                    </table>
                </div>
                <div class="col-sm-6">
                    <table class="table table-bordered">
                        <tr>
                            <th>Start Count</th>
                            <td><?php echo $order['start_count']; ?></td>
                        </tr>
                        <tr>
                            <th>Remains</th>
                            <td><?php echo $order['remains']; ?></td>
                        </tr>
                        <tr>
                            <th>Last Checked</th>
                            <td><?php echo $order['last_check'] ?: 'Pending first check'; ?></td>
                        </tr>
                        <tr>
                            <th>Created</th>
                            <td><?php echo $order['created_at']; ?></td>
                        </tr>
                    </table>
                </div>
            </div>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading"><h4>Order Timeline</h4></div>
        <div class="panel-body">
            <ul class="list-group">
                <li class="list-group-item">
                    <strong><?php echo $order['created_at']; ?></strong> - Order placed successfully.
                </li>
                <?php if ($order['status'] !== 'pending'): ?>
                <li class="list-group-item">
                    <strong><?php echo $order['updated_at']; ?></strong> - Status updated to <span class="label label-<?php echo $status_color; ?>"><?php echo ucfirst($order['status']); ?></span>
                </li>
                <?php endif; ?>
            </ul>
        </div>
    </div>
    <?php endif; ?>
</div>
