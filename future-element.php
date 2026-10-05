<?php
/**
 * Legacy URL kept alive as a permanent redirect so bookmarks and search
 * results land somewhere professional instead of a dead page.
 * Style-sheet sample page.
 */

declare(strict_types=1);

header('Location: index.php', true, 301);
header('Cache-Control: public, max-age=86400');
?>
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Redirecting… | CloudHost247</title>
  <meta http-equiv="refresh" content="0; url=index.php">
  <meta name="robots" content="noindex">
</head>
<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:60vh;margin:0">
  <p>You are being redirected to <a href="index.php">index.php</a>.</p>
</body>
</html>
