<?php
/**
 * CloudHost247 Module Manager behavioural tests.
 *
 * These exercise the real pipeline — upload validation, archive inspection,
 * secure extraction, installation, rollback, health verification, uninstall
 * and the admin controller — against real ZIP archives on a temporary
 * application root. WHMCS is replaced by the doubles in fakes.php; none of the
 * security logic under test is stubbed.
 */
$root = dirname(__DIR__, 2);
$base = $root . '/modules/addons/cloudhost247_modules/lib/';
foreach (array(
    'Support/ModuleException', 'Support/Version', 'Support/ModuleType', 'Support/Paths', 'Support/Checksum',
    'Manifest/Manifest',
    'Package/PackageInspection', 'Package/ArchiveInspector', 'Package/SecureExtractor',
    'Package/PackageStorage', 'Package/UploadReceiver',
    'Registry/ModuleRegistry', 'Registry/CompatibilityChecker', 'Registry/DependencyResolver',
    'Install/InstallationPlan', 'Install/InstallationTransaction', 'Install/Installer',
) as $file) {
    require_once $base . $file . '.php';
}
require_once __DIR__ . '/fakes.php';
require_once $base . 'Registry/ModuleRepository.php';
require_once $base . 'Security/CapabilityPolicy.php';
require_once $base . 'Services/ModuleManager.php';
require_once $base . 'Services/AdminView.php';
require_once $base . 'Services/AdminController.php';

use CloudHost247\Foundation\Security\AdminGuard;
use CloudHost247\Foundation\Support\AuditLogger;
use CloudHost247\ModuleManager\Install\InstallationPlan;
use CloudHost247\ModuleManager\Install\Installer;
use CloudHost247\ModuleManager\Manifest\Manifest;
use CloudHost247\ModuleManager\Package\ArchiveInspector;
use CloudHost247\ModuleManager\Package\PackageInspection;
use CloudHost247\ModuleManager\Package\PackageStorage;
use CloudHost247\ModuleManager\Package\SecureExtractor;
use CloudHost247\ModuleManager\Package\UploadReceiver;
use CloudHost247\ModuleManager\Registry\CompatibilityChecker;
use CloudHost247\ModuleManager\Registry\DependencyResolver;
use CloudHost247\ModuleManager\Registry\ModuleRepository;
use CloudHost247\ModuleManager\Security\CapabilityPolicy;
use CloudHost247\ModuleManager\Services\AdminController;
use CloudHost247\ModuleManager\Services\AdminView;
use CloudHost247\ModuleManager\Services\ModuleManager;
use CloudHost247\ModuleManager\Support\Checksum;
use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\ModuleType;
use CloudHost247\ModuleManager\Support\Paths;
use CloudHost247\ModuleManager\Support\Version;
use CloudHost247\ModuleManager\Tests\ArrayRegistry;

$tests = array();
$check = function ($name, $value) use (&$tests) { $tests[$name] = (bool) $value; };
$rejects = function (callable $operation, $reason = null) {
    try {
        $operation();
        return false;
    } catch (ModuleException $failure) {
        return $reason === null ? true : $failure->reason() === $reason;
    } catch (Throwable $other) {
        return false;
    }
};

/* --------------------------------------------------------------- scaffold */

$workspace = sys_get_temp_dir() . '/ch247-modules-' . getmypid() . '-' . bin2hex(random_bytes(4));
$appRoot = $workspace . '/docroot';
$storageRoot = $workspace . '/storage';
$archives = $workspace . '/archives';
foreach (array($appRoot . '/modules/addons', $appRoot . '/modules/servers', $storageRoot, $archives) as $directory) {
    mkdir($directory, 0755, true);
}
Paths::overrideApplicationRoot($appRoot);
mkdir($appRoot . '/modules/addons/cloudhost247_core', 0755, true);
file_put_contents(
    $appRoot . '/modules/addons/cloudhost247_core/cloudhost247_core.php',
    "<?php\nfunction cloudhost247_core_config(){return array('name'=>'Core','version'=>'1.2.0');}\n",
    LOCK_EX
);
$storage = new PackageStorage($storageRoot, 'test');
$inspector = new ArchiveInspector();

$manifestFor = function (array $overrides = array()) {
    return array_merge(array(
        'id' => 'demo_module',
        'name' => 'Demo Module',
        'version' => '1.0.0',
        'description' => 'A demonstration module used by the Module Manager test suite.',
        'author' => 'CloudHost247',
        'license' => 'Proprietary',
        'type' => 'addon',
        'entry_point' => 'demo_module.php',
        'min_php_version' => '7.4',
        'permissions' => array('products.read', 'services.provision'),
        'migrations' => array('required' => true, 'tables' => array('mod_demo_items')),
        'configuration' => array('required' => true, 'fields' => array(
            array('key' => 'timeout', 'label' => 'Request timeout', 'type' => 'number', 'required' => true, 'help' => 'Seconds'),
        )),
        'integrations' => array('providers' => array('demo_api')),
    ), $overrides);
};

/**
 * Build a real ZIP. $files maps archive entry name => contents.
 * $modes maps entry name => unix mode, for symlink and permission fixtures.
 */
$makeZip = function ($name, array $files, array $modes = array()) use ($archives) {
    $path = $archives . '/' . $name;
    @unlink($path);
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE) !== true) { throw new RuntimeException('cannot create fixture'); }
    foreach ($files as $entry => $contents) { $zip->addFromString($entry, $contents); }
    foreach ($modes as $entry => $mode) { $zip->setExternalAttributesName($entry, ZipArchive::OPSYS_UNIX, $mode << 16); }
    $zip->close();
    return $path;
};

$packageFiles = function (array $manifest, array $extra = array(), $prefix = 'demo_module/') {
    $files = array(
        $prefix . 'module.json' => json_encode($manifest, JSON_PRETTY_PRINT),
        $prefix . 'demo_module.php' => "<?php\n// Demo module entry point v" . $manifest['version'] . "\n",
        $prefix . 'lib/Service.php' => "<?php\nnamespace Demo;\nclass Service {}\n",
        $prefix . 'templates/view.tpl' => "<p>demo</p>\n",
        $prefix . 'README.md' => "# Demo Module\n",
    );
    foreach ($extra as $entry => $contents) { $files[$prefix . $entry] = $contents; }
    return $files;
};

/* ------------------------------------------------------------- versioning */

$check('version comparison orders releases', Version::compare('1.2.0', '1.10.0') < 0 && Version::compare('2.0', '1.9.9') > 0 && Version::compare('1.0.0', '1.0') === 0);
$check('version range accepts an inclusive minimum', Version::satisfies('7.4.33', '7.4', ''));
$check('version range rejects below the minimum', !Version::satisfies('7.3.2', '7.4', ''));
$check('version range rejects above the maximum', !Version::satisfies('8.3.1', '7.4', '8.2.99'));
$check('version validation rejects injected text', !Version::isValid('1.0.0; rm -rf /') && !Version::isValid('') && Version::isValid('1.4.2-beta.1'));
$check('version change is described for the preview', Version::describeChange('1.0.0', '1.1.0') === 'upgrade' && Version::describeChange('1.1.0', '1.0.0') === 'downgrade' && Version::describeChange('1.0.0', '1.0.0') === 'reinstall');

