<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Category
 *
 * @var id
 * @var groupname
 * @var groupcolour
 * @var discountpercent
 * @var susptermexempt
 * @var separateinvoices
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class ClientGroup extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblclientgroups';

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
    protected $fillable = ['groupname', 'groupcolour', 'discountpercent', 'susptermexempt', 'separateinvoices'];

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

    /**
     * Get client related hostings
     *
     * @return type
     */
    public function clients()
    {
        return $this->hasMany("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Clients", 'groupid');
    }
}
