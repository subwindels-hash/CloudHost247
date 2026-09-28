<?php
/**
 * Client > VoIP calling
 *
 * @var array  $calls        recent call records for this client
 * @var array  $webRtcConfig ['token','identity','provider','ttl'] or ['error' => ...]
 * @var string $currency
 * @var string $csrf
 */

require __DIR__ . '/_helpers.php';
?>
<div class="phoneservices-client-voip">

    <h2>VoIP calling</h2>
    <p class="ps-muted">Place and receive calls straight from your browser, or bridge them to your handset.</p>

    <div class="row">
        <div class="col-md-4">
            <div class="panel panel-default" id="ps-dialer">
                <div class="panel-heading">Dialer</div>
                <div class="panel-body">
                    <div id="webrtc-status" class="alert alert-info">Starting softphone…</div>

                    <div class="form-group">
                        <label for="from-number">Your number</label>
                        <select id="from-number" class="form-control">
                            <option value="">Loading…</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label for="to-number">Call to</label>
                        <input type="tel" id="to-number" class="form-control" placeholder="+15551234567"
                               autocomplete="tel" inputmode="tel">
                    </div>

                    <div class="ps-dialer-timer" id="ps-call-timer">00:00</div>

                    <div class="ps-keypad" id="ps-keypad">
                        <?php foreach (['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'] as $digit) : ?>
                            <button type="button" class="btn btn-default" data-digit="<?php echo $e($digit); ?>">
                                <?php echo $e($digit); ?>
                            </button>
                        <?php endforeach; ?>
                    </div>

                    <button id="btn-call" class="btn btn-success btn-block" disabled>
                        <i class="fas fa-phone"></i> Call
                    </button>
                    <button id="btn-hangup" class="btn btn-danger btn-block" style="display:none;">
                        <i class="fas fa-phone-slash"></i> Hang up
                    </button>
                    <button id="btn-mute" class="btn btn-default btn-block btn-sm" type="button">
                        <i class="fas fa-microphone-slash"></i> Mute
                    </button>
                </div>
            </div>
        </div>

        <div class="col-md-8">
            <div class="panel panel-default">
                <div class="panel-heading">Call history</div>
                <div class="table-responsive">
                    <table class="table table-striped">
                        <thead>
                            <tr>
                                <th>From</th>
                                <th>To</th>
                                <th>Status</th>
                                <th>Duration</th>
                                <th>Cost</th>
                                <th>Started</th>
                            </tr>
                        </thead>
                        <tbody id="ps-call-log">
                        <?php foreach ($calls as $call) : ?>
                            <tr>
                                <td><?php echo $e($call['from_number']); ?></td>
                                <td><?php echo $e($call['to_number']); ?></td>
                                <td>
                                    <span class="label label-<?php echo $e($labelFor((string) $call['status'])); ?>">
                                        <?php echo $e($call['status']); ?>
                                    </span>
                                </td>
                                <td><?php echo $e($duration($call['duration'] ?? 0)); ?></td>
                                <td><?php echo $money($call['cost'] ?? 0); ?></td>
                                <td><?php echo $e($call['started_at']); ?></td>
                            </tr>
                        <?php endforeach; ?>
                        <?php if (!$calls) : ?>
                            <tr><td colspan="6" class="text-center ps-muted">No calls yet.</td></tr>
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
window.psWebRtcConfig = <?php echo json_encode(
    is_array($webRtcConfig) && empty($webRtcConfig['error']) ? $webRtcConfig : [],
    JSON_UNESCAPED_SLASHES | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT
); ?>;
</script>
