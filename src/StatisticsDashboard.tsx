import { useEffect, useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, BarChart3, CalendarDays, Download, Filter, RefreshCw, Search } from "lucide-react";
import { questionBank, type Area, type Option, type Question, type Tema, type TemaGeral } from "./data/questions";
import {
  fetchAggregatedQuestionDetailStats,
  fetchAggregatedQuestionStats,
  questionStatsConfigured,
  type AggregatedQuestionDetailStats,
  type AggregatedQuestionStats,
} from "./utils/statistics";
import { generateStatisticsPdfBlob, generateVisualStatisticsPdfBlob } from "./utils/statisticsPdf";

type LoadState = "loading" | "ready" | "not-configured" | "error";

type Summary = {
  totalQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  expiredQuestions: number;
  averageScore: number;
  correctPercent: number;
};

type GroupedStats = {
  label: string;
  summary: Summary;
};

type QuestionSummary = Summary & {
  questionId: string;
  area: Area;
  tema: Tema;
  temaGeral: TemaGeral;
  correctOptionId: Option["id"];
  usedHintQuestions: number;
  selectedOptions: Record<Option["id"], number>;
};

const emptySummary: Summary = {
  totalQuestions: 0,
  correctQuestions: 0,
  incorrectQuestions: 0,
  expiredQuestions: 0,
  averageScore: 0,
  correctPercent: 0,
};

const emptySelectedOptions: Record<Option["id"], number> = {
  A: 0,
  B: 0,
  C: 0,
  D: 0,
};

const questionById = new Map(questionBank.map((question) => [question.id, question]));

function getHomeHref() {
  return `${window.location.pathname.replace(/\/estatisticas\/?$/, "/")}${window.location.search}`;
}

