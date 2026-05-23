import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenCheck,
  Check,
  Download,
  HelpCircle,
  Lightbulb,
  Lock,
  Pause,
  Play,
  RotateCcw,
  Scissors,
  Search,
  ShieldAlert,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { getTemaGeral, questionBank, type Option, type Question } from "./data/questions";
import FormattedExplanation from "../FormattedExplanation";
import QuestionEditorDashboard from "../QuestionEditorDashboard";
import QuestionAttachments from "../QuestionAttachments";
import OfficialQuestionValidatorDashboard from "../OfficialQuestionValidatorDashboard";
import StatisticsDashboard from "../StatisticsDashboard";
import { flushQuestionEventQueue, trackQuestionEvent } from "./utils/analytics";
import { generateResultPdfBlob } from "./utils/resultPdf";
import {
  fetchAggregatedQuestionDetailStats,
  questionStatsConfigured,
  type AggregatedQuestionDetailStats,
} from "../utils/statistics";

const QUESTION_LIMIT = 10;
const QUESTION_SECONDS = 180;
const DRAG_START_THRESHOLD = 46;
const DRAG_COMMIT_RATIO = 0.42;
const DRAG_COMMIT_MIN_DISTANCE = 132;
const DRAG_COMMIT_VELOCITY = 1.15;
const DRAG_TRANSITION_MS = 240;
const TUTORIAL_STORAGE_KEY = "questmed2:tutorial-seen";
const QUESTION_EXPOSURE_STORAGE_KEY = "questmed2:recent-question-exposures";
const RECENT_EXPOSURE_LIMIT = Math.min(questionBank.length, QUESTION_LIMIT * 8);

type FlowStep = "question" | "videoModal" | "finished";

type AnswerRecord = {
  questionId: string;
  area: Question["area"];
  selectedOptionId: Option["id"] | null;
  correctOptionId: Option["id"];
  isCorrect: boolean;
  usedHint: boolean;
  expired: boolean;
  score: number;
  videoOpened: boolean;
};

type QuestionRuntimeState = {
  selectedOptionId: Option["id"] | null;
  eliminatedOptionIds: Option["id"][];
  isConfirmed: boolean;
  isExpired: boolean;
  usedHint: boolean;
  showHintModal: boolean;
  showVideoPrompt: boolean;
  isPaused: boolean;
  timeLeft: number;
};

type SessionState = {
  currentIndex: number;
  questionStates: QuestionRuntimeState[];
  flowStep: FlowStep;
  answers: AnswerRecord[];
  printWarning: string | null;
};

type DragState = {
  isDragging: boolean;
  neighborIndex: number | null;
  offset: number;
  transition: boolean;
};

type GestureStart = {
  x: number;
  y: number;
  time: number;
};

type TutorialTarget = "welcome" | "question" | "confirm" | "hint" | "eliminate" | "timer" | "swipe" | "feedback" | "result";

type TutorialStep = {
  target: TutorialTarget;
  title: string;
  body: string;
};

type TargetRect = {
  top: number;
  left: number;
  width: number;
  height: number;
};

type ClassroomAnswerState = {
  selectedOptionId: Option["id"] | null;
  isConfirmed: boolean;
  showDiscussionModal: boolean;
};

type ClassroomStatsLoadState = "loading" | "ready" | "not-configured" | "error";

type ClassroomQuestionStats = {
  totalQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  expiredQuestions: number;
  usedHintQuestions: number;
  correctPercent: number;
  averageScore: number;
  selectedOptions: Record<Option["id"], number>;
};

type FeedbackAnimation = {
  id: number;
  kind: "correct" | "incorrect";
};

const idleDrag: DragState = {
  isDragging: false,
  neighborIndex: null,
  offset: 0,
  transition: false,
};

const tutorialSteps: TutorialStep[] = [
  {
    target: "welcome",
    title: "Bem-vindo ao QuestMED",
    body: "Resolva 10 questões por dia, com tempo limitado e feedback imediato.",
  },
  {
    target: "question",
    title: "Leia e escolha",
    body: "Leia o enunciado e toque em uma alternativa para marcar sua resposta.",
  },
  {
    target: "confirm",
    title: "Confirme quando decidir",
    body: "Depois de selecionar uma alternativa, o botão de check aparece para registrar a resposta.",
  },
  {
    target: "hint",
    title: "Use a dica com critério",
    body: "A lâmpada abre uma dica. Se você usar, a questão passa a valer metade.",
  },
  {
    target: "eliminate",
    title: "Corte duas alternativas",
    body: "A tesoura elimina duas respostas incorretas e só pode ser usada uma vez por questão.",
  },
  {
    target: "timer",
    title: "Controle o tempo",
    body: "O cronômetro mostra o tempo restante. Toque nele para pausar ou continuar.",
  },
  {
    target: "swipe",
    title: "Passe as questões",
    body: "Arraste para cima para avançar e para baixo para voltar quando estiver no fim ou no topo da questão.",
  },
  {
    target: "feedback",
    title: "Revise o feedback",
    body: "Depois de confirmar, aparecem acerto ou erro, pontuação, justificativa e vídeo curto quando houver.",
  },
  {
    target: "result",
    title: "Veja seu resultado",
    body: "Ao terminar as 10 questões, o app mostra seu resumo de acertos, erros, não respondidas e desempenho.",
  },
];

function createQuestionState(): QuestionRuntimeState {
  return {
    selectedOptionId: null,
    eliminatedOptionIds: [],
    isConfirmed: false,
    isExpired: false,
    usedHint: false,
    showHintModal: false,
    showVideoPrompt: false,
    isPaused: false,
    timeLeft: QUESTION_SECONDS,
  };
}

function normalizeQuestionState(state: QuestionRuntimeState | undefined): QuestionRuntimeState {
  return {
    ...createQuestionState(),
    ...state,
  };
}

