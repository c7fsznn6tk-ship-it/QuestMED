import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Image,
  Lock,
  RefreshCw,
  Save,
  Search,
} from "lucide-react";
import { type Option, type Question } from "./data/questions";

type ImportedQuestion = Question & {
  source?: string;
  sourceQuestionNumber?: number;
  imageAlt?: string;
  imageUrl?: string;
  reviewNotes?: string;
  validationStatus?: "pending" | "needs-review" | "validated";
  metadata?: {
    answerWasRelabeledFromE?: boolean;
    hasImageMention?: boolean;
    originalOptionCount?: number;
  };
};

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

const VALIDATOR_TOKEN_KEY = "questmed:editor-token";
const optionIds: Option["id"][] = ["A", "B", "C", "D"];
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function getHomeHref() {
  return `${window.location.pathname.replace(/\/validar-questoes\/?$/, "/")}${window.location.search}`;
}

function cloneQuestion(question: ImportedQuestion): ImportedQuestion {
  return {
    ...question,
    metadata: question.metadata ? { ...question.metadata } : undefined,
    options: question.options.map((option) => ({ ...option })),
    statistics: { ...question.statistics },
  };
}

function normalizeOptions(options: Option[]) {
  return optionIds.map((optionId) => options.find((option) => option.id === optionId) ?? { id: optionId, text: "" });
}

