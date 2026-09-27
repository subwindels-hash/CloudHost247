<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\Constants;

class InvoiceItem
{
    const TYPE_PRODUCT = "product";

    const TYPE_ADDON = "addon";

    const TYPE_DOMAIN = "domainpricing"; //used only when domain type is not specified! - this type does NOT exits in database

    const TYPE_DOMAIN_REGISTER = "domainregister";

    const TYPE_DOMAIN_TRANSFER = "domaintransfer";

    const TYPE_DOMAIN_RENEW = "domainrenew";

    const DOMAIN_TYPES = ["domainregister", "domaintransfer", "domainrenew"];
}
