<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class HostingAddon extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblhostingaddons';

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
    protected $fillable = ['orderid', 'hostingid', 'addonid', 'userid', 'server', 'name', 'setupfee', 'recuring', 'billingcycle', 'tax', 'status', 'regdate', 'nextduedate', 'nextinvoicedate', 'termination_date', 'peymentmethod', 'notes'];

    /**
     * Indicates if the model should soft delete.
     *
     * @var bool
     */
    protected $softDelete = false;


    public function __construct(array $attributes = [])
    {
        parent::__construct($attributes);
    }

    /**
     * Indicates if the model should be timestamped.
     *
     * @var bool
     */
    public $timestamps = false;

    public function addon()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Addon", "addonid");
    }

    public function hosting()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting", "hostingid");
    }

    public function order()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Order", "orderid");
    }

    public function getBillingcycleFriendlyAttribute()
    {
        return $this->attributes['billingcycle'];
    }
}
