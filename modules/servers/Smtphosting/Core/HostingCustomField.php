<?php


namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core;

use Illuminate\Database\Capsule\Manager as DB;

class HostingCustomField
{
    protected $hostingId;
    protected $productId;
    protected $name;
    protected $customFieldId;

    const SERVICE_ID = 'serviceId';
    const ORDER_ID   = 'orderId';


    /**
     * HostingCustomField constructor.
     * @param int $productId
     * @param int $hostingId
     * @param string $name
     */
    public function __construct(int $productId, int $hostingId, string $name)
    {
        $this->productId = $productId;
        $this->hostingId = $hostingId;
        $this->name      = $name;
    }

    public function getCustomFieldId()
    {

        return $this->customFieldId = DB::table("tblcustomfields")
            ->where("type", ProductCustomField::TYPE)
            ->where("relid", $this->productId)
            ->where("fieldname", "LIKE", $this->name . "%")
            ->value("id");
    }

    public function exist()
    {
        return DB::table("tblcustomfieldsvalues")
                   ->where("fieldid", $this->customFieldId)
                   ->where("relid", $this->hostingId)
                   ->count() > 0;
    }

    public function update($value)
    {
        $this->getCustomFieldId();
        if ($this->exist())
        {
            return DB::table("tblcustomfieldsvalues")
                ->where("fieldid", $this->customFieldId)
                ->where("relid", $this->hostingId)
                ->update(['value' => $value]);
        }
        else
        {
            return DB::table("tblcustomfieldsvalues")
                ->insert([
                    "fieldid" => $this->customFieldId,
                    "relid"   => $this->hostingId,
                    'value'   => $value
                ]);
        }
    }
    
    public function getValue()
{
    $this->getCustomFieldId();

    return DB::table("tblcustomfieldsvalues")
        ->where("fieldid", $this->customFieldId)
        ->where("relid", $this->hostingId)
        ->value("value");
}



}