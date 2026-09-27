<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Configuration
 *
 * @var setting
 * @var value
 * @var created_at
 * @var updated_at
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Configuration extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblconfiguration';

    protected $primaryKey = 'setting';

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['setting', 'value', 'created_at', 'updated_at'];

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

    public function __construct(array $attributes = [])
    {
        parent::__construct($attributes);
    }
}
