<div class="smm-dashboard">
    <h2>SMM Panel Dashboard</h2>

    <?php if ($flash): ?>
    <div class="alert alert-<?php echo $flash['type'] === 'success' ? 'success' : 'danger'; ?>">
        <?php echo $flash['message']; ?>
    </div>
    <?php endif; ?>

    <div class="row" style="margin-top:20px;">
        <div class="col-sm-2">
            <div class="panel panel-primary">
                <div class="panel-heading">Total Services</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['total_services']; ?></h3>
                </div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="panel panel-success">
                <div class="panel-heading">Active Services</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['active_services']; ?></h3>
                </div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="panel panel-info">
                <div class="panel-heading">Total Orders</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['total_orders']; ?></h3>
                </div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="panel panel-warning">
                <div class="panel-heading">Pending</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['pending_orders']; ?></h3>
                </div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="panel panel-default">
                <div class="panel-heading">Processing</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['processing_orders']; ?></h3>
                </div>
            </div>
        </div>
        <div class="col-sm-2">
            <div class="panel panel-success">
                <div class="panel-heading">Completed</div>
                <div class="panel-body text-center">
                    <h3><?php echo $stats['completed_orders']; ?></h3>
                </div>
            </div>
        </div>
    </div>

    <div class="panel panel-default" style="margin-top:20px;">
        <div class="panel-heading">
            <h4>Recent Orders</h4>
        </div>
        <div class="panel-body">
            <?php if (count($recentOrders) > 0): ?>
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>SMM Order</th>
                        <th>Service ID</th>
                        <th>Quantity</th>
                        <th>Link</th>
                        <th>Status</th>
                        <th>Last Check</th>
                        <th>Created</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($recentOrders as $order): ?>
                    <tr>
                        <td><?php echo $order->id; ?></td>
                        <td><?php echo $order->smm_order_id; ?></td>
                        <td><?php echo $order->smm_service_id; ?></td>
                        <td><?php echo $order->quantity; ?></td>
                        <td><?php echo substr($order->link, 0, 50); ?>...</td>
                        <td>
                            <span class="label label-<?php
                                echo ($order->status === 'completed') ? 'success' :
                                     (($order->status === 'pending') ? 'warning' :
                                     (($order->status === 'canceled' || $order->status === 'error') ? 'danger' : 'info'));
                            ?>"><?php echo ucfirst($order->status); ?></span>
                        </td>
                        <td><?php echo $order->last_check ?: 'Never'; ?></td>
                        <td><?php echo $order->created_at; ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php else: ?>
            <p>No orders found yet.</p>
            <?php endif; ?>
        </div>
    </div>
</div>
