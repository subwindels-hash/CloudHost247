<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Addon
 *
 * @var int id
 * @var string packages
 * @var string name
 * @var string description
 * @var string billingcycle
 * @var string tax
 * @var string showorder
 * @var string downloads
 * @var string autoactivate
 * @var string suspendproduct
 * @var int welcomeemail
 * @var int weight
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Addon extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbladdons';

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
    protected $fillable = ['packages', 'name', 'description', 'billingcycle', 'tax', 'showorder', 'downloads', 'autoactivate', 'suspendproduct', 'welcomeemail', 'weight'];

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
