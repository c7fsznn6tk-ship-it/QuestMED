import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Download,
  Filter,
  HelpCircle,
  Lightbulb,
  RotateCcw,
  Scissors,
  ShieldAlert,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import { getTemaGeral, questionBank, type Option, type Question } from "./data/questions";
import FormattedExplanation from "./FormattedExplanation";
import QuestionAttachments from "./QuestionAttachments";
import { flushQuestionEventQueue, trackQuestionEvent } from "./utils/analytics";
import { generateResultPdfBlob } from "./utils/resultPdf";

const QUESTION_LIMIT = 10;
const QUESTION_EXPOSURE_STORAGE_KEY = "questmed-desktop:recent-question-exposures";
const TUTORIAL_STORAGE_KEY = "questmed-desktop:tutorial-seen";
const RECENT_EXPOSURE_LIMIT = Math.min(questionBank.length, QUESTION_LIMIT * 8);

type AreaFilterId = "all" | "gynecology-obstetrics" | "preventive" | "surgery" | "internal-medicine" | "pediatrics";

type AreaFilter = {
  id: AreaFilterId;
  label: string;
  matches: (question: Question) => boolean;
};

const areaFilters: AreaFilter[] = [
  {
    id: "all",
    label: "Todas",
    matches: () => true,
  },
  {
    id: "gynecology-obstetrics",
    label: "GO",
    matches: (question) => question.area === "Ginecologia e ObstetrÃ­cia",
  },
  {
    id: "preventive",
    label: "Preventiva",
    matches: (question) => ["Medicina Preventiva", "Preventiva", "Medicina Preventiva e Social"].includes(question.area),
  },
  {
    id: "internal-medicine",
    label: "Clinica",
    matches: (question) => question.area === "ClÃ­nica MÃ©dica",
  },
  {
    id: "pediatrics",
    label: "Pediatria",
    matches: (question) => question.area === "Pediatria",
  },
  {
    id: "surgery",
    label: "Cirurgia",
    matches: (question) => question.area === "Cirurgia",
  },
];

type FlowStep = "question" | "finished";

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
  elapsedSeconds: number;
};

type SessionState = {
  currentIndex: number;
  questionStates: QuestionRuntimeState[];
  flowStep: FlowStep;
  answers: AnswerRecord[];
  printWarning: string | null;
};

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
    elapsedSeconds: 0,
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
    const parsedHistory = rawHistory ? JSON.parse(rawHistory) : [];

    return Array.isArray(parsedHistory)
      ? parsedHistory.filter((questionId): questionId is string => typeof questionId === "string")
      : [];
  } catch {
    return [];
  }
}