function shuffleQuestions<T>(items: T[]) {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function readRecentQuestionExposures() {
  try {
    const rawHistory = window.localStorage.getItem(QUESTION_EXPOSURE_STORAGE_KEY);
    const parsed = rawHistory ? JSON.parse(rawHistory) : [];

    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function recordQuestionExposures(questionIds: string[]) {
  try {
    const nextHistory = [
      ...questionIds,
      ...readRecentQuestionExposures().filter((questionId) => !questionIds.includes(questionId)),
    ].slice(0, RECENT_EXPOSURE_LIMIT);

    window.localStorage.setItem(QUESTION_EXPOSURE_STORAGE_KEY, JSON.stringify(nextHistory));
  } catch {
    // localStorage can be unavailable in restricted browser modes.
  }
}

function getQuestionSelectionScore(question: Question, recentQuestionIds: string[]) {
  const recentIndex = recentQuestionIds.indexOf(question.id);
  const recencyPenalty = recentIndex >= 0 ? (RECENT_EXPOSURE_LIMIT - recentIndex) * 100 : 0;

  return recencyPenalty + Math.random();
}

function createQuestionSet() {
  const recentQuestionIds = readRecentQuestionExposures();
  const themes = Array.from(new Set(questionBank.map(getTemaGeral)));
  const buckets = new Map(
    themes.map((theme) => [
      theme,
      questionBank
        .filter((question) => getTemaGeral(question) === theme)
        .map((question) => ({
          question,
          score: getQuestionSelectionScore(question, recentQuestionIds),
        }))
        .sort((a, b) => a.score - b.score)
        .map(({ question }) => question),
    ]),
  );
  const themeOrder = shuffleQuestions(themes).sort((themeA, themeB) => {
    const firstQuestionA = buckets.get(themeA)?.[0];
    const firstQuestionB = buckets.get(themeB)?.[0];
    const scoreA = firstQuestionA ? getQuestionSelectionScore(firstQuestionA, recentQuestionIds) : Infinity;
    const scoreB = firstQuestionB ? getQuestionSelectionScore(firstQuestionB, recentQuestionIds) : Infinity;

    return scoreA - scoreB;
  });
  const selected: Question[] = [];
  let round = 0;

  while (selected.length < QUESTION_LIMIT && themeOrder.length > 0) {
    const theme = themeOrder[round % themeOrder.length];
    const question = buckets.get(theme)?.shift();

    if (question) {
      selected.push(question);
    }

    round += 1;

    if (round > questionBank.length + themeOrder.length) {
      break;
    }
  }

  return selected;
}

function createInitialSession(questionTotal: number): SessionState {
  return {
    currentIndex: 0,
    questionStates: Array.from({ length: questionTotal }, createQuestionState),
    flowStep: "question",
    answers: [],
    printWarning: null,
  };
}

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function getEliminatedOptions(question: Question) {
  return question.options
    .filter((option) => option.id !== question.correctOptionId)
    .sort((a, b) => question.statistics[a.id] - question.statistics[b.id])
    .slice(0, 2)
    .map((option) => option.id);
}

function getYoutubeEmbedUrl(videoId: string) {
  return `https://www.youtube-nocookie.com/embed/${videoId}?rel=0&playsinline=1`;
}

function createAnswerRecord(
  question: Question,
  selectedOptionId: Option["id"] | null,
  usedHint: boolean,
  expired: boolean,
  videoOpened = false,
): AnswerRecord {
  const isCorrect = selectedOptionId === question.correctOptionId && !expired;

  return {
    questionId: question.id,
    area: question.area,
    selectedOptionId,
    correctOptionId: question.correctOptionId,
    isCorrect,
    usedHint,
    expired,
    score: isCorrect ? (usedHint ? 0.5 : 1) : 0,
    videoOpened,
  };
}

function upsertAnswer(answers: AnswerRecord[], record: AnswerRecord) {
  const existingIndex = answers.findIndex((answer) => answer.questionId === record.questionId);

  if (existingIndex === -1) {
    return [...answers, record];
  }

  return answers.map((answer, index) => (index === existingIndex ? record : answer));
}

function replaceQuestionState(
  states: QuestionRuntimeState[],
  index: number,
  updater: (state: QuestionRuntimeState) => QuestionRuntimeState,
) {
  return states.map((state, stateIndex) => (stateIndex === index ? updater(state) : state));
}

function FloatingToolButton({
  active,
  ariaLabel,
  children,
  disabled,
  onClick,
  refProp,
  tooltip,
}: {
  active?: boolean;
  ariaLabel: string;
  children: React.ReactNode;
  disabled?: boolean;
  onClick: () => void;
  refProp?: React.RefObject<HTMLButtonElement | null>;
  tooltip: string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={["floating-tool-button", active ? "active" : ""].join(" ")}
      data-tooltip={tooltip}
      disabled={disabled}
      onClick={onClick}
      ref={refProp}
      type="button"
    >
      {children}
    </button>
  );
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function summarizeClassroomQuestionStats(
  rows: AggregatedQuestionDetailStats[],
  questionId: string,
): ClassroomQuestionStats | null {
  const questionRows = rows.filter((row) => row.questionId === questionId);

  if (questionRows.length === 0) {
    return null;
  }

  const totals = questionRows.reduce<ClassroomQuestionStats>(
    (summary, row) => ({
      totalQuestions: summary.totalQuestions + row.totalQuestions,
      correctQuestions: summary.correctQuestions + row.correctQuestions,
      incorrectQuestions: summary.incorrectQuestions + row.incorrectQuestions,
      expiredQuestions: summary.expiredQuestions + row.expiredQuestions,
      usedHintQuestions: summary.usedHintQuestions + row.usedHintQuestions,
      correctPercent: 0,
      averageScore: summary.averageScore + row.averageScore * row.totalQuestions,
      selectedOptions: {
        A: summary.selectedOptions.A + row.selectedAQuestions,
        B: summary.selectedOptions.B + row.selectedBQuestions,
        C: summary.selectedOptions.C + row.selectedCQuestions,
        D: summary.selectedOptions.D + row.selectedDQuestions,
      },
    }),
    {
      totalQuestions: 0,
      correctQuestions: 0,
      incorrectQuestions: 0,
      expiredQuestions: 0,
      usedHintQuestions: 0,
      correctPercent: 0,
      averageScore: 0,
      selectedOptions: {
        A: 0,
        B: 0,
        C: 0,
        D: 0,
      },
    },
  );

  if (totals.totalQuestions === 0) {
    return totals;
  }

  return {
    ...totals,
    correctPercent: (totals.correctQuestions / totals.totalQuestions) * 100,
    averageScore: totals.averageScore / totals.totalQuestions,
  };
}

function playFeedbackTone(kind: FeedbackAnimation["kind"]) {
  const AudioContextClass =
    window.AudioContext ??
    (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;

  if (!AudioContextClass) {
    return;
  }

  const audioContext = new AudioContextClass();
  const masterGain = audioContext.createGain();
  const startTime = audioContext.currentTime;
  const notes = kind === "correct" ? [523.25, 659.25, 783.99] : [220, 164.81];

  masterGain.gain.setValueAtTime(0.0001, startTime);
  masterGain.gain.exponentialRampToValueAtTime(kind === "correct" ? 0.13 : 0.1, startTime + 0.02);
  masterGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.44);
  masterGain.connect(audioContext.destination);

  notes.forEach((frequency, index) => {
    const oscillator = audioContext.createOscillator();
    const gain = audioContext.createGain();
    const noteStart = startTime + index * (kind === "correct" ? 0.055 : 0.075);
    const noteEnd = noteStart + (kind === "correct" ? 0.26 : 0.32);

    oscillator.type = kind === "correct" ? "sine" : "triangle";
    oscillator.frequency.setValueAtTime(frequency, noteStart);
    if (kind === "incorrect") {
      oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.72, noteEnd);
    }

    gain.gain.setValueAtTime(0.0001, noteStart);
    gain.gain.exponentialRampToValueAtTime(1, noteStart + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, noteEnd);
    oscillator.connect(gain);
    gain.connect(masterGain);
    oscillator.start(noteStart);
    oscillator.stop(noteEnd + 0.02);
  });

  window.setTimeout(() => void audioContext.close(), 620);
}

function FeedbackBurst({
  kind,
  onDone,
}: {
  kind: FeedbackAnimation["kind"];
  onDone: () => void;
}) {
  useEffect(() => {
    const timeoutId = window.setTimeout(onDone, 2000);

    return () => window.clearTimeout(timeoutId);
  }, [onDone]);

  return (
    <div
      aria-hidden="true"
      className={["feedback-burst", kind].join(" ")}
    >
      <span className="feedback-burst-core">{kind === "correct" ? "✓" : "!"}</span>
    </div>
  );
}

function ClassroomModule() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState(() => questionBank[0]?.id ?? "");
  const [answerState, setAnswerState] = useState<ClassroomAnswerState>({
    selectedOptionId: null,
    isConfirmed: false,
    showDiscussionModal: false,
  });
  const [feedbackAnimation, setFeedbackAnimation] = useState<FeedbackAnimation | null>(null);
  const [statsRows, setStatsRows] = useState<AggregatedQuestionDetailStats[]>([]);
  const [statsLoadState, setStatsLoadState] = useState<ClassroomStatsLoadState>(() =>
    questionStatsConfigured() ? "loading" : "not-configured",
  );
  const feedbackRef = useRef<HTMLElement | null>(null);
  const selectedQuestion = questionBank.find((questionItem) => questionItem.id === selectedQuestionId) ?? questionBank[0];
  const selectedOption = selectedQuestion?.options.find((option) => option.id === answerState.selectedOptionId);
  const isCorrect = answerState.selectedOptionId === selectedQuestion?.correctOptionId;
  const canConfirm = Boolean(answerState.selectedOptionId) && !answerState.isConfirmed;
  const selectedQuestionStats = useMemo(
    () => summarizeClassroomQuestionStats(statsRows, selectedQuestion?.id ?? ""),
    [selectedQuestion?.id, statsRows],
  );
  const maxSelectedCount = Math.max(
    ...Object.values(selectedQuestionStats?.selectedOptions ?? { A: 0, B: 0, C: 0, D: 0 }),
    1,
  );

  async function loadClassroomStats() {
    if (!questionStatsConfigured()) {
      setStatsLoadState("not-configured");
      setStatsRows([]);
      return;
    }

    setStatsLoadState("loading");

    try {
      const nextRows = await fetchAggregatedQuestionDetailStats();
      setStatsRows(nextRows);
      setStatsLoadState("ready");
    } catch {
      setStatsRows([]);
      setStatsLoadState("error");
    }
  }

  const filteredQuestions = useMemo(() => {
    const normalizedSearch = normalizeText(searchTerm.trim());

    if (!normalizedSearch) {
      return questionBank.slice(0, 24);
    }

    return questionBank
      .filter((questionItem) => {
        const searchableText = [
          questionItem.id,
          questionItem.Tema,
          questionItem.area,
          questionItem.statement,
        ].join(" ");

        return normalizeText(searchableText).includes(normalizedSearch);
      })
      .slice(0, 24);
  }, [searchTerm]);

  useEffect(() => {
    void loadClassroomStats();
  }, []);

  useEffect(() => {
    if (!answerState.isConfirmed) {
      return;
    }

    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [answerState.isConfirmed, selectedQuestionId]);

  function chooseQuestion(questionId: string) {
    setSelectedQuestionId(questionId);
    setAnswerState({
      selectedOptionId: null,
      isConfirmed: false,
      showDiscussionModal: false,
    });
  }

  function selectClassroomOption(optionId: Option["id"]) {
    if (answerState.isConfirmed) {
      return;
    }

    setAnswerState((current) => ({
      ...current,
      selectedOptionId: optionId,
    }));
  }

  function confirmClassroomAnswer() {
    if (!answerState.selectedOptionId || answerState.isConfirmed) {
      return;
    }

    const animationKind = answerState.selectedOptionId === selectedQuestion?.correctOptionId ? "correct" : "incorrect";
    playFeedbackTone(animationKind);
    setFeedbackAnimation({
      id: Date.now(),
      kind: animationKind,
    });

    setAnswerState((current) => ({
      ...current,
      isConfirmed: true,
      showDiscussionModal: false,
    }));
  }

  function restartClassroomAnswer() {
    setFeedbackAnimation(null);
    setAnswerState({
      selectedOptionId: null,
      isConfirmed: false,
      showDiscussionModal: false,
    });
  }

  if (!selectedQuestion) {
    return (
      <main className="classroom-shell">
        <section className="stats-state-card danger">
          <HelpCircle size={22} aria-hidden="true" />
          <div>
            <h2>Nenhuma questao encontrada</h2>
            <p>O banco de questoes ainda nao esta disponivel para este modulo.</p>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="classroom-shell">
      <section className="classroom-dashboard" aria-label="Sala de aula QuestMED">
        {feedbackAnimation && (
          <FeedbackBurst
            key={feedbackAnimation.id}
            kind={feedbackAnimation.kind}
            onDone={() => setFeedbackAnimation(null)}
          />
        )}
        <header className="stats-header classroom-header">
          <a className="stats-back-link" href="./">
            <ArrowLeft size={18} aria-hidden="true" />
            Voltar
          </a>
          <div className="stats-title-row">
            <span className="stats-title-icon">
              <BookOpenCheck size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">QuestMED</p>
              <h1>Sala de aula</h1>
            </div>
          </div>
          <button className="stats-pdf-button" onClick={restartClassroomAnswer} type="button">
            <RotateCcw size={18} aria-hidden="true" />
            Refazer
          </button>
        </header>

        <section className="question-search-panel classroom-search-panel">
          <div className="stats-filter-title">
            <Search size={18} aria-hidden="true" />
            <strong>Escolher questao</strong>
          </div>
          <label>
            <span>Buscar por ID, tema, area ou enunciado</span>
            <input
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Ex.: Q001, diabetes, saude da mulher..."
              type="search"
              value={searchTerm}
            />
          </label>
        </section>

        <div className="classroom-layout">
          <aside className="stats-panel classroom-question-list-panel" aria-label="Questoes encontradas">
            <div className="classroom-list-header">
              <h2>Banco de questoes</h2>
              <span>{filteredQuestions.length} opcoes</span>
            </div>
            <div className="classroom-question-list">
              {filteredQuestions.map((questionItem) => (
                <button
                  className={questionItem.id === selectedQuestion.id ? "selected" : ""}
                  key={questionItem.id}
                  onClick={() => chooseQuestion(questionItem.id)}
                  type="button"
                >
                  <strong>{questionItem.id}</strong>
                  <span>{questionItem.Tema}</span>
                  <em>{questionItem.statement}</em>
                </button>
              ))}
              {filteredQuestions.length === 0 && (
                <p className="stats-empty-line">Nenhuma questao corresponde a busca.</p>
              )}
            </div>
          </aside>

          <section className="classroom-question-workspace">
            <div className="meta-row">
              <span className="id-pill">{selectedQuestion.id}</span>
              <span className="theme-pill">{selectedQuestion.Tema}</span>
              <span className="area-pill">{selectedQuestion.area}</span>
            </div>

            <section className="question-card classroom-question-card">
              <p>{selectedQuestion.statement}</p>
              <QuestionAttachments question={selectedQuestion} />
            </section>

            <section className="options-list classroom-options-list" aria-label="Alternativas">
              {selectedQuestion.options.map((option) => {
                const isSelected = answerState.selectedOptionId === option.id;
                const isCorrectOption = answerState.isConfirmed && option.id === selectedQuestion.correctOptionId;
                const isWrongSelection = answerState.isConfirmed && isSelected && !isCorrectOption;

                return (
                  <button
                    className={[
                      "option-button",
                      isSelected ? "selected" : "",
                      isCorrectOption ? "correct" : "",
                      isWrongSelection ? "incorrect" : "",
                      answerState.isConfirmed ? "locked" : "",
                    ].join(" ")}
                    disabled={answerState.isConfirmed}
                    key={option.id}
                    onClick={() => selectClassroomOption(option.id)}
                    type="button"
                  >
                    <span className="option-letter">{option.id}</span>
                    <span>{option.text}</span>
                  </button>
                );
              })}
            </section>

            <section className="feedback-zone classroom-feedback-zone" aria-live="polite" ref={feedbackRef}>
              {answerState.isConfirmed && (
                <>
                  <div className={["result-card", isCorrect ? "correct" : "incorrect"].join(" ")}>
                    <Sparkles size={18} aria-hidden="true" />
                    <p>
                      <strong className={["result-badge", isCorrect ? "correct" : "incorrect"].join(" ")}>
                        {isCorrect ? "CORRETA" : "INCORRETA"}
                      </strong>
                      <span>
                        Gabarito: alternativa {selectedQuestion.correctOptionId}
                        {selectedOption ? `; voce marcou ${selectedOption.id}.` : "."}
                      </span>
                    </p>
                  </div>

                  <div className="score-mini-card">
                    <span>Pontuacao nesta questao</span>
                    <strong>{isCorrect ? "1,0 ponto" : "0,0 ponto"}</strong>
                  </div>

                  {selectedQuestion.hint && (
                    <div className="explanation-card">
                      <p>
                        <strong>Dica:</strong> {selectedQuestion.hint}
                      </p>
                    </div>
                  )}

                  {selectedQuestion.explanation && (
                    <div className="explanation-card">
                      <FormattedExplanation explanation={selectedQuestion.explanation} />
                    </div>
                  )}

                  <div className="explanation-card classroom-statistics-card">
                    <h2>Estatistica da questao</h2>
                    {statsLoadState === "loading" && (
                      <p className="stats-empty-line">Carregando estatisticas reais...</p>
                    )}
                    {statsLoadState === "not-configured" && (
                      <p className="stats-empty-line">Supabase nao configurado para buscar estatisticas reais.</p>
                    )}
                    {statsLoadState === "error" && (
                      <p className="stats-empty-line">Nao foi possivel carregar as estatisticas reais desta questao.</p>
                    )}
                    {statsLoadState === "ready" && !selectedQuestionStats && (
                      <p className="stats-empty-line">Ainda nao ha respostas reais registradas para esta questao.</p>
                    )}
                    {statsLoadState === "ready" && selectedQuestionStats && (
                      <>
                        <div className="question-detail-grid">
                          <div className="stats-card">
                            <span>Respostas</span>
                            <strong>{selectedQuestionStats.totalQuestions}</strong>
                          </div>
                          <div className="stats-card">
                            <span>Acerto</span>
                            <strong>{formatDecimal(selectedQuestionStats.correctPercent)}%</strong>
                          </div>
                          <div className="stats-card">
                            <span>Dicas</span>
                            <strong>{selectedQuestionStats.usedHintQuestions}</strong>
                          </div>
                          <div className="stats-card">
                            <span>Media</span>
                            <strong>{formatDecimal(selectedQuestionStats.averageScore)}</strong>
                          </div>
                        </div>
                        <div className="option-distribution">
                          {selectedQuestion.options.map((option) => {
                            const count = selectedQuestionStats.selectedOptions[option.id];
                            const percent =
                              selectedQuestionStats.totalQuestions > 0
                                ? (count / selectedQuestionStats.totalQuestions) * 100
                                : 0;
                            const width = `${Math.max(4, (count / maxSelectedCount) * 100)}%`;

                            return (
                              <div className="option-distribution-row" key={option.id}>
                                <span className={option.id === selectedQuestion.correctOptionId ? "correct" : ""}>
                                  {option.id}
                                </span>
                                <div>
                                  <strong>{count}</strong>
                                  <em>{formatDecimal(percent)}%</em>
                                  <i style={{ width }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>

                  <button
                    className="primary-wide-button classroom-explanation-button"
                    onClick={() => setAnswerState((current) => ({ ...current, showDiscussionModal: true }))}
                    type="button"
                  >
                    <BookOpenCheck size={18} aria-hidden="true" />
                    Ver explicacao
                  </button>
                </>
              )}
            </section>
          </section>
        </div>

        {canConfirm && (
          <button
            aria-label="Confirmar alternativa"
            className="floating-confirm-button classroom-confirm-button"
            disabled={!canConfirm}
            onClick={confirmClassroomAnswer}
            title="Confirmar alternativa"
            type="button"
          >
            <Check size={28} aria-hidden="true" />
          </button>
        )}

        {answerState.showDiscussionModal && (
          <div className="classroom-discussion-backdrop" role="presentation">
            <section
              aria-label="Discussao da questao"
              aria-modal="true"
              className="classroom-discussion-modal"
              role="dialog"
            >
              <button
                aria-label="Fechar discussao"
                className="close-modal-button"
                onClick={() => setAnswerState((current) => ({ ...current, showDiscussionModal: false }))}
                type="button"
              >
                <X size={20} aria-hidden="true" />
              </button>
              <div className="classroom-discussion-content">
                <div className="meta-row">
                  <span className="id-pill">{selectedQuestion.id}</span>
                  <span className="theme-pill">{selectedQuestion.Tema}</span>
                  <span className="area-pill">{selectedQuestion.area}</span>
                  <span className="hint-penalty-pill">Conteudo de teste</span>
                </div>

                <header className="classroom-discussion-header">
                  <p className="eyebrow">Modelo temporario</p>
                  <h2>Explicacao ampliada para discussao em sala</h2>
                  <p>
                    Este modal contem apenas informacoes de teste para avaliarmos formato, espaco de leitura e ritmo
                    da apresentacao. O conteudo definitivo sera definido depois.
                  </p>
                </header>

                <section className="classroom-discussion-grid">
                  <article className="classroom-discussion-section">
                    <span>1</span>
                    <div>
                      <h3>Ponto central da questao</h3>
                      <p>
                        Neste espaco poderemos destacar qual dado do enunciado muda a conduta, quais pistas devem ser
                        reconhecidas rapidamente e por que a alternativa correta resolve melhor o problema.
                      </p>
                    </div>
                  </article>

                  <article className="classroom-discussion-section">
                    <span>2</span>
                    <div>
                      <h3>Armadilhas comuns</h3>
                      <p>
                        Aqui pode entrar uma discussao sobre distratores, interpretacoes incompletas do caso e erros
                        frequentes que aparecem quando a questao e resolvida com pressa.
                      </p>
                    </div>
                  </article>

                  <article className="classroom-discussion-section">
                    <span>3</span>
                    <div>
                      <h3>Como eu conduziria com os alunos</h3>
                      <p>
                        Podemos usar este bloco para transformar a justificativa em roteiro de aula: pergunta inicial,
                        debate rapido, fechamento conceitual e conexao com pratica clinica.
                      </p>
                    </div>
                  </article>
                </section>

                <section className="classroom-discussion-note">
                  <strong>Aviso</strong>
                  <p>
                    Conteudo demonstrativo. Esta area ainda nao esta conectada a informacoes especificas da questao.
                  </p>
                </section>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

function QuizApp() {
  const [questions, setQuestions] = useState<Question[]>(() => createQuestionSet());
  const [session, setSession] = useState<SessionState>(() => createInitialSession(questions.length));
  const [drag, setDrag] = useState<DragState>(idleDrag);
  const [feedbackAnimation, setFeedbackAnimation] = useState<FeedbackAnimation | null>(null);
  const [showTutorial, setShowTutorial] = useState(false);
  const [tutorialStep, setTutorialStep] = useState(0);
  const [tutorialTargetRect, setTutorialTargetRect] = useState<TargetRect | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const activeScrollRef = useRef<HTMLDivElement | null>(null);
  const questionCardRef = useRef<HTMLElement | null>(null);
  const optionsListRef = useRef<HTMLElement | null>(null);
  const feedbackRef = useRef<HTMLElement | null>(null);
  const helpButtonRef = useRef<HTMLButtonElement | null>(null);
  const hintButtonRef = useRef<HTMLButtonElement | null>(null);
  const eliminateButtonRef = useRef<HTMLButtonElement | null>(null);
  const timerButtonRef = useRef<HTMLButtonElement | null>(null);
  const confirmButtonRef = useRef<HTMLButtonElement | null>(null);
  const gestureStartRef = useRef<GestureStart | null>(null);
  const dragRef = useRef<DragState>(idleDrag);
  const swipeHandledRef = useRef(false);
  const transitionTimeoutRef = useRef<number | null>(null);
  const sentQuestionEventKeysRef = useRef<Set<string>>(new Set());

  const questionCount = questions.length;
  const question = questions[session.currentIndex];
  const questionState = normalizeQuestionState(session.questionStates[session.currentIndex]);
  const questionLocked =
    showTutorial ||
    questionState.isConfirmed ||
    questionState.isExpired ||
    questionState.isPaused ||
    session.flowStep !== "question";
  const activeTutorialStep = tutorialSteps[tutorialStep];

  function setDragState(nextDrag: DragState) {
    dragRef.current = nextDrag;
    setDrag(nextDrag);
  }

  function getTutorialTargetElement(target: TutorialTarget) {
    if (target === "welcome" || target === "result") {
      return stageRef.current;
    }

    if (target === "question") {
      return questionCardRef.current;
    }

    if (target === "confirm") {
      return confirmButtonRef.current ?? optionsListRef.current;
    }

    if (target === "hint") {
      return hintButtonRef.current;
    }

    if (target === "eliminate") {
      return eliminateButtonRef.current;
    }

    if (target === "timer") {
      return timerButtonRef.current;
    }

    if (target === "swipe") {
      return activeScrollRef.current;
    }

    return feedbackRef.current ?? optionsListRef.current;
  }

  function updateTutorialTarget() {
    if (!showTutorial) {
      setTutorialTargetRect(null);
      return;
    }

    const element = getTutorialTargetElement(activeTutorialStep.target);

    if (!element) {
      setTutorialTargetRect(null);
      return;
    }

    const rect = element.getBoundingClientRect();
    setTutorialTargetRect({
      top: rect.top,
      left: rect.left,
      width: rect.width,
      height: rect.height,
    });
  }

  function markTutorialSeen() {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
    } catch {
      // localStorage can be unavailable in restricted browser modes.
    }
  }

  function openTutorial() {
    setDragState(idleDrag);
    setTutorialStep(0);
    setShowTutorial(true);
  }

  function closeTutorial(markSeen: boolean) {
    if (markSeen) {
      markTutorialSeen();
    }

    setShowTutorial(false);
    setTutorialStep(0);
    setTutorialTargetRect(null);
  }

  function goToNextTutorialStep() {
    if (tutorialStep >= tutorialSteps.length - 1) {
      closeTutorial(true);
      return;
    }

    setTutorialStep((current) => current + 1);
  }

  function goToPreviousTutorialStep() {
    setTutorialStep((current) => Math.max(0, current - 1));
  }

  useEffect(() => {
    return () => {
      if (transitionTimeoutRef.current) {
        window.clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    recordQuestionExposures(questions.map((questionItem) => questionItem.id));
  }, [questions]);

  useEffect(() => {
    try {
      if (window.localStorage.getItem(TUTORIAL_STORAGE_KEY) !== "true") {
        setShowTutorial(true);
      }
    } catch {
      setShowTutorial(true);
    }
  }, []);

  useEffect(() => {
    if (!showTutorial) {
      return;
    }

    const frame = window.requestAnimationFrame(updateTutorialTarget);
    const scrollElement = activeScrollRef.current;

    window.addEventListener("resize", updateTutorialTarget);
    scrollElement?.addEventListener("scroll", updateTutorialTarget, { passive: true });

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updateTutorialTarget);
      scrollElement?.removeEventListener("scroll", updateTutorialTarget);
    };
  }, [showTutorial, tutorialStep, session.currentIndex, questionState.selectedOptionId]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "auto" });
      activeScrollRef.current?.scrollTo({ top: 0 });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [session.currentIndex]);

  useEffect(() => {
    if (questionLocked || questionState.isPaused || questionState.timeLeft === 0) {
      return;
    }

    const timer = window.setInterval(() => {
      setSession((current) => {
        if (current.flowStep !== "question" || current.currentIndex !== session.currentIndex) {
          return current;
        }

        const activeQuestion = questions[current.currentIndex];
        const activeQuestionState = current.questionStates[current.currentIndex];

        if (
          !activeQuestionState ||
          activeQuestionState.isConfirmed ||
          activeQuestionState.isExpired ||
          activeQuestionState.isPaused
        ) {
          return current;
        }

        if (activeQuestionState.timeLeft <= 1) {
          const timeoutRecord = createAnswerRecord(
            activeQuestion,
            null,
            activeQuestionState.usedHint,
            true,
          );

          trackAnswerRecord(activeQuestion, timeoutRecord, current.currentIndex);

          return {
            ...current,
            answers: upsertAnswer(current.answers, timeoutRecord),
            questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
              ...state,
              timeLeft: 0,
              isExpired: true,
            })),
          };
        }

        return {
          ...current,
          questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
            ...state,
            timeLeft: state.timeLeft - 1,
          })),
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [questionLocked, questionState.isPaused, questionState.timeLeft, session.currentIndex]);

  useEffect(() => {
    function warn(message: string) {
      setSession((current) => ({ ...current, printWarning: message }));
      window.setTimeout(() => {
        setSession((current) => ({ ...current, printWarning: null }));
      }, 2600);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const blockedShortcut =
        key === "printscreen" ||
        ((event.ctrlKey || event.metaKey) && ["p", "s"].includes(key));

      if (!blockedShortcut) {
        return;
      }

      event.preventDefault();
      warn("Capturas e salvamentos rápidos foram desativados nesta tela.");
    }

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
      warn("Menu de contexto bloqueado durante a resolução.");
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("contextmenu", handleContextMenu);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("contextmenu", handleContextMenu);
    };
  }, []);

  useEffect(() => {
    function flushQueue() {
      void flushQuestionEventQueue();
    }

    window.addEventListener("online", flushQueue);
    document.addEventListener("visibilitychange", flushQueue);
    flushQueue();

    return () => {
      window.removeEventListener("online", flushQueue);
      document.removeEventListener("visibilitychange", flushQueue);
    };
  }, []);

  useEffect(() => {
    if (!questionState.isConfirmed && !questionState.isExpired) {
      return;
    }

    feedbackRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [questionState.isConfirmed, questionState.isExpired]);

  const summary = useMemo(() => {
    const answered = session.answers.filter((answer) => !answer.expired);
    const correct = session.answers.filter((answer) => answer.isCorrect);
    const expired = session.answers.filter((answer) => answer.expired);
    const totalScore = session.answers.reduce((total, answer) => total + answer.score, 0);
    const percent = Math.round((totalScore / QUESTION_LIMIT) * 100);

    return {
      answered: answered.length,
      correct: correct.length,
      expired: expired.length,
      incorrect: session.answers.length - correct.length - expired.length,
      percent,
      totalScore,
    };
  }, [session.answers]);

  function generateSessionPdf() {
    const exportedAt = new Date();
    const blob = generateResultPdfBlob({
      answers: session.answers,
      exportedAt,
      questions,
      summary: {
        answered: summary.answered,
        correct: summary.correct,
        expired: summary.expired,
        incorrect: summary.incorrect,
        percent: summary.percent,
        totalScore: summary.totalScore,
      },
      totalQuestions: QUESTION_LIMIT,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = exportedAt.toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `questmed-resultado-${timestamp}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function getAnswerStatus(targetQuestion: Question, targetState: QuestionRuntimeState) {
    if (targetState.isExpired) {
      return "expired";
    }

    if (!targetState.isConfirmed || !targetState.selectedOptionId) {
      return null;
    }

    return targetState.selectedOptionId === targetQuestion.correctOptionId ? "correct" : "incorrect";
  }

  function updateActiveQuestion(updater: (state: QuestionRuntimeState) => QuestionRuntimeState) {
    setSession((current) => ({
      ...current,
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, updater),
    }));
  }

  function trackAnswerRecord(targetQuestion: Question, record: AnswerRecord, questionIndex: number) {
    const eventKey = [
      questionIndex,
      targetQuestion.id,
      record.selectedOptionId ?? "expired",
      record.expired ? "expired" : "answered",
      record.score,
    ].join(":");

    if (sentQuestionEventKeysRef.current.has(eventKey)) {
      return;
    }

    sentQuestionEventKeysRef.current.add(eventKey);
    trackQuestionEvent({
      question: targetQuestion,
      selectedOptionId: record.selectedOptionId,
      isCorrect: record.isCorrect,
      usedHint: record.usedHint,
      expired: record.expired,
      score: record.score,
    });
  }

  function finishSession() {
    setSession((current) => ({
      ...current,
      flowStep: "finished",
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        showHintModal: false,
        showVideoPrompt: false,
      })),
    }));
  }

  function navigateToQuestion(nextIndex: number) {
    const cappedIndex = Math.max(0, Math.min(nextIndex, questionCount - 1));

    if (cappedIndex === session.currentIndex) {
      return;
    }

    setSession((current) => ({
      ...current,
      currentIndex: cappedIndex,
      flowStep: "question",
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        showHintModal: false,
      })),
    }));
  }

  function goNext() {
    const nextIndex = session.currentIndex + 1;

    if (nextIndex >= questionCount) {
      finishSession();
      return;
    }

    navigateToQuestion(nextIndex);
  }

  function goPrevious() {
    if (session.currentIndex === 0) {
      return;
    }

    navigateToQuestion(session.currentIndex - 1);
  }

  function shouldIgnoreSwipeTarget(target: EventTarget | null) {
    return (
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          ".floating-tool-button, .timer-card, .floating-confirm-button, .video-prompt-card button, .close-modal-button, iframe, a",
        ),
      )
    );
  }

  function getScrollInfo(target: EventTarget | null) {
    const targetElement = target instanceof HTMLElement ? target : null;
    const scrollElement =
      (targetElement?.closest(".question-page-scroll") as HTMLDivElement | null) ?? activeScrollRef.current;

    if (!scrollElement) {
      return { atBottom: true, atTop: true };
    }

    const atTop = scrollElement.scrollTop <= 2;
    const atBottom =
      scrollElement.scrollTop + scrollElement.clientHeight >= scrollElement.scrollHeight - 2;

    return { atBottom, atTop };
  }

  function getNeighborIndex(deltaY: number, target: EventTarget | null) {
    const { atBottom, atTop } = getScrollInfo(target);
    const isLastQuestion = session.currentIndex === questionCount - 1;
    const canGoToResult = isLastQuestion && (questionState.isConfirmed || questionState.isExpired);

    if (deltaY < 0 && atBottom && canGoToResult) {
      return questionCount;
    }

    if (deltaY < 0 && atBottom && session.currentIndex < questionCount - 1) {
      return session.currentIndex + 1;
    }

    if (deltaY > 0 && atTop && session.currentIndex > 0) {
      return session.currentIndex - 1;
    }

    return null;
  }

  function clampDragOffset(offset: number) {
    const viewportHeight = activeScrollRef.current?.clientHeight ?? window.innerHeight;
    const maxOffset = viewportHeight * 0.96;

    return Math.max(-maxOffset, Math.min(maxOffset, offset));
  }

  function startGesture(x: number, y: number, target: EventTarget | null) {
    if (
      showTutorial ||
      questionState.isPaused ||
      session.flowStep !== "question" ||
      questionState.showHintModal ||
      shouldIgnoreSwipeTarget(target)
    ) {
      gestureStartRef.current = null;
      return;
    }

    gestureStartRef.current = { x, y, time: performance.now() };
  }

  function moveGesture(x: number, y: number, target: EventTarget | null, preventDefault: () => void) {
    const gestureStart = gestureStartRef.current;

    if (
      !gestureStart ||
      showTutorial ||
      questionState.isPaused ||
      session.flowStep !== "question" ||
      questionState.showHintModal
    ) {
      return;
    }

    const deltaX = x - gestureStart.x;
    const deltaY = y - gestureStart.y;

    if (Math.abs(deltaY) < DRAG_START_THRESHOLD || Math.abs(deltaY) < Math.abs(deltaX) * 1.25) {
      return;
    }

    const neighborIndex = dragRef.current.neighborIndex ?? getNeighborIndex(deltaY, target);

    if (neighborIndex === null) {
      return;
    }

    preventDefault();
    setDragState({
      isDragging: true,
      neighborIndex,
      offset: clampDragOffset(deltaY),
      transition: false,
    });
  }

  function endGesture(x: number, y: number) {
    const gestureStart = gestureStartRef.current;
    const currentDrag = dragRef.current;

    gestureStartRef.current = null;

    if (!gestureStart || !currentDrag.isDragging || currentDrag.neighborIndex === null) {
      setDragState(idleDrag);
      return;
    }

    const viewportHeight = activeScrollRef.current?.clientHeight ?? window.innerHeight;
    const elapsed = Math.max(performance.now() - gestureStart.time, 1);
    const velocity = (y - gestureStart.y) / elapsed;
    const dragDistance = Math.abs(currentDrag.offset);
    const shouldCommit =
      dragDistance > viewportHeight * DRAG_COMMIT_RATIO ||
      (dragDistance > DRAG_COMMIT_MIN_DISTANCE && Math.abs(velocity) > DRAG_COMMIT_VELOCITY);

    swipeHandledRef.current = true;
    window.setTimeout(() => {
      swipeHandledRef.current = false;
    }, 140);

    if (!shouldCommit) {
      setDragState({
        ...currentDrag,
        offset: 0,
        transition: true,
      });

      transitionTimeoutRef.current = window.setTimeout(() => {
        setDragState(idleDrag);
      }, DRAG_TRANSITION_MS);
      return;
    }

    const neighborIndex = currentDrag.neighborIndex;
    const exitOffset = neighborIndex > session.currentIndex ? -viewportHeight : viewportHeight;

    setDragState({
      ...currentDrag,
      offset: exitOffset,
      transition: true,
    });

    transitionTimeoutRef.current = window.setTimeout(() => {
      if (neighborIndex >= questionCount) {
        finishSession();
      } else {
        navigateToQuestion(neighborIndex);
      }
      setDragState(idleDrag);
    }, DRAG_TRANSITION_MS);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      return;
    }

    startGesture(event.clientX, event.clientY, event.target);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      return;
    }

    moveGesture(event.clientX, event.clientY, event.target, () => event.preventDefault());
  }

  function handlePointerUp(event: React.PointerEvent<HTMLElement>) {
    if (event.pointerType === "touch") {
      return;
    }

    endGesture(event.clientX, event.clientY);
  }

  function handleTouchStart(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    startGesture(touch.clientX, touch.clientY, event.target);
  }

  function handleTouchMove(event: React.TouchEvent<HTMLElement>) {
    const touch = event.touches[0];
    moveGesture(touch.clientX, touch.clientY, event.target, () => event.preventDefault());
  }

  function handleTouchEnd(event: React.TouchEvent<HTMLElement>) {
    const touch = event.changedTouches[0];
    endGesture(touch.clientX, touch.clientY);
  }

  function selectOption(optionId: Option["id"]) {
    if (showTutorial || swipeHandledRef.current || questionLocked || questionState.eliminatedOptionIds.includes(optionId)) {
      return;
    }

    updateActiveQuestion((state) => ({
      ...state,
      selectedOptionId: optionId,
    }));
  }

  function confirmAnswer() {
    if (!questionState.selectedOptionId || questionLocked) {
      return;
    }

    const record = createAnswerRecord(
      question,
      questionState.selectedOptionId,
      questionState.usedHint,
      false,
    );

    playFeedbackTone(record.isCorrect ? "correct" : "incorrect");
    setFeedbackAnimation({
      id: Date.now(),
      kind: record.isCorrect ? "correct" : "incorrect",
    });

    trackAnswerRecord(question, record, session.currentIndex);

    setSession((current) => ({
      ...current,
      answers: upsertAnswer(current.answers, record),
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        isConfirmed: true,
        showVideoPrompt: true,
      })),
    }));
  }

  function eliminateOptions() {
    if (questionState.eliminatedOptionIds.length > 0 || questionLocked) {
      return;
    }

    updateActiveQuestion((state) => ({
      ...state,
      eliminatedOptionIds: getEliminatedOptions(question),
    }));
  }

  function openHint() {
    if (questionLocked) {
      return;
    }

    updateActiveQuestion((state) => ({
      ...state,
      showHintModal: true,
      usedHint: true,
    }));
  }

  function toggleTimerPause() {
    if (session.flowStep !== "question" || questionState.isConfirmed || questionState.isExpired) {
      return;
    }

    updateActiveQuestion((state) => ({
      ...state,
      isPaused: !state.isPaused,
    }));
    setDragState(idleDrag);
  }

  function closeHint() {
    updateActiveQuestion((state) => ({
      ...state,
      showHintModal: false,
    }));
  }

  function openVideo() {
    if (!question.videoId) {
      return;
    }

    setSession((current) => ({
      ...current,
      answers: current.answers.map((answer) =>
        answer.questionId === question.id ? { ...answer, videoOpened: true } : answer,
      ),
      flowStep: "videoModal",
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        showVideoPrompt: false,
      })),
    }));
  }

  function closeVideo() {
    setSession((current) => ({
      ...current,
      flowStep: "question",
    }));
  }

  function restartSession() {
    sentQuestionEventKeysRef.current.clear();
    setFeedbackAnimation(null);
    setDragState(idleDrag);
    setSession(createInitialSession(questionCount));
  }

  function startNewQuestions() {
    const nextQuestions = createQuestionSet();
    sentQuestionEventKeysRef.current.clear();
    setFeedbackAnimation(null);
    setDragState(idleDrag);
    setQuestions(nextQuestions);
    setSession(createInitialSession(nextQuestions.length));
  }

  function renderFinishedContent() {
    return (
      <>
        {session.printWarning && <SecurityToast message={session.printWarning} />}
        <div className="finish-hero">
          <span className="finish-icon">
            <Sparkles size={30} aria-hidden="true" />
          </span>
          <strong>QUESTMED</strong>
        </div>

        <section className="summary-grid" aria-label="Estatísticas finais">
          <div>
            <strong>{summary.correct}</strong>
            <span>Acertos</span>
          </div>
          <div>
            <strong>{summary.incorrect}</strong>
            <span>Erros</span>
          </div>
          <div>
            <strong>{summary.expired}</strong>
            <span>Não respondidas</span>
          </div>
          <div>
            <strong>{summary.percent}%</strong>
            <span>Desempenho</span>
          </div>
        </section>

        <section className="score-card">
          <p>Pontuação total</p>
          <strong>{summary.totalScore.toFixed(1).replace(".", ",")} / {QUESTION_LIMIT}</strong>
          <span>{summary.answered} questões respondidas. Dicas usadas reduzem a questão para metade da pontuação.</span>
        </section>

        <div className="finish-actions">
          <button className="primary-wide-button" onClick={generateSessionPdf} type="button">
            <Download size={19} aria-hidden="true" />
            Gerar PDF
          </button>
          <button className="secondary-wide-button" onClick={restartSession} type="button">
            <RotateCcw size={19} aria-hidden="true" />
            Refazer
          </button>
          <button className="secondary-wide-button" onClick={startNewQuestions} type="button">
            <Shuffle size={19} aria-hidden="true" />
            Novas questões
          </button>
        </div>
      </>
    );
  }

  function renderFinishedPage(position: "active" | "neighbor") {
    const isActive = position === "active";

    return (
      <article
        aria-hidden={!isActive}
        className={["feed-page", "result-feed-page", isActive ? "active" : "neighbor"].join(" ")}
      >
        <div className="result-page-scroll">{renderFinishedContent()}</div>
      </article>
    );
  }

  function renderQuestionPage(index: number, position: "active" | "neighbor") {
    if (index >= questionCount) {
      return renderFinishedPage(position);
    }

    const targetQuestion = questions[index];
    const targetState = normalizeQuestionState(session.questionStates[index]);
    const targetAnswer = session.answers.find((answer) => answer.questionId === targetQuestion.id);
    const targetStatus = getAnswerStatus(targetQuestion, targetState);
    const targetProgress = Math.min(index + 1, QUESTION_LIMIT);
    const isActive = position === "active";
    const targetLocked =
      targetState.isConfirmed ||
      targetState.isExpired ||
      targetState.isPaused ||
      showTutorial ||
      session.flowStep !== "question" ||
      !isActive;

    return (
      <article
        aria-hidden={!isActive}
        className={["feed-page", isActive ? "active" : "neighbor"].join(" ")}
        key={`${targetQuestion.id}-${position}`}
      >
        <header className="topbar">
          <div>
            <p className="eyebrow">QuestMED</p>
            <h1>Quest {targetProgress}</h1>
          </div>
          <div className="floating-tools" aria-label="Ferramentas da questão">
            <button
              aria-label="Abrir tutorial"
              className="floating-tool-button help-tool-button"
              data-tooltip="Mostra o tutorial visual."
              onClick={openTutorial}
              ref={isActive ? helpButtonRef : undefined}
              type="button"
            >
              <HelpCircle size={21} aria-hidden="true" />
            </button>
            <FloatingToolButton
              active={targetState.usedHint}
              ariaLabel="Mostrar dica"
              disabled={targetLocked}
              onClick={openHint}
              refProp={isActive ? hintButtonRef : undefined}
              tooltip="Abre uma dica. Se usada, a questão passa a valer metade."
            >
              <Lightbulb size={21} aria-hidden="true" />
            </FloatingToolButton>
            <FloatingToolButton
              active={targetState.eliminatedOptionIds.length > 0}
              ariaLabel="Eliminar duas alternativas"
              disabled={targetLocked || targetState.eliminatedOptionIds.length > 0}
              onClick={eliminateOptions}
              refProp={isActive ? eliminateButtonRef : undefined}
              tooltip="Elimina duas alternativas incorretas."
            >
              <Scissors size={21} aria-hidden="true" />
            </FloatingToolButton>
            <button
              aria-label={targetState.isPaused ? "Continuar cronômetro" : "Pausar cronômetro"}
              className={[
                "timer-card",
                targetState.isExpired ? "expired" : "",
                targetState.isPaused ? "paused" : "",
              ].join(" ")}
              disabled={!isActive || targetState.isConfirmed || targetState.isExpired}
              onClick={toggleTimerPause}
              ref={isActive ? timerButtonRef : undefined}
              type="button"
            >
              {targetState.isPaused ? (
                <Play size={18} aria-hidden="true" />
              ) : (
                <Pause size={18} aria-hidden="true" />
              )}
              <span>{formatTimer(targetState.timeLeft)}</span>
            </button>
          </div>
        </header>

        <div className="question-page-scroll" ref={isActive ? activeScrollRef : undefined}>
          <div className="meta-row">
            <span className="id-pill">{targetQuestion.id}</span>
            <span className="theme-pill">{targetQuestion.Tema}</span>
            <span className="area-pill">{targetQuestion.area}</span>
            <span className="progress-pill">{targetProgress}/{QUESTION_LIMIT} hoje</span>
            {targetState.usedHint && <span className="hint-penalty-pill">Dica: 50%</span>}
          </div>

          <section className="question-card" ref={isActive ? questionCardRef : undefined}>
            <p>{targetQuestion.statement}</p>
            <QuestionAttachments question={targetQuestion} />
          </section>

          <section className="options-list" aria-label="Alternativas" ref={isActive ? optionsListRef : undefined}>
            {targetQuestion.options.map((option) => {
              const isSelected = targetState.selectedOptionId === option.id;
              const isEliminated = targetState.eliminatedOptionIds.includes(option.id);
              const isCorrect = targetState.isConfirmed && option.id === targetQuestion.correctOptionId;
              const isWrongSelection = targetState.isConfirmed && isSelected && !isCorrect;

              return (
                <button
                  className={[
                    "option-button",
                    isSelected ? "selected" : "",
                    isEliminated ? "eliminated" : "",
                    isCorrect ? "correct" : "",
                    isWrongSelection ? "incorrect" : "",
                    targetLocked ? "locked" : "",
                  ].join(" ")}
                  disabled={isEliminated || targetLocked}
                  key={option.id}
                  onClick={() => selectOption(option.id)}
                  type="button"
                >
                  <span className="option-letter">{option.id}</span>
                  <span>{option.text}</span>
                </button>
              );
            })}
          </section>

          <section className="feedback-zone" aria-live="polite" ref={isActive ? feedbackRef : undefined}>
            {targetStatus === "expired" && (
              <div className="result-card expired">
                <Lock size={18} aria-hidden="true" />
                <p>
                  <strong className="result-badge neutral">TEMPO ENCERRADO</strong>
                  <span>A questão foi bloqueada e registrada como não respondida.</span>
                </p>
              </div>
            )}

            {targetStatus === "correct" && (
              <div className="result-card correct">
                <Sparkles size={18} aria-hidden="true" />
                <p>
                  <strong className="result-badge correct">CORRETA</strong>
                  <span>Boa leitura dos dados clínicos.</span>
                </p>
              </div>
            )}

            {targetStatus === "incorrect" && (
              <div className="result-card incorrect">
                <Sparkles size={18} aria-hidden="true" />
                <p>
                  <strong className="result-badge incorrect">INCORRETA</strong>
                  <span>A alternativa {targetQuestion.correctOptionId} e a mais adequada.</span>
                </p>
              </div>
            )}

            {targetAnswer && (
              <div className="score-mini-card">
                <span>Pontuação nesta questão</span>
                <strong>{targetAnswer.score.toFixed(1).replace(".", ",")} ponto</strong>
              </div>
            )}

            {targetState.showVideoPrompt && (
              <div className="video-prompt-card">
                <strong>{targetQuestion.explanationTitle}</strong>
                <button disabled={!targetQuestion.videoId || !isActive} onClick={openVideo} type="button">
                  <Play size={16} aria-hidden="true" />
                  Ver vídeo curto
                </button>
              </div>
            )}

            {(targetState.isConfirmed || targetState.isExpired) && targetQuestion.explanation && (
              <div className="explanation-card">
                <FormattedExplanation explanation={targetQuestion.explanation} />
              </div>
            )}
          </section>
        </div>
      </article>
    );
  }

  const canConfirm = Boolean(questionState.selectedOptionId) && !questionLocked;
  const showConfirmButton = canConfirm && session.flowStep === "question";
  const feedHeight = activeScrollRef.current?.clientHeight ?? 1;
  const neighborOffset = drag.neighborIndex === null ? 0 : drag.neighborIndex > session.currentIndex ? feedHeight : -feedHeight;
  const isLastQuestion = session.currentIndex === questionCount - 1;
  const feedStyle = {
    transform: `translate3d(0, ${drag.offset}px, 0)`,
    transition: drag.transition ? `transform ${DRAG_TRANSITION_MS}ms cubic-bezier(0.18, 0.82, 0.22, 1)` : "none",
  };
  const stageClassName = [
    "phone-stage",
    drag.isDragging || drag.transition ? "is-feed-moving" : "",
    questionState.isPaused ? "is-timer-paused" : "",
    showTutorial ? "is-tutorial-open" : "",
  ].join(" ");

  if (session.flowStep === "finished") {
    return (
      <main className="app-shell secure-surface">
        <section className="phone-stage finished-stage" aria-label="Resultado QuestMED" ref={stageRef}>
          {renderFinishedContent()}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell secure-surface">
      <section
        className={stageClassName}
        aria-label="QuestMED"
        ref={stageRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={() => setDragState(idleDrag)}
        onTouchEnd={handleTouchEnd}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
      >
        {session.printWarning && <SecurityToast message={session.printWarning} />}
        {feedbackAnimation && (
          <FeedbackBurst
            key={feedbackAnimation.id}
            kind={feedbackAnimation.kind}
            onDone={() => setFeedbackAnimation(null)}
          />
        )}

        <section className="question-feed" aria-label="Questões">
          <div className="question-feed-track" style={feedStyle}>
            {drag.neighborIndex !== null && (
              <div className="feed-page-slot" style={{ transform: `translate3d(0, ${neighborOffset}px, 0)` }}>
                {renderQuestionPage(drag.neighborIndex, "neighbor")}
              </div>
            )}
            <div className="feed-page-slot">{renderQuestionPage(session.currentIndex, "active")}</div>
          </div>
        </section>

        {questionState.showHintModal && (
          <div className="modal-backdrop hint-backdrop" onClick={closeHint} role="presentation">
            <section className="hint-modal" aria-modal="true" role="dialog">
              <header className="hint-modal-header">
                <Lightbulb size={28} aria-hidden="true" />
                <h2>Dica</h2>
              </header>
              <p>{question.hint}</p>
            </section>
          </div>
        )}

        {session.flowStep === "videoModal" && question.videoId && (
          <div className="modal-backdrop video-backdrop" role="presentation">
            <section className="video-modal" aria-label="Vídeo explicativo" aria-modal="true" role="dialog">
              <button className="close-modal-button" onClick={closeVideo} type="button" aria-label="Fechar vídeo">
                <X size={20} aria-hidden="true" />
              </button>
              <div className="video-frame-wrap">
                <iframe
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  src={getYoutubeEmbedUrl(question.videoId)}
                  title={question.explanationTitle}
                />
              </div>
              <button className="primary-wide-button" onClick={isLastQuestion ? finishSession : goNext} type="button">
                {isLastQuestion ? "Resultado do dia" : "Próxima questão"}
              </button>
            </section>
          </div>
        )}

        {showConfirmButton && (
          <button
            className="floating-confirm-button"
            disabled={!canConfirm}
            onClick={confirmAnswer}
            ref={confirmButtonRef}
            type="button"
            aria-label="Confirmar alternativa"
            title="Confirmar alternativa"
          >
            <Check size={28} aria-hidden="true" />
          </button>
        )}

        {showTutorial && (
          <TutorialOverlay
            onClose={() => closeTutorial(true)}
            onNext={goToNextTutorialStep}
            onPrevious={goToPreviousTutorialStep}
            onSkip={() => closeTutorial(true)}
            rect={tutorialTargetRect}
            step={activeTutorialStep}
            stepIndex={tutorialStep}
            stepTotal={tutorialSteps.length}
          />
        )}
      </section>
    </main>
  );
}

export default function Module2App() {
  const normalizedPath = window.location.pathname.replace(/\/$/, "");
  const isStatsRoute = normalizedPath.endsWith("/estatisticas");
  const isQuestionEditorRoute = normalizedPath.endsWith("/editar-questoes");
  const isQuestionValidatorRoute = normalizedPath.endsWith("/validar-questoes");
  const isClassroomRoute = normalizedPath.endsWith("/sala-de-aula") || normalizedPath.endsWith("/estudar");

  if (isStatsRoute) {
    return <StatisticsDashboard />;
  }

  if (isQuestionEditorRoute) {
    return <QuestionEditorDashboard />;
  }

  if (isQuestionValidatorRoute) {
    return <OfficialQuestionValidatorDashboard />;
  }

  if (isClassroomRoute) {
    return <ClassroomModule />;
  }

  return <QuizApp />;
}

function TutorialOverlay({
  onClose,
  onNext,
  onPrevious,
  onSkip,
  rect,
  step,
  stepIndex,
  stepTotal,
}: {
  onClose: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSkip: () => void;
  rect: TargetRect | null;
  step: TutorialStep;
  stepIndex: number;
  stepTotal: number;
}) {
  const margin = 10;
  const targetStyle = rect
    ? {
        top: Math.max(8, rect.top - margin),
        left: Math.max(8, rect.left - margin),
        width: rect.width + margin * 2,
        height: rect.height + margin * 2,
      }
    : undefined;
  const cardTop = rect ? rect.top + rect.height + 22 : window.innerHeight / 2 - 120;
  const preferTop = rect ? cardTop > window.innerHeight - 230 : false;
  const maxCardLeft = Math.max(16, window.innerWidth - 356);
  const useCenteredCard =
    !rect || rect.height > window.innerHeight * 0.68 || rect.width > window.innerWidth * 0.82;
  const cardStyle = useCenteredCard
    ? {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      }
    : rect
      ? {
          top: preferTop ? "auto" : Math.min(cardTop, window.innerHeight - 220),
          bottom: preferTop ? Math.max(18, window.innerHeight - rect.top + 18) : "auto",
          left: Math.min(Math.max(16, rect.left + rect.width / 2 - 170), maxCardLeft),
        }
    : undefined;
  const isLast = stepIndex === stepTotal - 1;

  return (
    <div className="tutorial-layer" role="dialog" aria-modal="true" aria-label="Tutorial QuestMED">
      <div className="tutorial-dim" />
      {targetStyle && <div className="tutorial-target-ring" style={targetStyle} aria-hidden="true" />}
      {step.target === "swipe" && (
        <div className="tutorial-swipe-gesture" aria-hidden="true">
          <span />
        </div>
      )}
      <section className="tutorial-card" style={cardStyle}>
        <div className="tutorial-step-count">
          {stepIndex + 1}/{stepTotal}
        </div>
        <h2>{step.title}</h2>
        <p>{step.body}</p>
        <div className="tutorial-actions">
          <button className="tutorial-text-button" onClick={onSkip} type="button">
            Pular
          </button>
          <div>
            <button className="tutorial-secondary-button" disabled={stepIndex === 0} onClick={onPrevious} type="button">
              Voltar
            </button>
            <button className="tutorial-primary-button" onClick={isLast ? onClose : onNext} type="button">
              {isLast ? "Concluir" : "Próximo"}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function SecurityToast({ message }: { message: string }) {
  return (
    <div className="security-toast" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}
