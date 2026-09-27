<?php

namespace WGSModule\Soyoustart\classes;

use WHMCS\Database\Capsule;
use WGSModule\Soyoustart\classes\EmailTemplates;

class CustomDatabase
{

    /* creating custom table if not exist */
    public function createTableIfNotExist()
    {
        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_pricesetting')) {
                Capsule::schema()->create(
                    'mod_soyoustart_pricesetting',
                    function ($table) {
                        $table->increments('id');
                        $table->text('server');
                        $table->text('servertype');
                        $table->float('productprice', 10, 2)->nullable();
                        $table->float('additionalIPprice', 10, 2)->nullable();
                        $table->float('setupprice', 10, 2)->nullable();
                        $table->text('paymentmethod')->nullable();
                        $table->float('snapprice', 10, 2)->nullable();
                        $table->float('snapshotprice', 10, 2)->nullable();
                        $table->float('autobackupprice', 10, 2)->nullable();
                        $table->float('backupprice', 10, 2)->nullable();
                        $table->float('additionaldiskprice', 10, 2)->nullable();
                        $table->float('backupspaceprice', 10, 2)->nullable();
                        $table->float('cpanelsoftprice', 10, 2)->nullable();
                        $table->float('imageprice', 10, 2)->nullable();
                        $table->float('datacenterlocationprice', 10, 2)->nullable();
                        $table->float('publicnetworkprice', 10, 2)->nullable();
                        $table->float('privateetworkprice', 10, 2)->nullable();
                        $table->float('storageprice', 10, 2)->nullable();
                        $table->float('pleskprice', 10, 2)->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            } else {
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "snapprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "snapprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "snapshotprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "snapshotprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "autobackupprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "autobackupprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "backupprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "backupprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "additionaldiskprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "additionaldiskprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "backupspaceprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "backupspaceprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "cpanelsoftprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "cpanelsoftprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "imageprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "imageprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "datacenterlocationprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "datacenterlocationprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "publicnetworkprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "publicnetworkprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "privateetworkprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "privateetworkprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "storageprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "storageprice", "float", "10", true);
                }
                if (!Capsule::schema()->hasColumn("mod_soyoustart_pricesetting", "pleskprice")) {
                    $this->alterTable("mod_soyoustart_pricesetting", "pleskprice", "float", "10", true);
                }
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_pricesetting : {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_pricesetting : ' . $e->getMessage());
        }


        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_setting')) {
                Capsule::schema()->create(
                    'mod_soyoustart_setting',
                    function ($table) {
                        $table->increments('id');
                        $table->string('settings');
                        $table->longText('value');
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_setting: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_setting : ' . $e->getMessage());
        }
        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_imap')) {
                Capsule::schema()->create(
                    'mod_soyoustart_imap',
                    function ($table) {
                        $table->increments('id');
                        $table->string('soyouimaphost')->nullable();
                        $table->string('soyouimapuser')->nullable();
                        $table->string('soyouimappass')->nullable();
                        $table->string('soyouimapport')->nullable();
                        $table->string('soyouimapssl', 50)->nullable();
                        $table->mediumText('accesstoken')->nullable();
                        $table->mediumText('refereshtoken')->nullable();
                        $table->mediumText('gmail_clientId')->nullable();
                        $table->mediumText('gmail_secretkey')->nullable();
                        $table->string('gmailaddr', 100)->nullable();
                        $table->string('language', 50)->nullable();
                        $table->string('account_user', 50)->nullable();
                        $table->string('status', '50');
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }

                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_imap: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_imap : ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart')) {
                Capsule::schema()->create(
                    'mod_soyoustart',
                    function ($table) {
                        $table->increments('id');
                        $table->string('account_number')->nullable();
                        $table->string('location')->nullable();
                        $table->string('status')->nullable();
                        $table->string('secret_key')->nullable();
                        $table->string('application_key')->nullable();
                        $table->string('consumer_key')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            } else{
                if (!Capsule::schema()->hasColumn("mod_soyoustart", "status")) {
                    $this->alterTable("mod_soyoustart", "status", "text", 255, true);
                }
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart : ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_products')) {
                Capsule::schema()->create(
                    'mod_soyoustart_products',
                    function ($table) {
                        $table->increments('id');
                        $table->integer('productid')->nullable();
                        $table->text('plancode')->nullable();
                        $table->integer('pricesync')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }else {
                if (!Capsule::schema()->hasColumn("mod_soyoustart_products", "pricesync")) {
                    $this->alterTable("mod_soyoustart_products", "pricesync", "float", "10", true);
                }
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_products: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_products: ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_log')) {
                Capsule::schema()->create(
                    'mod_soyoustart_log',
                    function ($table) {
                        $table->increments('id');
                        $table->dateTime('datetime');
                        $table->string('action')->nullable();
                        $table->string('type')->nullable();
                        $table->longText('request')->nullable();
                        $table->longText('response')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_log: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_log: ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_ips_orders')) {
                Capsule::schema()->create(
                    'mod_soyoustart_ips_orders',
                    function ($table) {
                        $table->increments('id');
                        $table->integer('service_id');
                        $table->integer('invoiceid');
                        $table->integer('iporderid');
                        $table->string('ipaddress', 100)->nullable();
                        $table->integer('status');
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_ips_orders: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_ips_orders: ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_product_settings')) {
                Capsule::schema()->create(
                    'mod_soyoustart_product_settings',
                    function ($table) {
                        $table->increments('id');
                        $table->string('product');
                        $table->longText('settings')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_product_settings: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_product_settings: ' . $e->getMessage());
        }


        try {
            if (!Capsule::schema()->hasTable('mod_acl_settings')) {
                Capsule::schema()->create(
                    'mod_acl_settings',
                    function ($table) {
                        $table->increments('id');
                        $table->string('key');
                        $table->longText('value')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_acl_settings: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_acl_settings: ' . $e->getMessage());
        }

        
        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_email_log')) {
                Capsule::schema()->create(
                    'mod_soyoustart_email_log',
                    function ($table) {
                        $table->increments('id');
                        $table->dateTime('datetime');
                        $table->string('account_user', 100)->nullable();
                        $table->string('email', 100)->nullable();
                        $table->string('language', 100)->nullable();
                        $table->string('email_subject', 50)->nullable();
                        $table->longText('message')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_email_log: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_email_log: ' . $e->getMessage());
        }

        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_configurable')) {
                Capsule::schema()->create(
                    'mod_soyoustart_configurable',
                    function ($table) {
                        $table->increments('id');
                        $table->integer('subconfigid');
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_configurable: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_configurable: ' . $e->getMessage());
        }
        try {
            if (!Capsule::schema()->hasTable('mod_soyoustart_exchange_rates')) {
                Capsule::schema()->create(
                    'mod_soyoustart_exchange_rates',
                    function ($table) {
                        $table->increments('id');
                        $table->longText('value')->nullable();
                        $table->timestamp('created_at')->useCurrent();
                        $table->timestamp('updated_at')->useCurrent()->useCurrentOnUpdate();
                    }
                );
            }
        } catch (\Exception $e) {
            logActivity("Unable to create mod_soyoustart_exchange_rates: {$e->getMessage()}");
            throw new \Exception('Error creating table mod_soyoustart_exchange_rates: ' . $e->getMessage());
        }


        try {
            return [
                'status' => 'success',
                'description' => 'Module has been activated successfully',
            ];
        } catch (\Exception $e) {
            return [
                'status' => "error",
                'description' => 'Unable to create custom table for addon module soyoustart: ' . $e->getMessage(),
            ];
        }
    }

    /* delete custom table */
    public function deleteTalbe()
    {
        try {
            $deleteDbTable = Capsule::table('tbladdonmodules')->where('module', 'Soyoustart')->where('setting', 'delete_db')->first();
            if ($deleteDbTable->value == 'on') {
                Capsule::schema()->dropIfExists('mod_soyoustart_pricesetting');
                Capsule::schema()->dropIfExists('mod_soyoustart_operatingsys');
                Capsule::schema()->dropIfExists('mod_soyoustart_imap');
                Capsule::schema()->dropIfExists('mod_soyoustart');
                Capsule::schema()->dropIfExists('mod_soyoustart_license');
                Capsule::schema()->dropIfExists('mod_soyoustart_products');
                Capsule::schema()->dropIfExists('mod_soyoustart_servers_ips');
                Capsule::schema()->dropIfExists('mod_soyoustart_email_log');
                Capsule::schema()->dropIfExists('mod_soyoustart_log');
                Capsule::schema()->dropIfExists('mod_soyoustart_ips_orders');
                Capsule::schema()->dropIfExists('mod_soyoustart_configurable');
                Capsule::schema()->dropIfExists('mod_soyoustart_product_settings');
            }
            return [
                'status' => 'success',
                'description' => 'Module deactivated successfully!',
            ];
        } catch (\Exception $e) {
            return [
                "status" => "error",
                "description" => "Unable to drop soyoustart module tables: {$e->getMessage()}",
            ];
        }
    }

    public function alterTable($tableName, $columnName, $columnType, $columnSize = null, $isNullable = false)
    {
        try {
            if (!Capsule::schema()->hasColumn($tableName, $columnName)) {
                Capsule::schema()->table($tableName, function ($table) use ($columnName, $columnType, $columnSize, $isNullable) {
                    if ($isNullable) {
                        if ($columnType == 'text') {
                            $table->text($columnName)->nullable();
                        } else {
                            $table->{$columnType}($columnName, $columnSize)->nullable();
                        }
                    } else {
                        if ($columnType == 'text') {
                            $table->text($columnName);
                        } else {
                            $table->{$columnType}($columnName, $columnSize);
                        }
                    }
                });
            }
        } catch (\Exception $e) {
            logActivity("Altering table($tableName) Error: {$e->getMessage()}");
        }
    }

    /* upgrade database */
    public function upgradeDB()
    {
       $this->createTableIfNotExist();
    }


    public function createEmailTemplateIfNotExist()
    {
        try {
            require_once __DIR__ . DS . '/EmailTemplates.php';

            $emailTemplates = new EmailTemplates();

            foreach ($emailTemplates->customEmailTempaltes() as $key => $template) {
                if (!Capsule::table('tblemailtemplates')->WHERE('name', $template["name"])->WHERE('type', $template["type"])->count()) {
                    Capsule::table('tblemailtemplates')->insertGetId($template);
                }
            }
        } catch (\Exception $e) {
            throw new \Exception('Error while creating custom email templates: ' . $e->getMessage());
        }
    }
}
