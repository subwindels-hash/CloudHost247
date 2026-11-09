/**
 * Non-configurable fail-closed safety interlock. A withdrawal can commit after the legacy sender's
 * final check but before that worker initiates its network request; a database disconnect can also
 * invalidate a lock while a suspended process remains able to send. Environment flags alone must
 * never enable this path. Re-enabling requires an independently reviewed coordination design and
 * deployment authorization; do not change this to a runtime option.
 */
export function isGa4PurchaseDeliverySafe(): boolean {
  return false;
}
