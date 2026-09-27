<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\UI\Widget\Forms\Fields\Hidden;

/**
 * FormIntegration controller
 *
 * This form does not contain a <form> tag, this is correct for implementing a FW form functionalities
 * to fields and sections that are injected into already existing WHMCS forms.
 *
 * @author Sławomir Miśkowicz <slawomir@modulesgarden.com>
 */
class FormIntegration extends BaseStandaloneForm
{
    protected $id = 'formIntegration';
    protected $name = 'formIntegration';

    //do not overwrite this function
    protected function preInitContent()
    {
        $this->setSubmit(null);

        $formAction = new Hidden('mgformtype');
        $formAction->setDefaultValue(FormConstants::UPDATE);
        $this->addField($formAction);
        $formAction = new Hidden('ajax');
        $formAction->setDefaultValue(1);
        $this->addField($formAction);
    }
}
