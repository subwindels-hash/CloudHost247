<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Currency
 *
 * @var id
 * @var code
 * @var prefix
 * @var suffix
 * @var format
 * @var rate
 * @var default
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Currency extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblcurrencies';

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
    protected $fillable = ['code', 'prefix', 'suffix', 'format', 'rate', 'default'];

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

    public static function getDefaultCurrencyId()
    {
        $model    = new self();
        $currency = $model->where('default', '1')->first();
        if (!$currency)
        {
            return null;
        }

        return $currency->id;
    }
}
