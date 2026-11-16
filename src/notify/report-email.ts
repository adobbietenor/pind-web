// The report alert's email (A24, 16 Nov 2026), on its own with no Worker imports so a unit test
// can read it (tests/unit/a24.test.ts R01). Never a message's words: reports are on people.

export const REASON: Record<string, string> = {
  uncomfortable: "Made me uncomfortable",
  not_who_they_said: "Not who they said they were",
  under_19: "Under 19",
  spam: "Spam",
};

export interface ReportAlert {
  report_id: string;
  reason: string;
  target_kind: string;
  person_id: string | null;
  first_name: string | null;
  crew_name: string | null;
  hidden: boolean | null;
  reports_on_them: number;
  created_at: string;
}

// The email, on its own so a unit test can read it.
export function reportEmail(a: ReportAlert, origin: string): { subject: string; text: string } {
  const who = a.target_kind === "crew" ? `the squad "${a.crew_name ?? "?"}"` : (a.first_name ?? "someone");
  const link = a.person_id ? `${origin}/admin/reports#person-${a.person_id}` : `${origin}/admin/reports`;
  return {
    subject: `Pin'd report: ${REASON[a.reason] ?? a.reason} — ${who}`,
    text: [
      `A new report on ${who}: ${REASON[a.reason] ?? a.reason}.`,
      a.person_id ? `${a.hidden ? "They are hidden now (H9)." : "They are still visible."} Reports on them in all: ${a.reports_on_them}.` : "",
      `Filed ${a.created_at.slice(0, 16).replace("T", " ")} UTC.`,
      "",
      `Review it, hide or ban: ${link}`,
    ]
      .filter((l) => l !== "")
      .join("\n"),
  };
}

