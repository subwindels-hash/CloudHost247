<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;

/**
 * Description of Addon
 *
 * @var int id
 * @var string uuid
 * @var int roleid
 * @var string username
 * @var string password
 * @var string passwordhash
 * @var string authmodule
 * @var string authdata
 * @var string firstname
 * @var string lastname
 * @var string email
 * @var string signature
 * @var string notes
 * @var string template
 * @var string language
 * @var int disabled
 * @var int loginattempts
 * @var string supportdepts
 * @var string ticketnotifications
 * @var string homewidgets
 * @var string password_reset_key
 * @var string password_reset_data
 * @var timestamp password_reset_expiry
 * @var timestamp created_at
 * @var timestamp updated_at
 *
 * @author Paweł Złamaniec <rafal.os@modulesgarden.com>
 */
class Admins extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbladmins';

    /**
     * Eloquent guarded parameters
     * @var array
     */
    protected $guarded = ['id'];

    protected $primaryKey = 'id';

    /**
     * Eloquent fillable parameters
     * @var array
     */
    protected $fillable = ['uuid', 'roleid', 'username', 'password', 'passwordhash', 'authmodule', 'authdata', 'firstname', 'lastname', 'email', 'signature', 'notes', 'template', 'language', 'disabled', 'loginattempts', 'supportdepts', 'ticketnotifications', 'homewidgets', 'password_reset_key', 'password_reset_data', 'password_reset_expiry', 'created_at', 'updated_at'];

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
