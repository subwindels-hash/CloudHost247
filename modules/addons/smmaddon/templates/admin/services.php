<div class="smm-services">
    <h2>SMM Services Management</h2>

    <?php if ($flash): ?>
    <div class="alert alert-<?php echo $flash['type'] === 'success' ? 'success' : 'danger'; ?>">
        <?php echo $flash['message']; ?>
    </div>
    <?php endif; ?>

    <div class="row" style="margin-bottom:20px;">
        <div class="col-sm-6">
            <form method="post" action="<?php echo $modulelink; ?>&action=sync_services" style="display:inline;">
                <input type="hidden" name="action" value="sync_services">
                <button type="submit" class="btn btn-primary">
                    <i class="fas fa-sync"></i> Sync Services from SMM Panel
                </button>
            </form>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading"><h4>Service Mapping</h4></div>
        <div class="panel-body">
            <?php if (count($services) > 0): ?>
            <table class="table table-striped table-hover">
                <thead>
                    <tr>
                        <th>SMM ID</th>
                        <th>Name</th>
                        <th>Category</th>
                        <th>Rate</th>
                        <th>Min/Max</th>
                        <th>Type</th>
                        <th>WHMCS Product</th>
                        <th>Markup %</th>
                        <th>Markup Fixed</th>
                        <th>Active</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($services as $svc): ?>
                    <tr>
                        <td><?php echo $svc->smm_service_id; ?></td>
                        <td><?php echo $svc->smm_name; ?></td>
                        <td><?php echo $svc->smm_category; ?></td>
                        <td><?php echo $svc->smm_rate; ?></td>
                        <td><?php echo $svc->smm_min; ?> / <?php echo $svc->smm_max; ?></td>
                        <td><?php echo $svc->smm_type; ?></td>
                        <td>
                            <?php
                            if ($svc->whmcs_product_id) {
                                $prod = Capsule::table('tblproducts')->where('id', $svc->whmcs_product_id)->first();
                                echo $prod ? $prod->name : 'Deleted Product';
                            } else {
                                echo '<span class="text-muted">Unmapped</span>';
                            }
                            ?>
                        </td>
                        <td><?php echo $svc->markup_percent; ?>%</td>
                        <td>$<?php echo $svc->markup_fixed; ?></td>
                        <td>
                            <form method="post" action="<?php echo $modulelink; ?>&action=toggle_service" style="display:inline;">
                                <input type="hidden" name="id" value="<?php echo $svc->id; ?>">
                                <input type="hidden" name="is_active" value="<?php echo $svc->is_active ? 0 : 1; ?>">
                                <button type="submit" class="btn btn-xs btn-<?php echo $svc->is_active ? 'success' : 'default'; ?>">
                                    <?php echo $svc->is_active ? 'Active' : 'Inactive'; ?>
                                </button>
                            </form>
                        </td>
                        <td>
                            <button type="button" class="btn btn-xs btn-info" data-toggle="modal" data-target="#mapModal<?php echo $svc->id; ?>">
                                Map
                            </button>
                        </td>
                    </tr>

                    <!-- Map Modal -->
                    <div class="modal fade" id="mapModal<?php echo $svc->id; ?>" tabindex="-1" role="dialog">
                        <div class="modal-dialog" role="document">
                            <div class="modal-content">
                                <form method="post" action="<?php echo $modulelink; ?>&action=map_service">
                                    <div class="modal-header">
                                        <h4 class="modal-title">Map Service: <?php echo $svc->smm_name; ?></h4>
                                    </div>
                                    <div class="modal-body">
                                        <input type="hidden" name="smm_service_id" value="<?php echo $svc->smm_service_id; ?>">
                                        <div class="form-group">
                                            <label>WHMCS Product</label>
                                            <select name="whmcs_product_id" class="form-control">
                                                <option value="">-- Select Product --</option>
                                                <?php foreach ($products as $prod): ?>
                                                <option value="<?php echo $prod->id; ?>" <?php echo ($svc->whmcs_product_id == $prod->id) ? 'selected' : ''; ?>>
                                                    <?php echo $prod->name; ?> (ID: <?php echo $prod->id; ?>)
                                                </option>
                                                <?php endforeach; ?>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label>WHMCS Server (Optional)</label>
                                            <select name="whmcs_server_id" class="form-control">
                                                <option value="0">Default</option>
                                                <?php foreach ($servers as $srv): ?>
                                                <option value="<?php echo $srv->id; ?>" <?php echo ($svc->whmcs_server_id == $srv->id) ? 'selected' : ''; ?>>
                                                    <?php echo $srv->name; ?>
                                                </option>
                                                <?php endforeach; ?>
                                            </select>
                                        </div>
                                        <div class="form-group">
                                            <label>Markup Percentage (%)</label>
                                            <input type="number" step="0.01" name="markup_percent" class="form-control" value="<?php echo $svc->markup_percent; ?>">
                                        </div>
                                        <div class="form-group">
                                            <label>Markup Fixed ($)</label>
                                            <input type="number" step="0.0001" name="markup_fixed" class="form-control" value="<?php echo $svc->markup_fixed; ?>">
                                        </div>
                                    </div>
                                    <div class="modal-footer">
                                        <button type="button" class="btn btn-default" data-dismiss="modal">Close</button>
                                        <button type="submit" class="btn btn-primary">Save Mapping</button>
                                    </div>
                                </form>
                            </div>
                        </div>
                    </div>
                    <?php endforeach; ?>
                </tbody>
            </table>
            <?php else: ?>
            <p>No services found. Click "Sync Services" to fetch services from your SMM panel.</p>
            <?php endif; ?>
        </div>
    </div>
</div>
