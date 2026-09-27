<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs;

use \Illuminate\Database\Eloquent\Model as EloquentModel;
use Michelf\Markdown;

/**
 * Description of Product
 *
 * @author Paweł Złamaniec <pawel.zl@modulesgarden.com>
 */
class Ticket extends EloquentModel
{
    /**
     * Table name
     *
     * @var string
     */
    protected $table = 'tbltickets';

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
    protected $fillable = ['tid', 'did', 'userid', 'contactid', 'name', 'email', 'cc', 'c', 'date', 'title', 'message', 'status', 'urgency', 'admin', 'attachment', 'lastreply', 'flag', 'clientunread', 'adminunread', 'replyingadmin', 'replyingtime', 'service', 'merged_ticket_id', 'editor'];

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
     * Get Realted client
     */
    public function client()
    {
        return $this->belongsTo('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Client', 'userid');
    }

    public function clientRC()
    {
        return $this->belongsTo('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\ResellerClient', 'userid', "client_id");
    }

    public function replies()
    {
        return $this->hasMany('ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\TicketReply', 'tid');
    }

    public function department()
    {
        return $this->belongsTo("ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\TicketDepartment", "did");
    }

    public function updateStatus($status)
    {
        $this->status = $status;
        $this->save();
    }
}
