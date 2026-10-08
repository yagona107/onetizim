-- 0077_school_journal.sql
-- Xususiy maktab elektron jurnali:
-- 1) grades.kind ga 'lesson' (darsdagi joriy baho) qo'shiladi — jurnal katagi shu tur bilan yoziladi.
-- 2) period_grades — chorak (academic_periods) bo'yicha yakuniy baho, har fan uchun bittadan.

alter table grades drop constraint if exists grades_kind_check;
alter table grades
  add constraint grades_kind_check check (kind in ('lesson', 'homework', 'quiz', 'midterm', 'exam', 'final'));

-- Jurnal katagi: bir o'quvchiga bir kunda bir fandan bitta joriy baho.
create unique index if not exists grades_lesson_unique_idx
  on grades (student_id, subject, graded_on) where kind = 'lesson';

create table if not exists period_grades (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  group_id uuid not null references groups(id) on delete cascade,
  period_id uuid not null references academic_periods(id) on delete cascade,
  subject text not null check (char_length(subject) between 1 and 80),
  score smallint not null check (score between 1 and 5),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_id, subject, period_id)
);

create index if not exists period_grades_group_idx on period_grades (org_id, group_id, period_id, subject);

drop trigger if exists period_grades_touch on period_grades;
create trigger period_grades_touch before update on period_grades
  for each row execute function public.touch_updated_at();

alter table period_grades enable row level security;

drop policy if exists period_grades_manage on period_grades;
create policy period_grades_manage on period_grades
  for all using (can_manage_org(org_id))
  with check (
    can_manage_org(org_id)
    and exists (
      select 1 from students s
      where s.id = student_id and s.org_id = period_grades.org_id and s.group_id = period_grades.group_id
    )
    and exists (select 1 from academic_periods p where p.id = period_id and p.org_id = period_grades.org_id)
  );

drop policy if exists period_grades_teacher on period_grades;
create policy period_grades_teacher on period_grades
  for all using (teaches_group(group_id))
  with check (
    teaches_group(group_id)
    and exists (
      select 1 from students s
      where s.id = student_id and s.org_id = period_grades.org_id and s.group_id = period_grades.group_id
    )
    and exists (select 1 from academic_periods p where p.id = period_id and p.org_id = period_grades.org_id)
  );