/* ----------------------------------------------------------------- paths */

$check('containment rejects parent traversal', Paths::containedPath($appRoot, '../evil.php') === false);
$check('containment rejects absolute paths', Paths::containedPath($appRoot, '/etc/passwd') === false);
$check('containment rejects windows drive paths', Paths::containedPath($appRoot, 'C:/windows/system32') === false);
$check('containment rejects backslash traversal', Paths::containedPath($appRoot, '..\\..\\evil.php') === false);
$check('containment rejects null bytes', Paths::containedPath($appRoot, "safe.php\0.txt") === false);
$check('containment rejects empty and dot-only paths', Paths::containedPath($appRoot, '') === false && Paths::containedPath($appRoot, './') === false);
$check('containment accepts a nested module file', Paths::containedPath($appRoot, 'lib/Support/Thing.php') === $appRoot . '/lib/Support/Thing.php');
$check('module ids are strictly validated', Paths::isValidModuleId('demo_module') && !Paths::isValidModuleId('Demo') && !Paths::isValidModuleId('../x') && !Paths::isValidModuleId('ab'));
$check('platform module ids are reserved', !Paths::isValidModuleId('cloudhost247_core') && !Paths::isValidModuleId('cloudhost247_modules') && Paths::isReserved('vendor'));
$check('tree removal refuses to act outside its boundary', Paths::removeTree($appRoot, $appRoot . '/modules') === false && is_dir($appRoot));

/* ------------------------------------------------------------ module types */

$check('module types are a closed allowlist', ModuleType::isSupported('addon') && ModuleType::isSupported('server') && !ModuleType::isSupported('cron') && !ModuleType::isSupported('../../includes'));
$check('module type resolves the install directory', ModuleType::directory('server') === 'modules/servers' && ModuleType::directory('gateway') === 'modules/gateways');
$check('module destination is derived, never taken from the archive', Paths::moduleDirectory('addon', 'demo_module') === $appRoot . '/modules/addons/demo_module');

/* ---------------------------------------------------------------- checksum */

$sample = $archives . '/sample.bin';
file_put_contents($sample, 'module package bytes');
$check('checksums are sha-256 of the real bytes', Checksum::ofFile($sample) === hash('sha256', 'module package bytes'));
$check('checksum comparison is constant time and strict', Checksum::matches(Checksum::ofString('a'), Checksum::ofString('a')) && !Checksum::matches(Checksum::ofString('a'), Checksum::ofString('b')));
$check('checksum shortening keeps a recognisable prefix', strlen(Checksum::short(Checksum::ofString('a'))) <= 20);

/* ---------------------------------------------------------------- manifest */

