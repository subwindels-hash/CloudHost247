<?php
/**
 * Client > SMS & messaging
 *
 * @var array  $messages recent messages for this client
 * @var array  $numbers  sender numbers owned by this client
 * @var array  $toggles
 * @var string $currency
 * @var string $csrf
 */

require __DIR__ . '/_helpers.php';
?>
<div class="phoneservices-client-sms">

    <h2>SMS &amp; messaging</h2>
    <p class="ps-muted">Send SMS and WhatsApp messages worldwide and track delivery in real time.</p>

    <div id="ps-sms-status" class="alert" style="display:none;"></div>

    <div class="row">
        <div class="col-md-4">
            <div class="panel panel-default">
                <div class="panel-heading">Compose</div>
                <div class="panel-body">
                    <form id="ps-sms-form">
                        <div class="form-group">
                            <label for="ps-sms-channel">Channel</label>
                            <select name="channel" id="ps-sms-channel" class="form-control">
                                <option value="sms">SMS</option>
                                <option value="whatsapp">WhatsApp</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="ps-sms-from">From</label>
                            <select name="from" id="ps-sms-from" class="form-control">
                                <?php foreach ($numbers as $number) : ?>
                                    <?php if ($number['status'] !== 'active') { continue; } ?>
                                    <option value="<?php echo $e($number['number']); ?>">
                                        <?php echo $e($number['number']); ?>
                                    </option>
                                <?php endforeach; ?>
                                <option value="">Platform default</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="ps-sms-to">To</label>
                            <input type="tel" name="to" id="ps-sms-to" class="form-control"
                                   placeholder="+15551234567" required>
                        </div>
                        <div class="form-group">
                            <label for="ps-sms-body">Message</label>
                            <textarea name="message" id="ps-sms-body" class="form-control" rows="5"
                                      maxlength="1600" required></textarea>
                            <span class="help-block" id="ps-sms-counter">0 characters · 0 segment(s)</span>
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Send message</button>
                    </form>
                </div>
            </div>
        </div>

        <div class="col-md-8">
            <div class="panel panel-default">
                <div class="panel-heading">Message log</div>
                <div class="table-responsive">
                    <table class="table table-striped table-condensed">
                        <thead>
                            <tr>
                                <th>When</th>
                                <th>Channel</th>
                                <th>Direction</th>
                                <th>Counterparty</th>
                                <th>Message</th>
                                <th>Status</th>
                                <th>Cost</th>
                            </tr>
                        </thead>
                        <tbody>
                        <?php foreach ($messages as $message) : ?>
                            <?php $inbound = ($message['direction'] ?? 'outbound') === 'inbound'; ?>
                            <tr>
                                <td><?php echo $e($message['created_at']); ?></td>
                                <td><span class="label label-default"><?php echo $e($message['channel']); ?></span></td>
                                <td><?php echo $inbound ? 'In' : 'Out'; ?></td>
                                <td><?php echo $e($inbound ? $message['from_number'] : $message['to_number']); ?></td>
                                <td class="ps-truncate" title="<?php echo $e($message['body']); ?>">
                                    <?php echo $e(mb_substr((string) $message['body'], 0, 70)); ?><?php echo mb_strlen((string) $message['body']) > 70 ? '…' : ''; ?>
                                </td>
                                <td>
                                    <span class="label label-<?php echo $e($labelFor((string) $message['status'])); ?>">
                                        <?php echo $e($message['status']); ?>
                                    </span>
                                </td>
                                <td><?php echo $money($message['cost'] ?? 0); ?></td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$messages) : ?>
                            <tr><td colspan="7" class="text-center ps-muted">No messages yet.</td></tr>
                        <?php endif; ?>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    </div>
</div>

<script>
window.psConfig = window.psConfig || <?php echo json_encode([
    'apiBase'  => 'modules/addons/phoneservices/api/rest.php',
    'csrf'     => $csrf,
    'currency' => $currency,
], JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT); ?>;
</script>
