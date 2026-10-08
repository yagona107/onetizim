"use client";

import { useMemo, useState, useTransition, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/Label";
import { Select } from "@/components/ui/Select";
import { setJournalGrade, setPeriodGrade } from "@/lib/actions/journal";
import { averageScore } from "@/lib/validations/grade";

const SCORE_CLASS: Record<number, string> = {
  5: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  4: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300",
  3: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  2: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
  1: "bg-red-200 text-red-900 dark:bg-red-500/25 dark:text-red-200",
};
const WEEKDAY_SHORT = ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"];
const PERIOD_COL = "period";

export interface JournalOption {
  id: string;
  name: string;
}

/** Sinf, fan va chorak tanlovi (URL parametrlari orqali). */
export function JournalFilters({
  groups,
  groupId,
  subjects,
  subject,
  periods,
  periodId,
}: {
  groups: JournalOption[];
  groupId: string;
  subjects: string[];
  subject: string;
  periods: JournalOption[];
  periodId: string | null;
}) {
  const router = useRouter();
  function go(next: { group?: string; subject?: string; period?: string }) {
    const params = new URLSearchParams();
    params.set("group", next.group ?? groupId);
    // Sinf almashsa fan qayta tanlanadi (boshqa sinfda bu fan bo'lmasligi mumkin).
    const nextSubject = next.group && next.group !== groupId ? "" : (next.subject ?? subject);
    if (nextSubject) params.set("subject", nextSubject);
    const nextPeriod = next.period ?? periodId;
    if (nextPeriod) params.set("period", nextPeriod);
    router.push(`/education/grades?${params}`);
  }

  return (
    <div className="flex flex-wrap gap-4">
      <div className="w-40">
        <Label htmlFor="journal-group">Sinf</Label>
        <Select id="journal-group" value={groupId} onChange={(e) => go({ group: e.target.value })}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="w-56">
        <Label htmlFor="journal-subject">Fan</Label>
        <Select id="journal-subject" value={subject} onChange={(e) => go({ subject: e.target.value })}>
          {subjects.length === 0 && <option value="">Fan yo&apos;q</option>}
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      </div>
      {periods.length > 0 && (
        <div className="w-44">
          <Label htmlFor="journal-period">Chorak</Label>
          <Select id="journal-period" value={periodId ?? ""} onChange={(e) => go({ period: e.target.value })}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}

interface Cell {
  studentId: string;
  /** ISO sana yoki PERIOD_COL (chorak bahosi). */
  col: string;
}

/**
 * Elektron jurnal: o'quvchilar × dars sanalari. Katak tanlanib 1–5 tugmasi (yoki klaviaturada 1–5)
 * bosilsa baho qo'yiladi, Delete — o'chiradi. Oxirgi ustun — chorak bahosi (o'rtachadan tavsiya).
 */
export function SchoolJournal({
  groupId,
  subject,
  periodId,
  students,
  dates,
  lessonGrades: initialLessonGrades,
  otherScores,
  absences,
  periodGrades: initialPeriodGrades,
  today,
}: {
  groupId: string;
  subject: string;
  periodId: string | null;
  students: { id: string; full_name: string }[];
  /** Dars sanalari (o'sish tartibida). */
  dates: string[];
  /** `${studentId}|${date}` → darsdagi baho. */
  lessonGrades: Record<string, number>;
  /** Shu chorakdagi boshqa turdagi baholar (nazorat, imtihon...) — o'rtachaga qo'shiladi. */
  otherScores: Record<string, number[]>;
  /** `${studentId}|${date}` — darsga kelmagan. */
  absences: string[];
  /** studentId → chorak bahosi. */
  periodGrades: Record<string, number>;
  today: string;
}) {
  const [lessonGrades, setLessonGrades] = useState(initialLessonGrades);
  const [periodGrades, setPeriodGrades] = useState(initialPeriodGrades);
  const [selected, setSelected] = useState<Cell | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const absent = useMemo(() => new Set(absences), [absences]);
  const columnCount = dates.length + (periodId ? 1 : 0);

  function averageOf(studentId: string) {
    const scores = dates
      .map((d) => lessonGrades[`${studentId}|${d}`])
      .filter((s): s is number => typeof s === "number")
      .concat(otherScores[studentId] ?? []);
    return averageScore(scores);
  }

  function apply(cell: Cell, score: number | null) {
    setError(null);
    if (cell.col === PERIOD_COL) {
      if (!periodId) return;
      const before = periodGrades[cell.studentId];
      setPeriodGrades((prev) => withScore(prev, cell.studentId, score));
      startTransition(async () => {
        const result = await setPeriodGrade({ groupId, studentId: cell.studentId, subject, periodId, score });
        if (!result.ok) {
          setPeriodGrades((prev) => withScore(prev, cell.studentId, before ?? null));
          setError(result.error);
        }
      });
      return;
    }
    if (cell.col > today) return setError("Kelajakdagi sanaga baho qo'yib bo'lmaydi");
    const key = `${cell.studentId}|${cell.col}`;
    const before = lessonGrades[key];
    setLessonGrades((prev) => withScore(prev, key, score));
    startTransition(async () => {
      const result = await setJournalGrade({ groupId, studentId: cell.studentId, subject, date: cell.col, score });
      if (!result.ok) {
        setLessonGrades((prev) => withScore(prev, key, before ?? null));
        setError(result.error);
      }
    });
  }

  function focusCell(row: number, col: number) {
    document.querySelector<HTMLButtonElement>(`[data-journal-cell="${row}:${col}"]`)?.focus();
  }

  function onKey(e: KeyboardEvent<HTMLButtonElement>, row: number, col: number, cell: Cell) {
    if (/^[1-5]$/.test(e.key)) {
      e.preventDefault();
      apply(cell, Number(e.key));
      // Bir sana bo'yicha ketma-ket kiritish uchun keyingi o'quvchiga o'tiladi.
      if (row + 1 < students.length) focusCell(row + 1, col);
    } else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      apply(cell, null);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusCell(Math.min(students.length - 1, row + 1), col);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusCell(Math.max(0, row - 1), col);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      focusCell(row, Math.min(columnCount - 1, col + 1));
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      focusCell(row, Math.max(0, col - 1));
    }
  }

  const selectedStudent = selected ? students.find((s) => s.id === selected.studentId) : null;
  const selectedLabel =
    selected && selectedStudent
      ? `${selectedStudent.full_name} · ${selected.col === PERIOD_COL ? "Chorak bahosi" : shortDate(selected.col)}`
      : null;

  if (students.length === 0) {
    return (
      <div className="rounded-xl border border-line p-8 text-center text-ink-faint">
        Bu sinfda aktiv o&apos;quvchi yo&apos;q.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2 text-sm shadow-sm">
        {selectedLabel ? (
          <>
            <span className="mr-1 font-medium text-ink">{selectedLabel}</span>
            {[5, 4, 3, 2, 1].map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => selected && apply(selected, s)}
                className={`h-8 w-8 rounded-md text-sm font-semibold ${SCORE_CLASS[s]} hover:opacity-80`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={() => selected && apply(selected, null)}
              className="rounded-md px-2.5 py-1.5 text-xs font-medium text-ink-muted hover:bg-canvas"
            >
              O&apos;chirish
            </button>
          </>
        ) : (
          <span className="text-ink-faint">
            Katakni tanlang va 1–5 bosing (klaviatura: 1–5, Delete, strelkalar)
          </span>
        )}
        {isPending && <span className="ml-auto text-xs text-ink-faint">Saqlanmoqda...</span>}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      {dates.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Bu chorakda hali {subject} darsi o&apos;tilmagan (dars jadvaliga ko&apos;ra).
        </p>
      )}

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-canvas text-xs text-ink-muted">
            <tr>
              <th className="sticky left-0 z-10 min-w-48 border-b border-line bg-canvas px-3 py-2 text-left font-medium">
                O&apos;quvchi
              </th>
              {dates.map((d) => (
                <th
                  key={d}
                  className={`min-w-10 border-b border-l border-line px-1 py-2 text-center font-medium ${
                    d === today ? "text-brand-600" : ""
                  }`}
                >
                  <div>{shortDate(d)}</div>
                  <div className="text-[10px] font-normal text-ink-faint">{weekdayShort(d)}</div>
                </th>
              ))}
              <th className="border-b border-l border-line px-2 py-2 text-center font-medium">O&apos;rtacha</th>
              {periodId && (
                <th className="border-b border-l border-line px-2 py-2 text-center font-medium">Chorak</th>
              )}
            </tr>
          </thead>
          <tbody>
            {students.map((s, row) => {
              const avg = averageOf(s.id);
              const suggested = avg === null ? null : Math.round(avg);
              const periodCell = { studentId: s.id, col: PERIOD_COL };
              const periodScore = periodGrades[s.id];
              return (
                <tr key={s.id}>
                  <td className="sticky left-0 z-10 border-b border-line bg-surface px-3 py-1.5 whitespace-nowrap text-ink">
                    {row + 1}. {s.full_name}
                  </td>
                  {dates.map((d, col) => {
                    const score = lessonGrades[`${s.id}|${d}`];
                    const isAbsent = absent.has(`${s.id}|${d}`);
                    const cell = { studentId: s.id, col: d };
                    const active = selected?.studentId === s.id && selected.col === d;
                    return (
                      <td key={d} className="border-b border-l border-line p-0.5 text-center">
                        <button
                          type="button"
                          data-journal-cell={`${row}:${col}`}
                          onClick={() => setSelected(cell)}
                          onFocus={() => setSelected(cell)}
                          onKeyDown={(e) => onKey(e, row, col, cell)}
                          aria-label={`${s.full_name}, ${shortDate(d)}: ${score ?? (isAbsent ? "kelmagan" : "baho yo'q")}`}
                          className={`h-8 w-full min-w-9 rounded-md text-xs font-semibold outline-none ${
                            active ? "ring-2 ring-brand-500" : ""
                          } ${
                            score
                              ? SCORE_CLASS[score]
                              : isAbsent
                                ? "text-red-500"
                                : "text-ink-faint hover:bg-canvas"
                          }`}
                        >
                          {score ?? (isAbsent ? "Nb" : "")}
                        </button>
                      </td>
                    );
                  })}
                  <td className="border-b border-l border-line px-2 text-center font-semibold text-ink">
                    {avg ?? "—"}
                  </td>
                  {periodId && (
                    <td className="border-b border-l border-line p-0.5 text-center">
                      <button
                        type="button"
                        data-journal-cell={`${row}:${dates.length}`}
                        onClick={() => setSelected(periodCell)}
                        onFocus={() => setSelected(periodCell)}
                        onKeyDown={(e) => onKey(e, row, dates.length, periodCell)}
                        title={suggested && !periodScore ? `Tavsiya: ${suggested}` : undefined}
                        aria-label={`${s.full_name}: chorak bahosi ${periodScore ?? "qo'yilmagan"}`}
                        className={`h-8 w-full min-w-10 rounded-md text-sm font-bold outline-none ${
                          selected?.studentId === s.id && selected.col === PERIOD_COL ? "ring-2 ring-brand-500" : ""
                        } ${periodScore ? SCORE_CLASS[periodScore] : "text-ink-faint hover:bg-canvas"}`}
                      >
                        {periodScore ?? (suggested ? <span className="font-normal">({suggested})</span> : "")}
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-faint">
        Nb — darsga kelmagan (davomatdan). Chorak ustunidagi qavs ichidagi raqam — o&apos;rtachadan tavsiya.
      </p>
    </div>
  );
}

function withScore(map: Record<string, number>, key: string, score: number | null) {
  const next = { ...map };
  if (score === null) delete next[key];
  else next[key] = score;
  return next;
}

function shortDate(iso: string) {
  return `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
}

function weekdayShort(iso: string) {
  return WEEKDAY_SHORT[(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7];
}