$manifest = Manifest::fromArray($manifestFor());
$check('manifest exposes identity and entry point', $manifest->id() === 'demo_module' && $manifest->version() === '1.0.0' && $manifest->entryPoint() === 'demo_module.php');
$check('manifest resolves its install directory from the declared type', $manifest->relativeDirectory() === 'modules/addons/demo_module');
$check('manifest reports declared database tables', $manifest->hasMigrations() && $manifest->declaredTables() === array('mod_demo_items'));
$check('manifest reports configuration requirements', $manifest->requiresConfiguration() && count($manifest->configuration()['fields']) === 1);
$check('manifest reports declared integrations', $manifest->integrationProviders() === array('demo_api'));
$check('manifest round-trips through json', Manifest::decode($manifest->toJson())->version() === '1.0.0');
$check('manifest rejects a missing id', $rejects(function () use ($manifestFor) { Manifest::fromArray(array_diff_key($manifestFor(), array('id' => 1))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects an unsupported module type', $rejects(function () use ($manifestFor) { Manifest::fromArray($manifestFor(array('type' => 'cron'))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects an invalid version', $rejects(function () use ($manifestFor) { Manifest::fromArray($manifestFor(array('version' => 'latest'))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects a traversing entry point', $rejects(function () use ($manifestFor) { Manifest::fromArray($manifestFor(array('entry_point' => '../../configuration.php'))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects an absolute entry point', $rejects(function () use ($manifestFor) { Manifest::fromArray($manifestFor(array('entry_point' => '/var/www/x.php'))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects a reserved module id', $rejects(function () use ($manifestFor) { Manifest::fromArray($manifestFor(array('id' => 'cloudhost247_core'))); }, ModuleException::REASON_MANIFEST));
$check('manifest rejects secret configuration fields', $rejects(function () use ($manifestFor) {
    Manifest::fromArray($manifestFor(array('configuration' => array('fields' => array(array('key' => 'api_key', 'label' => 'API key', 'secret' => true))))));
}, ModuleException::REASON_MANIFEST));
$check('manifest rejects database tables outside the module namespace', $rejects(function () use ($manifestFor) {
    Manifest::fromArray($manifestFor(array('migrations' => array('required' => true, 'tables' => array('tblclients')))));
}, ModuleException::REASON_MANIFEST));
$check('manifest rejects malformed json', $rejects(function () { Manifest::decode('{"id":'); }, ModuleException::REASON_MANIFEST));
$check('manifest records unknown keys instead of trusting them', Manifest::fromArray($manifestFor(array('post_install_script' => 'evil.php')))->unknownKeys() === array('post_install_script'));
$check('manifest parses dependency shorthand', (function () use ($manifestFor) {
    $parsed = Manifest::fromArray($manifestFor(array('dependencies' => array('cloudhost247_core' => '>=1.1.0'))))->dependencies();
    return isset($parsed['cloudhost247_core']) && $parsed['cloudhost247_core']['min_version'] === '1.1.0';
})());
$check('manifest survives a registry round trip without losing constraints', (function () use ($manifestFor) {
    $original = Manifest::fromArray($manifestFor(array(
        'dependencies' => array('cloudhost247_core' => '>=1.1.0', 'optional_helper' => array('min_version' => '2.0.0', 'max_version' => '3.0.0', 'optional' => true)),
        'configuration' => array('fields' => array(array('key' => 'timeout', 'type' => 'number', 'required' => true))),
        'integrations' => array('providers' => array('demo_provider')),
    )));
    // ModuleRepository::manifest() rebuilds stored manifests through fromArray(toArray()).
    $restored = Manifest::fromArray($original->toArray());
    $dependencies = $restored->dependencies();
    return $dependencies == $original->dependencies()
        && $dependencies['cloudhost247_core']['min_version'] === '1.1.0'
        && $dependencies['optional_helper']['max_version'] === '3.0.0'
        && $dependencies['optional_helper']['optional'] === true
        && $restored->unknownKeys() === array()
        && $restored->toArray() == $original->toArray();
})());
$check('manifest accepts a plain list of dependency ids', (function () use ($manifestFor) {
    $parsed = Manifest::fromArray($manifestFor(array('dependencies' => array('cloudhost247_core'))))->dependencies();
    return isset($parsed['cloudhost247_core'])
        && $parsed['cloudhost247_core']['min_version'] === ''
        && $parsed['cloudhost247_core']['optional'] === false;
})());

/* ------------------------------------------------------------ upload guard */

putenv('CH247_MODULE_MAX_UPLOAD_BYTES=');
$goodZip = $makeZip('demo-1.0.0.zip', $packageFiles($manifestFor()));
$receiver = new UploadReceiver(function ($path) { return is_file($path); });
$upload = function ($path, $name = 'demo.zip', $error = UPLOAD_ERR_OK) {
    return array('name' => $name, 'tmp_name' => $path, 'error' => $error, 'size' => is_file($path) ? filesize($path) : 0);
};
$received = $receiver->receive($upload($goodZip));
$check('upload returns a sanitized name, size and checksum', $received['name'] === 'demo.zip' && $received['checksum'] === Checksum::ofFile($goodZip) && $received['bytes'] > 0);
$check('upload rejects a non-zip extension', $rejects(function () use ($receiver, $upload, $goodZip) { $receiver->receive($upload($goodZip, 'payload.php')); }, ModuleException::REASON_UPLOAD));
$check('upload rejects a double extension', $rejects(function () use ($receiver, $upload, $goodZip) { $receiver->receive($upload($goodZip, 'payload.zip.php')); }, ModuleException::REASON_UPLOAD));
$check('upload rejects php upload errors', $rejects(function () use ($receiver, $upload, $goodZip) { $receiver->receive($upload($goodZip, 'demo.zip', UPLOAD_ERR_INI_SIZE)); }, ModuleException::REASON_UPLOAD));
$check('upload rejects a missing file', $rejects(function () use ($receiver) { $receiver->receive(null); }, ModuleException::REASON_UPLOAD));
$check('upload rejects a path that is not a genuine upload', $rejects(function () use ($upload, $goodZip) {
    (new UploadReceiver(function ($path) { return false; }))->receive($upload($goodZip));
}, ModuleException::REASON_UPLOAD));
$notZip = $archives . '/fake.zip';
file_put_contents($notZip, "<?php system(\$_GET['c']); // " . str_repeat('x', 200));
$check('upload rejects a php payload renamed to .zip', $rejects(function () use ($receiver, $upload, $notZip) { $receiver->receive($upload($notZip)); }, ModuleException::REASON_UPLOAD));
$tiny = $archives . '/tiny.zip';
file_put_contents($tiny, 'PK');
$check('upload rejects a file that is too small', $rejects(function () use ($receiver, $upload, $tiny) { $receiver->receive($upload($tiny)); }, ModuleException::REASON_UPLOAD));
putenv('CH247_MODULE_MAX_UPLOAD_BYTES=65536');
$check('upload size limit is configurable by deployment', UploadReceiver::maxBytes() === 65536);
putenv('CH247_MODULE_MAX_UPLOAD_BYTES=1');
$check('upload size limit ignores unusable configuration', UploadReceiver::maxBytes() === UploadReceiver::DEFAULT_MAX_BYTES);
putenv('CH247_MODULE_MAX_UPLOAD_BYTES=');

/* --------------------------------------------------------- archive safety */

$inspection = $inspector->inspect($goodZip);
$check('inspection reads the manifest without extracting', $inspection->manifest()->id() === 'demo_module' && !is_dir($appRoot . '/modules/addons/demo_module'));
$check('inspection strips a single wrapper directory', $inspection->rootPrefix() === 'demo_module' && in_array('demo_module.php', $inspection->relativePaths(), true));
$check('inspection reports the real file count and size', $inspection->fileCount() === 5 && $inspection->totalBytes() > 0 && $inspection->has('lib/Service.php'));
$check('inspection exposes archive checksums for change detection', count($inspection->crcMap()) === 5);

$check('archive rejects parent traversal entries', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('traversal.zip', $packageFiles($manifestFor()) + array('demo_module/../../../evil.php' => '<?php')));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects absolute entries', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('absolute.zip', $packageFiles($manifestFor()) + array('/etc/cron.d/evil' => 'x')));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects symbolic links', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $files = $packageFiles($manifestFor()) + array('demo_module/link.php' => '../../../configuration.php');
    return $inspector->inspect($makeZip('symlink.zip', $files, array('demo_module/link.php' => 0120777)));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects setuid and setgid entries', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $files = $packageFiles($manifestFor());
    return $inspector->inspect($makeZip('setuid.zip', $files, array('demo_module/demo_module.php' => 04755 | 0100000)));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects entries marked executable', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $files = $packageFiles($manifestFor());
    return $inspector->inspect($makeZip('executable.zip', $files, array('demo_module/lib/Service.php' => 0100755)));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects shell scripts', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('shell.zip', $packageFiles($manifestFor(), array('install.sh' => "#!/bin/sh\n"))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects phar payloads', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('phar.zip', $packageFiles($manifestFor(), array('payload.phar' => 'x'))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects shared objects and binaries', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('binary.zip', $packageFiles($manifestFor(), array('lib/hook.so' => 'ELF'))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects server configuration overrides', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('htaccess.zip', $packageFiles($manifestFor(), array('.htaccess' => "php_value auto_prepend_file evil.php\n"))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects private key material', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('keys.zip', $packageFiles($manifestFor(), array('certs/server.key' => 'secret'))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects version control metadata', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('git.zip', $packageFiles($manifestFor(), array('.git/config' => "[core]\n"))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects a package without a manifest', $rejects(function () use ($inspector, $makeZip) {
    $inspector->inspect($makeZip('nomanifest.zip', array('demo_module/demo_module.php' => '<?php')));
}, ModuleException::REASON_MANIFEST));
$check('archive rejects a file that is not a zip', $rejects(function () use ($inspector, $notZip) { $inspector->inspect($notZip); }, ModuleException::REASON_ARCHIVE));
$check('archive rejects a highly compressed bomb entry', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('bomb.zip', $packageFiles($manifestFor(), array('data/filler.txt' => str_repeat("\0", 6 * 1024 * 1024)))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects excessively long paths', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('longpath.zip', $packageFiles($manifestFor(), array(str_repeat('a', 210) . '.php' => '<?php'))));
}, ModuleException::REASON_ARCHIVE));
$check('archive rejects deeply nested structures', $rejects(function () use ($inspector, $makeZip, $packageFiles, $manifestFor) {
    $inspector->inspect($makeZip('deep.zip', $packageFiles($manifestFor(), array(str_repeat('a/', 14) . 'x.php' => '<?php'))));
}, ModuleException::REASON_ARCHIVE));

/* -------------------------------------------------------- secure extractor */

$extractor = new SecureExtractor();
$scratch = $workspace . '/extract-demo';
$written = $extractor->extract($inspection, $scratch);
$check('extraction writes every inspected file', count($written) === 5 && is_file($scratch . '/demo_module.php') && is_file($scratch . '/lib/Service.php'));
$check('extraction records a sha-256 per installed file', $written[0]['sha256'] === hash_file('sha256', $scratch . '/' . $written[0]['path']));
$check('archive permission bits never reach the filesystem', (fileperms($scratch . '/demo_module.php') & 0777) === 0644);
$check('extraction never leaves the destination directory', !file_exists($workspace . '/evil.php') && !file_exists($appRoot . '/evil.php'));

$poisoned = new PackageInspection(array(
    'archive_path' => $inspection->archivePath(),
    'root_prefix' => $inspection->rootPrefix(),
    'entries' => array_merge($inspection->entries(), array(array(
        'name' => 'demo_module/demo_module.php', 'path' => 'demo_module/demo_module.php', 'directory' => false,
        'size' => 1, 'compressed' => 1, 'crc' => 0, 'relative' => '../../escaped.php',
    ))),
    'file_count' => 6,
    'total_bytes' => $inspection->totalBytes(),
    'manifest_json' => $inspection->manifestJson(),
    'manifest' => $inspection->manifest(),
));
$escapeTarget = $workspace . '/extract-poisoned';
$check('extraction re-checks containment for every entry', $rejects(function () use ($extractor, $poisoned, $escapeTarget) {
    $extractor->extract($poisoned, $escapeTarget);
}, ModuleException::REASON_ARCHIVE));
$check('a rejected extraction leaves nothing behind', !file_exists($workspace . '/escaped.php') && count(Paths::listFiles($escapeTarget)) === 0);

/* ------------------------------------------------------------ compatibility */

$strict = new CompatibilityChecker('7.4.33', '8.9.0', array('json', 'zip'));
$result = $strict->check(Manifest::fromArray($manifestFor(array('min_php_version' => '8.1'))));
$check('compatibility blocks an unsupported php version', !$result['compatible'] && count($result['checks']) >= 1);
$result = $strict->check(Manifest::fromArray($manifestFor(array('min_application_version' => '9.0'))));
$check('compatibility blocks an unsupported application version', !$result['compatible']);
$result = $strict->check(Manifest::fromArray($manifestFor(array('php_extensions' => array('imagick')))));
$check('compatibility blocks a missing php extension', !$result['compatible']);
$result = $strict->check(Manifest::fromArray($manifestFor(array('php_extensions' => array('zip')))));
$check('compatibility accepts a satisfied requirement', $result['compatible'] && $result['problems'] === array());
$result = (new CompatibilityChecker('7.4.33', '', array()))->check(Manifest::fromArray($manifestFor(array('min_application_version' => '8.0'))));
$check('an undetectable application version is reported, never silently passed', (function () use ($result) {
    if ($result['warnings'] === array()) { return false; }
    foreach ($result['checks'] as $row) {
        if ($row['name'] === 'Application version') { return $row['actual'] === 'not detected' && $row['ok'] === false; }
    }
    return false;
})());
$check('compatibility reads the live runtime by default', (new CompatibilityChecker())->phpVersion() === PHP_VERSION);

/* -------------------------------------------------------------- dependencies */

$installedIndex = array(
    'cloudhost247_core' => array('version' => '1.2.0', 'enabled' => true, 'name' => 'Core', 'dependencies' => array()),
    'legacy_widget' => array('version' => '0.9.0', 'enabled' => false, 'name' => 'Legacy', 'dependencies' => array()),
    'child_module' => array('version' => '1.0.0', 'enabled' => true, 'name' => 'Child', 'dependencies' => array(
        'demo_module' => array('id' => 'demo_module', 'min_version' => '1.0.0', 'max_version' => '', 'optional' => false),
    )),
);
$resolver = new DependencyResolver($installedIndex);
$check('dependency check passes when satisfied', $resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array('cloudhost247_core' => '>=1.1.0')))))['satisfied']);
$check('dependency check fails when missing', !$resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array('absent_module' => '>=1.0.0')))))['satisfied']);
$check('dependency check fails on a version that is too old', !$resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array('cloudhost247_core' => '>=2.0.0')))))['satisfied']);
$check('dependency check fails when the dependency is disabled', !$resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array('legacy_widget' => '>=0.9.0')))))['satisfied']);
$check('optional dependencies warn instead of blocking', (function () use ($resolver, $manifestFor) {
    $outcome = $resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array(
        array('id' => 'absent_module', 'min_version' => '1.0.0', 'optional' => true),
    )))));
    return $outcome['satisfied'] && $outcome['warnings'] !== array();
})());
$check('declared conflicts block installation', !$resolver->check(Manifest::fromArray($manifestFor(array('conflicts' => array('cloudhost247_core')))))['satisfied']);
$check('dependents are discovered for uninstall protection', (function () use ($resolver) {
    $dependents = $resolver->dependents('demo_module');
    return count($dependents) === 1 && $dependents[0]['id'] === 'child_module';
})());
$check('platform components can satisfy dependencies', (function () use ($manifestFor) {
    $resolver = new DependencyResolver(array(), array('cloudhost247_core' => array('version' => '1.2.0', 'enabled' => true, 'name' => 'Core', 'dependencies' => array())));
    return $resolver->check(Manifest::fromArray($manifestFor(array('dependencies' => array('cloudhost247_core' => '>=1.2.0')))))['satisfied'];
})());

