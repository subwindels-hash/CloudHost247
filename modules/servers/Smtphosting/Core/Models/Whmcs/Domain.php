<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Domain
 *
 * @var id
 * @var userid
 * @var orderid
 * @var type
 * @var registrationdate
 * @var domain
 * @var firstpaymentamount
 * @var recurringamount
 * @var registrar
 * @var registrationperiod
 * @var expirydate
 * @var subscriptionid
 * @var promoid
 * @var status
 * @var nextduedate
 * @var nextinvoicedate
 * @var additionalnotes
 * @var paymentmethod
 * @var dnsmanagement
 * @var emailforwarding
 * @var idprotection
 * @var is_premium
 * @var donotrenew
 * @var reminders
 * @var synced
 * @var created_at
 * @var updated_at
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Domain extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbldomains';

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
    protected $fillable = ['userid', 'orderid', 'type', 'registrationdate', 'domain', 'firstpaymentamount', 'recurringamount', 'registrar', 'registrationperiod', 'expirydate', 'subscriptionid', 'promoid', 'status', 'nextduedate', 'nextinvoicedate', 'additionalnotes', 'paymentmethod', 'dnsmanagement', 'emailforwarding', 'idprotection', 'is_premium', 'donotrenew', 'reminders', 'synced', 'created_at', 'updated_at'];

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

    public function client()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Client", "userid");
    }

    public function order()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Order", "orderid");
    }
}
