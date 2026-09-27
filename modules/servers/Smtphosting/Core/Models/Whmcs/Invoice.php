<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Invoice extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblinvoices';

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
    protected $fillable = ['userid', 'invoicenum', 'date', 'duedate', 'datepaid', 'subtotal', 'credit', 'tax', 'tax2', 'total', 'taxrate', 'taxrate2', 'status', 'paymentmethod', 'notes'];

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
     * Add relation to invoice items
     *
     * @return type
     */
    public function items()
    {
        return $this->hasMany("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\InvoiceItem", "invoiceid");
    }

    public function transactions()
    {
        return $this->hasMany("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Transaction", "invoiceid");
    }

    public function client()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Client", "userid");
    }

    public function order()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Order", "id", "invoiceid");
    }

    public function getAmountpaidAttribute()
    {
        $total = 0;
        foreach ($this->transactions as $trans)
        {
            $total += $trans->amountin - $trans->amountout;
        }

        return $total;
    }
}
