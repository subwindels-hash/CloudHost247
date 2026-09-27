<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Registrars
 *
 * @var id
 * @var registrar
 * @var setting
 * @var value
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class Registrars extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblregistrars';

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
    protected $fillable = ['registrar', 'setting', 'value'];

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

    /*
     * Returns list of active whmcs registrar modules
     */
    public function getActiveList()
    {
        return $this->query()->getQuery()->select(['registrar'])->groupBy('registrar')->lists('registrar');
    }
}
