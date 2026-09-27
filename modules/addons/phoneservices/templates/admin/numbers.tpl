<div class="phoneservices-admin-numbers">
    <div class="row">
        <div class="col-sm-12">
            <h2>Virtual Numbers</h2>
            <p class="lead">Manage all virtual phone numbers</p>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <table class="table table-striped table-bordered">
                <thead>
                    <tr>
                        <th>ID</th>
                        <th>Number</th>
                        <th>User</th>
                        <th>Country</th>
                        <th>Type</th>
                        <th>Provider</th>
                        <th>Status</th>
                        <th>Next Renewal</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($numbers as $num): ?>
                    <tr>
                        <td>#<?php echo $num['id']; ?></td>
                        <td><?php echo $num['number']; ?></td>
                        <td><?php echo $num['user_id'] ? 'User #' . $num['user_id'] : 'Unassigned'; ?></td>
                        <td><?php echo $num['country']; ?></td>
                        <td><?php echo ucfirst($num['type']); ?></td>
                        <td><?php echo ucfirst($num['provider']); ?></td>
                        <td>
                            <span class="label label-<?php 
                                echo $num['status'] === 'active' ? 'success' : 
                                     ($num['status'] === 'suspended' ? 'warning' : 
                                     ($num['status'] === 'released' ? 'danger' : 'default'));
                            ?>">
                                <?php echo ucfirst($num['status']); ?>
                            </span>
                        </td>
                        <td><?php echo $num['next_renewal'] ? date('Y-m-d', strtotime($num['next_renewal'])) : '-'; ?></td>
                        <td>
                            <?php if ($num['status'] === 'active'): ?>
                            <a href="<?php echo $vars['modulelink']; ?>&action=numbers&do=suspend&id=<?php echo $num['id']; ?>" class="btn btn-xs btn-warning">Suspend</a>
                            <?php endif; ?>
                            <?php if ($num['status'] !== 'released'): ?>
                            <a href="<?php echo $vars['modulelink']; ?>&action=numbers&do=release&id=<?php echo $num['id']; ?>" class="btn btn-xs btn-danger" onclick="return confirm('Release this number?')">Release</a>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
