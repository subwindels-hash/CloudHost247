<?php
namespace CloudHost247\ModuleManager\Install;

use CloudHost247\ModuleManager\Support\ModuleException;
use CloudHost247\ModuleManager\Support\Paths;

/**
 * Filesystem transaction around one installation.
 *
 * Before anything on the server changes, the existing module directory is
 * copied into a private backup location together with a snapshot describing
 * what is about to happen and who asked for it. If any later step fails the
 * transaction restores the previous directory byte for byte, so a failed
 * installation can never leave a half-written module behind.
 */
final class InstallationTransaction
{
    const SNAPSHOT = 'installation.json';
    const PREVIOUS = 'previous';

    private $backupDirectory;
    private $moduleDirectory;
    private $hadPreviousVersion = false;
    private $extracted = false;
    private $committed = false;
    private $rolledBack = false;
    private $snapshot = array();

    public function __construct($backupDirectory, $moduleDirectory)
    {
        $this->backupDirectory = rtrim((string) $backupDirectory, '/');
        $this->moduleDirectory = rtrim((string) $moduleDirectory, '/');
    }

    public function backupDirectory() { return $this->backupDirectory; }
    public function hadPreviousVersion() { return $this->hadPreviousVersion; }
    public function wasRolledBack() { return $this->rolledBack; }

    /** Record the intent, then preserve whatever is already installed. */
    public function begin(array $snapshot)
    {
        $this->snapshot = $snapshot;
        $this->snapshot['started_at'] = date('c');
        $this->writeSnapshot('started');

        if (is_dir($this->moduleDirectory)) {
            $this->hadPreviousVersion = true;
            $target = $this->backupDirectory . '/' . self::PREVIOUS;
            if (!$this->copyTree($this->moduleDirectory, $target)) {
                throw new ModuleException('The existing module could not be backed up, so the installation was not started.', ModuleException::REASON_INSTALL);
            }
            $this->snapshot['previous_files'] = count(Paths::listFiles($target));
            $this->writeSnapshot('backed-up');
        }
        return $this;
    }

    /** Clear the destination so an update cannot leave stale files from the old version. */
    public function clearDestination()
    {
        if (!is_dir($this->moduleDirectory)) { return true; }
        $parent = dirname($this->moduleDirectory);
        if (!Paths::removeTree($this->moduleDirectory, $parent)) {
            throw new ModuleException('The previous module files could not be replaced.', ModuleException::REASON_INSTALL);
        }
        return true;
    }

    public function markExtracted(array $files)
    {
        $this->extracted = true;
        $this->snapshot['installed_files'] = count($files);
        $this->writeSnapshot('extracted');
    }

    public function commit(array $result = array())
    {
        $this->committed = true;
        $this->snapshot['result'] = 'installed';
        $this->snapshot['completed_at'] = date('c');
        foreach ($result as $key => $value) { $this->snapshot[$key] = $value; }
        $this->writeSnapshot('committed');
        return true;
    }

    /**
     * Undo everything this transaction did.
     *
     * @return bool true when the server was returned to its previous state
     */
    public function rollback($reason)
    {
        $this->rolledBack = true;
        $restored = true;

        if (is_dir($this->moduleDirectory)) {
            $restored = Paths::removeTree($this->moduleDirectory, dirname($this->moduleDirectory)) && $restored;
        }
        if ($this->hadPreviousVersion) {
            $backup = $this->backupDirectory . '/' . self::PREVIOUS;
            $restored = $this->copyTree($backup, $this->moduleDirectory) && $restored;
        }

        $this->snapshot['result'] = 'rolled_back';
        $this->snapshot['rollback_reason'] = substr((string) $reason, 0, 500);
        $this->snapshot['rollback_restored_previous'] = $this->hadPreviousVersion ? $restored : false;
        $this->snapshot['completed_at'] = date('c');
        $this->writeSnapshot('rolled-back');
        return $restored;
    }

    public function snapshot()
    {
        return $this->snapshot;
    }

    public function snapshotPath()
    {
        return $this->backupDirectory . '/' . self::SNAPSHOT;
    }

    private function writeSnapshot($stage)
    {
        $this->snapshot['stage'] = $stage;
        $encoded = json_encode($this->snapshot, JSON_UNESCAPED_SLASHES);
        if ($encoded === false) { return; }
        @file_put_contents($this->snapshotPath(), $encoded);
        @chmod($this->snapshotPath(), 0600);
    }

    /** Plain recursive copy. Symlinks are skipped rather than followed. */
    private function copyTree($source, $destination)
    {
        if (!is_dir($source)) { return false; }
        if (!Paths::ensureDirectory($destination, 0755)) { return false; }
        $ok = true;
        foreach (Paths::listFiles($source) as $relative) {
            $from = $source . '/' . $relative;
            $to = Paths::containedPath($destination, $relative);
            if ($to === false) { $ok = false; continue; }
            if (!Paths::ensureDirectory(dirname($to), 0755)) { $ok = false; continue; }
            if (!@copy($from, $to)) { $ok = false; continue; }
            @chmod($to, 0644);
        }
        return $ok;
    }
}