function recordQuestionExposures(questionIds: string[]) {
  try {
    const nextHistory = [...questionIds, ...readRecentQuestionExposures()]
      .filter((questionId, index, allIds) => allIds.indexOf(questionId) === index)
      .slice(0, RECENT_EXPOSURE_LIMIT);

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

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function matchesAnyArea(question: Question, labels: string[]) {
  const normalizedArea = normalizeText(question.area);

  return labels.some((label) => normalizedArea === normalizeText(label));
}

function getAreaFilter(filterId: AreaFilterId): AreaFilter {
  switch (filterId) {
    case "gynecology-obstetrics":
      return {
        id: filterId,
        label: "GO",
        matches: (question) => matchesAnyArea(question, ["Ginecologia e Obstetricia", "Ginecologia e Obstetrícia"]),
      };
    case "preventive":
      return {
        id: filterId,
        label: "Preventiva",
        matches: (question) => matchesAnyArea(question, ["Medicina Preventiva", "Preventiva", "Medicina Preventiva e Social"]),
      };
    case "surgery":
      return {
        id: filterId,
        label: "Cirurgia",
        matches: (question) => matchesAnyArea(question, ["Cirurgia"]),
      };
    case "internal-medicine":
      return {
        id: filterId,
        label: "Clinica",
        matches: (question) => matchesAnyArea(question, ["Clinica Medica", "Clínica Médica"]),
      };
    case "pediatrics":
      return {
        id: filterId,
        label: "Pediatria",
        matches: (question) => matchesAnyArea(question, ["Pediatria"]),
      };
    default:
      return areaFilters[0];
  }
}

function createQuestionSet(areaFilterId: AreaFilterId = "all") {
  const recentQuestionIds = readRecentQuestionExposures();
  const activeAreaFilter = getAreaFilter(areaFilterId);
  const availableQuestions = questionBank.filter(activeAreaFilter.matches);
  const themes = Array.from(new Set(availableQuestions.map(getTemaGeral)));
  const buckets = new Map(
    themes.map((theme) => [
      theme,
      availableQuestions
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

    if (round > availableQuestions.length + themeOrder.length) {
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

function replaceQuestionState(
  states: QuestionRuntimeState[],
  index: number,
  updater: (state: QuestionRuntimeState) => QuestionRuntimeState,
) {
  return states.map((state, stateIndex) => (stateIndex === index ? updater(state) : state));
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

function formatTimer(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function getEliminatedOptions(question: Question) {
  return question.options
    .filter((option) => option.id !== question.correctOptionId)
    .sort((a, b) => question.statistics[a.id] - question.statistics[b.id])
    .slice(0, 2)
    .map((option) => option.id);
}

function getQuestionStatus(question: Question, state: QuestionRuntimeState) {
  if (!state.isConfirmed || !state.selectedOptionId) {
    return "pending";
  }

  return state.selectedOptionId === question.correctOptionId ? "correct" : "incorrect";
}

function getAreaShortLabel(area: string) {
  const normalizedArea = normalizeText(area);

  if (normalizedArea.includes("pediatria")) {
    return "Pediatria";
  }

  if (normalizedArea.includes("ginecologia") || normalizedArea.includes("obstetricia")) {
    return "Ginecologia e Obstetrícia";
  }

  if (normalizedArea.includes("preventiva") || normalizedArea.includes("social")) {
    return "Preventiva";
  }

  if (normalizedArea.includes("cirurgia")) {
    return "Cirurgia";
  }

  if (normalizedArea.includes("clinica")) {
    return "Clinica";
  }

  return area;
}

function SecurityToast({ message }: { message: string }) {
  return (
    <div className="desktop-security-toast" role="status">
      <ShieldAlert size={18} aria-hidden="true" />
      <span>{message}</span>
    </div>
  );
}

export default function DesktopApp() {
  const [selectedAreaFilter, setSelectedAreaFilter] = useState<AreaFilterId>("all");
  const [questions, setQuestions] = useState<Question[]>(() => createQuestionSet("all"));
  const [session, setSession] = useState<SessionState>(() => createInitialSession(questions.length));
  const [showTutorial, setShowTutorial] = useState(false);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [pendingConfirmation, setPendingConfirmation] = useState<
    { kind: "newQuestions" } | { kind: "areaFilter"; filterId: AreaFilterId } | null
  >(null);
  const sentQuestionEventKeysRef = useRef(new Set<string>());
  const currentQuestion = questions[session.currentIndex] ?? questions[0];
  const questionCount = questions.length;
  const questionState = normalizeQuestionState(session.questionStates[session.currentIndex]);
  const questionLocked =
    questionState.isConfirmed ||
    showTutorial ||
    session.flowStep !== "question";
  const answerStatus = currentQuestion ? getQuestionStatus(currentQuestion, questionState) : "pending";
  const canConfirm = Boolean(questionState.selectedOptionId) && !questionLocked;
  const isLastQuestion = session.currentIndex === questionCount - 1;

  const summary = useMemo(() => {
    const answered = session.answers.filter((answerItem) => !answerItem.expired);
    const correct = session.answers.filter((answerItem) => answerItem.isCorrect);
    const expired = session.answers.filter((answerItem) => answerItem.expired);
    const totalScore = session.answers.reduce((total, answerItem) => total + answerItem.score, 0);
    const percent = questionCount > 0 ? Math.round((totalScore / questionCount) * 100) : 0;

    return {
      answered: answered.length,
      correct: correct.length,
      expired: expired.length,
      incorrect: session.answers.length - correct.length - expired.length,
      percent,
      totalScore,
    };
  }, [questionCount, session.answers]);

  useEffect(() => {
    recordQuestionExposures(questions.map((question) => question.id));
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
    if (questionLocked || !currentQuestion) {
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
          !activeQuestion ||
          !activeQuestionState ||
          activeQuestionState.isConfirmed ||
          activeQuestionState.isExpired
        ) {
          return current;
        }

        return {
          ...current,
          questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
            ...state,
            elapsedSeconds: state.elapsedSeconds + 1,
          })),
        };
      });
    }, 1000);

    return () => window.clearInterval(timer);
  }, [currentQuestion, questionLocked, questions, session.currentIndex]);

  useEffect(() => {
    function warn(message: string) {
      setSession((current) => ({ ...current, printWarning: message }));
      window.setTimeout(() => {
        setSession((current) => ({ ...current, printWarning: null }));
      }, 2600);
    }

    function handleKeyDown(event: KeyboardEvent) {
      const key = event.key.toLowerCase();
      const blockedShortcut = key === "printscreen" || ((event.ctrlKey || event.metaKey) && ["p", "s"].includes(key));

      if (!blockedShortcut) {
        return;
      }

      event.preventDefault();
      warn("Capturas e salvamentos rapidos foram desativados nesta tela.");
    }

    function handleContextMenu(event: MouseEvent) {
      event.preventDefault();
      warn("Menu de contexto bloqueado durante a resolucao.");
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

  function markTutorialSeen() {
    try {
      window.localStorage.setItem(TUTORIAL_STORAGE_KEY, "true");
    } catch {
      // localStorage can be unavailable in restricted browser modes.
    }
  }

  function closeTutorial() {
    markTutorialSeen();
    setShowTutorial(false);
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

  function navigateToQuestion(nextIndex: number) {
    const cappedIndex = Math.max(0, Math.min(nextIndex, questionCount - 1));

    setIsFilterOpen(false);
    setSession((current) => ({
      ...current,
      currentIndex: cappedIndex,
      flowStep: "question",
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        showHintModal: false,
        showVideoPrompt: false,
      })),
    }));
  }

  function selectOption(optionId: Option["id"]) {
    if (questionLocked || questionState.eliminatedOptionIds.includes(optionId)) {
      return;
    }

    setIsFilterOpen(false);
    updateActiveQuestion((state) => ({
      ...state,
      selectedOptionId: optionId,
    }));
  }

  function confirmAnswer() {
    if (!currentQuestion || !questionState.selectedOptionId || questionLocked) {
      return;
    }

    const record = createAnswerRecord(currentQuestion, questionState.selectedOptionId, questionState.usedHint, false);
    trackAnswerRecord(currentQuestion, record, session.currentIndex);

    setIsFilterOpen(false);
    setSession((current) => ({
      ...current,
      answers: upsertAnswer(current.answers, record),
      questionStates: replaceQuestionState(current.questionStates, current.currentIndex, (state) => ({
        ...state,
        isConfirmed: true,
        showVideoPrompt: false,
      })),
    }));
  }

  function eliminateOptions() {
    if (!currentQuestion || questionState.eliminatedOptionIds.length > 0 || questionLocked) {
      return;
    }

    updateActiveQuestion((state) => ({
      ...state,
      eliminatedOptionIds: getEliminatedOptions(currentQuestion),
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

  function closeHint() {
    updateActiveQuestion((state) => ({
      ...state,
      showHintModal: false,
    }));
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

  function restartSession() {
    sentQuestionEventKeysRef.current.clear();
    setSession(createInitialSession(questionCount));
  }

  function applyNewQuestions(filterId = selectedAreaFilter) {
    const nextQuestions = createQuestionSet(filterId);
    sentQuestionEventKeysRef.current.clear();
    setQuestions(nextQuestions);
    setSession(createInitialSession(nextQuestions.length));
  }

  function requestNewQuestions() {
    setPendingConfirmation({ kind: "newQuestions" });
  }

  function selectAreaFilter(filterId: AreaFilterId) {
    if (filterId === selectedAreaFilter) {
      setIsFilterOpen(false);
      return;
    }

    setIsFilterOpen(false);
    setPendingConfirmation({ kind: "areaFilter", filterId });
  }

  function confirmPendingChange() {
    if (!pendingConfirmation) {
      return;
    }

    if (pendingConfirmation.kind === "areaFilter") {
      setSelectedAreaFilter(pendingConfirmation.filterId);
      applyNewQuestions(pendingConfirmation.filterId);
    } else {
      applyNewQuestions();
    }

    setPendingConfirmation(null);
  }

  function generateSessionPdf() {
    const exportedAt = new Date();
    const blob = generateResultPdfBlob({
      answers: session.answers,
      exportedAt,
      questions,
      summary,
      totalQuestions: questionCount,
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const timestamp = exportedAt.toISOString().replace(/[:.]/g, "-");

    link.href = url;
    link.download = `questmed-desktop-resultado-${timestamp}.pdf`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderResultContent() {
    return (
      <section className="desktop-result-panel" aria-label="Resultado QuestMED Desktop">
        <div className="desktop-result-hero">
          <span>
            <Sparkles size={34} aria-hidden="true" />
          </span>
          <div>
            <p className="eyebrow">QuestMED Desktop</p>
            <h1>Resultado do dia</h1>
          </div>
        </div>

        <div className="desktop-summary-grid" aria-label="Estatisticas finais">
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
            <span>Nao respondidas</span>
          </div>
          <div>
            <strong>{summary.percent}%</strong>
            <span>Desempenho</span>
          </div>
        </div>

        <div className="desktop-score-card">
          <span>Pontuacao total</span>
          <strong>
            {formatDecimal(summary.totalScore)} / {questionCount}
          </strong>
          <p>{summary.answered} questoes respondidas. Dicas usadas reduzem a pontuacao da questao para metade.</p>
        </div>

        <div className="desktop-result-actions">
          <button className="desktop-primary-button" onClick={generateSessionPdf} type="button">
            <Download size={18} aria-hidden="true" />
            Gerar PDF
          </button>
          <button className="desktop-secondary-button" onClick={restartSession} type="button">
            <RotateCcw size={18} aria-hidden="true" />
            Refazer
          </button>
          <button className="desktop-secondary-button" onClick={requestNewQuestions} type="button">
            <Shuffle size={18} aria-hidden="true" />
            Novas questoes
          </button>
        </div>
      </section>
    );
  }

  if (!currentQuestion) {
    return (
      <main className="desktop-shell secure-surface">
        <section className="desktop-empty-state">
          <HelpCircle size={24} aria-hidden="true" />
          <h1>Banco indisponivel</h1>
          <p>Nao ha questoes disponiveis para este filtro.</p>
        </section>
      </main>
    );
  }

  if (session.flowStep === "finished") {
    return (
      <main className="desktop-shell secure-surface">
        {session.printWarning && <SecurityToast message={session.printWarning} />}
        {renderResultContent()}
      </main>
    );
  }

  return (
    <main className="desktop-shell secure-surface">
      {session.printWarning && <SecurityToast message={session.printWarning} />}

      <section className="desktop-stage" aria-label="QuestMED Desktop">
        <header className="desktop-topbar">
          <div>
            <p className="eyebrow">QuestMED Desktop</p>
            <h1>Questao {session.currentIndex + 1}</h1>
          </div>

          <div className="desktop-filter-bar" aria-label="Filtrar por grande area">
            <button
              aria-expanded={isFilterOpen}
              aria-label="Abrir filtros"
              className="desktop-filter-toggle"
              onClick={() => setIsFilterOpen((current) => !current)}
              type="button"
            >
              <Filter size={24} aria-hidden="true" />
            </button>
            {isFilterOpen && (
              <div className="desktop-filter-menu" role="menu">
                {areaFilters.map((filter) => (
                  <button
                    aria-pressed={selectedAreaFilter === filter.id}
                    className={selectedAreaFilter === filter.id ? "active" : ""}
                    disabled={selectedAreaFilter === filter.id}
                    key={filter.id}
                    onClick={() => selectAreaFilter(filter.id)}
                    role="menuitemradio"
                    type="button"
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="desktop-timer elapsed" aria-label="Tempo gasto nesta questao">
            <span>Tempo</span>
            <strong>{formatTimer(questionState.elapsedSeconds)}</strong>
          </div>
        </header>

        <div className="desktop-layout">
          <section className="desktop-question-workspace">
            <div className="desktop-meta-row">
              <span className="id-pill">{currentQuestion.id}</span>
              <span className="area-pill">{currentQuestion.area}</span>
              <span className="progress-pill">
                {session.currentIndex + 1}/{questionCount} hoje
              </span>
              {questionState.usedHint && <span className="hint-penalty-pill">Dica: 50%</span>}
            </div>

            <section className="desktop-question-card">
              <p>{currentQuestion.statement}</p>
              <QuestionAttachments question={currentQuestion} />
            </section>

            <section className="desktop-options-grid" aria-label="Alternativas">
              {currentQuestion.options.map((option) => {
                const isSelected = questionState.selectedOptionId === option.id;
                const isEliminated = questionState.eliminatedOptionIds.includes(option.id);
                const isCorrect = questionState.isConfirmed && option.id === currentQuestion.correctOptionId;
                const isWrongSelection = questionState.isConfirmed && isSelected && !isCorrect;

                return (
                  <button
                    className={[
                      "desktop-option-button",
                      isSelected ? "selected" : "",
                      isEliminated ? "eliminated" : "",
                      isCorrect ? "correct" : "",
                      isWrongSelection ? "incorrect" : "",
                      questionLocked ? "locked" : "",
                    ].join(" ")}
                    disabled={isEliminated || questionLocked}
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

            <section className="desktop-feedback-zone" aria-live="polite">
              {questionState.isConfirmed && currentQuestion.explanation && (
                <div className={["explanation-card", "desktop-answer-explanation", answerStatus].join(" ")}>
                  <strong className="desktop-answer-message">
                    {answerStatus === "correct" ? "Parabéns, você acertou" : "Que pena, você errou"}
                  </strong>
                  <FormattedExplanation explanation={currentQuestion.explanation} />
                </div>
              )}
            </section>
          </section>

          <aside className="desktop-side-panel" aria-label="Navegacao e acoes">
            <div className="desktop-question-map" aria-label="Mapa de questoes">
              {questions.map((questionItem, index) => {
                const targetState = normalizeQuestionState(session.questionStates[index]);
                const targetStatus = getQuestionStatus(questionItem, targetState);

                return (
                  <button
                    aria-label={`Abrir questao ${index + 1}`}
                    className={[session.currentIndex === index ? "active" : "", targetStatus].join(" ")}
                    key={questionItem.id}
                    onClick={() => navigateToQuestion(index)}
                    type="button"
                  >
                    <span>{index + 1}</span>
                    <strong>{getAreaShortLabel(questionItem.area)}</strong>
                    <small>{formatTimer(targetState.elapsedSeconds)}</small>
                  </button>
                );
              })}
            </div>

            <div className="desktop-action-stack">
              <button className="desktop-secondary-button" disabled={questionLocked} onClick={openHint} type="button">
                <Lightbulb size={18} aria-hidden="true" />
                Dica
              </button>
              <button
                className="desktop-secondary-button"
                disabled={questionLocked || questionState.eliminatedOptionIds.length > 0}
                onClick={eliminateOptions}
                type="button"
              >
                <Scissors size={18} aria-hidden="true" />
                Eliminar
              </button>
            </div>

            <div className="desktop-nav-actions">
              <button
                className="desktop-secondary-button"
                disabled={session.currentIndex === 0}
                onClick={() => navigateToQuestion(session.currentIndex - 1)}
                type="button"
              >
                <ArrowLeft size={18} aria-hidden="true" />
                Anterior
              </button>
              {isLastQuestion ? (
                <button
                  className="desktop-primary-button"
                  disabled={!questionState.isConfirmed}
                  onClick={finishSession}
                  type="button"
                >
                  Resultado
                  <Sparkles size={18} aria-hidden="true" />
                </button>
              ) : (
                <button
                  className="desktop-primary-button"
                  onClick={() => navigateToQuestion(session.currentIndex + 1)}
                  type="button"
                >
                  Proxima
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              )}
            </div>

            <div className="desktop-session-card">
              <span>Resumo parcial</span>
              <strong>{formatDecimal(summary.totalScore)} pts</strong>
              <p>
                {summary.correct} acertos, {summary.incorrect} erros e {summary.expired} sem resposta.
              </p>
              <button className="desktop-ghost-button" onClick={requestNewQuestions} type="button">
                <Shuffle size={16} aria-hidden="true" />
                Novas questoes
              </button>
            </div>

            <button className="desktop-help-button" onClick={() => setShowTutorial(true)} type="button">
              <HelpCircle size={17} aria-hidden="true" />
              Tutorial
            </button>
          </aside>
        </div>
      </section>

      {canConfirm && (
        <button
          className="desktop-floating-confirm-button"
          disabled={!canConfirm}
          onClick={confirmAnswer}
          type="button"
          aria-label="Confirmar alternativa"
        >
          <Check size={24} aria-hidden="true" />
          <span>Confirmar</span>
        </button>
      )}

      {questionState.showHintModal && (
        <div className="modal-backdrop hint-backdrop" onClick={closeHint} role="presentation">
          <section className="hint-modal" aria-modal="true" role="dialog">
            <header className="hint-modal-header">
              <Lightbulb size={28} aria-hidden="true" />
              <h2>Dica</h2>
            </header>
            <p>{currentQuestion.hint}</p>
          </section>
        </div>
      )}

      {pendingConfirmation && (
        <div className="desktop-confirm-backdrop" role="presentation">
          <section className="desktop-confirm-modal" aria-modal="true" role="dialog" aria-label="Confirmar troca de questoes">
            <button
              className="close-modal-button"
              onClick={() => setPendingConfirmation(null)}
              type="button"
              aria-label="Cancelar troca"
            >
              <X size={20} aria-hidden="true" />
            </button>
            <div className="desktop-confirm-icon">
              <Shuffle size={28} aria-hidden="true" />
            </div>
            <h2>Trocar questoes?</h2>
            <p>
              {pendingConfirmation.kind === "areaFilter"
                ? "Ao mudar o filtro, uma nova lista de questoes sera criada e o progresso atual sera reiniciado."
                : "Uma nova lista de questoes sera criada e o progresso atual sera reiniciado."}
            </p>
            <div className="desktop-confirm-actions">
              <button className="desktop-secondary-button" onClick={() => setPendingConfirmation(null)} type="button">
                Cancelar
              </button>
              <button className="desktop-primary-button" onClick={confirmPendingChange} type="button">
                Sim, trocar
              </button>
            </div>
          </section>
        </div>
      )}

      {showTutorial && (
        <div className="desktop-tutorial-backdrop" role="presentation">
          <section className="desktop-tutorial-modal" aria-modal="true" role="dialog" aria-label="Tutorial Desktop">
            <button className="close-modal-button" onClick={closeTutorial} type="button" aria-label="Fechar tutorial">
              <X size={20} aria-hidden="true" />
            </button>
            <div className="desktop-tutorial-icon">
              <HelpCircle size={30} aria-hidden="true" />
            </div>
            <p className="eyebrow">Tutorial Desktop</p>
            <h2>Resolucao em tela ampla</h2>
            <div className="desktop-tutorial-grid">
              <div>
                <strong>Painel central</strong>
                <span>Leia o enunciado, veja anexos e marque uma alternativa.</span>
              </div>
              <div>
                <strong>Barra superior</strong>
                <span>Filtre por area e controle o cronometro da questao.</span>
              </div>
              <div>
                <strong>Painel lateral</strong>
                <span>Navegue entre as 10 questoes e acompanhe o status de cada uma.</span>
              </div>
              <div>
                <strong>Acoes</strong>
                <span>Use dica, elimine alternativas, confirme e avance por botoes.</span>
              </div>
            </div>
            <button className="desktop-primary-button" onClick={closeTutorial} type="button">
              Comecar
            </button>
          </section>
        </div>
      )}
    </main>
  );
}
