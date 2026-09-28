<?php
namespace CloudHost247\ModuleManager\Support;

use RuntimeException;

/**
 * Controlled module-management failure.
 *
 * Carries a stable machine reason and a correlation reference. The message is
 * always safe to show an administrator: it never contains a filesystem path
 * outside the module tree, a credential, or an exception trace.
 */
class ModuleException extends RuntimeException
{
    const REASON_UPLOAD = 'upload_rejected';
    const REASON_ARCHIVE = 'archive_rejected';
    const REASON_MANIFEST = 'manifest_invalid';
    const REASON_COMPATIBILITY = 'incompatible';
    const REASON_DEPENDENCY = 'dependency_unsatisfied';
    const REASON_CONFLICT = 'module_conflict';
    const REASON_STORAGE = 'storage_unavailable';
    const REASON_PERMISSION = 'permission_denied';
    const REASON_INSTALL = 'installation_failed';
    const REASON_ROLLBACK = 'rollback_performed';
    const REASON_STATE = 'invalid_state';
    const REASON_CONFIGURATION = 'configuration_invalid';

    private $reason;
    private $correlationId;

    public function __construct($message, $reason = self::REASON_INSTALL, $correlationId = '')
    {
        parent::__construct((string) $message);
        $this->reason = (string) $reason;
        $this->correlationId = (string) $correlationId;
    }

    public function reason()
    {
        return $this->reason;
    }

    public function correlationId()
    {
        return $this->correlationId;
    }

    public function withCorrelation($correlationId)
    {
        $this->correlationId = (string) $correlationId;
        return $this;
    }
}
