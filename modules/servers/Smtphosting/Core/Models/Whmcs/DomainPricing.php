<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Domain Pricing
 *
 * @var id
 * @var extension
 * @var dnsmanagement
 * @var emailforwarding
 * @var idprotection
 * @var eppcode
 * @var autoreg
 * @var order
 * @var group
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class DomainPricing extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbldomainpricing';

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
    protected $fillable = ['id', 'extension', 'dnsmanagement', 'emailforwarding', 'idprotection', 'eppcode', 'autoreg', 'order', 'group'];

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

    public function getExtensionNoDotAttribute()
    {
        return substr($this->extension, 1);
    }

    public function scopeWithPrincing($query)
    {
        return $query->join('tblpricing', function ($join) {
            $join->on('tbldomainpricing.id', 'LIKE', 'tblpricing.relid');
        }
        );
    }

    public function scopeGroupByExtension($query)
    {
        return $query->groupBy("tbldomainpricing.extension");
    }

}
