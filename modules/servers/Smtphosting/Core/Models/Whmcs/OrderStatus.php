<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of OrderStatus
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class OrderStatus extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblorderstatuses';

    /**
     * @var string
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
    protected $fillable = ['title', 'color', 'showpending', 'showactive', 'showcancelled', 'sortorder'];

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

    /**
     * OrderStatus constructor.
     * @param array $attributes
     */
    public function __construct(array $attributes = [])
    {
        parent::__construct($attributes);
    }
}
