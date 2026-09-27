<div class="phoneservices-pricing">
    <div class="row">
        <div class="col-sm-12">
            <h2>Pricing Control</h2>
            <p class="lead">Manage pricing per country and service type</p>
        </div>
    </div>

    <?php if (isset($_GET['success'])): ?>
    <div class="alert alert-success">Pricing updated successfully.</div>
    <?php endif; ?>

    <form method="post" action="<?php echo $vars['modulelink']; ?>&action=pricing">
        <table class="table table-striped table-bordered">
            <thead>
                <tr>
                    <th>Service Type</th>
                    <th>Country</th>
                    <th>Rate/Min ($)</th>
                    <th>Rate/Unit ($)</th>
                    <th>Monthly ($)</th>
                    <th>Setup ($)</th>
                    <th>Currency</th>
                </tr>
            </thead>
            <tbody>
                <?php foreach ($pricing as $index => $item): ?>
                <tr>
                    <td>
                        <input type="hidden" name="pricing[<?php echo $index; ?>][service_type]" value="<?php echo $item['service_type']; ?>">
                        <?php echo ucfirst($item['service_type']); ?>
                    </td>
                    <td>
                        <input type="text" name="pricing[<?php echo $index; ?>][country]" class="form-control" value="<?php echo $item['country']; ?>">
                    </td>
                    <td>
                        <input type="number" step="0.000001" name="pricing[<?php echo $index; ?>][rate_per_minute]" class="form-control" value="<?php echo $item['rate_per_minute']; ?>">
                    </td>
                    <td>
                        <input type="number" step="0.000001" name="pricing[<?php echo $index; ?>][rate_per_unit]" class="form-control" value="<?php echo $item['rate_per_unit']; ?>">
                    </td>
                    <td>
                        <input type="number" step="0.01" name="pricing[<?php echo $index; ?>][monthly_cost]" class="form-control" value="<?php echo $item['monthly_cost']; ?>">
                    </td>
                    <td>
                        <input type="number" step="0.01" name="pricing[<?php echo $index; ?>][setup_cost]" class="form-control" value="<?php echo $item['setup_cost']; ?>">
                    </td>
                    <td>
                        <input type="text" name="pricing[<?php echo $index; ?>][currency]" class="form-control" value="<?php echo $item['currency']; ?>">
                    </td>
                </tr>
                <?php endforeach; ?>
            </tbody>
        </table>
        <button type="submit" class="btn btn-primary">Save Pricing</button>
    </form>
</div>
