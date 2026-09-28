<?php
/**
 * Admin > Providers (connectivity / health)
 *
 * @var array  $vars
 * @var array  $notice     ['type','message']|null
 * @var array  $providers  [['id','label','capabilities','configured','reachable','error'], ...]
 * @var string $csrf
 */

$moduleLink = htmlspecialchars((string) ($vars['modulelink'] ?? ''), ENT_QUOTES, 'UTF-8');
$e = static function ($value): string {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
?>
<div class="phoneservices-admin phoneservices-providers">

    <div class="ps-page-head">
        <h2>Providers</h2>
        <p class="ps-muted">Live connectivity status for every registered integration.</p>
    </div>

    <?php if (!empty($notice)) : ?>
        <div class="alert alert-<?php echo $e($notice['type']); ?>"><?php echo $e($notice['message']); ?></div>
    <?php endif; ?>

    <div class="table-responsive">
        <table class="table table-striped table-bordered">
            <thead>
                <tr>
                    <th>Provider</th>
                    <th>Capabilities</th>
                    <th>Credentials</th>
                    <th>Connectivity</th>
                    <th>Last error</th>
                    <th class="text-right">Actions</th>
                </tr>
            </thead>
            <tbody>
            <?php foreach ($providers as $provider) : ?>
                <tr>
                    <td>
                        <strong><?php echo $e($provider['label']); ?></strong>
                        <div class="ps-muted"><code><?php echo $e($provider['id']); ?></code></div>
                    </td>
                    <td>
                        <?php foreach ((array) $provider['capabilities'] as $capability) : ?>
                            <span class="label label-info"><?php echo $e($capability); ?></span>
                        <?php endforeach; ?>
                    </td>
                    <td>
                        <?php if (!empty($provider['configured'])) : ?>
                            <span class="label label-success">Configured</span>
                        <?php else : ?>
                            <span class="label label-default">Missing</span>
                        <?php endif; ?>
                    </td>
                    <td>
                        <?php if (!empty($provider['reachable'])) : ?>
                            <span class="label label-success">Reachable</span>
                        <?php elseif (!empty($provider['configured'])) : ?>
                            <span class="label label-danger">Unreachable</span>
                        <?php else : ?>
                            <span class="ps-muted">&mdash;</span>
                        <?php endif; ?>
                    </td>
                    <td class="ps-error-cell"><?php echo $provider['error'] ? $e($provider['error']) : '<span class="ps-muted">None</span>'; ?></td>
                    <td class="text-right">
                        <form method="post" action="<?php echo $moduleLink; ?>&amp;action=providers" class="ps-inline-form">
                            <?php echo $csrf; ?>
                            <input type="hidden" name="provider" value="<?php echo $e($provider['id']); ?>">
                            <button type="submit" class="btn btn-xs btn-default">Test connection</button>
                        </form>
                        <a class="btn btn-xs btn-primary" href="<?php echo $moduleLink; ?>&amp;action=api_config#ps-<?php echo $e($provider['id']); ?>">Credentials</a>
                    </td>
                </tr>
            <?php endforeach; ?>
            <?php if (!$providers) : ?>
                <tr><td colspan="6" class="text-center ps-muted">No providers registered.</td></tr>
            <?php endif; ?>
            </tbody>
        </table>
    </div>
</div>
