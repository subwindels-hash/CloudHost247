<?php
/** Verify the PHP tool hub only links to an explicitly configured Node mount. */
require dirname(__DIR__, 2) . '/tools/lib/bootstrap.php';
use CloudHost247\Tools\Catalog;
use CloudHost247\Tools\View;
function expectTrace($condition, $message) { if (!$condition) { fwrite(STDERR, "FAIL: $message\n"); exit(1); } }
$hub = Catalog::resolve('/tools');
$email = Catalog::resolve('/tools/category/email');
$security = Catalog::resolve('/tools/category/security');
expectTrace(strpos(View::fragment($hub, '', ''), 'data-tool-slug="email-trace"') === false, 'no unconfigured link');
expectTrace(strpos(View::fragment($hub, '', '/whmcs', '/platform'), '/whmcs/platform/account/email-trace') !== false, 'configured link');
expectTrace(strpos(View::fragment($hub, '', '/whmcs', '/platform'), '/whmcs/platform/account/email-forensics') !== false, 'configured forensics link');
expectTrace(strpos(View::fragment($email, 'forensics', '', '/platform'), 'Email Trace &amp; Forensics Analyzer') !== false, 'forensics search');
expectTrace(strpos(View::fragment($hub, '', ''), 'data-tool-slug="email-forensics"') === false, 'no unconfigured forensics link');
expectTrace(strpos(View::fragment($email, 'trace', '', '/platform'), 'Email Trace') !== false, 'email category search');
expectTrace(strpos(View::fragment($security, '', '', '/platform'), 'data-tool-slug="email-trace"') === false, 'unrelated category');
expectTrace(strpos(View::fragment($hub, 'no-such-tool', '', '/platform'), 'data-tool-slug="email-trace"') === false, 'unrelated search');
expectTrace(strpos(View::fragment($hub, '', '', '//evil.example'), 'data-tool-slug="email-trace"') === false, 'unsafe mount rejected');
echo "Email Trace discovery OK\n";
