<?php
namespace CloudHost247\Broker\Migrations;

use CloudHost247\Foundation\Contracts\Migration;
use WHMCS\Database\Capsule;

/**
 * Domain delivery ledger columns (requirement #25).
 *
 * Tracks whether a completed transfer has actually been associated with the
 * customer's CloudHost247 account — never assumed, always recorded with the
 * real WHMCS domain id once association is confirmed (or an explicit
 * pending/failed state an operator can act on).
 *
 * Additive only: adds columns to mod_cloudhost247_broker_transfers behind
 * hasColumn guards; nothing is dropped, renamed or retyped, and no WHMCS
 * core table is touched.
 */
final class DeliveryMigration implements Migration
{
    public function version() { return '1.1.0'; }

    public function description() { return 'Add delivery_status, whmcs_domain_id, delivered_at and delivery_note columns to the brokerage transfers table'; }

    public function up()
    {
        $table = 'mod_cloudhost247_broker_transfers';
        if (!Capsule::schema()->hasTable($table)) { return; } // V100 always runs first on a fresh install

        if (!Capsule::schema()->hasColumn($table, 'delivery_status')) {
            Capsule::schema()->table($table, function ($t) {
                $t->string('delivery_status', 24)->default('pending')->index('ch247_broker_transfer_delivery_idx');
            });
        }
        if (!Capsule::schema()->hasColumn($table, 'whmcs_domain_id')) {
            Capsule::schema()->table($table, function ($t) {
                $t->unsignedBigInteger('whmcs_domain_id')->nullable()->index('ch247_broker_transfer_domain_idx');
            });
        }
        if (!Capsule::schema()->hasColumn($table, 'delivered_at')) {
            Capsule::schema()->table($table, function ($t) {
                $t->dateTime('delivered_at')->nullable();
            });
        }
        if (!Capsule::schema()->hasColumn($table, 'delivery_note')) {
            Capsule::schema()->table($table, function ($t) {
                $t->string('delivery_note', 255)->default('');
            });
        }
    }
}