/* ----------------------------------------------------------------- planning */

$registry = new ArrayRegistry();
$installer = new Installer($registry, $storage, $extractor, new CompatibilityChecker());
$checksum = Checksum::ofFile($goodZip);
$plan = $installer->plan($inspection, $checksum);
$check('a new module plans as a fresh install', $plan->action() === InstallationPlan::ACTION_INSTALL && $plan->isFreshInstall() && $plan->installable());
$check('the preview reports every decision field', (function () use ($plan) {
    $summary = $plan->summary();
    foreach (array('module', 'version', 'author', 'license', 'type', 'php', 'files', 'size', 'database_changes', 'configuration_required', 'permissions', 'checksum', 'install_path') as $field) {
        if (!array_key_exists($field, $summary)) { return false; }
    }
    return $summary['checksum'] === $plan->checksum() && $summary['database_changes'] === 'Yes' && $summary['configuration_required'] === 'Yes';
})());
$check('the preview warns that declared migrations run on activation', (bool) preg_grep('/database changes/i', $plan->warnings()));
$check('a package missing its declared entry point is blocked', (function () use ($installer, $inspector, $makeZip, $manifestFor, $packageFiles, $checksum) {
    $files = $packageFiles($manifestFor(array('entry_point' => 'missing.php')));
    $planned = $installer->plan($inspector->inspect($makeZip('noentry.zip', $files)), $checksum);
    return !$planned->installable() && (bool) preg_grep('/entry point/i', $planned->blockers());
})());

/* ------------------------------------------------------------- installation */

