import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  FilePenLine,
  Image,
  Lock,
  Plus,
  RefreshCw,
  Save,
  Search,
  Trash2,
} from "lucide-react";
import { type Option, type Question } from "./data/questions";

type LoadState = "idle" | "loading" | "ready" | "error";
type SaveState = "idle" | "saving" | "saved" | "error";

const EDITOR_TOKEN_KEY = "questmed:editor-token";
const optionIds: Option["id"][] = ["A", "B", "C", "D"];
const jsonHeaders = { "Content-Type": "application/json; charset=utf-8" };

function getHomeHref() {
  return `${window.location.pathname.replace(/\/editar-questoes\/?$/, "/")}${window.location.search}`;
}

function cloneQuestion(question: Question): Question {
  return {
    ...question,
    attachments: question.attachments?.map((attachment) => ({ ...attachment })),
    options: question.options.map((option) => ({ ...option })),
    statistics: { ...question.statistics },
  };
}

function getQuestionSearchText(question: Question) {
  return [
    question.id,
    question.area,
    question.temaGeral,
    question.Tema,
    question.statement,
    question.hint,
    question.explanation,
    question.explanationTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function normalizeOptions(options: Option[]) {
  return optionIds.map((optionId) => options.find((option) => option.id === optionId) ?? { id: optionId, text: "" });
}

function validateDraft(draft: Question | null) {
  const errors: string[] = [];

  if (!draft) {
    return ["Selecione uma questao."];
  }

  if (!draft.statement.trim()) {
    errors.push("Enunciado obrigatorio.");
  }

  if (!draft.hint.trim()) {
    errors.push("Dica obrigatoria.");
  }

  if (!draft.explanation?.trim()) {
    errors.push("Justificativa obrigatoria.");
  }

  draft.attachments
    ?.filter((attachment) => attachment.type === "image" && attachment.src.trim())
    .forEach((attachment, index) => {
      if (!attachment.alt.trim()) {
        errors.push(`Descricao da imagem ${index + 1} obrigatoria.`);
      }
    });

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
    throw new Error(
      "O helper local do editor nao respondeu. Abra o modulo com npm run editor, nao com npm run dev.",
    );
  }

  const payload = (await response.json()) as T & { error?: string; errors?: string[] };

  if (!response.ok) {
    const details = payload.errors?.length ? ` ${payload.errors.join(" ")}` : "";
    throw new Error(`${payload.error ?? "Nao foi possivel concluir a operacao."}${details}`);
  }

  return payload;
}

function EditorStateCard({
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
          <h2>Editor de questoes</h2>
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

export default function QuestionEditorDashboard() {
  const [token, setToken] = useState(() => window.sessionStorage.getItem(EDITOR_TOKEN_KEY) ?? "");
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Question | null>(null);
  const [questionSearch, setQuestionSearch] = useState("");
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

      window.sessionStorage.setItem(EDITOR_TOKEN_KEY, payload.token);
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
      const payload = await parseResponse<{ questions: Question[] }>(
        await window.fetch("/api/questions", {
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
        window.sessionStorage.removeItem(EDITOR_TOKEN_KEY);
        setToken("");
      }

      setLoadState("error");
      setLoadError(error instanceof Error ? error.message : "Nao foi possivel carregar as questoes.");
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
      const payload = await parseResponse<{ question: Question }>(
        await window.fetch(`/api/questions/${encodeURIComponent(draft.id)}`, {
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
  const searchedQuestions = useMemo(() => {
    const normalizedSearch = questionSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return questions;
    }

    return questions.filter((question) => getQuestionSearchText(question).includes(normalizedSearch));
  }, [questionSearch, questions]);

  function selectQuestion(question: Question) {
    setSelectedQuestionId(question.id);
    setDraft(cloneQuestion(question));
    setSaveState("idle");
    setSaveError(null);
  }

  function updateDraft(updater: (current: Question) => Question) {
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

  function addImageAttachment() {
    updateDraft((current) => ({
      ...current,
      attachments: [...(current.attachments ?? []), { type: "image", src: "", alt: "", caption: "" }],
    }));
  }

  function updateImageAttachment(index: number, field: "alt" | "caption" | "src", value: string) {
    updateDraft((current) => ({
      ...current,
      attachments: (current.attachments ?? []).map((attachment, attachmentIndex) =>
        attachmentIndex === index && attachment.type === "image" ? { ...attachment, [field]: value } : attachment,
      ),
    }));
  }

  function removeImageAttachment(index: number) {
    updateDraft((current) => ({
      ...current,
      attachments: (current.attachments ?? []).filter((_, attachmentIndex) => attachmentIndex !== index),
    }));
  }

  return (
    <main className="stats-app-shell">
      <section className="stats-dashboard" aria-label="Editor de questoes QuestMED">
        <header className="stats-header">
          <a className="stats-back-link" href={getHomeHref()} aria-label="Voltar ao QuestMED">
            <ArrowLeft size={18} aria-hidden="true" />
            QuestMED
          </a>
          <div className="stats-title-row">
            <span className="stats-title-icon">
              <FilePenLine size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">Banco local</p>
              <h1>Editar questoes</h1>
            </div>
          </div>
          <button className="stats-refresh-button" disabled={!token || loadState === "loading"} onClick={() => loadQuestions()} type="button">
            <RefreshCw className={loadState === "loading" ? "stats-loading-icon" : ""} size={17} aria-hidden="true" />
            Atualizar
          </button>
        </header>

        {!token && <LoginPanel authError={authError} isSubmitting={isLoggingIn} onLogin={login} />}

        {token && loadState === "loading" && (
          <EditorStateCard icon={<RefreshCw className="stats-loading-icon" size={24} />} title="Carregando questoes">
            Lendo o banco local pelo helper do editor.
          </EditorStateCard>
        )}

        {token && loadState === "error" && (
          <EditorStateCard danger icon={<AlertCircle size={24} />} title="Nao foi possivel carregar">
            {loadError ?? "Confira se o helper foi aberto com npm run editor."}
          </EditorStateCard>
        )}

        {token && loadState === "ready" && (
          <>
            <section className="question-search-panel editor-search-panel">
              <div className="stats-filter-title">
                <Search size={18} aria-hidden="true" />
                <strong>Buscar questao</strong>
              </div>
              <label>
                <span>ID, tema, area, enunciado ou justificativa</span>
                <input
                  onChange={(event) => setQuestionSearch(event.target.value)}
                  placeholder="Ex.: disuria.quest16 ou pielonefrite"
                  type="search"
                  value={questionSearch}
                />
              </label>
              <span className={isDirty ? "editor-dirty-pill active" : "editor-dirty-pill"}>
                {isDirty ? "Alteracoes pendentes" : "Sem pendencias"}
              </span>
            </section>

            <div className="editor-workspace-grid">
              <section className="stats-panel editor-question-list-panel">
                <h2>Questoes</h2>
                {searchedQuestions.length === 0 ? (
                  <p className="stats-empty-line">Nenhuma questao encontrada.</p>
                ) : (
                  <div className="stats-table-wrap">
                    <table className="stats-table question-stats-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Tema geral</th>
                          <th>Tema especifico</th>
                          <th>Area</th>
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
                            <td>{question.temaGeral ?? question.Tema}</td>
                            <td>{question.Tema}</td>
                            <td>{question.area}</td>
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
                      <p className="eyebrow">Questao selecionada</p>
                      <h2>{draft.id}</h2>
                    </div>
                    <button className="stats-refresh-button" disabled={!isDirty || saveState === "saving"} onClick={saveDraft} type="button">
                      {saveState === "saving" ? <RefreshCw className="stats-loading-icon" size={17} /> : <Save size={17} />}
                      Salvar
                    </button>
                  </div>

                  <div className="question-detail-meta">
                    <span>{draft.temaGeral ?? draft.Tema}</span>
                    <span>{draft.Tema}</span>
                    <span>{draft.area}</span>
                    <span>{draft.explanationTitle}</span>
                  </div>

                  <label className="editor-field">
                    <span>Tema geral</span>
                    <input
                      onChange={(event) => updateDraft((current) => ({ ...current, temaGeral: event.target.value }))}
                      value={draft.temaGeral ?? draft.Tema}
                    />
                  </label>

                  {saveState === "saved" && (
                    <p className="editor-form-success">
                      <CheckCircle2 size={17} aria-hidden="true" />
                      Questao salva no banco local.
                    </p>
                  )}
                  {saveState === "error" && saveError && <p className="editor-form-error">{saveError}</p>}

                  <label className="editor-field">
                    <span>Enunciado</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, statement: event.target.value }))}
                      rows={7}
                      value={draft.statement}
                    />
                  </label>

                  <div className="editor-options-grid">
                    {normalizeOptions(draft.options).map((option) => (
                      <label className="editor-field" key={option.id}>
                        <span>Alternativa {option.id}</span>
                        <textarea onChange={(event) => updateOption(option.id, event.target.value)} rows={3} value={option.text} />
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

                  <label className="editor-field">
                    <span>Dica</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, hint: event.target.value }))}
                      rows={3}
                      value={draft.hint}
                    />
                  </label>

                  <label className="editor-field">
                    <span>Justificativa</span>
                    <textarea
                      onChange={(event) => updateDraft((current) => ({ ...current, explanation: event.target.value }))}
                      rows={5}
                      value={draft.explanation ?? ""}
                    />
                  </label>

                  <section className="editor-attachments-panel">
                    <div className="editor-attachments-header">
                      <div className="stats-filter-title">
                        <Image size={18} aria-hidden="true" />
                        <strong>Imagens anexadas</strong>
                      </div>
                      <button className="secondary-wide-button" onClick={addImageAttachment} type="button">
                        <Plus size={17} aria-hidden="true" />
                        Adicionar
                      </button>
                    </div>

                    {(draft.attachments ?? []).length === 0 && (
                      <p className="stats-empty-line">Nenhuma imagem anexada.</p>
                    )}

                    {(draft.attachments ?? []).map((attachment, index) => {
                      if (attachment.type !== "image") {
                        return null;
                      }

                      return (
                        <div className="editor-attachment-card" key={index}>
                          <div className="editor-attachment-card-header">
                            <strong>Imagem {index + 1}</strong>
                            <button
                              className="editor-icon-button danger"
                              onClick={() => removeImageAttachment(index)}
                              type="button"
                              aria-label={`Remover imagem ${index + 1}`}
                            >
                              <Trash2 size={17} aria-hidden="true" />
                            </button>
                          </div>

                          <label className="editor-field">
                            <span>URL ou caminho da imagem</span>
                            <input
                              onChange={(event) => updateImageAttachment(index, "src", event.target.value)}
                              placeholder="/question-images/nome-do-arquivo.png"
                              value={attachment.src}
                            />
                          </label>

                          <div className="editor-options-grid">
                            <label className="editor-field">
                              <span>Descricao da imagem</span>
                              <input
                                onChange={(event) => updateImageAttachment(index, "alt", event.target.value)}
                                placeholder="Descricao curta para acessibilidade"
                                value={attachment.alt}
                              />
                            </label>
                            <label className="editor-field">
                              <span>Legenda opcional</span>
                              <input
                                onChange={(event) => updateImageAttachment(index, "caption", event.target.value)}
                                placeholder="Texto exibido abaixo da imagem"
                                value={attachment.caption ?? ""}
                              />
                            </label>
                          </div>

                          {attachment.src.trim() && (
                            <div className="validator-image-preview">
                              <img alt={attachment.alt || "Imagem associada a questao"} src={attachment.src} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </section>

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
