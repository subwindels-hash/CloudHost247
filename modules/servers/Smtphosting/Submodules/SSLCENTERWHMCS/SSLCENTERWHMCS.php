<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SSLCENTERWHMCS;

use ModulesGarden\ProductsReseller\Server\Smtphosting\Calls\GetInfo;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Configuration;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\HostingCustomField;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Models\Whmcs\SslOrders;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Core\ModuleConstants;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\DataSingleton;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Helpers\Dispatcher;
use ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\DefaultSSLSubmodule;
use WHMCS\Product\Product;


//GoGetSSL integration
class SSLCENTERWHMCS extends DefaultSSLSubmodule
{
    /**
     * @param array $params
     * @return array|mixed
     * @throws \Exception
     */
    public function sslStepOne($params)
    {
        $postfields                                                    = $this->getPostfields($params);
        $result                                                        = parent::sslStepOne($params);
        $result['additionalfields']['<br />']['<br />']['Description'] = str_replace('<div class="modal-header panel-heading">\n', '<div class="modal-header panel-heading" style="display: flex; flex-direction: row-reverse;">\n', $result['additionalfields']['<br />']['<br />']['Description']);
        $result['additionalfields']['<br />']['<br />']['Description'] .= "<style>.hidden {display: none;}</style>";
        return $result;
    }

    /**
     * @param array $params
     * @return array|bool|mixed|\stdClass|string
     * @throws \Exception
     */
    public function sslStepTwo($params)
    {
        $postfields = $this->getPostfields($params);

        $result = parent::sslStepTwo($postfields);

        if ($result['error'] || !isset($result['approveremails2']) || !isset($result['approvalmethods']))
        {
            return ['error' => $result['error'] ?: $this->lang->T('sslcenterwhmcsVersionTooLow')];
        }

        $ins = DataSingleton::getInstance();
        $ins->setApprovalMethods($result['approvalmethods']);
        $ins->setApprovalEmails($result['approveremails2']);
        $ins->setBrand($result['brand']);
        $result['cssDir']     = ModuleConstants::getStylesDirForSmarty();
        $result['jsDir']      = ModuleConstants::getJsDirForSmarty();
        $result['templateMG'] = Dispatcher::getTemplateForAction('stepTwo');
        return $result;
    }

    /**
     * @param array $params
     * @return array|bool|mixed|\stdClass|string
     * @throws \Exception
     */
    public function sslStepThree($params)
    {
        $postfields = $this->getPostfields($params);

        return parent::sslStepThree($postfields);
    }