$installed = $installer->install($plan, 7);
$moduleDirectory = $appRoot . '/modules/addons/demo_module';
$check('installation writes the module inside its own directory only', $installed['files'] === 5 && is_file($moduleDirectory . '/demo_module.php') && is_file($moduleDirectory . '/lib/Service.php'));
$check('installation records the real version and checksum', (function () use ($registry, $checksum) {
    $row = $registry->find('demo_module');
    return $row && $row->version === '1.0.0' && $row->package_checksum === $checksum && (int) $row->file_count === 5;
})());
$check('an installed module is never enabled automatically', (int) $registry->find('demo_module')->enabled === 0);
$check('an installed module is not reported healthy until it is verified', $registry->find('demo_module')->health_status === 'unknown');
$check('installation stores a verifiable file manifest', (function () use ($registry, $moduleDirectory) {
    $files = $registry->files('demo_module');
    if (count($files) !== 5) { return false; }
    foreach ($files as $file) {
        if ($file->sha256 !== hash_file('sha256', $moduleDirectory . '/' . $file->relative_path)) { return false; }
    }
    return true;
})());
$check('a pre-installation backup is kept', is_dir($storageRoot . '/backups/' . $installed['backup']) && is_file($storageRoot . '/backups/' . $installed['backup'] . '/installation.json'));
$check('the backup snapshot names the installer, version and checksum', (function () use ($storageRoot, $installed, $checksum) {
    $snapshot = json_decode(file_get_contents($storageRoot . '/backups/' . $installed['backup'] . '/installation.json'), true);
    return $snapshot['admin_id'] === 7 && $snapshot['version_to'] === '1.0.0' && $snapshot['package_checksum'] === $checksum
        && $snapshot['declared_tables'] === array('mod_demo_items') && $snapshot['stage'] === 'committed';
})());

$health = $installer->health('demo_module');
$check('health verification re-hashes the installed files', $health['status'] === 'healthy' && $health['checked'] === 5);
file_put_contents($moduleDirectory . '/lib/Service.php', "<?php\n// tampered\n");
$check('health verification detects tampering', $installer->health('demo_module')['status'] === 'modified');
unlink($moduleDirectory . '/lib/Service.php');
$check('health verification detects deleted files', $installer->health('demo_module')['status'] === 'missing_files');
$check('health verification reports uninstalled modules honestly', $installer->health('never_installed')['status'] === 'not_installed');

/* ------------------------------------------------------------------ updates */

$updateZip = $makeZip('demo-1.1.0.zip', $packageFiles($manifestFor(array('version' => '1.1.0')), array('lib/Extra.php' => "<?php\n// added in 1.1.0\n")));
unset($files);
$updateInspection = $inspector->inspect($updateZip);
$updateChecksum = Checksum::ofFile($updateZip);
$updatePlan = $installer->plan($updateInspection, $updateChecksum);
$check('an existing module is detected and planned as an update', $updatePlan->action() === InstallationPlan::ACTION_UPDATE && !$updatePlan->isFreshInstall() && $updatePlan->existingVersion() === '1.0.0');
$check('the update preview lists new, replaced and unchanged files', (function () use ($updatePlan) {
    $files = $updatePlan->files();
    return in_array('lib/Extra.php', $files['new'], true) && in_array('demo_module.php', $files['replaced'], true) && $files['total'] === 6;
})());
$updateResult = $installer->install($updatePlan, 7);
$check('the update installs the new version and its new files', $updateResult['version'] === '1.1.0' && $updateResult['previous_version'] === '1.0.0' && is_file($moduleDirectory . '/lib/Extra.php'));
$check('the registry records the previous version after an update', $registry->find('demo_module')->previous_version === '1.0.0');
$check('files removed from the package are removed from disk', (function () use ($installer, $inspector, $makeZip, $manifestFor, $packageFiles, $moduleDirectory, $registry) {
    $files = $packageFiles($manifestFor(array('version' => '1.2.0')));
    unset($files['demo_module/README.md']);
    $trimmed = $inspector->inspect($makeZip('demo-1.2.0.zip', $files));
    $plan = $installer->plan($trimmed, Checksum::ofString('trim'));
    $orphaned = $plan->files()['orphaned'];
    $installer->install($plan, 7);
    return in_array('README.md', $orphaned, true) && !is_file($moduleDirectory . '/README.md') && $registry->find('demo_module')->version === '1.2.0';
})());

$downgradeZip = $makeZip('demo-0.9.0.zip', $packageFiles($manifestFor(array('version' => '0.9.0'))));
$downgradePlan = $installer->plan($inspector->inspect($downgradeZip), Checksum::ofFile($downgradeZip));
$check('an older package is detected as a downgrade', $downgradePlan->action() === InstallationPlan::ACTION_DOWNGRADE && $downgradePlan->requiresDowngradeConfirmation());
$check('a downgrade warns before it is allowed', (bool) preg_grep('/older than the installed version/i', $downgradePlan->warnings()));
$samePlan = $installer->plan($inspector->inspect($makeZip('demo-same.zip', $packageFiles($manifestFor(array('version' => '1.2.0'))))), Checksum::ofString('same'));
$check('an identical version is planned as a reinstall', $samePlan->action() === InstallationPlan::ACTION_REINSTALL && $samePlan->actionLabel() === 'Reinstall Module');
$check('changing the module type of an installed module is blocked', (function () use ($installer, $inspector, $makeZip, $packageFiles, $manifestFor) {
    $files = $packageFiles($manifestFor(array('version' => '1.3.0', 'type' => 'server')));
    $planned = $installer->plan($inspector->inspect($makeZip('demo-type.zip', $files)), Checksum::ofString('type'));
    return !$planned->installable() && (bool) preg_grep('/type/i', $planned->blockers());
})());

/* ----------------------------------------------------------------- rollback */

$beforeRollback = array();
foreach (Paths::listFiles($moduleDirectory) as $relative) {
    $beforeRollback[$relative] = hash_file('sha256', $moduleDirectory . '/' . $relative);
}
$brokenFiles = $packageFiles($manifestFor(array('version' => '2.0.0', 'health_check' => array('files' => array('lib/Required.php')))));
$brokenPlan = $installer->plan($inspector->inspect($makeZip('demo-2.0.0-broken.zip', $brokenFiles)), Checksum::ofString('broken'));
$rolledBack = false;
$rollbackMessage = '';
try {
    $installer->install($brokenPlan, 7);
} catch (ModuleException $failure) {
    $rolledBack = $failure->reason() === ModuleException::REASON_ROLLBACK;
    $rollbackMessage = $failure->getMessage();
}
$afterRollback = array();
foreach (Paths::listFiles($moduleDirectory) as $relative) {
    $afterRollback[$relative] = hash_file('sha256', $moduleDirectory . '/' . $relative);
}
$check('a failed installation rolls back', $rolledBack);
$check('rollback restores the previous version byte for byte', $beforeRollback === $afterRollback && $beforeRollback !== array());
$check('rollback keeps the registry on the working version', $registry->find('demo_module')->version === '1.2.0');
$check('the rollback message is admin-safe and explicit', strpos($rollbackMessage, 'rolled back') !== false && strpos($rollbackMessage, $workspace) === false);
$check('a failed first install leaves no module directory behind', (function () use ($registry, $storage, $extractor, $inspector, $makeZip, $packageFiles, $manifestFor, $appRoot) {
    $installer = new Installer($registry, $storage, $extractor, new CompatibilityChecker());
    $files = $packageFiles($manifestFor(array('id' => 'ghost_module', 'entry_point' => 'ghost_module.php', 'health_check' => array('files' => array('lib/Absent.php')))), array(), 'ghost_module/');
    $files['ghost_module/ghost_module.php'] = "<?php\n";
    unset($files['ghost_module/demo_module.php']);
    $plan = $installer->plan($inspector->inspect($makeZip('ghost.zip', $files)), Checksum::ofString('ghost'));
    try { $installer->install($plan, 7); } catch (ModuleException $failure) { /* expected */ }
    return !$registry->find('ghost_module') && count(Paths::listFiles($appRoot . '/modules/addons/ghost_module')) === 0;
})());

