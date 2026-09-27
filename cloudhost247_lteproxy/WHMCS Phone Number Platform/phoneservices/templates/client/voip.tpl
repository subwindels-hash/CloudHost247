<div class="phoneservices-client-voip">
    <div class="row">
        <div class="col-sm-12">
            <h2>VoIP Calling</h2>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-4">
            <div class="panel panel-default dialer-panel">
                <div class="panel-heading">WebRTC Dialer</div>
                <div class="panel-body">
                    <div id="webrtc-status" class="alert alert-info">Initializing...</div>
                    <div class="form-group">
                        <label>Your Number</label>
                        <select id="from-number" class="form-control">
                            <option>Select your number</option>
                        </select>
                    </div>
                    <div class="form-group">
                        <label>Call To</label>
                        <input type="tel" id="to-number" class="form-control" placeholder="+1234567890">
                    </div>
                    <button id="btn-call" class="btn btn-success btn-block" disabled><i class="fas fa-phone"></i> Call</button>
                    <button id="btn-hangup" class="btn btn-danger btn-block" style="display:none;"><i class="fas fa-phone-slash"></i> Hang Up</button>
                </div>
            </div>
        </div>
        <div class="col-sm-8">
            <div class="panel panel-default">
                <div class="panel-heading">Call Logs</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr><th>From</th><th>To</th><th>Status</th><th>Duration</th><th>Cost</th><th>Time</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($calls as $call): ?>
                            <tr>
                                <td><?php echo $call['from_number']; ?></td>
                                <td><?php echo $call['to_number']; ?></td>
                                <td><span class="label label-<?php echo $call['status'] === 'completed' ? 'success' : 'info'; ?>"><?php echo $call['status']; ?></span></td>
                                <td><?php echo $call['duration']; ?>s</td>
                                <td>$<?php echo number_format($call['cost'], 3); ?></td>
                                <td><?php echo date('Y-m-d H:i', strtotime($call['started_at'])); ?></td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
window.psWebRtcConfig = <?php echo json_encode($webRtcConfig); ?>;
</script>

<style>
.dialer-panel { max-width: 300px; }
#webrtc-status { font-size: 12px; }
</style>
