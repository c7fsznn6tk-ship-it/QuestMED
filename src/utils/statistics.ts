import { getTemaGeral, questionBank, type Area, type Tema, type TemaGeral } from "../data/questions";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const STATS_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/daily_question_stats` : "";
const QUESTION_STATS_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/question_stats` : "";
const temaGeralByQuestionId = new Map(questionBank.map((question) => [question.id, getTemaGeral(question)]));
const temaGeralByTema = new Map(questionBank.map((question) => [question.Tema, getTemaGeral(question)]));

export type AggregatedQuestionStats = {
  localDay: string;
  area: Area;
  tema: Tema;
  temaGeral: TemaGeral;
  totalQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  expiredQuestions: number;
  correctPercent: number;
  averageScore: number;
};

export type AggregatedQuestionDetailStats = {
  localDay: string;
  questionId: string;
  area: Area;
  tema: Tema;
  temaGeral: TemaGeral;
  correctOptionId: "A" | "B" | "C" | "D";
  totalQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  expiredQuestions: number;
  usedHintQuestions: number;
  selectedAQuestions: number;
  selectedBQuestions: number;
  selectedCQuestions: number;
  selectedDQuestions: number;
  correctPercent: number;
  averageScore: number;
};

type StatsRow = {
  local_day: string;
  area: Area;
  tema: Tema;
  tema_geral?: TemaGeral | null;
  total_questions: number;
  correct_questions: number;
  incorrect_questions: number;
  expired_questions: number;
  correct_percent: number | string | null;
  average_score: number | string | null;
};

type QuestionStatsRow = {
  local_day: string;
  question_id: string;
  area: Area;
  tema: Tema;
  tema_geral?: TemaGeral | null;
  correct_option_id: "A" | "B" | "C" | "D";
  total_questions: number;
  correct_questions: number;
  incorrect_questions: number;
  expired_questions: number;
  used_hint_questions: number;
  selected_a_questions: number;
  selected_b_questions: number;
  selected_c_questions: number;
  selected_d_questions: number;
  correct_percent: number | string | null;
  average_score: number | string | null;
};

export function questionStatsConfigured() {
  return Boolean(STATS_ENDPOINT && SUPABASE_ANON_KEY);
}

function toNumber(value: number | string | null) {
  if (value === null) {
    return 0;
  }

  return typeof value === "number" ? value : Number(value);
}

function resolveTemaGeral(row: Pick<StatsRow, "tema" | "tema_geral"> & { question_id?: string }) {
  return (row.question_id ? temaGeralByQuestionId.get(row.question_id) : undefined) || temaGeralByTema.get(row.tema) || row.tema_geral?.trim() || row.tema;
}

function normalizeRow(row: StatsRow): AggregatedQuestionStats {
  return {
    localDay: row.local_day,
    area: row.area,
    tema: row.tema,
    temaGeral: resolveTemaGeral(row),
    totalQuestions: row.total_questions,
    correctQuestions: row.correct_questions,
    incorrectQuestions: row.incorrect_questions,
    expiredQuestions: row.expired_questions,
    correctPercent: toNumber(row.correct_percent),
    averageScore: toNumber(row.average_score),
  };
}

function normalizeQuestionRow(row: QuestionStatsRow): AggregatedQuestionDetailStats {
  return {
    localDay: row.local_day,
    questionId: row.question_id,
    area: row.area,
    tema: row.tema,
    temaGeral: resolveTemaGeral(row),
    correctOptionId: row.correct_option_id,
    totalQuestions: row.total_questions,
    correctQuestions: row.correct_questions,
    incorrectQuestions: row.incorrect_questions,
    expiredQuestions: row.expired_questions,
    usedHintQuestions: row.used_hint_questions,
    selectedAQuestions: row.selected_a_questions,
    selectedBQuestions: row.selected_b_questions,
    selectedCQuestions: row.selected_c_questions,
    selectedDQuestions: row.selected_d_questions,
    correctPercent: toNumber(row.correct_percent),
    averageScore: toNumber(row.average_score),
  };
}

async function fetchStatsRows<Row>(endpoint: string, select: string) {
  const params = new URLSearchParams({
    select,
    order: "local_day.desc",
  });

  const response = await window.fetch(`${endpoint}?${params.toString()}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Supabase stats request failed with status ${response.status}`);
  }

  return (await response.json()) as Row[];
}

export async function fetchAggregatedQuestionStats() {
  if (!questionStatsConfigured()) {
    return [];
  }

  const selectWithTemaGeral =
    "local_day,area,tema,tema_geral,total_questions,correct_questions,incorrect_questions,expired_questions,correct_percent,average_score";
  const legacySelect =
    "local_day,area,tema,total_questions,correct_questions,incorrect_questions,expired_questions,correct_percent,average_score";
  let rows: StatsRow[];

  try {
    rows = await fetchStatsRows<StatsRow>(STATS_ENDPOINT, selectWithTemaGeral);
  } catch {
    rows = await fetchStatsRows<StatsRow>(STATS_ENDPOINT, legacySelect);
  }

  return rows.map(normalizeRow);
}

export async function fetchAggregatedQuestionDetailStats() {
  if (!questionStatsConfigured()) {
    return [];
  }

  const selectWithTemaGeral =
    "local_day,question_id,area,tema,tema_geral,correct_option_id,total_questions,correct_questions,incorrect_questions,expired_questions,used_hint_questions,selected_a_questions,selected_b_questions,selected_c_questions,selected_d_questions,correct_percent,average_score";
  const legacySelect =
    "local_day,question_id,area,tema,correct_option_id,total_questions,correct_questions,incorrect_questions,expired_questions,used_hint_questions,selected_a_questions,selected_b_questions,selected_c_questions,selected_d_questions,correct_percent,average_score";
  let rows: QuestionStatsRow[];

  try {
    rows = await fetchStatsRows<QuestionStatsRow>(QUESTION_STATS_ENDPOINT, selectWithTemaGeral);
  } catch {
    rows = await fetchStatsRows<QuestionStatsRow>(QUESTION_STATS_ENDPOINT, legacySelect);
  }

  return rows.map(normalizeQuestionRow);
}
