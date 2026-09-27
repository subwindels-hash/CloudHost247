<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of CustomField
 *
 * @var id
 * @var type
 * @var relid
 * @var fieldname
 * @var fieldtype
 * @var description
 * @var fieldoptions
 * @var regexpr
 * @var adminonly
 * @var required
 * @var showorder
 * @var showinvoice
 * @var sortorder
 * @var created_at
 * @var updated_at
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class CustomField extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblcustomfields';

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
    protected $fillable = ['type', 'relid', 'fieldname', 'fieldtype', 'description', 'fieldoptions', 'regexpr', 'adminonly', 'required', 'showorder', 'showinvoice', 'sortorder'];

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

    public function getValueByRelid($relid)
    {
        $field  = new CustomFieldValue();
        $result = $field->where("fieldid", $this->attributes["id"])->where("relid", $relid)->first();

        return $result->value;
    }
}
