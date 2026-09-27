<div class="phoneservices-client-numbers">
    <div class="row">
        <div class="col-sm-12">
            <h2>My Numbers</h2>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>Number</th>
                        <th>Country</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Next Renewal</th>
                        <th>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($numbers as $num): ?>
                    <tr>
                        <td><?php echo $num['number']; ?></td>
                        <td><?php echo $num['country']; ?></td>
                        <td><?php echo ucfirst($num['type']); ?></td>
                        <td><span class="label label-<?php echo $num['status'] === 'active' ? 'success' : 'warning'; ?>"><?php echo ucfirst($num['status']); ?></span></td>
                        <td><?php echo $num['next_renewal'] ? date('Y-m-d', strtotime($num['next_renewal'])) : '-'; ?></td>
                        <td>
                            <?php if ($num['status'] === 'active'): ?>
                            <a href="<?php echo $vars['modulelink']; ?>&action=numbers&do=renew&id=<?php echo $num['id']; ?>" class="btn btn-xs btn-success">Renew</a>
                            <a href="<?php echo $vars['modulelink']; ?>&action=numbers&do=release&id=<?php echo $num['id']; ?>" class="btn btn-xs btn-danger" onclick="return confirm('Release this number?')">Release</a>
                            <?php endif; ?>
                        </td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <h3>Buy a Number</h3>
            <form method="post" action="<?php echo $vars['modulelink']; ?>&action=numbers&do=purchase">
                <div class="form-group">
                    <label>Country</label>
                    <select name="country" class="form-control">
                        <?php foreach ($availableCountries as $c): ?>
                        <option value="<?php echo $c['code']; ?>"><?php echo $c['flag'] . ' ' . $c['name']; ?></option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label>Type</label>
                    <select name="type" class="form-control">
                        <option value="local">Local Number</option>
                        <option value="tollfree">Toll-Free</option>
                    </select>
                </div>
                <div class="form-group">
                    <label>Number (optional - leave blank for auto-select)</label>
                    <input type="text" name="number" class="form-control" placeholder="+1...">
                </div>
                <button type="submit" class="btn btn-primary">Search & Purchase</button>
            </form>
        </div>
    </div>
</div>
