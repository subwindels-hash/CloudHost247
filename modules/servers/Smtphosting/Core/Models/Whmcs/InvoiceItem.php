<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class InvoiceItem extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblinvoiceitems';

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
    protected $fillable = ['invoiceid', 'userid', 'type', 'relid', 'description', 'amount', 'taxed', 'duedate', 'paymentmethod', 'notes'];

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

    public function client()
    {
        return $this->hasOne("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Client", "id", "userid");
    }

    public function invoice()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Invoice", "invoiceid");
    }

    public function hosting()
    {
        return $this->hasOne("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Hosting", "id", "relid");
    }

    public function hostingAddon()
    {
        return $this->hasOne("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\HostingAddon", "id", "relid");
    }

    public function domain()
    {
        return $this->hasOne("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Domain", "id", "relid");
    }

    public function upgrade()
    {
        return $this->hasOne("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Upgrade", "id", "relid");
    }
}
