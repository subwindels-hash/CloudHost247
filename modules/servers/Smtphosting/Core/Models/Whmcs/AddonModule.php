<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of AddonModule
 *
 * @var int id
 * @var string module
 * @var string setting
 * @var string value
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class AddonModule extends EloquentModel
{
    /**
     * Table name
     * @var string
     */
    protected $table = 'tbladdonmodules';

    /**
     * Key
     * @var type
     */
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
    protected $fillable = ['module', 'setting', 'value'];

    /**
     * Indicates if the model should soft delete.
     * @var bool
     */
    protected $softDelete = false;

    /**
     * Indicates if the model should be timestamped.
     * @var bool
     */
    public $timestamps = false;
}