<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of TldCategoryPivot
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class TldCategoryPivot extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbltld_category_pivot';

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
    protected $fillable = ['tld_id', 'category_id'];

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
    public $timestamps = true;

    public function __construct(array $attributes = [])
    {
        parent::__construct($attributes);
    }

    public function tld()
    {
        return $this->hasOne('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Tld', 'tld_id');
    }

    public function category()
    {
        return $this->hasOne('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\TldCategory', 'tld_id');
    }
}
