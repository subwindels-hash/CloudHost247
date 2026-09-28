<?php
/**
 * Client > My numbers
 *
 * @var array  $numbers            numbers owned by this client
 * @var array  $availableCountries [['code','name','flag'], ...]
 * @var string $currency
 * @var string $csrf
 */

require __DIR__ . '/_helpers.php';
?>
<div class="phoneservices-client-numbers">

    <h2>My numbers</h2>
    <p class="ps-muted">Buy virtual numbers in <?php echo (int) count($availableCountries); ?> countries and manage their lifecycle.</p>

    <div id="ps-number-status" class="alert" style="display:none;"></div>

    <div class="panel panel-default">
        <div class="panel-heading">Find a new number</div>
        <div class="panel-body">
            <form id="ps-number-search" class="form-inline">
                <div class="form-group">
                    <label class="sr-only" for="ps-country">Country</label>
                    <select name="country" id="ps-country" class="form-control">
                        <?php foreach ($availableCountries as $country) : ?>
                            <option value="<?php echo $e($country['code']); ?>">
                                <?php echo $e(($country['flag'] ?? '') . ' ' . $country['name']); ?>
                            </option>
                        <?php endforeach; ?>
                    </select>
                </div>
                <div class="form-group">
                    <label class="sr-only" for="ps-type">Type</label>
                    <select name="type" id="ps-type" class="form-control">
                        <option value="local">Local</option>
                        <option value="tollfree">Toll-free</option>
                        <option value="mobile">Mobile</option>
                        <option value="national">National</option>
                    </select>
                </div>
                <button type="submit" class="btn btn-primary">Search</button>
            </form>

            <div class="table-responsive" style="margin-top:15px;">
                <table class="table table-condensed">
                    <thead>
                        <tr><th>Number</th><th>Country</th><th>Type</th><th>Monthly</th><th></th></tr>
                    </thead>
                    <tbody id="ps-number-results"></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="panel panel-default">
        <div class="panel-heading">Your numbers</div>
        <div class="table-responsive">
            <table class="table table-striped">
                <thead>
                    <tr>
                        <th>Number</th>
                        <th>Country</th>
                        <th>Type</th>
                        <th>Status</th>
                        <th>Monthly</th>
                        <th>Renews</th>
                        <th class="text-right">Actions</th>
                    </tr>
                </thead>
                <tbody>
                <?php foreach ($numbers as $number) : ?>
                    <tr>
                        <td><strong><?php echo $e($number['number']); ?></strong></td>
                        <td><?php echo $e($number['country']); ?></td>
                        <td><?php echo $e($number['type']); ?></td>
                        <td>
                            <span class="label label-<?php echo $e($labelFor((string) $number['status'])); ?>">
                                <?php echo $e($number['status']); ?>
                            </span>
                        </td>
                        <td><?php echo $money($number['monthly_cost'] ?? 0); ?></td>
                        <td><?php echo $e($number['next_renewal'] ?: '—'); ?></td>
                        <td class="text-right">
                            <?php if ($number['status'] === 'active') : ?>
                                <button class="btn btn-xs btn-default" data-number-action="renew"
                                        data-number-id="<?php echo (int) $number['id']; ?>">Renew</button>
                                <button class="btn btn-xs btn-warning" data-number-action="suspend"
                                        data-number-id="<?php echo (int) $number['id']; ?>">Suspend</button>
                            <?php elseif ($number['status'] === 'suspended') : ?>
                                <button class="btn btn-xs btn-success" data-number-action="activate"
                                        data-number-id="<?php echo (int) $number['id']; ?>">Reactivate</button>
                            <?php endif; ?>
                            <?php if ($number['status'] !== 'released') : ?>
                                <button class="btn btn-xs btn-danger" data-number-action="release"
                                        data-number-id="<?php echo (int) $number['id']; ?>">Release</button>
                            <?php endif; ?>
                        </td>
                    </tr>
                <?php endforeach; ?>
                <?php if (!$numbers) : ?>
                    <tr><td colspan="7" class="text-center ps-muted">You don't own any numbers yet.</td></tr>
                <?php endif; ?>
                </tbody>
            </table>
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