/* ------------------------------------------------------- enable and disable */

ModuleManager::useRepository($registry);
$registry->setEnabled('demo_module', true, 7);
$check('enabling a module updates real state', (int) $registry->find('demo_module')->enabled === 1);
$check('the platform reports a module as enabled only when its files exist', ModuleManager::isEnabled('demo_module'));
$check('a module with no installation record is never reported as enabled', !ModuleManager::isEnabled('absent_module'));
$check('module code can assert it is enabled before running', (function () {
    try { ModuleManager::assertEnabled('absent_module'); return false; } catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_STATE; }
})());

$childManifest = Manifest::fromArray($manifestFor(array(
    'id' => 'child_module', 'name' => 'Child Module', 'version' => '1.0.0', 'entry_point' => 'child_module.php',
    'dependencies' => array('demo_module' => '>=1.0.0'), 'migrations' => array(), 'configuration' => array(), 'integrations' => array(),
)));
mkdir($appRoot . '/modules/addons/child_module', 0755, true);
file_put_contents($appRoot . '/modules/addons/child_module/child_module.php', "<?php\n// child\n");
$registry->recordInstallation($childManifest, array('checksum' => str_repeat('c', 64), 'file_count' => 1, 'bytes' => 10), 7);
$registry->replaceFileManifest('child_module', array(array(
    'path' => 'child_module.php',
    'sha256' => hash_file('sha256', $appRoot . '/modules/addons/child_module/child_module.php'),
    'bytes' => filesize($appRoot . '/modules/addons/child_module/child_module.php'),
)));
$registry->setEnabled('child_module', true, 7);
$check('disabling a module that others depend on is blocked', (function () use ($installer) {
    try { $installer->assertCanDisable('demo_module'); return false; }
    catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_DEPENDENCY; }
})());
$check('uninstalling a module that others depend on is blocked', (function () use ($installer) {
    try { $installer->uninstall('demo_module', 7); return false; }
    catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_DEPENDENCY; }
})());
$registry->setEnabled('child_module', false, 7);
$check('disabling is allowed once no enabled module depends on it', $installer->assertCanDisable('demo_module') === true);
$registry->setEnabled('demo_module', false, 7);
$check('enabling is blocked while a dependency is disabled', (function () use ($installer) {
    try { $installer->assertCanEnable('child_module'); return false; }
    catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_DEPENDENCY; }
})());
$check('enabling is blocked when the installed files are gone', (function () use ($installer, $registry, $appRoot) {
    $registry->replaceFileManifest('child_module', array(array('path' => 'absent.php', 'sha256' => str_repeat('0', 64), 'bytes' => 1)));
    $registry->setEnabled('demo_module', true, 7);
    try { $installer->assertCanEnable('child_module'); return false; }
    catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_STATE; }
})());
$registry->replaceFileManifest('child_module', array(array(
    'path' => 'child_module.php',
    'sha256' => hash_file('sha256', $appRoot . '/modules/addons/child_module/child_module.php'),
    'bytes' => filesize($appRoot . '/modules/addons/child_module/child_module.php'),
)));
$registry->setEnabled('demo_module', true, 7);
$check('enabling is allowed once dependencies are installed and enabled', $installer->assertCanEnable('child_module') === true);
$check('disabling deletes no files and no data', count(Paths::listFiles($moduleDirectory)) === 4 && $registry->find('demo_module') !== null);

/* ---------------------------------------------------------------- uninstall */

$registry->forget('child_module');
$impact = $installer->uninstallImpact('demo_module');
$check('uninstall impact lists the files that will be removed', $impact['file_count'] === 4 && $impact['directory'] === 'modules/addons/demo_module');
$check('uninstall impact lists database tables without dropping them', $impact['tables'] === array('mod_demo_items'));
$check('uninstall impact lists declared api integrations', $impact['integrations'] === array('demo_api'));
$check('uninstall impact reports whether the module is live', $impact['enabled'] === true && $impact['dependents'] === array());
file_put_contents($moduleDirectory . '/local-notes.txt', 'operator data');
$uninstalled = $installer->uninstall('demo_module', 7);
$check('uninstall removes only the files it installed', $uninstalled['removed'] === 4 && is_file($moduleDirectory . '/local-notes.txt'));
$check('uninstall never drops database tables', $uninstalled['retained_tables'] === array('mod_demo_items'));
$check('uninstall clears the registry entry and file manifest', $registry->find('demo_module') === null && $registry->files('demo_module') === array());
$check('uninstall refuses unknown modules', (function () use ($installer) {
    try { $installer->uninstall('absent_module', 7); return false; }
    catch (ModuleException $failure) { return $failure->reason() === ModuleException::REASON_STATE; }
})());
Paths::removeTree($moduleDirectory, $appRoot);

/* --------------------------------------------------------- package storage */

$check('storage keeps packages and backups outside the web root by default', $storage->available() && strpos($storage->packagesDirectory(), $storageRoot) === 0);
$check('storage denies web access to its directories', is_file($storageRoot . '/packages/.htaccess') && strpos(file_get_contents($storageRoot . '/packages/.htaccess'), 'denied') !== false);
$copy = $archives . '/to-store.zip';
copy($goodZip, $copy);
$stored = $storage->store($copy, $checksum);
$check('stored packages are named by checksum, never by client filename', basename($stored) === $checksum . '.zip' && $storage->packagePath($checksum) === $stored);
$check('storage rejects an invalid checksum reference', $rejects(function () use ($storage, $goodZip) { $storage->store($goodZip, 'not-a-checksum'); }));
$check('storage can delete a package on request', $storage->forget($checksum) && $storage->packagePath($checksum) === '');
$unavailable = new PackageStorage('', 'unset');
$check('storage reports unavailability instead of guessing a path', !$unavailable->available() && $unavailable->unavailableReason() !== '');

/* -------------------------------------------------------- capability policy */

