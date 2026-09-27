<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of CustomFieldsValues
 *
 * @var id
 * @var fieldid
 * @var relid
 * @var value
 */
class CustomFieldsValues extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblcustomfieldsvalues';

    protected $primaryKey = 'id';

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['fieldid', 'relid', 'value'];

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
}
