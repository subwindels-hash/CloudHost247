<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Order extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblorders';

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
    protected $fillable = ['ordernum', 'userid', 'contactid', 'date', 'nameservers', 'transfersecret', 'renewals', 'promocode', 'promotype', 'promovalue', 'orderdata', 'amount', 'paymentmethod', 'invoiceid', 'status', 'ipaddress', 'fraudmodule', 'fraudoutput', 'notes'];

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

    public function hostings()
    {
        return $this->hasMany('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting', 'orderid');
    }

    public function domains()
    {
        return $this->hasMany('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Domain', 'orderid');
    }

    public function addons()
    {
        return $this->hasMany('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\HostingAddon', 'orderid');
    }

    public function upgrades()
    {
        return $this->hasMany('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Upgrade', 'orderid');
    }

    public function invoice()
    {
        return $this->hasOne('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Invoice', 'id', 'invoiceid');
    }

    /**
     * Get Realted client
     */
    public function client()
    {
        return $this->belongsTo('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Client', 'userid');
    }
}
