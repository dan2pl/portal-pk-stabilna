export type CaseStatus =
  | "NEW"
  | "ANALYSIS"
  | "ANALYSIS_DOCS_NEEDED"
  | "ANALYSIS_POSITIVE"
  | "ANALYSIS_NEGATIVE"
  | "CONTRACT_PREP"
  | "CONTRACT_DOCS_NEEDED"
  | "CONTRACT_AT_AGENT"
  | "CONTRACT_SIGNED"
  | "IN_PROGRESS"
  | "CLOSED_SUCCESS"
  | "CLOSED_FAIL"
  | "CLIENT_RESIGNED";

export const CASE_STATUS_DEFS: Record<
  CaseStatus,
  { label: string; group: "pipeline" | "closed" | "special"; order: number }
> = {
  NEW: { label: "Nowa", group: "pipeline", order: 10 },
  ANALYSIS: { label: "W analizie", group: "pipeline", order: 20 },
  ANALYSIS_DOCS_NEEDED: {
    label: "Braki dokumentów do analizy",
    group: "pipeline",
    order: 25,
  },
  ANALYSIS_POSITIVE: {
    label: "Analiza pozytywna",
    group: "pipeline",
    order: 30,
  },
  ANALYSIS_NEGATIVE: {
    label: "Odrzucona w analizie",
    group: "closed",
    order: 90,
  },
  CONTRACT_PREP: {
    label: "Przygotowanie umowy",
    group: "pipeline",
    order: 40,
  },
  CONTRACT_DOCS_NEEDED: {
    label: "Oczekiwanie na dokumenty do wykupu",
    group: "pipeline",
    order: 45,
  },
  CONTRACT_AT_AGENT: {
    label: "Umowa u agenta",
    group: "pipeline",
    order: 50,
  },
  CONTRACT_SIGNED: {
    label: "Umowa zawarta",
    group: "pipeline",
    order: 60,
  },
  IN_PROGRESS: { label: "W toku", group: "pipeline", order: 70 },
  CLOSED_SUCCESS: {
    label: "Zakończona – Sukces",
    group: "closed",
    order: 100,
  },
  CLOSED_FAIL: {
    label: "Zakończona – Przegrana",
    group: "closed",
    order: 110,
  },
  CLIENT_RESIGNED: {
    label: "Rezygnacja klienta",
    group: "closed",
    order: 120,
  },
};

export function isValidCaseStatus(value: any): value is CaseStatus {
  return (
    typeof value === "string" &&
    Object.keys(CASE_STATUS_DEFS).includes(value)
  );
}