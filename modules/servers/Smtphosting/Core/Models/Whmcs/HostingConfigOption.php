<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class HostingConfigOption extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblhostingconfigoptions';

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
    protected $fillable = [];

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

    public function configOption()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\ProductConfigOption", "configid");
    }

    public function subOption()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\ProductConfigOption", "optionid");
    }
}
