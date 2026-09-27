<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Contact
 *
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Contact extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tblcontacts';

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
    protected $fillable = ['uuid', 'firstname', 'lastname', 'companyname', 'email', 'address1', 'address2', 'city', 'state', 'postcode', 'country', 'phonenumber', 'password', 'authmodule', 'authdata', 'currency', 'defaultgateway', 'credit', 'taxexempt', 'latefeeoveride', 'overideduenotices', 'separateinvoices', 'disableautocc', 'datecreated', 'notes', 'billingcid', 'securityqid', 'securityqans', 'groupid', 'cardtype', 'cardlastfour', 'bankname', 'banktype', 'gatewayid', 'lastlogin', 'ip', 'host', 'status', 'language', 'pwresetkey', 'emailoptout', 'overrideautoclose', 'allow_sso', 'email_verified', 'created_at', 'updated_at', 'pwresetexpiry'];

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