function getQuestionSearchText(question: ImportedQuestion) {
  return [
    question.id,
    question.source,
    question.area,
    question.temaGeral,
    question.Tema,
    question.statement,
    question.hint,
    question.explanation,
    question.explanationTitle,
    question.reviewNotes,
    question.validationStatus,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function validateDraft(draft: ImportedQuestion | null) {
  const errors: string[] = [];

  if (!draft) {
    return ["Selecione uma questao."];
  }

  if (!draft.statement.trim()) {
    errors.push("Enunciado obrigatorio.");
  }

  if (!draft.area.trim()) {
    errors.push("Area obrigatoria.");
  }

  if (!draft.Tema.trim()) {
    errors.push("Tema obrigatorio.");
  }

  if (!optionIds.includes(draft.correctOptionId)) {
    errors.push("Gabarito deve ser A, B, C ou D.");
  }

  normalizeOptions(draft.options).forEach((option) => {
    if (!option.text.trim()) {
      errors.push(`Alternativa ${option.id} obrigatoria.`);
    }
  });

  return errors;
}

async function parseResponse<T>(response: Response): Promise<T> {
  const contentType = response.headers.get("content-type") ?? "";

  if (!contentType.includes("application/json")) {
    throw new Error("O helper local nao respondeu. Abra este modulo com npm run editor.");
  }

  const payload = (await response.json()) as T & { error?: string; errors?: string[] };

  if (!response.ok) {
    const details = payload.errors?.length ? ` ${payload.errors.join(" ")}` : "";
    throw new Error(`${payload.error ?? "Nao foi possivel concluir a operacao."}${details}`);
  }

  return payload;
}

function LoginPanel({
  authError,
  isSubmitting,
  onLogin,
}: {
  authError: string | null;
  isSubmitting: boolean;
  onLogin: (password: string) => void;
}) {
  const [password, setPassword] = useState("");

  return (
    <section className="stats-panel editor-login-panel">
      <div className="editor-login-header">
        <Lock size={26} aria-hidden="true" />
        <div>
          <p className="eyebrow">Acesso local</p>
          <h2>Validar questoes</h2>
        </div>
      </div>
      <form
        className="editor-login-form"
        onSubmit={(event) => {
          event.preventDefault();
          onLogin(password);
        }}
      >
        <label>
          <span>Senha do helper local</span>
          <input
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="QUESTMED_EDITOR_PASSWORD"
            type="password"
            value={password}
          />
        </label>
        {authError && <p className="editor-form-error">{authError}</p>}
        <button className="stats-refresh-button" disabled={isSubmitting || !password} type="submit">
          {isSubmitting ? <RefreshCw className="stats-loading-icon" size={17} /> : <Lock size={17} />}
          Entrar
        </button>
      </form>
    </section>
  );
}

function ValidatorStateCard({
  children,
  danger,
  icon,
  title,
}: {
  children: React.ReactNode;
  danger?: boolean;
  icon: React.ReactNode;
  title: string;
}) {
  return (
    <section className={["stats-state-card", danger ? "danger" : ""].join(" ")}>
      {icon}
      <div>
        <h2>{title}</h2>
        <p>{children}</p>
      </div>
    </section>
  );
}

export default function OfficialQuestionValidatorDashboard() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(VALIDATOR_TOKEN_KEY) ?? "");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [questions, setQuestions] = useState<ImportedQuestion[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ImportedQuestion | null>(null);
  const [questionSearch, setQuestionSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [imageFilter, setImageFilter] = useState("all");
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  async function login(password: string) {
    setIsLoggingIn(true);
    setAuthError(null);

    try {
      const payload = await parseResponse<{ token: string }>(
        await window.fetch("/api/login", {
          body: JSON.stringify({ password }),
          headers: jsonHeaders,
          method: "POST",
        }),
      );

      window.sessionStorage.setItem(VALIDATOR_TOKEN_KEY, payload.token);
      setToken(payload.token);
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Nao foi possivel entrar.");
    } finally {
      setIsLoggingIn(false);
    }
  }

  async function loadQuestions(nextToken = token) {
    if (!nextToken) {
      return;
    }

    setLoadState("loading");
    setLoadError(null);

    try {
      const payload = await parseResponse<{ questions: ImportedQuestion[] }>(
        await window.fetch("/api/imported-questions", {
          headers: { Authorization: `Bearer ${nextToken}` },
        }),
      );

      setQuestions(payload.questions);
      setLoadState("ready");

      const nextSelectedId = selectedQuestionId ?? payload.questions[0]?.id ?? null;
      const selected = payload.questions.find((question) => question.id === nextSelectedId) ?? payload.questions[0] ?? null;

      setSelectedQuestionId(selected?.id ?? null);
      setDraft(selected ? cloneQuestion(selected) : null);
      setSaveState("idle");
      setSaveError(null);
    } catch (error) {
      if (error instanceof Error && error.message.includes("nao autorizado")) {
        window.sessionStorage.removeItem(VALIDATOR_TOKEN_KEY);
        setToken("");
      }

      setLoadState("error");
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel carregar as questoes importadas.");
    }
  }

  async function saveDraft() {
    if (!draft || saveState === "saving") {
      return;
    }

    const errors = validateDraft(draft);

    if (errors.length > 0) {
      setSaveState("error");
      setSaveError(errors.join(" "));
      return;
    }

    setSaveState("saving");
    setSaveError(null);

    try {
      const payload = await parseResponse<{ question: ImportedQuestion }>(
        await window.fetch(`/api/imported-questions/${encodeURIComponent(draft.id)}`, {
          body: JSON.stringify({ question: draft }),
          headers: {
            Authorization: `Bearer ${token}`,
            ...jsonHeaders,
          },
          method: "PUT",
        }),
      );

      setQuestions((current) =>
        current.map((question) => (question.id === payload.question.id ? payload.question : question)),
      );
      setDraft(cloneQuestion(payload.question));
      setSaveState("saved");
    } catch (error) {
      setSaveState("error");
      setSaveError(error instanceof Error ? error.message : "Nao foi possivel salvar.");
    }
  }

  useEffect(() => {
    void loadQuestions();
  }, [token]);

  const selectedQuestion = useMemo(
    () => questions.find((question) => question.id === selectedQuestionId) ?? null,
    [questions, selectedQuestionId],
  );
  const draftErrors = useMemo(() => validateDraft(draft), [draft]);
  const isDirty = Boolean(draft && selectedQuestion && JSON.stringify(draft) !== JSON.stringify(selectedQuestion));
  const summary = useMemo(
    () => ({
      pending: questions.filter((question) => (question.validationStatus ?? "pending") === "pending").length,
      needsReview: questions.filter((question) => question.validationStatus === "needs-review").length,
      validated: questions.filter((question) => question.validationStatus === "validated").length,
      withImageMention: questions.filter((question) => question.metadata?.hasImageMention).length,
    }),
    [questions],
  );
  const searchedQuestions = useMemo(() => {
    const normalizedSearch = questionSearch.trim().toLowerCase();

    return questions.filter((question) => {
      const status = question.validationStatus ?? "pending";
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesImage =
        imageFilter === "all" ||
        (imageFilter === "image-mentioned" && Boolean(question.metadata?.hasImageMention)) ||
        (imageFilter === "image-added" && Boolean(question.imageUrl?.trim()));
      const matchesSearch = !normalizedSearch || getQuestionSearchText(question).includes(normalizedSearch);

      return matchesStatus && matchesImage && matchesSearch;
    });
  }, [imageFilter, questionSearch, questions, statusFilter]);

  function selectQuestion(question: ImportedQuestion) {
    setSelectedQuestionId(question.id);
    setDraft(cloneQuestion(question));
    setSaveState("idle");
    setSaveError(null);
  }

  function updateDraft(updater: (current: ImportedQuestion) => ImportedQuestion) {
    setDraft((current) => (current ? updater(current) : current));
    setSaveState("idle");
    setSaveError(null);
  }

  function updateOption(optionId: Option["id"], text: string) {
    updateDraft((current) => ({
      ...current,
      options: normalizeOptions(current.options).map((option) => (option.id === optionId ? { ...option, text } : option)),
    }));
  }

  return (
    <main className="stats-app-shell">
      <section className="stats-dashboard" aria-label="Validador de questoes importadas">
        <header className="stats-header">
          <a className="stats-back-link" href={getHomeHref()} aria-label="Voltar ao QuestMED">
            <ArrowLeft size={18} aria-hidden="true" />
            QuestMED
          </a>
          <div className="stats-title-row">
            <span className="stats-title-icon">
              <ClipboardCheck size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">Provas oficiais</p>
              <h1>Validar questoes</h1>
            </div>
          </div>
          <button className="stats-refresh-button" disabled={!token || loadState === "loading"} onClick={() => loadQuestions()} type="button">
            <RefreshCw className={loadState === "loading" ? "stats-loading-icon" : ""} size={17} aria-hidden="true" />
            Atualizar
          </button>
        </header>

        {!token && <LoginPanel authError={authError} isSubmitting={isLoggingIn} onLogin={login} />}

        {token && loadState === "loading" && (
          <ValidatorStateCard icon={<RefreshCw className="stats-loading-icon" size={24} />} title="Carregando importacao">
            Lendo o banco de questoes oficiais pelo helper local.
          </ValidatorStateCard>
        )}

        {token && loadState === "error" && (
          <ValidatorStateCard danger icon={<AlertCircle size={24} />} title="Nao foi possivel carregar">
            {loadError ?? "Confira se o helper foi aberto com npm run editor."}
          </ValidatorStateCard>
        )}

        {token && loadState === "ready" && (
          <>
            <section className="stats-card-grid validator-summary-grid">
              <article className="stats-card">
                <span>Pendentes</span>
                <strong>{summary.pending}</strong>
              </article>
              <article className="stats-card">
                <span>Revisar</span>
                <strong>{summary.needsReview}</strong>
              </article>
              <article className="stats-card">
                <span>Validadas</span>
                <strong>{summary.validated}</strong>
              </article>
              <article className="stats-card">
                <span>Com imagem</span>
                <strong>{summary.withImageMention}</strong>
              </article>
            </section>

            <section className="question-search-panel editor-search-panel validator-search-panel">
              <div className="stats-filter-title">
                <Search size={18} aria-hidden="true" />
                <strong>Buscar questao</strong>
              </div>
              <label>
                <span>ID, prova, tema, enunciado ou anotacao</span>
                <input
                  onChange={(event) => setQuestionSearch(event.target.value)}
                  placeholder="Ex.: Revalida 25.1, pre-natal, q042"
                  type="search"
                  value={questionSearch}
                />
              </label>
              <label>
                <span>Status</span>
                <select onChange={(event) => setStatusFilter(event.target.value)} value={statusFilter}>
                  <option value="all">Todos</option>
                  <option value="pending">Pendentes</option>
                  <option value="needs-review">Revisar</option>
                  <option value="validated">Validadas</option>
                </select>
              </label>
              <label>
                <span>Imagem</span>
                <select onChange={(event) => setImageFilter(event.target.value)} value={imageFilter}>
                  <option value="all">Todas</option>
                  <option value="image-mentioned">Provavel imagem</option>
                  <option value="image-added">Imagem adicionada</option>
                </select>
              </label>
              <span className={isDirty ? "editor-dirty-pill active" : "editor-dirty-pill"}>
                {isDirty ? "Alteracoes pendentes" : "Sem pendencias"}
              </span>
            </section>

            <div className="editor-workspace-grid validator-workspace-grid">
              <section className="stats-panel editor-question-list-panel">
                <h2>Questoes importadas</h2>
                {searchedQuestions.length === 0 ? (
                  <p className="stats-empty-line">Nenhuma questao encontrada.</p>
                ) : (
                  <div className="stats-table-wrap">
                    <table className="stats-table question-stats-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Prova</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {searchedQuestions.map((question) => (
                          <tr
                            className={question.id === selectedQuestionId ? "selected" : ""}
                            key={question.id}
                            onClick={() => selectQuestion(question)}
                          >
                            <td>{question.id}</td>
                            <td>{question.source ?? question.Tema}</td>
                            <td>
                              <span className={`validator-status-pill ${question.validationStatus ?? "pending"}`}>
                                {question.validationStatus === "validated"
                                  ? "Validada"
                                  : question.validationStatus === "needs-review"
                                    ? "Revisar"
                                    : "Pendente"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>

              {draft && (
                <section className="stats-panel editor-form-panel">
                  <div className="editor-form-header">
                    <div>
                      <p className="eyebrow">{draft.source ?? "Questao importada"}</p>
                      <h2>{draft.id}</h2>
                    </div>
                    <button className="stats-refresh-button" disabled={!isDirty || saveState === "saving"} onClick={saveDraft} type="button">
                      {saveState === "saving" ? <RefreshCw className="stats-loading-icon" size={17} /> : <Save size={17} />}
                      Salvar
                    </button>
                  </div>

                  <section className="validator-preview-panel" aria-label="Previa da questao">
                    <div className="validator-preview-statement">{draft.statement}</div>

                    <div className="validator-preview-options">
                      {normalizeOptions(draft.options).map((option) => (
                        <div className="validator-preview-option" key={option.id}>
                          <span>{option.id}</span>
                          <p>{option.text}</p>
                        </div>
                      ))}
                    </div>

                    <div className="validator-preview-answer">
                      <span>Gabarito</span>
                      <strong>{draft.correctOptionId}</strong>
                    </div>
                  </section>

                  <div className="question-detail-meta validator-meta">
                    <span>Q{draft.sourceQuestionNumber ?? "-"}</span>
                    <span>{draft.metadata?.originalOptionCount ?? 4} alternativas originais</span>
                    {draft.metadata?.answerWasRelabeledFromE && <span>Gabarito E remapeado</span>}
                    {draft.metadata?.hasImageMention && <span>Provavel imagem</span>}
                  </div>

                  {saveState === "saved" && (
                    <p className="editor-form-success">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      Questao salva no banco de validacao.
                    </p>
                  )}
                  {saveState === "error" && saveError && <p className="editor-form-error">{saveError}</p>}

                  <div className="editor-options-grid">
                    <label className="editor-field">
                      <span>Area</span>
                      <input onChange={(event) => updateDraft((current) => ({ ...current, area: event.target.value }))} value={draft.area} />
                    </label>
                    <label className="editor-field">
                      <span>Tema</span>
                      <input onChange={(event) => updateDraft((current) => ({ ...current, Tema: event.target.value }))} value={draft.Tema} />
                    </label>
                    <label className="editor-field">
                      <span>Tema geral</span>
                      <input
                        onChange={(event) => updateDraft((current) => ({ ...current, temaGeral: event.target.value }))}
                        value={draft.temaGeral ?? draft.Tema}
                      />
                    </label>
                  </div>

                  <label className="editor-field">
                    <span>Status de validacao</span>
                    <select
                      onChange={(event) =>
                        updateDraft((current) => ({
                          ...current,
                          validationStatus: event.target.value as ImportedQuestion["validationStatus"],
                        }))
                      }
                      value={draft.validationStatus ?? "pending"}
                    >
                      <option value="pending">Pendente</option>
                      <option value="needs-review">Precisa revisar</option>
                      <option value="validated">Validada</option>
                    </select>
                  </label>

                  <label className="editor-field">
                    <span>Enunciado</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, statement: event.target.value }))}
                      rows={8}
                      value={draft.statement}
                    />
                  </label>

                  <div className="editor-options-grid">
                    {normalizeOptions(draft.options).map((option) => (
                      <label className="editor-field" key={option.id}>
                        <span>Alternativa {option.id}</span>
                        <textarea onChange={(event) => updateOption(option.id, event.target.value)} rows={4} value={option.text} />
                      </label>
                    ))}
                  </div>

                  <label className="editor-field">
                    <span>Gabarito</span>
                    <select
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, correctOptionId: event.target.value as Option["id"] }))
                      }
                      value={draft.correctOptionId}
                    >
                      {optionIds.map((optionId) => (
                        <option key={optionId} value={optionId}>
                          {optionId}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="editor-options-grid">
                    <label className="editor-field">
                      <span>Dica</span>
                      <textarea
                        onChange={(event) => updateDraft((current) => ({ ...current, hint: event.target.value }))}
                        rows={4}
                        value={draft.hint}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Titulo da justificativa</span>
                      <input
                        onChange={(event) => updateDraft((current) => ({ ...current, explanationTitle: event.target.value }))}
                        value={draft.explanationTitle}
                      />
                    </label>
                  </div>

                  <label className="editor-field">
                    <span>Justificativa</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, explanation: event.target.value }))}
                      rows={5}
                      value={draft.explanation ?? ""}
                    />
                  </label>

                  <section className="validator-image-panel">
                    <div className="stats-filter-title">
                      <Image size={18} aria-hidden="true" />
                      <strong>Imagem ou recurso associado</strong>
                    </div>
                    <label className="editor-field">
                      <span>URL ou caminho da imagem</span>
                      <input
                        onChange={(event) => updateDraft((current) => ({ ...current, imageUrl: event.target.value }))}
                        placeholder="Ex.: /assets/questoes/revalida-25-1-q001.png"
                        value={draft.imageUrl ?? ""}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Descricao da imagem</span>
                      <input
                        onChange={(event) => updateDraft((current) => ({ ...current, imageAlt: event.target.value }))}
                        placeholder="Descricao curta para revisao e acessibilidade"
                        value={draft.imageAlt ?? ""}
                      />
                    </label>
                    {draft.imageUrl?.trim() && (
                      <div className="validator-image-preview">
                        <img alt={draft.imageAlt || "Imagem associada a questao"} src={draft.imageUrl} />
                      </div>
                    )}
                  </section>

                  <label className="editor-field">
                    <span>Anotacoes de revisao</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, reviewNotes: event.target.value }))}
                      rows={4}
                      value={draft.reviewNotes ?? ""}
                    />
                  </label>

                  {draftErrors.length > 0 && (
                    <div className="editor-validation-list">
                      {draftErrors.map((error) => (
                        <span key={error}>{error}</span>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </div>
          </>
        )}
      </section>
    </main>
  );
}
