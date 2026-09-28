<?php
/**
 * Admin > Virtual numbers
 *
 * @var array  $vars
 * @var array  $notice  ['type','message']|null
 * @var array  $numbers
 * @var array  $filters ['status','country','search']
 * @var string $csrf
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) ($value ?? ''), ENT_QUOTES, 'UTF-8');
};
$statusClass = [
    'active'    => 'success',
    'pending'   => 'warning',
    'suspended' => 'warning',
    'released'  => 'danger',
    'expired'   => 'default',
];

/** Render a CSRF-protected lifecycle button. */
$action = static function (int $id, string $operation, string $label, string $style) use ($moduleLink, $csrf, $e): string {
    $confirm = $operation === 'release'
        ? ' onsubmit="return confirm(\'Releasing this number is permanent. Continue?\');"'
        : '';

    return '<form method="post" action="' . $moduleLink . '&amp;action=numbers" class="ps-inline-form"' . $confirm . '>'
        . $csrf
        . '<input type="hidden" name="number_id" value="' . $id . '">'
        . '<input type="hidden" name="operation" value="' . $e($operation) . '">'
        . '<button type="submit" class="btn btn-xs btn-' . $e($style) . '">' . $e($label) . '</button>'
        . '</form>';
};
?>
<div class="phoneservices-admin phoneservices-numbers">

    <div class="ps-page-head">
        <h2>Virtual numbers</h2>
        <p class="ps-muted">Every number provisioned through the platform, across all clients.</p>
    </div>

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <form method="get" action="<?php echo $moduleLink; ?>" class="form-inline ps-filter-bar">
        <input type="hidden" name="module" value="phoneservices">
        <input type="hidden" name="action" value="numbers">
        <div class="form-group">
            <select name="status" class="form-control">
                <?php foreach (['' => 'Any status', 'active' => 'Active', 'pending' => 'Pending',
                                 'suspended' => 'Suspended', 'released' => 'Released', 'expired' => 'Expired'] as $value => $label) : ?>
                    <option value="<?php echo $e($value); ?>" <?php echo ($filters['status'] ?? '') === $value ? 'selected' : ''; ?>>
                        <?php echo $e($label); ?>
                    </option>
                <?php endforeach; ?>
            </select>
        </div>
        <div class="form-group">
            <input type="text" name="country" class="form-control" maxlength="2" size="4"
                   placeholder="CC" value="<?php echo $e($filters['country'] ?? ''); ?>">
        </div>
        <div class="form-group">
            <input type="text" name="q" class="form-control" placeholder="Number contains…"
                   value="<?php echo $e($filters['search'] ?? ''); ?>">
        </div>
        <button type="submit" class="btn btn-default">Filter</button>
        <a href="<?php echo $moduleLink; ?>&amp;action=numbers" class="btn btn-link">Reset</a>
    </form>

    <div class="table-responsive">
        <table class="table table-striped table-condensed">
            <thead>
                <tr>
                    <th>ID</th>
                    <th>Number</th>
                    <th>Client</th>
                    <th>Country</th>
                    <th>Type</th>
                    <th>Provider</th>
                    <th>Status</th>
                    <th>Renews</th>
                    <th class="text-right">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($numbers as $number) : ?>
                <tr>
                    <td>#<?php echo (int) $number['id']; ?></td>
                    <td><strong><?php echo $e($number['number']); ?></strong></td>
                    <td>
                        <?php if (!empty($number['user_id'])) : ?>
                            <a href="clientssummary.php?userid=<?php echo (int) $number['user_id']; ?>">#<?php echo (int) $number['user_id']; ?></a>
                        <?php else : ?>
                            <span class="ps-muted">Unassigned</span>
                        <?php endif; ?>
                    </td>
                    <td><?php echo $e($number['country']); ?></td>
                    <td><?php echo $e(ucfirst((string) $number['type'])); ?></td>
                    <td><?php echo $e(ucfirst((string) $number['provider'])); ?></td>
                    <td>
                        <span class="label label-<?php echo $e($statusClass[$number['status']] ?? 'default'); ?>">
                            <?php echo $e(ucfirst((string) $number['status'])); ?>
                        </span>
                    </td>
                    <td><?php echo $e($number['next_renewal'] ? date('Y-m-d', strtotime((string) $number['next_renewal'])) : '—'); ?></td>
                    <td class="text-right">
                        <?php
                        $id = (int) $number['id'];

                        if ($number['status'] === 'active') {
                            echo $action($id, 'renew', 'Renew', 'default');
                            echo $action($id, 'suspend', 'Suspend', 'warning');
                        } elseif ($number['status'] === 'suspended') {
                            echo $action($id, 'activate', 'Activate', 'success');
                        }

                        if ($number['status'] !== 'released') {
                            echo $action($id, 'release', 'Release', 'danger');
                        }
                        ?>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$numbers) : ?>
                <tr><td colspan="9" class="text-center ps-muted">No numbers match the current filters.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