$check('capability set covers every privileged action', CapabilityPolicy::keys() === array(
    'modules.view', 'modules.upload', 'modules.install', 'modules.update', 'modules.toggle', 'modules.uninstall', 'modules.configure',
));
$check('capability policy falls back to whmcs roles when the store is absent', CapabilityPolicy::allows('modules.install'));
$check('capability seeding is skipped safely without a database', CapabilityPolicy::seedDefaults()['available'] === false);
$check('capability seeding explains an unavailable policy store', strpos(CapabilityPolicy::describeSeeding(CapabilityPolicy::seedDefaults()), 'Foundation') !== false);

/* ------------------------------------------------------------- controller */

$controllerRegistry = new ArrayRegistry();
ModuleManager::useRepository($controllerRegistry);
$controllerStorage = new PackageStorage($workspace . '/controller-storage', 'test');
$controllerInstaller = new Installer($controllerRegistry, $controllerStorage, $extractor, new CompatibilityChecker());
$controller = new AdminController($controllerRegistry, $controllerInstaller, $controllerStorage, $inspector, $receiver);
$view = new AdminView('addonmodules.php?module=cloudhost247_modules');

$request = function (array $post = array(), array $files = array(), array $get = array()) {
    $_SERVER['REQUEST_METHOD'] = $post ? 'POST' : 'GET';
    $_SERVER['REMOTE_ADDR'] = '203.0.113.9';
    $_POST = $post;
    $_FILES = $files;
    $_GET = $get;
};

AdminGuard::reset();
AuditLogger::$records = array();
$request();
$dashboard = $controller->handle();
$check('the dashboard authenticates the administrator first', in_array('requireAdmin', AdminGuard::$calls, true) && in_array('require:modules.view', AdminGuard::$calls, true));
$check('the dashboard issues a csrf token for every form', $dashboard['token'] === 'test-csrf-token');
$check('the dashboard reports real runtime facts', $dashboard['php_version'] === PHP_VERSION && $dashboard['zip_available'] === true);
$check('the dashboard starts empty when nothing is installed', $dashboard['modules'] === array());

$uploadCopy = $archives . '/upload-1.0.0.zip';
copy($goodZip, $uploadCopy);
$request(array('operation' => 'upload'), array('package' => array('name' => 'demo-1.0.0.zip', 'tmp_name' => $uploadCopy, 'error' => UPLOAD_ERR_OK, 'size' => filesize($uploadCopy))));
$uploaded = $controller->handle();
$check('uploading validates the csrf token before doing anything', in_array('requirePostToken', AdminGuard::$calls, true));
$check('uploading requires the upload capability', in_array('require:modules.upload', AdminGuard::$calls, true));
$check('a validated upload produces a preview instead of installing', $uploaded['preview'] !== null && $uploaded['view'] === 'preview' && !is_dir($appRoot . '/modules/addons/demo_module'));
$check('the upload is recorded in the package ledger', (function () use ($controllerRegistry, $checksum) {
    $package = $controllerRegistry->package($checksum);
    return $package && $package->status === 'validated' && $package->module_id === 'demo_module' && (int) $package->file_count === 5;
})());
$check('the upload is written to the module log with its checksum', (function () use ($controllerRegistry, $checksum) {
    foreach ($controllerRegistry->eventRows as $event) {
        if ($event->event_type === 'upload' && $event->result === 'success' && $event->package_checksum === $checksum && $event->admin_ip === '203.0.113.9') { return true; }
    }
    return false;
})());
$check('the upload is written to the administrator audit trail', (function () {
    foreach (AuditLogger::$records as $record) {
        if ($record['action'] === 'module.package.uploaded' && $record['admin_id'] === 7) { return true; }
    }
    return false;
})());

$previewHtml = $view->render($uploaded);
$check('the preview screen shows every decision field', (function () use ($previewHtml, $checksum) {
    foreach (array('Demo Module', '1.0.0', 'CloudHost247', 'Proprietary', 'Addon module', 'modules/addons/demo_module', 'mod_demo_items', 'demo_api', $checksum) as $needle) {
        if (strpos($previewHtml, $needle) === false) { return false; }
    }
    return true;
})());
$check('the preview screen requires explicit confirmation', strpos($previewHtml, 'confirm_install') !== false && strpos($previewHtml, 'Install Module') !== false && strpos($previewHtml, 'Cancel') !== false);
$check('the preview screen carries the csrf token', substr_count($previewHtml, 'name="token" value="test-csrf-token"') >= 1);
$check('no screen emits javascript', stripos($previewHtml, '<script') === false && stripos($previewHtml, 'onclick=') === false);

$request(array('operation' => 'install', 'checksum' => $checksum));
$refused = $controller->handle();
$check('installation without confirmation is refused', $refused['error'] !== '' && !is_dir($appRoot . '/modules/addons/demo_module'));

AdminGuard::$denied = array('modules.install');
$request(array('operation' => 'install', 'checksum' => $checksum, 'confirm_install' => '1'));
$denied = $controller->handle();
$check('installation is refused without the install capability', $denied['error'] !== '' && !is_dir($appRoot . '/modules/addons/demo_module'));
AdminGuard::$denied = array();

$request(array('operation' => 'install', 'checksum' => $checksum, 'confirm_install' => '1'));
$installedView = $controller->handle();
$check('a confirmed installation really installs the module', $installedView['error'] === '' && is_file($appRoot . '/modules/addons/demo_module/demo_module.php'));
$check('the success message reports verified facts only', strpos($installedView['notice'], '5 file(s)') !== false && strpos($installedView['notice'], 'installed but disabled') !== false);
$check('installation is health checked immediately', $controllerRegistry->find('demo_module')->health_status === 'healthy');
$check('the install and health check are both logged', (function () use ($controllerRegistry) {
    $types = $controllerRegistry->eventTypes();
    return in_array('install:success', $types, true) && in_array('health_check:success', $types, true);
})());
$check('the package ledger marks the package as installed', $controllerRegistry->package($checksum)->status === 'installed');

AdminGuard::$tokenValid = false;
$request(array('operation' => 'toggle', 'module_id' => 'demo_module', 'enabled' => '1'));
$csrfBlocked = $controller->handle();
$check('a forged request without a valid token changes nothing', $csrfBlocked['error'] !== '' && (int) $controllerRegistry->find('demo_module')->enabled === 0);
AdminGuard::$tokenValid = true;

$request(array('operation' => 'toggle', 'module_id' => 'demo_module', 'enabled' => '1'));
$enabled = $controller->handle();
$check('enabling a module through the controller works', (int) $controllerRegistry->find('demo_module')->enabled === 1 && strpos($enabled['notice'], 'enabled') !== false);
$request(array('operation' => 'toggle', 'module_id' => 'demo_module', 'enabled' => '0'));
$disabled = $controller->handle();
$check('disabling states plainly that nothing was deleted', strpos($disabled['notice'], 'No files were deleted') !== false && count(Paths::listFiles($appRoot . '/modules/addons/demo_module')) === 5);

