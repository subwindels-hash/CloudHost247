<?php
namespace CloudHost247\NetworkTools\Services\Productivity;

use CloudHost247\NetworkTools\Core\Result\ToolResult;
use CloudHost247\NetworkTools\Services\Service;
use InvalidArgumentException;

/**
 * Time card calculator (docs section 60).
 *
 * Parses one line per shift ("09:00-17:00,30"), supports overnight shifts, and
 * computes worked time, breaks, overtime and an optional pay estimate. All
 * arithmetic is plain time maths on the values you entered; the result states
 * which rules it applied so a payroll decision is never based on a hidden
 * assumption. Nothing is stored.
 */
final class TimeCardService extends Service
{
    protected function execute()
    {
        $raw = str_replace(array("\r\n", "\r"), "\n", (string) $this->input['shifts']);
        $overtimeAfter = max(1, min(24, (float) (isset($this->input['overtime_after']) ? $this->input['overtime_after'] : 8)));
        $rate = $this->parseRate(isset($this->input['rate']) ? (string) $this->input['rate'] : '');
        $lines = explode("\n", trim($raw));
        $shifts = array();
        $problems = array();
        $totalMinutes = 0;
        $breakMinutes = 0;
        $overtimeMinutes = 0;
        $lineNumber = 0;
        foreach ($lines as $line) {
            $lineNumber++;
            $line = trim($line);
            if ($line === '') {
                continue;
            }
            if (!preg_match('/^\s*(\d{1,2}):(\d{2})\s*[-–to]+\s*(\d{1,2}):(\d{2})\s*(?:,\s*(\d{1,4}))?\s*$/i', $line, $matches)) {
                $problems[] = 'Line ' . $lineNumber . ' ("' . substr($line, 0, 40) . '") is not in the form HH:MM-HH:MM,break. It was skipped.';
                continue;
            }
            $start = ((int) $matches[1]) * 60 + (int) $matches[2];
            $end = ((int) $matches[3]) * 60 + (int) $matches[4];
            $break = isset($matches[5]) && $matches[5] !== '' ? (int) $matches[5] : 0;
            $overnight = false;
            if ($end <= $start) {
                $end += 24 * 60;
                $overnight = true;
            }
            $gross = $end - $start;
            if ($break >= $gross) {
                $problems[] = 'Line ' . $lineNumber . ': the break (' . $break . ' minutes) is not shorter than the shift (' . $gross . ' minutes). The break was treated as the whole shift.';
                $break = $gross;
            }
            $worked = $gross - $break;
            $overtime = max(0, $worked - (int) round($overtimeAfter * 60));
            $shifts[] = array(
                'line' => $lineNumber,
                'input' => $line,
                'start' => sprintf('%02d:%02d', (int) $matches[1], (int) $matches[2]),
                'end' => sprintf('%02d:%02d', (int) $matches[3], (int) $matches[4]),
                'overnight' => $overnight,
                'gross_minutes' => $gross,
                'break_minutes' => $break,
                'worked_minutes' => $worked,
                'worked' => $this->formatMinutes($worked),
                'overtime_minutes' => $overtime,
                'overtime' => $overtime > 0 ? $this->formatMinutes($overtime) : '0m',
            );
            $totalMinutes += $worked;
            $breakMinutes += $break;
            $overtimeMinutes += $overtime;
        }
        if (!$shifts) {
            throw new InvalidArgumentException($problems ? implode(' ', array_slice($problems, 0, 3)) : 'Enter at least one shift, for example 09:00-17:00,30.');
        }
        $data = array(
            'shifts' => $shifts,
            'shift_count' => count($shifts),
            'total_worked_minutes' => $totalMinutes,
            'total_worked' => $this->formatMinutes($totalMinutes),
            'total_break_minutes' => $breakMinutes,
            'total_break' => $this->formatMinutes($breakMinutes),
            'overtime_after_hours' => $overtimeAfter,
            'overtime_minutes' => $overtimeMinutes,
            'overtime' => $this->formatMinutes($overtimeMinutes),
            'regular_minutes' => $totalMinutes - $overtimeMinutes,
            'regular' => $this->formatMinutes($totalMinutes - $overtimeMinutes),
            'rules' => 'Each shift is clock-out minus clock-in, minus the break you entered. An end time at or before the start time is treated as an overnight shift. Overtime is the part of a shift beyond ' . $overtimeAfter . ' worked hours; no jurisdiction-specific multiplier is applied.',
            'problems' => $problems,
        );
        $warnings = $problems;
        if ($rate !== null) {
            $data['rate'] = $rate;
            $data['pay_estimate'] = array(
                'amount' => round(($totalMinutes - $overtimeMinutes) / 60 * $rate, 2),
                'overtime_amount' => round($overtimeMinutes / 60 * $rate, 2),
                'currency' => 'the currency unit you typed',
                'note' => 'Overtime hours are priced at the same rate as regular hours here. Overtime premiums, taxes, rounding rules and unpaid breaks are payroll decisions this calculator cannot make for you.',
            );
        }
        $data['summary'] = 'Total worked time: ' . $this->formatMinutes($totalMinutes) . ' over ' . count($shifts) . ' shift(s)' . ($overtimeMinutes > 0 ? ', of which ' . $this->formatMinutes($overtimeMinutes) . ' is overtime' : '') . '.';
        $data['privacy'] = 'Your shifts and rate were used for this calculation only and were not stored.';
        return ToolResult::success($data, $warnings, array('stored' => false));
    }

    private function parseRate($value)
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        if (!preg_match('/^[0-9]+(?:[.,][0-9]{1,2})?\s*(?:[A-Za-z£$€¥]{1,4})?$/', $value)) {
            return null;
        }
        $number = (float) str_replace(',', '.', preg_replace('/[^0-9.,]/', '', $value));
        return $number > 0 && $number < 100000 ? $number : null;
    }

    private function formatMinutes($minutes)
    {
        $minutes = max(0, (int) $minutes);
        $hours = intdiv($minutes, 60);
        $rest = $minutes % 60;
        if ($hours === 0) {
            return $rest . 'm';
        }
        return $hours . 'h ' . str_pad((string) $rest, 2, '0', STR_PAD_LEFT) . 'm';
    }
}
