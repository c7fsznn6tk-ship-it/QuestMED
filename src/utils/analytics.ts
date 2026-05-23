import { getTemaGeral, type Option, type Question } from "../data/questions";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const EVENTS_ENDPOINT = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1/question_events` : "";
const SESSION_STORAGE_KEY = "questmed:anonymous-session-id";
const QUEUE_STORAGE_KEY = "questmed:question-event-queue";

type QuestionEventPayload = {
  event_id: string;
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

function analyticsEnabled() {
  return Boolean(EVENTS_ENDPOINT && SUPABASE_ANON_KEY);
}

function readQueue(): QuestionEventPayload[] {
  try {
    const rawQueue = window.localStorage.getItem(QUEUE_STORAGE_KEY);

    return rawQueue ? JSON.parse(rawQueue) : [];
  } catch {
    return [];
  }
}

function writeQueue(queue: QuestionEventPayload[]) {
  window.localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
}

function createId() {
  if (window.crypto.randomUUID) {
    return window.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getAnonymousSessionId() {
  const existingId = window.localStorage.getItem(SESSION_STORAGE_KEY);

  if (existingId) {
    return existingId;
  }

  const nextId = createId();
  window.localStorage.setItem(SESSION_STORAGE_KEY, nextId);

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

async function sendPayload(payload: QuestionEventPayload) {
  if (!analyticsEnabled()) {
    return true;
  }

  const response = await window.fetch(EVENTS_ENDPOINT, {
    method: "POST",
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(payload),
  });

  return response.ok || response.status === 409;
}

export async function flushQuestionEventQueue() {
  if (!analyticsEnabled()) {
    return;
  }

  const queue = readQueue();
  const pending: QuestionEventPayload[] = [];

  for (const payload of queue) {
    try {
      const sent = await sendPayload(payload);

      if (!sent) {
        pending.push(payload);
      }
    } catch {
      pending.push(payload);
    }
  }

  writeQueue(pending);
}

export function trackQuestionEvent(event: QuestionAnalyticsEvent) {
  if (!analyticsEnabled()) {
    return;
  }

  const queue = [...readQueue(), toPayload(event)];
  writeQueue(queue);
  void flushQuestionEventQueue();
}
