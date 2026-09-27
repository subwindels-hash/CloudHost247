<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class PaymentGateway extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblpaymentgateways';

    protected $primaryKey = 'gateway';

    /**
     * Eloquent guarded parameters
     * @var array
     */
    protected $guarded = ['gateway'];

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['gateway', 'setting', 'value', 'order'];

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

    public function scopeGetNameByGateway($query, $gateway)
    {
        return $query->where('setting', 'name')->where('gateway', $gateway);
    }


}
