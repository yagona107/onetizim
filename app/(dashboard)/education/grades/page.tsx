import { requirePermission } from "@/lib/auth/session";
import { GradeFilters } from "@/components/grades/GradeFilters";
import { GradeJournal } from "@/components/grades/GradeJournal";
import { GradeChip } from "@/components/grades/GradeChip";
import { JournalFilters, SchoolJournal } from "@/components/grades/SchoolJournal";
import { formatDate, todayIso } from "@/lib/utils/date";
import {
  GRADE_KIND_LABELS,
  averageScore,
  type GradeKind,
} from "@/lib/validations/grade";

interface GradeRow {
  id: string;
  student_id: string;
  subject: string;
  kind: GradeKind;
  score: number;
  graded_on: string;
}

/** Bir o'quvchi qatorida ko'rsatiladigan oxirgi baholar soni. */
const RECENT_LIMIT = 15;

export default async function GradesPage({
  searchParams,
}: {
  searchParams: Promise<{ group?: string; subject?: string; period?: string }>;
}) {
  const params = await searchParams;
  const { supabase, org, permissions, employeeId } = await requirePermission("grades.manage");
  if (org.type === "maktab") {
    return (
      <SchoolJournalView
        params={params}
        supabase={supabase}
        employeeId={permissions.includes("groups.manage") ? null : employeeId}
      />
    );
  }
  const { data: groups } = await supabase.from("groups").select("id, name").order("name");

  if (!groups || groups.length === 0) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold text-ink">Baholar</h1>
        <div className="rounded-xl border border-line p-8 text-center text-ink-faint">
          Avval kamida bitta sinf yarating.
        </div>
      </div>
    );
  }

  const groupId =
    params.group && groups.some((g) => g.id === params.group) ? params.group : groups[0].id;
  const subject = (params.subject ?? "").trim();

  let gradesQuery = supabase
    .from("grades")
    .select("id, student_id, subject, kind, score, graded_on")
    .eq("group_id", groupId)
    .order("graded_on", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(2000);
  if (subject) gradesQuery = gradesQuery.eq("subject", subject);

  const [{ data: students }, gradesResult, { data: lessons }, { data: courses }] =
    await Promise.all([
      supabase
        .from("students")
        .select("id, full_name")
        .eq("group_id", groupId)
        .eq("status", "active")
        .order("full_name"),
      gradesQuery,
      supabase.from("lessons").select("subject").eq("group_id", groupId),
      supabase.from("courses").select("name").order("name"),
    ]);

  const studentList = students ?? [];
  const grades = (gradesResult.data ?? []) as GradeRow[];

  const subjects = [
    ...new Set([
      ...(lessons ?? []).map((l) => l.subject as string),
      ...(courses ?? []).map((c) => c.name as string),
      ...grades.map((g) => g.subject),
    ]),
  ].sort();

  const gradesByStudent = new Map<string, GradeRow[]>();
  for (const g of grades) {
    const list = gradesByStudent.get(g.student_id) ?? [];
    list.push(g);
    gradesByStudent.set(g.student_id, list);
  }

  function subjectAverages(list: GradeRow[]) {
    const bySubject = new Map<string, number[]>();
    for (const g of list) bySubject.set(g.subject, [...(bySubject.get(g.subject) ?? []), g.score]);
    return [...bySubject.entries()]
      .map(([name, scores]) => `${name} ${averageScore(scores)}`)
      .join(" · ");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-ink">Baholar</h1>

      {gradesResult.error && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Baholar jadvali bazada topilmadi — 0029_grades.sql migratsiyasini Supabase SQL
          Editor&apos;da ishga tushiring.
        </p>
      )}

      <GradeFilters groups={groups} groupId={groupId} subject={subject} subjects={subjects} />

      {studentList.length === 0 ? (
        <div className="rounded-xl border border-line p-8 text-center text-ink-faint">
          Bu sinfda aktiv o&apos;quvchi yo&apos;q.
        </div>
      ) : (
        <>
          <GradeJournal
            key={`${groupId}-${subject}`}
            groupId={groupId}
            students={studentList as { id: string; full_name: string }[]}
            subject={subject}
            subjects={subjects}
            today={todayIso()}
          />

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-canvas text-ink-muted">
                <tr>
                  <th className="px-4 py-3 font-medium">O&apos;quvchi</th>
                  <th className="px-4 py-3 font-medium">O&apos;rtacha</th>
                  <th className="px-4 py-3 font-medium">
                    Baholar{subject ? ` — ${subject}` : ""}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {studentList.map((s) => {
                  const list = gradesByStudent.get(s.id) ?? [];
                  const avg = averageScore(list.map((g) => g.score));
                  return (
                    <tr key={s.id} className="align-top">
                      <td className="px-4 py-3 whitespace-nowrap text-ink">{s.full_name}</td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-ink">{avg ?? "—"}</div>
                        {!subject && list.length > 0 && (
                          <div className="mt-0.5 max-w-xs text-xs text-ink-faint">
                            {subjectAverages(list)}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {list.length === 0 ? (
                          <span className="text-ink-faint">Hali baho yo&apos;q</span>
                        ) : (
                          <div className="flex flex-wrap gap-1.5">
                            {list.slice(0, RECENT_LIMIT).map((g) => (
                              <GradeChip
                                key={g.id}
                                id={g.id}
                                score={g.score}
                                title={`${g.subject} · ${GRADE_KIND_LABELS[g.kind]} · ${formatDate(g.graded_on)}`}
                              />
                            ))}
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

type Supa = Awaited<ReturnType<typeof requirePermission>>["supabase"];

/** Chorak kiritilmagan bo'lsa jurnal so'nggi shuncha kunni ko'rsatadi. */
const FALLBACK_DAYS = 35;

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Dushanba ... 7 = Yakshanba */
function isoWeekday(iso: string) {
  return ((new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/**
 * Maktab elektron jurnali: sinf + fan + chorak. Ustunlar — dars jadvaliga ko'ra shu fan o'tiladigan
 * kunlar (chorak boshidan bugungacha) va baho qo'yilgan kunlar.
 */
async function SchoolJournalView({
  params,
  supabase,
  employeeId,
}: {
  params: { group?: string; subject?: string; period?: string };
  supabase: Supa;
  /** null — boshqaruv (hamma sinf va fanlar); aks holda o'qituvchi. */
  employeeId: string | null;
}) {
  const today = todayIso();
  const [groupsRes, lessonsRes, periodsRes] = await Promise.all([
    supabase.from("groups").select("id, name, teacher_id").eq("status", "active").order("name"),
    supabase.from("lessons").select("id, group_id, subject, weekday, teacher_id"),
    supabase.from("academic_periods").select("id, name, start_date, end_date").order("start_date"),
  ]);
  const allGroups = (groupsRes.data ?? []) as { id: string; name: string; teacher_id: string | null }[];
  const allLessons = (lessonsRes.data ?? []) as {
    id: string;
    group_id: string;
    subject: string;
    weekday: number;
    teacher_id: string | null;
  }[];
  const periods = (periodsRes.data ?? []) as { id: string; name: string; start_date: string; end_date: string }[];

  // O'qituvchi: sinf rahbari bo'lgan sinfda barcha fanlar, boshqa sinflarda faqat o'zi o'tadigan fanlar.
  const leads = new Set(employeeId ? allGroups.filter((g) => g.teacher_id === employeeId).map((g) => g.id) : []);
  const lessons = employeeId
    ? allLessons.filter((l) => l.teacher_id === employeeId || leads.has(l.group_id))
    : allLessons;
  const groups = allGroups
    .filter((g) => !employeeId || leads.has(g.id) || lessons.some((l) => l.group_id === g.id))
    .sort((a, b) => a.name.localeCompare(b.name, "uz", { numeric: true }));

  const header = <h1 className="text-xl font-semibold text-ink">Elektron jurnal</h1>;
  if (groups.length === 0) {
    return (
      <div className="space-y-4">
        {header}
        <div className="rounded-xl border border-line p-8 text-center text-ink-faint">
          {employeeId ? "Sizga biriktirilgan sinf yoki fan yo'q." : "Avval kamida bitta sinf oching."}
        </div>
      </div>
    );
  }

  const groupId = params.group && groups.some((g) => g.id === params.group) ? params.group : groups[0].id;
  const groupLessons = lessons.filter((l) => l.group_id === groupId);
  const subjects = [...new Set(groupLessons.map((l) => l.subject))].sort((a, b) => a.localeCompare(b, "uz"));
  const subject = params.subject && subjects.includes(params.subject) ? params.subject : (subjects[0] ?? "");

  const period =
    periods.find((p) => p.id === params.period) ??
    periods.find((p) => p.start_date <= today && today <= p.end_date) ??
    [...periods].reverse().find((p) => p.start_date <= today) ??
    periods[0] ??
    null;
  const from = period?.start_date ?? addDays(today, -FALLBACK_DAYS);
  const to = period ? (period.end_date < today ? period.end_date : today) : today;

  const subjectLessons = groupLessons.filter((l) => l.subject === subject);
  const weekdays = new Set(subjectLessons.map((l) => l.weekday));

  const [studentsRes, gradesRes, absencesRes, periodGradesRes] = await Promise.all([
    supabase.from("students").select("id, full_name").eq("group_id", groupId).eq("status", "active").order("full_name"),
    subject
      ? supabase
          .from("grades")
          .select("student_id, kind, score, graded_on")
          .eq("group_id", groupId)
          .eq("subject", subject)
          .gte("graded_on", from)
          .lte("graded_on", period?.end_date ?? today)
      : Promise.resolve({ data: [], error: null }),
    subjectLessons.length
      ? supabase
          .from("lesson_attendance")
          .select("student_id, lesson_date")
          .eq("status", "absent")
          .in("lesson_id", subjectLessons.map((l) => l.id))
          .gte("lesson_date", from)
          .lte("lesson_date", to)
      : Promise.resolve({ data: [], error: null }),
    period && subject
      ? supabase
          .from("period_grades")
          .select("student_id, score")
          .eq("group_id", groupId)
          .eq("subject", subject)
          .eq("period_id", period.id)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const gradeRows = (gradesRes.data ?? []) as { student_id: string; kind: string; score: number; graded_on: string }[];
  const lessonGrades: Record<string, number> = {};
  const otherScores: Record<string, number[]> = {};
  const dateSet = new Set<string>();
  for (let d = from; d <= to; d = addDays(d, 1)) if (weekdays.has(isoWeekday(d))) dateSet.add(d);
  for (const g of gradeRows) {
    if (g.kind === "lesson") {
      lessonGrades[`${g.student_id}|${g.graded_on}`] = g.score;
      dateSet.add(g.graded_on);
    } else {
      (otherScores[g.student_id] ??= []).push(g.score);
    }
  }
  const periodGrades: Record<string, number> = {};
  for (const p of (periodGradesRes.data ?? []) as { student_id: string; score: number }[]) {
    periodGrades[p.student_id] = p.score;
  }
  const absences = ((absencesRes.data ?? []) as { student_id: string; lesson_date: string }[]).map(
    (a) => `${a.student_id}|${a.lesson_date}`,
  );
  const migrationMissing = Boolean(periodGradesRes.error);

  return (
    <div className="space-y-4">
      <div>
        {header}
        <p className="text-sm text-ink-faint">
          {period
            ? `${period.name}: ${formatDate(period.start_date)} – ${formatDate(period.end_date)}`
            : `So'nggi ${FALLBACK_DAYS} kun`}
        </p>
      </div>

      {migrationMissing && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Elektron jurnal uchun 0077_school_journal.sql migratsiyasini Supabase SQL Editor&apos;da ishga tushiring.
        </p>
      )}
      {periods.length === 0 && (
        <p className="rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-300">
          Choraklar kiritilmagan — O&apos;quv bo&apos;limi → Choraklar bo&apos;limida qo&apos;shing.
        </p>
      )}

      <JournalFilters
        groups={groups.map((g) => ({ id: g.id, name: g.name }))}
        groupId={groupId}
        subjects={subjects}
        subject={subject}
        periods={periods.map((p) => ({ id: p.id, name: p.name }))}
        periodId={period?.id ?? null}
      />

      {!subject ? (
        <div className="rounded-xl border border-line p-8 text-center text-sm text-ink-faint">
          Bu sinf uchun dars jadvalida fan yo&apos;q.
        </div>
      ) : (
        <SchoolJournal
          key={`${groupId}-${subject}-${period?.id ?? ""}`}
          groupId={groupId}
          subject={subject}
          periodId={migrationMissing ? null : (period?.id ?? null)}
          students={(studentsRes.data ?? []) as { id: string; full_name: string }[]}
          dates={[...dateSet].sort()}
          lessonGrades={lessonGrades}
          otherScores={otherScores}
          absences={absences}
          periodGrades={periodGrades}
          today={today}
        />
      )}
    </div>
  );
}