$request(array('operation' => 'uninstall', 'module_id' => 'demo_module', 'confirm_uninstall' => '1', 'confirm_module_id' => 'wrong'));
$wrongConfirmation = $controller->handle();
$check('uninstall requires the module id to be typed exactly', $wrongConfirmation['error'] !== '' && is_file($appRoot . '/modules/addons/demo_module/demo_module.php'));
$request(array('operation' => 'uninstall', 'module_id' => 'demo_module', 'confirm_uninstall' => '1', 'confirm_module_id' => 'demo_module'));
$removed = $controller->handle();
$check('a confirmed uninstall removes the files and says what was kept', strpos($removed['notice'], 'Database tables retained') !== false
    && strpos($removed['notice'], 'Customer and service data were not deleted') !== false
    && !is_file($appRoot . '/modules/addons/demo_module/demo_module.php'));
$check('the uninstall is audited with the version that was removed', (function () {
    foreach (AuditLogger::$records as $record) {
        if ($record['action'] === 'module.uninstall' && $record['before']['version'] === '1.0.0') { return true; }
    }
    return false;
})());

$request(array('operation' => 'not_a_real_operation'));
$unknown = $controller->handle();
$check('unknown operations are rejected', $unknown['error'] !== '');

$request(array(), array(), array('view' => 'logs'));
$logs = $controller->handle();
$logsHtml = $view->render($logs);
$check('the module log lists real recorded events', $logs['events']['total'] >= 6 && strpos($logsHtml, 'Module installed') !== false);
$check('the module log shows who acted, from where, and on what checksum', strpos($logsHtml, '203.0.113.9') !== false && strpos($logsHtml, substr($checksum, 0, 12)) !== false);
$check('the module log never contains a secret-looking value', stripos($logsHtml, 'password') === false && stripos($logsHtml, 'api_key') === false);
$check('log filtering is restricted to known event types', (function () use ($controllerRegistry) {
    return $controllerRegistry->events(array('event_type' => 'install'))['total'] >= 1;
})());

$request(array(), array(), array('view' => 'details', 'module' => 'absent_module'));
$missingDetails = $controller->handle();
$check('details for an unknown module fall back to the dashboard', $missingDetails['view'] === 'dashboard');

/* ---------------------------------------------------- views and escaping */

$hostileRegistry = new ArrayRegistry();
$hostileManifest = Manifest::fromArray($manifestFor(array(
    'id' => 'hostile_module', 'entry_point' => 'hostile_module.php',
    'name' => 'Hostile <script>alert(1)</script>', 'author' => '"><img src=x onerror=alert(1)>',
)));
$hostileRegistry->recordInstallation($hostileManifest, array('checksum' => str_repeat('d', 64), 'file_count' => 1, 'bytes' => 20), 7);
ModuleManager::useRepository($hostileRegistry);
$hostileController = new AdminController($hostileRegistry, new Installer($hostileRegistry, $controllerStorage, $extractor, new CompatibilityChecker()), $controllerStorage, $inspector, $receiver);
$request();
$hostileHtml = $view->render($hostileController->handle());
$check('module metadata is escaped on output', strpos($hostileHtml, '<script>alert(1)</script>') === false && strpos($hostileHtml, '&lt;script&gt;') !== false);
$check('the dashboard shows real status and health labels', strpos($hostileHtml, 'DISABLED') !== false && strpos($hostileHtml, 'FILES MISSING') !== false);
$check('the dashboard states that installation rights are restricted', strpos($hostileHtml, 'Super Admin') !== false);

$request(array(), array(), array('view' => 'details', 'module' => 'hostile_module'));
$detailsHtml = $view->render($hostileController->handle());
$check('module details explain the uninstall impact before confirming', strpos($detailsHtml, 'Database tables') !== false
    && strpos($detailsHtml, 'never drops a table') !== false && strpos($detailsHtml, 'confirm_module_id') !== false);
$check('module details route credentials to the central integrations centre', strpos($detailsHtml, 'API &amp; Integrations') !== false
    && strpos($detailsHtml, 'never by the module itself') !== false && strpos($detailsHtml, 'demo_api') !== false);
$check('module details never invent a configured integration', strpos($detailsHtml, 'Not configured') !== false);
$check('module details report unverified state honestly', strpos($detailsHtml, 'FILES MISSING') !== false || strpos($detailsHtml, 'missing') !== false);
$check('installed modules expose a configure route', strpos($detailsHtml, 'id="configuration"') !== false
    && strpos($view->render($hostileController->handle()), 'Configure') !== false);

$request(array(), array(), array('view' => 'upload'));
$uploadHtml = $view->render($hostileController->handle());
$check('the upload screen documents what is validated before installing', strpos($uploadHtml, 'path traversal') !== false && strpos($uploadHtml, 'SHA-256') !== false);
$check('the upload screen enforces a client-side size hint and zip accept filter', strpos($uploadHtml, 'MAX_FILE_SIZE') !== false && strpos($uploadHtml, 'accept=".zip') !== false);

/* --------------------------------------------------- platform integration */

$check('the platform exposes installed components for dependency checks', (function () {
    $components = ModuleManager::platformComponents();
    return isset($components['cloudhost247_core']) && $components['cloudhost247_core']['version'] === '1.2.0';
})());
$check('integration registration is skipped when the integrations centre is absent', ModuleManager::registerIntegrations(true) === array());
$check('integration status is reported as not configured when unknown', (function () use ($hostileRegistry) {
    $rows = ModuleManager::integrationStatus('hostile_module');
    return count($rows) === 1 && $rows[0]['provider'] === 'demo_api' && $rows[0]['configured'] === false && $rows[0]['known'] === false;
})());
$check('integration deep links target the central credential vault', strpos(ModuleManager::integrationLink('demo_api'), 'view=configure&integration=demo_api') !== false);
$check('module event types are a closed vocabulary', (function () {
    foreach (array('upload', 'reject', 'install', 'update', 'reinstall', 'enable', 'disable', 'uninstall', 'rollback', 'health_check') as $type) {
        if (!isset(ModuleRepository::EVENT_TYPES[$type])) { return false; }
    }
    return count(ModuleRepository::EVENT_TYPES) === 10;
})());
$check('the repository writes to module-namespaced tables only', (function () {
    foreach (array(ModuleRepository::MODULES, ModuleRepository::PACKAGES, ModuleRepository::FILES, ModuleRepository::EVENTS) as $table) {
        if (strpos($table, 'mod_cloudhost247_module') !== 0) { return false; }
    }
    return true;
})());

/* ------------------------------------------------------------------ teardown */

ModuleManager::useRepository(null);
Paths::overrideApplicationRoot(null);
$_POST = array();
$_FILES = array();
$_GET = array();
Paths::removeTree($workspace, dirname($workspace));

$fail = 0;
foreach ($tests as $name => $ok) { echo ($ok ? 'ok' : 'not ok') . " - $name\n"; if (!$ok) { $fail++; } }
echo '# ' . count($tests) . ' assertions, ' . $fail . " failed\n";
exit($fail ? 1 : 0);
