<?php
namespace CloudHost247\Marketing\Repositories;

use CloudHost247\Marketing\Domain\AutomationRunStatus;
use CloudHost247\Marketing\Domain\AutomationStatus;
use CloudHost247\Marketing\Domain\AutomationStepType;
use CloudHost247\Marketing\Domain\AutomationTrigger;
use WHMCS\Database\Capsule;

/**
 * Automations, their steps and their runs.
 *
 * The repository never deletes a run and never rewrites history: an enrolment
 * that happened stays visible, it only changes state. `enrolment_key` carries
 * the idempotency (one live journey per subscriber per automation, or a fresh
 * key for each re-enrolment when the automation allows it), so a retried hook
 * cannot enrol the same person twice.
 */
final class AutomationRepository
{
    const TABLE = 'mod_cloudhost247_marketing_automations';
    const STEPS = 'mod_cloudhost247_marketing_automation_steps';
    const RUNS = 'mod_cloudhost247_marketing_automation_runs';

    // ------------------------------------------------------------- automations

    public function find($id)
    {
        return Capsule::table(self::TABLE)->where('id', (int) $id)->first();
    }

    public function findByIdempotencyKey($key)
    {
        return Capsule::table(self::TABLE)->where('idempotency_key', (string) $key)->first();
    }

    public function create(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        $id = Capsule::table(self::TABLE)->insertGetId($data);
        return $this->find($id);
    }

    public function update($id, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        Capsule::table(self::TABLE)->where('id', (int) $id)->update($data);
        return $this->find($id);
    }

    /** All automations, newest first, optionally filtered (status, trigger). */
    public function paginate(array $filters = array(), $page = 1, $perPage = 50)
    {
        $page = max(1, (int) $page);
        $perPage = max(1, min(200, (int) $perPage));
        $query = Capsule::table(self::TABLE);
        if (!empty($filters['status']) && AutomationStatus::isValid($filters['status'])) {
            $query->where('status', (string) $filters['status']);
        }
        if (!empty($filters['trigger_type']) && AutomationTrigger::isValid($filters['trigger_type'])) {
            $query->where('trigger_type', (string) $filters['trigger_type']);
        }
        $rows = $query->orderBy('id', 'desc')->limit($perPage)->offset(($page - 1) * $perPage)->get();
        return array('rows' => $rows ? $rows->all() : array(), 'page' => $page, 'per_page' => $perPage);
    }

    /** Active automations that should fire for this trigger (and list). */
    public function enrollingFor($triggerType, $listId = 0)
    {
        $query = Capsule::table(self::TABLE)
            ->where('status', AutomationStatus::ACTIVE)
            ->where('trigger_type', (string) $triggerType);
        if (AutomationTrigger::requiresList($triggerType)) {
            $query->where('list_id', (int) $listId);
        }
        $rows = $query->orderBy('id', 'asc')->limit(200)->get();
        return $rows ? $rows->all() : array();
    }

    public function countByStatus()
    {
        $counts = array();
        foreach (AutomationStatus::all() as $status) { $counts[$status] = 0; }
        foreach (Capsule::table(self::TABLE)->get()->all() as $row) {
            $status = (string) $row->status;
            if (isset($counts[$status])) { $counts[$status]++; }
        }
        return $counts;
    }

    // ------------------------------------------------------------------- steps

    /** Steps in run order. */
    public function steps($automationId)
    {
        $rows = Capsule::table(self::STEPS)->where('automation_id', (int) $automationId)->orderBy('position', 'asc')->limit(100)->get();
        return $rows ? $rows->all() : array();
    }

    public function stepAt($automationId, $position)
    {
        return Capsule::table(self::STEPS)
            ->where('automation_id', (int) $automationId)
            ->where('position', (int) $position)
            ->first();
    }

    public function addStep($automationId, array $data)
    {
        $now = date('Y-m-d H:i:s');
        $position = isset($data['position']) ? (int) $data['position'] : $this->nextPosition($automationId);
        $data['automation_id'] = (int) $automationId;
        $data['position'] = $position;
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        $id = Capsule::table(self::STEPS)->insertGetId($data);
        return Capsule::table(self::STEPS)->where('id', $id)->first();
    }

    public function updateStep($stepId, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        Capsule::table(self::STEPS)->where('id', (int) $stepId)->update($data);
        return Capsule::table(self::STEPS)->where('id', (int) $stepId)->first();
    }

    /**
     * Removes one step and closes the gap in the ordering. Positions are unique
     * per automation, so the tail is rewritten in one transaction; a
     * half-renumbered journey would skip or repeat a step for everybody waiting
     * in it.
     */
    public function removeStep($stepId)
    {
        $step = Capsule::table(self::STEPS)->where('id', (int) $stepId)->first();
        if (!$step) { return false; }
        $automationId = (int) $step->automation_id;
        Capsule::connection()->transaction(function () use ($step, $automationId) {
            Capsule::table(self::STEPS)->where('id', (int) $step->id)->delete();
            $position = 1;
            foreach ($this->steps($automationId) as $row) {
                if ((int) $row->position !== $position) {
                    Capsule::table(self::STEPS)->where('id', (int) $row->id)->update(array('position' => $position, 'updated_at' => date('Y-m-d H:i:s')));
                }
                $position++;
            }
        });
        return true;
    }

