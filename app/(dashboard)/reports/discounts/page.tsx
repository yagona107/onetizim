import { requirePermission } from "@/lib/auth/session";
import { ReportCards, ReportTable } from "@/components/reports/ReportParts";
import { formatSom } from "@/lib/utils/currency";
import { termsFor } from "@/lib/segment";

interface DiscountStudent {
  id: string;
  full_name: string;
  discount_percent?: number | null;
  discount_reason?: string | null;
  group: { name: string; course: { name: string } | null } | null;
}

interface ContractRow {
  discount_amount: number;
  student: DiscountStudent | null;
}

interface ChargeRow {
  discount: number;
  student: DiscountStudent | null;
}

/** Umumiy chegirmalar: faol shartnomalar bo'yicha har bir o'quvchi olgan chegirma summasi (Edu tizimdagidek). */
export default async function DiscountsReportPage() {
  const { supabase, org } = await requirePermission("finance.reports");
  const terms = termsFor(org.type);

  const STUDENT_SELECT = "id, full_name, discount_percent, discount_reason, group:groups(name, course:courses(name))";
  const [{ data }, chargesRes] = await Promise.all([
    supabase
      .from("contracts")
      .select(`discount_amount, student:students(${STUDENT_SELECT})`)
      .eq("status", "active")
      .gt("discount_amount", 0)
      .limit(5000),
    // Oylik hisobda qo'llangan o'quvchi chegirmalari (0076: aka-uka, a'lochi...).
    supabase
      .from("charges")
      .select(`discount, student:students(${STUDENT_SELECT})`)
      .gt("discount", 0)
      .limit(10000),
  ]);
  const contracts = (data ?? []) as unknown as ContractRow[];
  const charged = (chargesRes.error ? [] : (chargesRes.data ?? [])) as unknown as ChargeRow[];

  const byStudent = new Map<
    string,
    { name: string; course: string; group: string; reason: string; sum: number }
  >();
  const add = (student: DiscountStudent | null, amount: number) => {
    if (!student) return;
    const cur = byStudent.get(student.id) ?? {
      name: student.full_name,
      course: student.group?.course?.name ?? "—",
      group: student.group?.name ?? "—",
      reason:
        student.discount_percent && student.discount_percent > 0
          ? `${student.discount_percent}% · ${student.discount_reason ?? ""}`
          : "—",
      sum: 0,
    };
    cur.sum += amount;
    byStudent.set(student.id, cur);
  };
  for (const c of contracts) add(c.student, Number(c.discount_amount));
  for (const c of charged) add(c.student, Number(c.discount));
  const rows = [...byStudent.entries()].map(([id, v]) => ({ id, ...v })).sort((a, b) => b.sum - a.sum);
  const total = rows.reduce((s, r) => s + r.sum, 0);

  return (
    <div className="space-y-4">
      <ReportCards
        items={[
          { label: "Umumiy bonuslar", value: formatSom(0) },
          { label: "Umumiy chegirmalar", value: formatSom(total), tone: "bad" },
          { label: "Chegirmali o'quvchilar", value: rows.length },
          { label: "Chegirmali shartnomalar", value: contracts.length },
          { label: "Oylik hisobdagi chegirmalar", value: charged.length },
        ]}
      />
      <ReportTable
        rows={rows}
        rowKey={(r) => r.id}
        columns={[
          { header: "Ism", cell: (r) => <span className="font-medium text-ink">{r.name}</span> },
          ...(org.type === "maktab" ? [] : [{ header: "Kurs", cell: (r: (typeof rows)[number]) => r.course }]),
          { header: terms.group, cell: (r) => r.group },
          { header: "Chegirma", cell: (r) => r.reason },
          { header: "Umumiy olgan chegirmasi", align: "right", cell: (r) => formatSom(r.sum) },
          { header: "Bonus", align: "right", cell: () => formatSom(0) },
        ]}
      />
    </div>
  );
}
