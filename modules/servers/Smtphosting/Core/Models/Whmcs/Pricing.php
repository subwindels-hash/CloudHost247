<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Pricing extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblpricing';

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
    protected $fillable = ['type', 'currency', 'currencyModel', 'relid', 'msetupfee', 'qsetupfee', 'ssetupfee', 'asetupfee', 'bsetupfee', 'tsetupfee', 'monthly', 'quarterly', 'semiannually', 'annually', 'biennially', 'triennially'];

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
     * Adds query condition to limit result records only to domains pricing
     */
    public function domainPricing()
    {
        $this->whereIn('tblpricing.type', ['domaintransfer', 'domainrenew', 'domainregister']);

        return $this;
    }

    public function currencyModel()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Currency", "currency");
    }
}