    private function nextPosition($automationId)
    {
        $highest = 0;
        foreach ($this->steps($automationId) as $row) { $highest = max($highest, (int) $row->position); }
        return $highest + 1;
    }

    // -------------------------------------------------------------------- runs

    public function findRun($id)
    {
        return Capsule::table(self::RUNS)->where('id', (int) $id)->first();
    }

    public function findRunByKey($key)
    {
        return Capsule::table(self::RUNS)->where('enrolment_key', (string) $key)->first();
    }

    /** The live (non-terminal) run of one subscriber for one automation, if any. */
    public function activeRun($automationId, $subscriberId)
    {
        return Capsule::table(self::RUNS)
            ->where('automation_id', (int) $automationId)
            ->where('subscriber_id', (int) $subscriberId)
            ->whereIn('status', array(AutomationRunStatus::RUNNING, AutomationRunStatus::WAITING))
            ->orderBy('id', 'desc')
            ->first();
    }

    public function createRun(array $data)
    {
        $now = date('Y-m-d H:i:s');
        $data['created_at'] = $now;
        $data['updated_at'] = $now;
        $id = Capsule::table(self::RUNS)->insertGetId($data);
        return $this->findRun($id);
    }

    public function updateRun($runId, array $data)
    {
        $data['updated_at'] = date('Y-m-d H:i:s');
        Capsule::table(self::RUNS)->where('id', (int) $runId)->update($data);
        return $this->findRun($runId);
    }

    /** Runs whose next step is due. Terminal runs are never returned. */
    public function dueRuns($now, $limit = 100)
    {
        $rows = Capsule::table(self::RUNS)
            ->whereIn('status', array(AutomationRunStatus::RUNNING, AutomationRunStatus::WAITING))
            ->where('next_run_at', '<=', (string) $now)
            ->orderBy('next_run_at', 'asc')
            ->limit(max(1, (int) $limit))
            ->get();
        return $rows ? $rows->all() : array();
    }

    /** Live (non-terminal) runs of one automation, for archiving/pausing. */
    public function liveRuns($automationId)
    {
        $rows = Capsule::table(self::RUNS)
            ->where('automation_id', (int) $automationId)
            ->whereIn('status', array(AutomationRunStatus::RUNNING, AutomationRunStatus::WAITING))
            ->limit(10000)
            ->get();
        return $rows ? $rows->all() : array();
    }

    /** Live runs of one subscriber across every automation (used on unsubscribe). */
    public function activeRunsForSubscriber($subscriberId)
    {
        $rows = Capsule::table(self::RUNS)
            ->where('subscriber_id', (int) $subscriberId)
            ->whereIn('status', array(AutomationRunStatus::RUNNING, AutomationRunStatus::WAITING))
            ->limit(200)
            ->get();
        return $rows ? $rows->all() : array();
    }

    /**
     * Per-automation run counts plus the number of messages each automation has
     * put on the queue — the only two figures the Automations screen shows.
     */
    public function runCounts($automationId)
    {
        $counts = array();
        foreach (AutomationRunStatus::all() as $status) { $counts[$status] = 0; }
        $total = 0;
        foreach (Capsule::table(self::RUNS)->where('automation_id', (int) $automationId)->get()->all() as $row) {
            $status = (string) $row->status;
            if (isset($counts[$status])) { $counts[$status]++; }
            $total += (int) $row->sent_count;
        }
        $counts['messages'] = $total;
        return $counts;
    }

    /** Recent runs with the subscriber's address; bounded and ordered by id. */
    public function recentRuns($automationId, $limit = 25)
    {
        $rows = Capsule::table(self::RUNS)->where('automation_id', (int) $automationId)->orderBy('id', 'desc')->limit(max(1, (int) $limit))->get();
        return $rows ? $rows->all() : array();
    }

    /** Every run count on one screen, without a query per automation. */
    public function countsByAutomation()
    {
        $counts = array();
        foreach (Capsule::table(self::RUNS)->limit(20000)->get()->all() as $row) {
            $id = (int) $row->automation_id;
            if (!isset($counts[$id])) { $counts[$id] = array('running' => 0, 'waiting' => 0, 'completed' => 0, 'cancelled' => 0, 'failed' => 0, 'messages' => 0); }
            $status = (string) $row->status;
            if (isset($counts[$id][$status])) { $counts[$id][$status]++; }
            $counts[$id]['messages'] += (int) $row->sent_count;
        }
        return $counts;
    }

    /** Whether the automation has at least one step that sends an email. */
    public function hasSendStep($automationId)
    {
        foreach ($this->steps($automationId) as $step) {
            if (AutomationStepType::isSending((string) $step->step_type)) { return true; }
        }
        return false;
    }
}
