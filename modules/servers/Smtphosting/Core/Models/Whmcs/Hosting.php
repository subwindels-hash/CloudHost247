<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;
use WHMCS\Product\Product;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Hosting extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblhosting';

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
    protected $fillable = ['userid', 'orderid', 'packageid', 'server', 'regdate', 'domain', 'paymentmethod', 'firstpaymentamount', 'amount', 'billingcycle', 'nextduedate', 'nextinvoicedate', 'termination_date', 'completed_date', 'domainstatus', 'username', 'password', 'notes', 'subscriptionid', 'promoid', 'suspendreason', 'overideautosuspend', 'overidesuspenduntil', 'dedicatedip', 'assignedips', 'ns1', 'ns2', 'diskusage', 'disklimit', 'bwusage', 'bwlimit', 'lastupdate'];

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
     * Get related product
     *
     * @return type
     */
    public function product()
    {
        return $this->belongsTo("WHMCS\Product\Product", "packageid");
    }
}
