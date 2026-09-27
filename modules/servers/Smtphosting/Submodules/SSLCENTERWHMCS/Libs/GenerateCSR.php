<?php

namespace ModulesGarden\ProductsReseller\Server\Smtphosting\Submodules\SSLCENTERWHMCS\Libs;


use function ModulesGarden\ProductsReseller\Server\Smtphosting\Core\Helper\sl;

class GenerateCSR
{
    private $params;
    private $post;

    function __construct(&$params, &$post)
    {
        $this->params = &$params;
        $this->post   = &$post;
    }

    public function run()
    {
        try
        {
            return $this->GenerateCSR();
        }
        catch (\Exception $ex)
        {
            return json_encode(
                [
                    'success' => 0,
                    'msg'     => sl('lang')->T($ex->getMessage())
                ]
            );
        }
    }

    private function validateForm()
    {
        /* if(!preg_match("/^([-a-z0-9]{2,100})\.([a-z\.]{2,8})$/i", $this->post['commonName'])) {
          throw new Exception('invalidCommonName');
          } */
        if (!filter_var($this->post['emailAddress'], FILTER_VALIDATE_EMAIL))
        {
            throw new \Exception('invalidEmailAddress');
        }
        if (!preg_match("/^[A-Z]{2}$/i", $this->post['countryName']))
        {
            throw new \Exception('invalidCountryCode');
        }
    }

    private function GenerateCSR()
    {

        $this->validateForm();

        $dn = [
            'countryName'            => strtoupper($this->post['countryName']),
            'stateOrProvinceName'    => $this->post['stateOrProvinceName'],
            'localityName'           => $this->post['localityName'],
            'organizationName'       => $this->post['organizationName'],
            'organizationalUnitName' => $this->post['organizationalUnitName'],
            'commonName'             => $this->post['commonName'],
            'emailAddress'           => $this->post['emailAddress'],
        ];

        $privKey = openssl_pkey_new([
            "private_key_bits" => 2048,
            "private_key_type" => OPENSSL_KEYTYPE_RSA,
        ]);

        if ($privKey)
        {
            $serviceid = $this->params['serviceid'];
            if ($serviceid == null)
            {
                $serviceid = $this->post['serviceID'];
            }

            openssl_pkey_export($privKey, $pKeyOut);

            $csr = openssl_csr_new($dn, $privKey);

            if (!$csr)
            {
                return json_encode([1 => 8]);
            }

            openssl_csr_export($csr, $csrOut);
        }
        else
        {

            throw new \Exception('csrCodeGeneratorFailed');
        }

        return json_encode(
            [
                'success'     => 1,
                'msg'         => sl('lang')->T('SSLCENTERWHMCS', 'csrCodeGeneraterdSuccessfully'),
                'public_key'  => $csrOut,
                'private_key' => encrypt($pKeyOut)
            ]
        );
    }
}