function formatDate(date: string) {
  const [year, month, day] = date.split("-");

  if (!year || !month || !day) {
    return date;
  }

  return `${day}/${month}/${year}`;
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function summarize(rows: AggregatedQuestionStats[]): Summary {
  const totals = rows.reduce(
    (summary, row) => ({
      totalQuestions: summary.totalQuestions + row.totalQuestions,
      correctQuestions: summary.correctQuestions + row.correctQuestions,
      incorrectQuestions: summary.incorrectQuestions + row.incorrectQuestions,
      expiredQuestions: summary.expiredQuestions + row.expiredQuestions,
      averageScore: summary.averageScore + row.averageScore * row.totalQuestions,
      correctPercent: 0,
    }),
    emptySummary,
  );

  if (totals.totalQuestions === 0) {
    return emptySummary;
  }

  return {
    ...totals,
    averageScore: totals.averageScore / totals.totalQuestions,
    correctPercent: (totals.correctQuestions / totals.totalQuestions) * 100,
  };
}

function groupBy(rows: AggregatedQuestionStats[], key: (row: AggregatedQuestionStats) => string) {
  const groups = new Map<string, AggregatedQuestionStats[]>();

  rows.forEach((row) => {
    const label = key(row);
    groups.set(label, [...(groups.get(label) ?? []), row]);
  });

  return Array.from(groups.entries())
    .map<GroupedStats>(([label, groupRows]) => ({
      label,
      summary: summarize(groupRows),
    }))
    .sort((a, b) => b.summary.totalQuestions - a.summary.totalQuestions);
}

function summarizeQuestionRows(rows: AggregatedQuestionDetailStats[]): QuestionSummary[] {
  const groups = new Map<string, AggregatedQuestionDetailStats[]>();

  rows.forEach((row) => {
    groups.set(row.questionId, [...(groups.get(row.questionId) ?? []), row]);
  });

  return Array.from(groups.entries())
    .map(([questionId, groupRows]) => {
      const firstRow = groupRows[0];
      const totals = groupRows.reduce(
        (summary, row) => ({
          ...summary,
          totalQuestions: summary.totalQuestions + row.totalQuestions,
          correctQuestions: summary.correctQuestions + row.correctQuestions,
          incorrectQuestions: summary.incorrectQuestions + row.incorrectQuestions,
          expiredQuestions: summary.expiredQuestions + row.expiredQuestions,
          usedHintQuestions: summary.usedHintQuestions + row.usedHintQuestions,
          averageScore: summary.averageScore + row.averageScore * row.totalQuestions,
          selectedOptions: {
            A: summary.selectedOptions.A + row.selectedAQuestions,
            B: summary.selectedOptions.B + row.selectedBQuestions,
            C: summary.selectedOptions.C + row.selectedCQuestions,
            D: summary.selectedOptions.D + row.selectedDQuestions,
          },
        }),
        {
          ...emptySummary,
          questionId,
          area: firstRow.area,
          tema: firstRow.tema,
          temaGeral: firstRow.temaGeral,
          correctOptionId: firstRow.correctOptionId,
          usedHintQuestions: 0,
          selectedOptions: emptySelectedOptions,
        },
      );

      if (totals.totalQuestions === 0) {
        return totals;
      }

      return {
        ...totals,
        averageScore: totals.averageScore / totals.totalQuestions,
        correctPercent: (totals.correctQuestions / totals.totalQuestions) * 100,
      };
    })
    .sort((a, b) => b.totalQuestions - a.totalQuestions);
}

function getQuestionSearchText(question: Question | undefined, summary: QuestionSummary) {
  return [
    summary.questionId,
    summary.area,
    summary.temaGeral,
    summary.tema,
    question?.statement,
    question?.explanationTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="stats-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function StatsTable({ rows, title }: { rows: GroupedStats[]; title: string }) {
  return (
    <section className="stats-panel">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="stats-empty-line">Nenhum dado neste recorte.</p>
      ) : (
        <div className="stats-table-wrap">
          <table className="stats-table">
            <thead>
              <tr>
                <th>Recorte</th>
                <th>Respostas</th>
                <th>Acerto</th>
                <th>Media</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <td>{row.label}</td>
                  <td>{row.summary.totalQuestions}</td>
                  <td>{formatDecimal(row.summary.correctPercent)}%</td>
                  <td>{formatDecimal(row.summary.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuestionStatsTable({
  onSelectQuestion,
  rows,
  selectedQuestionId,
}: {
  onSelectQuestion: (questionId: string) => void;
  rows: QuestionSummary[];
  selectedQuestionId: string | null;
}) {
  return (
    <section className="stats-panel question-stats-panel">
      <h2>Por questao</h2>
      {rows.length === 0 ? (
        <p className="stats-empty-line">Nenhuma questao encontrada neste recorte.</p>
      ) : (
        <div className="stats-table-wrap">
          <table className="stats-table question-stats-table">
            <thead>
              <tr>
                <th>Questao</th>
                <th>Tema geral</th>
                <th>Tema especifico</th>
                <th>Area</th>
                <th>Respostas</th>
                <th>Acerto</th>
                <th>Dica</th>
                <th>Media</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  className={row.questionId === selectedQuestionId ? "selected" : ""}
                  key={row.questionId}
                  onClick={() => onSelectQuestion(row.questionId)}
                >
                  <td>{row.questionId}</td>
                  <td>{row.temaGeral}</td>
                  <td>{row.tema}</td>
                  <td>{row.area}</td>
                  <td>{row.totalQuestions}</td>
                  <td>{formatDecimal(row.correctPercent)}%</td>
                  <td>{row.usedHintQuestions}</td>
                  <td>{formatDecimal(row.averageScore)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function QuestionDetail({ summary }: { summary: QuestionSummary }) {
  const question = questionById.get(summary.questionId);
  const maxSelected = Math.max(...Object.values(summary.selectedOptions), 1);

  return (
    <section className="stats-panel question-detail-panel">
      <div className="question-detail-header">
        <div>
          <p className="eyebrow">Detalhe da questao</p>
          <h2>{summary.questionId}</h2>
        </div>
        <span className="question-correct-pill">Gabarito {summary.correctOptionId}</span>
      </div>

      <div className="question-detail-meta">
        <span>{summary.temaGeral}</span>
        <span>{summary.tema}</span>
        <span>{summary.area}</span>
        <span>{summary.totalQuestions} respostas</span>
      </div>

      {question && <p className="question-detail-statement">{question.statement}</p>}

      <div className="question-detail-grid">
        <StatCard label="Acertos" value={String(summary.correctQuestions)} />
        <StatCard label="Erros" value={String(summary.incorrectQuestions)} />
        <StatCard label="Nao respondidas" value={String(summary.expiredQuestions)} />
        <StatCard label="Usaram dica" value={String(summary.usedHintQuestions)} />
      </div>

      <div className="option-distribution" aria-label="Distribuicao por alternativa">
        {(["A", "B", "C", "D"] as const).map((optionId) => {
          const count = summary.selectedOptions[optionId];
          const percent = summary.totalQuestions > 0 ? (count / summary.totalQuestions) * 100 : 0;
          const width = `${Math.max(4, (count / maxSelected) * 100)}%`;

          return (
            <div className="option-distribution-row" key={optionId}>
              <span className={optionId === summary.correctOptionId ? "correct" : ""}>{optionId}</span>
              <div>
                <strong>{count}</strong>
                <em>{formatDecimal(percent)}%</em>
                <i style={{ width }} />
              </div>
            </div>
          );
        })}
      </div>

      {question && (
        <div className="question-option-list">
          {question.options.map((option) => (
            <p className={option.id === summary.correctOptionId ? "correct" : ""} key={option.id}>
              <strong>{option.id}</strong>
              <span>{option.text}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

export default function StatisticsDashboard() {
  const [rows, setRows] = useState<AggregatedQuestionStats[]>([]);
  const [questionRows, setQuestionRows] = useState<AggregatedQuestionDetailStats[]>([]);
  const [loadState, setLoadState] = useState<LoadState>(() =>
    questionStatsConfigured() ? "loading" : "not-configured",
  );
  const [selectedDay, setSelectedDay] = useState("all");
  const [selectedTemaGeral, setSelectedTemaGeral] = useState("all");
  const [selectedArea, setSelectedArea] = useState("all");
  const [questionSearch, setQuestionSearch] = useState("");
  const [selectedQuestionId, setSelectedQuestionId] = useState<string | null>(null);

  async function loadStats() {
    if (!questionStatsConfigured()) {
      setLoadState("not-configured");
      setRows([]);
      setQuestionRows([]);
      return;
    }

    setLoadState("loading");

    try {
      const [nextRows, nextQuestionRows] = await Promise.all([
        fetchAggregatedQuestionStats(),
        fetchAggregatedQuestionDetailStats(),
      ]);
      setRows(nextRows);
      setQuestionRows(nextQuestionRows);
      setLoadState("ready");
    } catch {
      setRows([]);
      setQuestionRows([]);
      setLoadState("error");
    }
  }

  useEffect(() => {
    void loadStats();
  }, []);

  const days = useMemo(() => Array.from(new Set(rows.map((row) => row.localDay))).sort().reverse(), [rows]);
  const temasGerais = useMemo(() => Array.from(new Set(rows.map((row) => row.temaGeral))).sort(), [rows]);
  const areas = useMemo(() => Array.from(new Set(rows.map((row) => row.area))).sort(), [rows]);

  const filteredRows = useMemo(
    () =>
      rows.filter((row) => {
        const matchesDay = selectedDay === "all" || row.localDay === selectedDay;
        const matchesTemaGeral = selectedTemaGeral === "all" || row.temaGeral === selectedTemaGeral;
        const matchesArea = selectedArea === "all" || row.area === selectedArea;

        return matchesDay && matchesTemaGeral && matchesArea;
      }),
    [rows, selectedArea, selectedDay, selectedTemaGeral],
  );

  const filteredQuestionRows = useMemo(
    () =>
      questionRows.filter((row) => {
        const matchesDay = selectedDay === "all" || row.localDay === selectedDay;
        const matchesTemaGeral = selectedTemaGeral === "all" || row.temaGeral === selectedTemaGeral;
        const matchesArea = selectedArea === "all" || row.area === selectedArea;

        return matchesDay && matchesTemaGeral && matchesArea;
      }),
    [questionRows, selectedArea, selectedDay, selectedTemaGeral],
  );

  const summary = useMemo(() => summarize(filteredRows), [filteredRows]);
  const byDay = useMemo(() => groupBy(filteredRows, (row) => formatDate(row.localDay)), [filteredRows]);
  const byTema = useMemo(() => groupBy(filteredRows, (row) => row.temaGeral), [filteredRows]);
  const byArea = useMemo(() => groupBy(filteredRows, (row) => row.area), [filteredRows]);
  const questionSummaries = useMemo(() => summarizeQuestionRows(filteredQuestionRows), [filteredQuestionRows]);
  const searchedQuestionSummaries = useMemo(() => {
    const normalizedSearch = questionSearch.trim().toLowerCase();

    if (!normalizedSearch) {
      return questionSummaries;
    }

    return questionSummaries.filter((summary) =>
      getQuestionSearchText(questionById.get(summary.questionId), summary).includes(normalizedSearch),
    );
  }, [questionSearch, questionSummaries]);
  const selectedQuestion =
    searchedQuestionSummaries.find((summary) => summary.questionId === selectedQuestionId) ??
    searchedQuestionSummaries[0] ??
    null;
  const hardestQuestions = useMemo(
    () =>
      [...questionSummaries]
        .filter((summary) => summary.totalQuestions > 0)
        .sort((a, b) => a.correctPercent - b.correctPercent)
        .slice(0, 5),
    [questionSummaries],
  );
  const isReady = loadState === "ready";
  const hasRows = filteredRows.length > 0;

  function generateStatisticsPdf() {
    const exportedAt = new Date();
    const timestamp = exportedAt.toISOString().replace(/[:.]/g, "-");
    const filters = [
      `Dia: ${selectedDay === "all" ? "Todos" : formatDate(selectedDay)}`,
      `Tema geral: ${selectedTemaGeral === "all" ? "Todos" : selectedTemaGeral}`,
      `Area: ${selectedArea === "all" ? "Todas" : selectedArea}`,
      `Busca: ${questionSearch.trim() || "Sem busca"}`,
    ];
    const blob = generateStatisticsPdfBlob({
      areas: byArea,
      days: byDay,
      exportedAt,
      filters,
      questions: searchedQuestionSummaries,
      summary,
      temas: byTema,
    });

    downloadBlob(blob, `questmed-estatisticas-${timestamp}.pdf`);
  }

  function generateVisualStatisticsPdf() {
    const exportedAt = new Date();
    const timestamp = exportedAt.toISOString().replace(/[:.]/g, "-");
    const filters = [
      `Dia: ${selectedDay === "all" ? "Todos" : formatDate(selectedDay)}`,
      `Tema geral: ${selectedTemaGeral === "all" ? "Todos" : selectedTemaGeral}`,
      `Area: ${selectedArea === "all" ? "Todas" : selectedArea}`,
      `Busca: ${questionSearch.trim() || "Sem busca"}`,
    ];
    const blob = generateVisualStatisticsPdfBlob({
      areas: byArea,
      days: byDay,
      exportedAt,
      filters,
      questions: searchedQuestionSummaries,
      summary,
      temas: byTema,
    });

    downloadBlob(blob, `questmed-estatisticas-visual-${timestamp}.pdf`);
  }

  return (
    <main className="stats-app-shell">
      <section className="stats-dashboard" aria-label="Estatisticas QuestMED">
        <header className="stats-header">
          <a className="stats-back-link" href={getHomeHref()} aria-label="Voltar ao QuestMED">
            <ArrowLeft size={18} aria-hidden="true" />
            QuestMED
          </a>
          <div className="stats-title-row">
            <span className="stats-title-icon">
              <BarChart3 size={28} aria-hidden="true" />
            </span>
            <div>
              <p className="eyebrow">Estatisticas globais</p>
              <h1>Respostas</h1>
            </div>
          </div>
          <div className="stats-header-actions">
            <button className="stats-pdf-button visual" disabled={!hasRows} onClick={generateVisualStatisticsPdf} type="button">
              <Download size={17} aria-hidden="true" />
              PDF visual
            </button>
            <button className="stats-pdf-button" disabled={!hasRows} onClick={generateStatisticsPdf} type="button">
              <Download size={17} aria-hidden="true" />
              PDF completo
            </button>
            <button className="stats-refresh-button" onClick={loadStats} type="button">
              <RefreshCw size={17} aria-hidden="true" />
              Atualizar
            </button>
          </div>
        </header>

        {loadState === "not-configured" && (
          <section className="stats-state-card">
            <AlertCircle size={24} aria-hidden="true" />
            <div>
              <h2>Supabase nao configurado</h2>
              <p>Defina VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY antes do build para carregar o painel.</p>
            </div>
          </section>
        )}

        {loadState === "error" && (
          <section className="stats-state-card danger">
            <AlertCircle size={24} aria-hidden="true" />
            <div>
              <h2>Nao foi possivel carregar</h2>
              <p>Confira a view publica no Supabase e tente atualizar novamente.</p>
            </div>
          </section>
        )}

        {loadState === "loading" && (
          <section className="stats-state-card">
            <RefreshCw className="stats-loading-icon" size={24} aria-hidden="true" />
            <div>
              <h2>Carregando estatisticas</h2>
              <p>Buscando os dados agregados das respostas.</p>
            </div>
          </section>
        )}

        {isReady && (
          <>
            <section className="stats-filter-panel" aria-label="Filtros">
              <div className="stats-filter-title">
                <Filter size={18} aria-hidden="true" />
                <strong>Filtros</strong>
              </div>
              <label>
                <span>Dia</span>
                <select value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}>
                  <option value="all">Todos os dias</option>
                  {days.map((day) => (
                    <option key={day} value={day}>
                      {formatDate(day)}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Tema geral</span>
                <select value={selectedTemaGeral} onChange={(event) => setSelectedTemaGeral(event.target.value as TemaGeral | "all")}>
                  <option value="all">Todos os temas</option>
                  {temasGerais.map((temaGeral) => (
                    <option key={temaGeral} value={temaGeral}>
                      {temaGeral}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>Area</span>
                <select value={selectedArea} onChange={(event) => setSelectedArea(event.target.value as Area | "all")}>
                  <option value="all">Todas as areas</option>
                  {areas.map((area) => (
                    <option key={area} value={area}>
                      {area}
                    </option>
                  ))}
                </select>
              </label>
            </section>

            {rows.length === 0 && (
              <section className="stats-state-card">
                <CalendarDays size={24} aria-hidden="true" />
                <div>
                  <h2>Sem respostas registradas</h2>
                  <p>Assim que novas respostas forem enviadas, os agregados aparecem aqui.</p>
                </div>
              </section>
            )}

            {rows.length > 0 && !hasRows && (
              <section className="stats-state-card">
                <CalendarDays size={24} aria-hidden="true" />
                <div>
                  <h2>Nenhum dado neste filtro</h2>
                  <p>Ajuste dia, tema ou area para ver outro recorte.</p>
                </div>
              </section>
            )}

            {hasRows && (
              <>
                <section className="stats-card-grid" aria-label="Resumo">
                  <StatCard label="Respostas" value={String(summary.totalQuestions)} />
                  <StatCard label="Acertos" value={String(summary.correctQuestions)} />
                  <StatCard label="Erros" value={String(summary.incorrectQuestions)} />
                  <StatCard label="Nao respondidas" value={String(summary.expiredQuestions)} />
                  <StatCard label="Percentual" value={`${formatDecimal(summary.correctPercent)}%`} />
                  <StatCard label="Media" value={formatDecimal(summary.averageScore)} />
                </section>

                <div className="stats-panel-grid">
                  <StatsTable rows={byDay} title="Por dia" />
                  <StatsTable rows={byTema} title="Por tema" />
                  <StatsTable rows={byArea} title="Por area" />
                </div>

                <section className="question-search-panel">
                  <div className="stats-filter-title">
                    <Search size={18} aria-hidden="true" />
                    <strong>Buscar questao</strong>
                  </div>
                  <label>
                    <span>ID, tema, area ou enunciado</span>
                    <input
                      onChange={(event) => setQuestionSearch(event.target.value)}
                      placeholder="Ex.: disuria.quest16 ou cefaleia"
                      type="search"
                      value={questionSearch}
                    />
                  </label>
                </section>

                <div className="question-analytics-grid">
                  <QuestionStatsTable
                    onSelectQuestion={setSelectedQuestionId}
                    rows={searchedQuestionSummaries}
                    selectedQuestionId={selectedQuestion?.questionId ?? null}
                  />
                  {selectedQuestion && <QuestionDetail summary={selectedQuestion} />}
                </div>

                {hardestQuestions.length > 0 && (
                  <section className="stats-panel hardest-question-panel">
                    <h2>Questoes com menor acerto</h2>
                    <div className="hardest-question-list">
                      {hardestQuestions.map((summary) => (
                        <button
                          key={summary.questionId}
                          onClick={() => setSelectedQuestionId(summary.questionId)}
                          type="button"
                        >
                          <span>{summary.questionId}</span>
                          <strong>{formatDecimal(summary.correctPercent)}%</strong>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}
