<div class="smm-orders">
    <h2>SMM Orders</h2>

    <?php if ($flash): ?>
    <div class="alert alert-<?php echo $flash['type'] === 'success' ? 'success' : 'danger'; ?>">
        <?php echo $flash['message']; ?>
    </div>
    <?php endif; ?>

    <div class="panel panel-default">
        <div class="panel-heading"><h4>All Orders</h4></div>
        <div class="panel-body">
            <?php if (count($orders) > 0): ?>
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>WHMCS Order</th>
                        <th>WHMCS Service</th>
                        <th>SMM Order ID</th>
                        <th>SMM Service</th>
                        <th>Quantity</th>
                        <th>Link</th>
                        <th>Status</th>
                        <th>Start Count</th>
                        <th>Remains</th>
                        <th>Last Check</th>
                        <th>Created</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($orders as $order): ?>
                    <tr>
                        <td><?php echo $order->id; ?></td>
                        <td><?php echo $order->whmcs_order_id; ?></td>
                        <td><?php echo $order->whmcs_service_id; ?></td>
                        <td><?php echo $order->smm_order_id; ?></td>
                        <td><?php echo $order->smm_service_id; ?></td>
                        <td><?php echo $order->quantity; ?></td>
                        <td><?php echo substr($order->link, 0, 40); ?>...</td>
                        <td>
                            <span class="label label-<?php
                                echo ($order->status === 'completed') ? 'success' :
                                     (($order->status === 'pending') ? 'warning' :
                                     (($order->status === 'canceled' || $order->status === 'error') ? 'danger' :
                                     (($order->status === 'partial') ? 'warning' : 'info')));
                            ?>"><?php echo ucfirst($order->status); ?></span>
                        </td>
                        <td><?php echo $order->start_count; ?></td>
                        <td><?php echo $order->remains; ?></td>
                        <td><?php echo $order->last_check ?: 'Never'; ?></td>
                        <td><?php echo $order->created_at; ?></td>
                        <td>
                            <?php if (!empty($order->smm_order_id)): ?>
                            <form method="post" action="<?php echo $modulelink; ?>&action=refresh_order" style="display:inline;">
                                <input type="hidden" name="smm_order_id" value="<?php echo $order->smm_order_id; ?>">
                                <button type="submit" class="btn btn-xs btn-info" title="Refresh Status">
                                    <i class="fas fa-sync"></i>
                                </button>
                            </form>
                            <?php if ($order->status !== 'canceled' && $order->status !== 'completed'): ?>
                            <form method="post" action="<?php echo $modulelink; ?>&action=cancel_smm_order" style="display:inline;" onsubmit="return confirm('Cancel this order?');">
                                <input type="hidden" name="smm_order_id" value="<?php echo $order->smm_order_id; ?>">
                                <button type="submit" class="btn btn-xs btn-danger" title="Cancel Order">
                                    <i class="fas fa-times"></i>
                                </button>
                            </form>
                            <?php endif; ?>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php else: ?>
            <p>No orders found.</p>
            <?php endif; ?>
        </div>
    </div>
</div>
