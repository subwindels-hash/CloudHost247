<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Upgrade extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblupgrades';

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
    protected $fillable = ['userid', 'orderid', 'type', 'date', 'relid', 'originalvalue', 'newvalue', 'new_cycle', 'amount', 'credit_amount', 'days_remaining', 'total_days_in_cycle', 'new_recurring_amount', 'recurringchange', 'status', 'paid'];

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

    public function order()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Order", "orderid");
    }

    public function hosting()
    {
        if ($this->type != 'package')
        {
            return new \stdClass();
        }

        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting", "relid");
    }

    public function productFrom()
    {
        if ($this->type != 'package')
        {
            return new \stdClass();
        }

        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Product", "originalvalue");
    }

    public function getNewBillingcycleAttribute()
    {
        $newvalue = explode(",", $this->newvalue);

        return $newvalue[1];
    }
}
