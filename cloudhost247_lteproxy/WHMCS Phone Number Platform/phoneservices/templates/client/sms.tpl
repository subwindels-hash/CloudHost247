<div class="phoneservices-client-sms">
    <div class="row">
        <div class="col-sm-12">
            <h2>SMS & Messaging</h2>
        </div>
    </div>

    <div class="row">
        <div class="col-sm-4">
            <div class="panel panel-default">
                <div class="panel-heading">Send Message</div>
                <div class="panel-body">
                    <form method="post" action="<?php echo $vars['modulelink']; ?>&action=sms&do=send">
                        <div class="form-group">
                            <label>From</label>
                            <select name="from" class="form-control">
                                <option>System Number</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>To</label>
                            <input type="tel" name="to" class="form-control" placeholder="+1234567890" required>
                        </div>
                        <div class="form-group">
                            <label>Message</label>
                            <textarea name="message" class="form-control" rows="4" maxlength="1600" required></textarea>
                            <small class="text-muted">Max 1600 characters</small>
                        </div>
                        <div class="form-group">
                            <label>Channel</label>
                            <select name="channel" class="form-control">
                                <option value="sms">SMS</option>
                                <option value="whatsapp">WhatsApp</option>
                            </select>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Send</button>
                    </form>
                </div>
            </div>

            <div class="panel panel-default">
                <div class="panel-heading">Send OTP</div>
                <div class="panel-body">
                    <form method="post" action="<?php echo $vars['modulelink']; ?>&action=sms&do=otp">
                        <div class="form-group">
                            <label>To</label>
                            <input type="tel" name="to" class="form-control" placeholder="+1234567890" required>
                        </div>
                        <button type="submit" class="btn btn-warning btn-block">Send OTP</button>
                    </form>
                </div>
            </div>
        </div>
        <div class="col-sm-8">
            <div class="panel panel-default">
                <div class="panel-heading">Message History</div>
                <div class="panel-body">
                    <table class="table table-striped">
                        <thead>
                            <tr><th>To</th><th>Body</th><th>Channel</th><th>Status</th><th>Time</th></tr>
                        </thead>
                        <tbody>
                            <?php foreach ($messages as $msg): ?>
                            <tr>
                                <td><?php echo $msg['to_number']; ?></td>
                                <td><?php echo htmlspecialchars(substr($msg['body'], 0, 50)); ?>...</td>
                                <td><span class="label label-default"><?php echo $msg['channel']; ?></span></td>
                                <td><span class="label label-<?php echo $msg['status'] === 'sent' ? 'success' : ($msg['status'] === 'failed' ? 'danger' : 'info'); ?>"><?php echo $msg['status']; ?></span></td>
                                <td><?php echo date('Y-m-d H:i', strtotime($msg['created_at'])); ?></td>
                            </tr>
                            <?php endforeach; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>
