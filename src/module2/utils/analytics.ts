import { getTemaGeral, type Option, type Question } from "../data/questions";

const MODULE2_QUEUE_STORAGE_KEY = "questmed2:question-event-queue";
const MODULE2_SESSION_STORAGE_KEY = "questmed2:anonymous-session-id";

type QuestionEventPayload = {
  event_id: string;
  module_version: "2.0";
  anonymous_session_id: string;
  occurred_at: string;
  local_day: string;
  question_id: string;
  area: Question["area"];
  tema: Question["Tema"];
  tema_geral: string;
  selected_option_id: Option["id"] | null;
  correct_option_id: Option["id"];
  is_correct: boolean;
  used_hint: boolean;
  expired: boolean;
  score: number;
};

export type QuestionAnalyticsEvent = {
  question: Question;
  selectedOptionId: Option["id"] | null;
  isCorrect: boolean;
  usedHint: boolean;
  expired: boolean;
  score: number;
};

function readQueue(): QuestionEventPayload[] {
  try {
    const rawQueue = window.localStorage.getItem(MODULE2_QUEUE_STORAGE_KEY);

    return rawQueue ? JSON.parse(rawQueue) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QuestionEventPayload[]) {
  window.localStorage.setItem(MODULE2_QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function createId() {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAnonymousSessionId() {
  const existingId = window.localStorage.getItem(MODULE2_SESSION_STORAGE_KEY);

  if (existingId) {
    return existingId;
  }

  const nextId = createId();
  window.localStorage.setItem(MODULE2_SESSION_STORAGE_KEY, nextId);

  return nextId;
}

function formatLocalDay(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function toPayload(event: QuestionAnalyticsEvent): QuestionEventPayload {
  const occurredAt = new Date();

  return {
    event_id: createId(),
    module_version: "2.0",
    anonymous_session_id: getAnonymousSessionId(),
    occurred_at: occurredAt.toISOString(),
    local_day: formatLocalDay(occurredAt),
    question_id: event.question.id,
    area: event.question.area,
    tema: event.question.Tema,
    tema_geral: getTemaGeral(event.question),
    selected_option_id: event.selectedOptionId,
    correct_option_id: event.question.correctOptionId,
    is_correct: event.isCorrect,
    used_hint: event.usedHint,
    expired: event.expired,
    score: event.score,
  };
}

export async function flushQuestionEventQueue() {
  writeQueue(readQueue());
}

export function trackQuestionEvent(event: QuestionAnalyticsEvent) {
  writeQueue([...readQueue(), toPayload(event)]);
}
