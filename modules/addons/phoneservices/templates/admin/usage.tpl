<div class="phoneservices-admin-usage">
    <div class="row">
        <div class="col-sm-12">
            <h2>Usage & Analytics</h2>
            <p class="lead">System-wide usage reports</p>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <table class="table table-striped table-bordered">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Service Type</th>
                        <th>Count</th>
                        <th>Total Used</th>
                    </tr>
                </thead>
                <tbody>
                    <?php foreach ($reports as $report): ?>
                    <tr>
                        <td><?php echo $report['date']; ?></td>
                        <td><?php echo ucfirst($report['service_type']); ?></td>
                        <td><?php echo number_format($report['count']); ?></td>
                        <td><?php echo number_format($report['total_used'], 2); ?></td>
                    </tr>
                    <?php endforeach; ?>
                </tbody>
            </table>
        </div>
    </div>
</div>
