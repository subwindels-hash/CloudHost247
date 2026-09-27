<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ProductSettings;

use \ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ExtendedEloquentModel;

/**
 * Description of ModuleSettings
 *
 * @var varchar(255) setting
 * @var text value
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Model extends ExtendedEloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'ProductSettings';

    protected $primaryKey = 'id';

    /**
     * Eloquent guarded parameters
     * @var array
     */
    protected $guarded = ['id'];

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['pid', 'setting', 'value'];

    /**
     * Indicates if the model should soft delete.
     *
     * @var bool
     */
    protected $softDelete = false;

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;
}