    /**
     * @param array $params
     * @return array
     */
    public function getInfo(array $params)
    {
        try
        {
            $product    = Product::findOrFail($params['pid']);
            $postfields = ["id" => $params['customfields'][HostingCustomField::SERVICE_ID]];
            $sslOrder   = SslOrders::where('serviceid', $params['serviceid'])->first();
            if (!$sslOrder)
            {
                throw new \Exception($this->lang->T('SSLCENTERWHMCS', 'sslOrderNotFound'));
            }
            $localOrderStatus = SslOrders::where('serviceid', $params['serviceid'])->first()->status;
            if ($localOrderStatus === "Completed" || $localOrderStatus === "Configuration Submitted")
            {
                $sslInfo = new GetInfo(Configuration::create($product->toArray()), $postfields);
                $sslData = $sslInfo->process()['result'];

                if (empty($sslData))
                {
                    throw new \Exception('Loading data error, please try again later.');
                }
                if ($sslData['whmcsStatus'])
                {
                    $sslOrder->status = $sslData['whmcsStatus'];
                    $sslOrder->save();
                }
                if ($sslData['remoteid'])
                {
                    $sslOrder->remoteid = $sslData['remoteid'];
                    $sslOrder->save();
                }
                $vars                       = $sslData;
                $vars['remoteid']           = $sslData['remoteid'];
                $vars['activationStatus']   = $sslData['status'];
                $vars['validFrom']          = $sslData['valid_from'];
                $vars['validTill']          = $sslData['valid_till'];
                $vars['subscriptionStarts'] = $sslData['begin_date'];
                $vars['subscriptionEnds']   = $sslData['end_date'];
                $now                        = strtotime($vars['validFrom']);
                $end_date                   = strtotime($vars['validTill']);
                $datediff                   = $now - $end_date;
                $vars['displayRenewButton'] = false;
                $today                      = date('Y-m-d');
                $diffDays                   = abs(strtotime($vars['validTill']) - strtotime($today)) / 86400;

                if ($diffDays < 90)
                {
                    $vars['displayRenewButton'] = true;
                }
                $vars['nextReissue'] = abs(round($datediff / (60 * 60 * 24)));
                $vars['crt']         = $sslData['crt_code'];
                $vars['csr']         = $sslData['csr_code'];
                $vars['ca']          = $sslData['ca_code'];

                if (!empty($sslData['dcv_method']))
                {
                    $vars['dcv_method'] = $sslData['dcv_method'];

                    if (in_array($vars['dcv_method'], ["http", "https", "dns"]))
                    {
                        if (is_array($sslData['approver_method']))
                        {
                            $vars['approver_method'][$vars['dcv_method']] = $sslData['approver_method'][$vars['dcv_method']];
                        }
                        else
                        {
                            $vars['approver_method'][$vars['dcv_method']] = (array)$sslData['approver_method']->{$vars['dcv_method']};
                        }

                        if ($vars['dcv_method'] == 'http' || $vars['dcv_method'] == 'https')
                        {
                            $vars['approver_method'][$vars['dcv_method']]['content'] = explode(PHP_EOL, $vars['approver_method'][$vars['dcv_method']]['content']);
                        }
                    }
                    else
                    {
                        $vars['dcv_method']      = 'email';
                        $vars['approver_method'] = $sslData['approver_method']['email'];
                    }
                }

                $vars['brandsWithOnlyEmailValidation'] = ['geotrust', 'thawte', 'rapidssl', 'symantec',];
            }
            $vars['MGLANG']              = $this->lang;
            $vars['allOk']               = true;
            $vars['configurationStatus'] = SslOrders::where('serviceid', $params['serviceid'])->first()->status;
            $vars['configurationURL']    = 'configuressl.php?cert=' . md5($sslOrder->id);
            $singletonDataInstance       = DataSingleton::getInstance();
            $vars['brand']               = $singletonDataInstance->getBrand();
            $vars['assetsURL']           = 'assets';

            //todo lacking smarty vars for full functionality
//        $vars['approver_method.$dcv_method.link']
//        $vars['approver_method.$dcv_method.content']
//        $vars['approver_method.dns.record|strtolower|replace:'cname':'CNAME'']
//        $vars['approver_method.https .http .dns']
//        $vars['sans']
//        $vars['san.method']
//        $vars['san.san_validation.link']
//        $vars['san.san_validation.content']
//        $vars['san.san_name']
//        $vars['san_revalidate']
//        $vars['custom_guide']
//        $vars['visible_renew_button']
//        $vars['disabledValidationMethods']
//        $vars['configoption24']
//        $vars['approver_email']
//        $vars['btndownload']
//        $vars['privateKey']
            $vars['cssDir']     = ModuleConstants::getStylesDirForSmarty();
            $vars['templateMG'] = Dispatcher::getTemplateForAction('home');
            return [
                'templatefile' => Dispatcher::template(),
                'vars'         => $vars
            ];
        }
        catch (\Exception $e)
        {
            logModuleCall(
                'Smtphosting',
                __FUNCTION__,
                $params,
                $e->getMessage(),
                $e->getTraceAsString()
            );
            return $e->getMessage();
        }
    }

    /**
     * @param array $params
     * @return array
     */
    public function getAAInfo(array $params): array
    {
        $details                                                       = $this->getInfo($params)['vars'];
        $vars                                                          = [];
        $vars[$this->lang->T('SSLCENTERWHMCS', 'remoteid')]            = $details['remoteid'] ?: '-';
        $vars[$this->lang->T('SSLCENTERWHMCS', 'partnerOrderId')]      = $details['partner_order_id'] ?: "-";
        $vars[$this->lang->T('SSLCENTERWHMCS', 'configurationStatus')] = $details['whmcsStatus'] ?: '-';
        $vars[$this->lang->T('SSLCENTERWHMCS', 'domain')]              = $details['domain'] ?: '-';
        $vars[$this->lang->T('SSLCENTERWHMCS', 'orderStatus')]         = ucfirst($details['activationStatus']) ?: '-';

        if ($details['dcv_method'] == 'email')
        {
            $vars[$this->lang->T('SSLCENTERWHMCS', 'approverEmail')] = $details['approver_method'];
        }
        $vars[$this->lang->T('SSLCENTERWHMCS', 'orderStatusDescription')] = $details['status_description'] ?: '-';

//    $return['Cron Synchronized'] = isset($orderDetails['synchronized']) && !empty($orderDetails['synchronized']) ? $orderDetails['synchronized'] : 'Not synchronized';

        if ($details['activationStatus'] == 'active')
        {
            $vars[$this->lang->T('SSLCENTERWHMCS', 'validFrom')] = $details['validFrom'];
            $vars[$this->lang->T('SSLCENTERWHMCS', 'validTill')] = $details['validTill'];
        }

        return $vars;
    }


    protected function getPostfields($params)
    {
        $postfields = $params;
        if ($_POST['servertype'])
        {
            $_SESSION['servertype'] = $_POST['servertype'];
        }
        $postfields['servertype']           = $_POST['servertype'] ?: $_SESSION['servertype'];
        $postfields['fields']['order_type'] = $_POST['fields']['order_type'];
        $postfields['dcvmethodMainDomain']  = strtolower($_POST['dcvmethodMainDomain']);
        $postfields['approveremail']        = $_POST['approveremail'];
        return $postfields;
    }


}
