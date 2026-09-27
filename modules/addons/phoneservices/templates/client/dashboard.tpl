<div class="phoneservices-client-dashboard">
    <div class="row">
        <div class="col-sm-12">
            <h2>Phone Services Dashboard</h2>
            <p>Welcome to your telecom services portal.</p>
        </div>
    </div>

    <div class="row stats-row">
        <div class="col-sm-3">
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-phone"></i></div>
                <div class="stat-value"><?php echo $stats['numbers']; ?></div>
                <div class="stat-label">Active Numbers</div>
                <a href="<?php echo $vars['modulelink']; ?>&action=numbers" class="btn btn-sm btn-default">Manage</a>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-microphone"></i></div>
                <div class="stat-value"><?php echo $stats['calls']; ?></div>
                <div class="stat-label">Calls</div>
                <a href="<?php echo $vars['modulelink']; ?>&action=voip" class="btn btn-sm btn-default">Call Logs</a>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-envelope"></i></div>
                <div class="stat-value"><?php echo $stats['sms']; ?></div>
                <div class="stat-label">Messages</div>
                <a href="<?php echo $vars['modulelink']; ?>&action=sms" class="btn btn-sm btn-default">Messages</a>
            </div>
        </div>
        <div class="col-sm-3">
            <div class="stat-card">
                <div class="stat-icon"><i class="fas fa-sim-card"></i></div>
                <div class="stat-value"><?php echo $stats['esims']; ?></div>
                <div class="stat-label">Active eSIMs</div>
                <a href="<?php echo $vars['modulelink']; ?>&action=esim" class="btn btn-sm btn-default">Manage</a>
            </div>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-12">
            <div class="panel panel-default">
                <div class="panel-heading">Quick Actions</div>
                <div class="panel-body">
                    <a href="<?php echo $vars['modulelink']; ?>&action=numbers" class="btn btn-primary">Buy Number</a>
                    <a href="<?php echo $vars['modulelink']; ?>&action=voip" class="btn btn-primary">Make Call</a>
                    <a href="<?php echo $vars['modulelink']; ?>&action=sms" class="btn btn-primary">Send SMS</a>
                    <a href="<?php echo $vars['modulelink']; ?>&action=esim" class="btn btn-primary">Buy eSIM</a>
                </div>
            </div>
        </div>
    </div>
</div>

<style>
.phoneservices-client-dashboard { padding: 20px; }
.stats-row { margin-bottom: 30px; }
.stat-card { background: #fff; border: 1px solid #eee; border-radius: 6px; padding: 25px; text-align: center; margin-bottom: 20px; box-shadow: 0 2px 4px rgba(0,0,0,0.05); }
.stat-icon { font-size: 24px; color: #3498db; margin-bottom: 10px; }
.stat-value { font-size: 32px; font-weight: bold; color: #2d3a4a; }
.stat-label { font-size: 13px; color: #888; text-transform: uppercase; margin: 8px 0 15px; }
</style>
