<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Packages\WhmcsService\Config;

class Enum
{
    //todo wyczyscic/zakomentowac niepotrzebne
    const CUSTOM_FIELDS = 'customFields';

    const CUSTOM_FIELDS_REL_ID = 'relid';

    const FIELD_RELATION_TYPE         = 'type';
    const FIELD_RELATION_TYPE_DEFAULT = 'product';
    const FIELD_RELATION_TYPE_PRODUCT = 'product';
    const FIELD_RELATION_TYPE_CLIENT  = 'client';

    const FIELD_NAME = 'fieldname';

    const FIELD_TYPE          = 'fieldtype';
    const FIELD_TYPE_DEFAULT  = 'text';
    const FIELD_TYPE_TEXT_BOX = 'text';
    const FIELD_TYPE_TEXTAREA = 'textarea';
    const FIELD_TYPE_LINK     = 'link';
    const FIELD_TYPE_PASSWORD = 'password';
    const FIELD_TYPE_DROPDOWN = 'dropdown';
    const FIELD_TYPE_TICK_BOX = 'tickbox';

    const FIELD_OPTIONS         = 'fieldoptions';
    const FIELD_OPTIONS_DEFAULT = '';

    const FIELD_REG_EXPR         = 'regexpr';
    const FIELD_REG_EXPR_DEFAULT = '';

    const FIELD_DESCRIPTION         = 'description';
    const FIELD_DESCRIPTION_DEFAULT = '';

    const FIELD_ADMIN_ONLY         = 'adminonly';
    const FIELD_ADMIN_ONLY_DEFAULT = '';
    const FIELD_ADMIN_ONLY_ON      = 'on';
    const FIELD_ADMIN_ONLY_OFF     = '';

    const FIELD_REQUIRED         = 'required';
    const FIELD_REQUIRED_DEFAULT = '';
    const FIELD_REQUIRED_ON      = 'on';
    const FIELD_REQUIRED_OFF     = '';

    const FIELD_SHOW_ORDER         = 'showorder';
    const FIELD_SHOW_ORDER_DEFAULT = '';
    const FIELD_SHOW_ORDER_ON      = 'on';
    const FIELD_SHOW_ORDER_OFF     = '';

    const FIELD_SHOW_INVOICE         = 'showinvoice';
    const FIELD_SHOW_INVOICE_DEFAULT = '';
    const FIELD_SHOW_INVOICE_ON      = 'on';
    const FIELD_SHOW_INVOICE_OFF     = '';

    const FIELD_SORT_ORDER         = 'sortorder';
    const FIELD_SORT_ORDER_DEFAULT = '0';

    const FIELD_CREATED_AT         = 'created_at';
    const FIELD_CREATED_AT_DEFAULT = '0000-00-00 00:00:00';

    const FIELD_UPDATED_AT         = 'updated_at';
    const FIELD_UPDATED_AT_DEFAULT = '0000-00-00 00:00:00';

    const CONFIGURABLE_OPTIONS = 'configurableOptions';

    const OPTION_GROUP_ID = 'gid';
    const OPTION_NAME     = 'optionname';

    const OPTION_TYPE          = 'optiontype';
    const OPTION_TYPE_QUANTITY = '4';
    const OPTION_TYPE_YES_NO   = '3';
    const OPTION_TYPE_RADIO    = '2';
    const OPTION_TYPE_DROPDOWN = '1';

    const OPTION_QUANTITY_MIN         = 'qtyminimum';
    const OPTION_QUANTITY_MIN_DEFAULT = '0';

    const OPTION_QUANTITY_MAX         = 'qtymaximum';
    const OPTION_QUANTITY_MAX_DEFAULT = '0';

    const ORDER         = 'order';
    const ORDER_DEFAULT = '0';

    const HIDDEN         = 'hidden';
    const HIDDEN_DEFAULT = '0';

    const CONFIG_SUB_OPTIONS        = 'configurableSubOptions';
    const OPTION_SUB_OPTION_ID      = 'configid';
    const OPTION_SUB_NAME           = 'optionname';
    const OPTION_SUB_ORDER          = 'sortorder';
    const OPTION_SUB_ORDER_DEFAULT  = '0';
    const OPTION_SUB_HIDDEN         = 'hidden';
    const OPTION_SUB_HIDDEN_DEFAULT = '0';

    const DEFAULT_QUANTITY_SUB_CONFIG = [
        self::OPTION_SUB_NAME   => 'number|Number',
        self::OPTION_SUB_ORDER  => self::OPTION_SUB_ORDER_DEFAULT,
        self::OPTION_SUB_HIDDEN => self::OPTION_SUB_HIDDEN_DEFAULT
    ];
}
