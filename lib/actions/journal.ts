"use server";

import { revalidatePath } from "next/cache";
import { ActionError, runAction } from "@/lib/actions/result";
import { assertPermission } from "@/lib/auth/session";
import { todayIso } from "@/lib/utils/date";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function checkScore(score: number | null) {
  if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) {
    throw new ActionError("Baho 1 dan 5 gacha bo'lishi kerak");
  }
}

function checkSubject(subject: string) {
  const s = subject.trim();
  if (s.length < 1 || s.length > 80) throw new ActionError("Fanni tanlang");
  return s;
}

function saveError(error: { code?: string; message: string }): never {
  if (error.code === "42501") throw new ActionError("Bu sinfga baho qo'yish huquqingiz yo'q");
  if (error.code === "23514" || error.code === "42P01" || error.code === "PGRST205") {
    throw new ActionError("Elektron jurnal bazada yoqilmagan — 0077_school_journal.sql migratsiyasini ishga tushiring.");
  }
  throw new ActionError("Bahoni saqlab bo'lmadi: " + error.message);
}

/**
 * Jurnal katagi: o'quvchiga shu kuni shu fandan joriy baho qo'yadi, o'zgartiradi
 * yoki (score = null) o'chiradi. Kelajakdagi sanaga baho qo'yilmaydi.
 */
export async function setJournalGrade(input: {
  groupId: string;
  studentId: string;
  subject: string;
  date: string;
  score: number | null;
}) {
  return runAction(async () => {
    if (!UUID.test(input.groupId) || !UUID.test(input.studentId)) throw new ActionError("Ma'lumotlar noto'g'ri");
    if (!ISO_DATE.test(input.date)) throw new ActionError("Sana noto'g'ri");
    if (input.date > todayIso()) throw new ActionError("Kelajakdagi sanaga baho qo'yib bo'lmaydi");
    checkScore(input.score);
    const subject = checkSubject(input.subject);

    const { supabase, org } = await assertPermission("grades.manage");

    const { data: existing, error: findError } = await supabase
      .from("grades")
      .select("id")
      .eq("student_id", input.studentId)
      .eq("subject", subject)
      .eq("graded_on", input.date)
      .eq("kind", "lesson")
      .maybeSingle();
    if (findError) saveError(findError);

    if (input.score === null) {
      if (existing) {
        const { error } = await supabase.from("grades").delete().eq("id", existing.id);
        if (error) saveError(error);
      }
    } else if (existing) {
      const { data, error } = await supabase
        .from("grades")
        .update({ score: input.score })
        .eq("id", existing.id)
        .select("id");
      if (error) saveError(error);
      if (!data?.length) throw new ActionError("Bu sinfga baho qo'yish huquqingiz yo'q");
    } else {
      const { error } = await supabase.from("grades").insert({
        org_id: org.id,
        student_id: input.studentId,
        group_id: input.groupId,
        subject,
        kind: "lesson",
        score: input.score,
        graded_on: input.date,
      });
      if (error) saveError(error);
    }

    revalidatePath("/education/grades");
  });
}

/** Chorak (yakuniy) bahosi: qo'yadi, o'zgartiradi yoki (score = null) o'chiradi. */
export async function setPeriodGrade(input: {
  groupId: string;
  studentId: string;
  subject: string;
  periodId: string;
  score: number | null;
}) {
  return runAction(async () => {
    if (!UUID.test(input.groupId) || !UUID.test(input.studentId) || !UUID.test(input.periodId)) {
      throw new ActionError("Ma'lumotlar noto'g'ri");
    }
    checkScore(input.score);
    const subject = checkSubject(input.subject);
    const { supabase, org } = await assertPermission("grades.manage");

    if (input.score === null) {
      const { error } = await supabase
        .from("period_grades")
        .delete()
        .eq("student_id", input.studentId)
        .eq("subject", subject)
        .eq("period_id", input.periodId);
      if (error) saveError(error);
    } else {
      const { data, error } = await supabase
        .from("period_grades")
        .upsert(
          {
            org_id: org.id,
            student_id: input.studentId,
            group_id: input.groupId,
            period_id: input.periodId,
            subject,
            score: input.score,
          },
          { onConflict: "student_id,subject,period_id" },
        )
        .select("id");
      if (error) saveError(error);
      if (!data?.length) throw new ActionError("Bu sinfga baho qo'yish huquqingiz yo'q");
    }

    revalidatePath("/education/grades");
  });
}
