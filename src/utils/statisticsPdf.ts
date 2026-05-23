import type { Option } from "../data/questions";

export type StatsPdfSummary = {
  totalQuestions: number;
  correctQuestions: number;
  incorrectQuestions: number;
  expiredQuestions: number;
  averageScore: number;
  correctPercent: number;
};

export type StatsPdfGroup = {
  label: string;
  summary: StatsPdfSummary;
};

export type StatsPdfQuestionSummary = StatsPdfSummary & {
  questionId: string;
  area: string;
  tema: string;
  temaGeral: string;
  correctOptionId: Option["id"];
  usedHintQuestions: number;
  selectedOptions: Record<Option["id"], number>;
};

type TextOptions = {
  bold?: boolean;
  color?: string;
  indent?: number;
  lineGap?: number;
  size?: number;
};

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 38;
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;
const COLORS = {
  ink: "0.109 0.169 0.180",
  muted: "0.376 0.443 0.455",
  primary: "0.055 0.373 0.361",
  primarySoft: "0.886 0.965 0.953",
  line: "0.839 0.898 0.886",
  danger: "0.788 0.294 0.294",
  dangerSoft: "1.000 0.945 0.945",
  success: "0.122 0.541 0.357",
  warning: "0.651 0.435 0.090",
  white: "1.000 1.000 1.000",
};

function normalizeForPdf(text: string) {
  return text
    .replace(/\u2013|\u2014/g, "-")
    .replace(/\u2018|\u2019/g, "'")
    .replace(/\u201c|\u201d/g, '"')
    .replace(/\u2192/g, "->")
    .replace(/\u00a0/g, " ");
}

function toWinAnsiByte(char: string) {
  const code = char.charCodeAt(0);

  return code <= 255 ? code : "?".charCodeAt(0);
}

function toPdfHex(text: string) {
  return Array.from(normalizeForPdf(text))
    .map((char) => toWinAnsiByte(char).toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

function estimateTextWidth(text: string, fontSize: number) {
  return normalizeForPdf(text).length * fontSize * 0.49;
}

function wrapText(text: string, fontSize: number, width: number) {
  const normalized = normalizeForPdf(text).replace(/\s+/g, " ").trim();
  const words = normalized.split(" ");
  const lines: string[] = [];
  let currentLine = "";

  words.forEach((word) => {
    const candidate = currentLine ? `${currentLine} ${word}` : word;

    if (estimateTextWidth(candidate, fontSize) <= width || !currentLine) {
      currentLine = candidate;
      return;
    }

    lines.push(currentLine);
    currentLine = word;
  });

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.length > 0 ? lines : [""];
}

function formatDecimal(value: number) {
  return value.toFixed(1).replace(".", ",");
}

function formatDate(date: Date) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

class SimplePdf {
  private pages: string[] = [];
  private current = "";
  private y = MARGIN;

  constructor() {
    this.addPage();
  }

  addPage() {
    if (this.current) {
      this.pages.push(this.current);
    }

    this.current = "";
    this.y = MARGIN;
  }

  addText(text: string, options: TextOptions = {}) {
    const size = options.size ?? 9.5;
    const lineGap = options.lineGap ?? 3;
    const indent = options.indent ?? 0;
    const font = options.bold ? "F2" : "F1";
    const color = options.color ?? COLORS.ink;
    const availableWidth = CONTENT_WIDTH - indent;
    const lines = wrapText(text, size, availableWidth);

    lines.forEach((line) => {
      this.ensureSpace(size + lineGap + 2);
      const x = MARGIN + indent;
      const pdfY = PAGE_HEIGHT - this.y;

      this.current += `q ${color} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${pdfY.toFixed(2)} Td <${toPdfHex(line)}> Tj ET Q\n`;
      this.y += size + lineGap;
    });
  }

  addTextAt(x: number, yFromTop: number, text: string, options: TextOptions = {}) {
    const size = options.size ?? 9.5;
    const font = options.bold ? "F2" : "F1";
    const color = options.color ?? COLORS.ink;
    const pdfY = PAGE_HEIGHT - yFromTop;

    this.current += `q ${color} rg BT /${font} ${size} Tf ${x.toFixed(2)} ${pdfY.toFixed(2)} Td <${toPdfHex(text)}> Tj ET Q\n`;
  }

  addRect(x: number, yFromTop: number, width: number, height: number, color: string) {
    const pdfY = PAGE_HEIGHT - yFromTop - height;

    this.current += `q ${color} rg ${x.toFixed(2)} ${pdfY.toFixed(2)} ${width.toFixed(2)} ${height.toFixed(2)} re f Q\n`;
  }

  addBar(label: string, percent: number, count: number, color = COLORS.primary) {
    this.ensureSpace(28);

    const y = this.y;
    const barX = MARGIN + 202;
    const barY = y + 4;
    const barWidth = CONTENT_WIDTH - 202;
    const fillWidth = Math.max(3, Math.min(100, percent) * (barWidth / 100));

    this.addTextAt(MARGIN, y + 13, label.slice(0, 36), { bold: true, size: 8.3 });
    this.addTextAt(MARGIN + 150, y + 13, `${formatDecimal(percent)}%`, { color: COLORS.muted, size: 8.3 });
    this.addTextAt(MARGIN + 178, y + 13, `n=${count}`, { color: COLORS.muted, size: 8.1 });
    this.addRect(barX, barY, barWidth, 12, COLORS.primarySoft);
    this.addRect(barX, barY, fillWidth, 12, color);

    this.y += 24;
  }

  addMetricBox(x: number, yFromTop: number, width: number, label: string, value: string, color = COLORS.primarySoft) {
    this.addRect(x, yFromTop, width, 50, color);
    this.addTextAt(x + 10, yFromTop + 18, label, { bold: true, color: COLORS.muted, size: 8.5 });
    this.addTextAt(x + 10, yFromTop + 39, value, { bold: true, color: COLORS.primary, size: 17 });
  }

  moveDown(amount = 8) {
    this.y += amount;
  }

  divider() {
    this.ensureSpace(12);
    const y = PAGE_HEIGHT - this.y;
    const right = PAGE_WIDTH - MARGIN;

    this.current += `q ${COLORS.line} RG 0.7 w ${MARGIN.toFixed(2)} ${y.toFixed(2)} m ${right.toFixed(2)} ${y.toFixed(2)} l S Q\n`;
    this.y += 11;
  }

  ensureSpace(height: number) {
    if (this.y + height > PAGE_HEIGHT - MARGIN) {
      this.addPage();
    }
  }

  forcePage() {
    this.addPage();
  }

  getY() {
    return this.y;
  }

  setY(y: number) {
    this.y = y;
  }

  toBlob() {
    if (this.current) {
      this.pages.push(this.current);
      this.current = "";
    }

    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${this.pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${this.pages.length} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
    ];

    this.pages.forEach((content, index) => {
      const pageObjectId = 5 + index * 2;
      const contentObjectId = pageObjectId + 1;

      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`,
      );
      objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
    });

    let pdf = "%PDF-1.4\n";
    const offsets = [0];

    objects.forEach((object, index) => {
      offsets.push(pdf.length);
      pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    });

    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    offsets.slice(1).forEach((offset) => {
      pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
    });
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const bytes = new Uint8Array(pdf.length);

    for (let index = 0; index < pdf.length; index += 1) {
      bytes[index] = pdf.charCodeAt(index) & 0xff;
    }

    return new Blob([bytes], { type: "application/pdf" });
  }
}

function addSummary(pdf: SimplePdf, summary: StatsPdfSummary) {
  pdf.addText(
    `Respostas: ${summary.totalQuestions} | Acertos: ${summary.correctQuestions} | Erros: ${summary.incorrectQuestions} | Nao respondidas: ${summary.expiredQuestions}`,
    { bold: true, size: 10.5 },
  );
  pdf.addText(
    `Percentual de acerto: ${formatDecimal(summary.correctPercent)}% | Media: ${formatDecimal(summary.averageScore)}`,
    { size: 10 },
  );
}

function addGroupSection(pdf: SimplePdf, title: string, groups: StatsPdfGroup[]) {
  pdf.addText(title, { bold: true, color: COLORS.primary, size: 12 });

  if (groups.length === 0) {
    pdf.addText("Sem dados neste recorte.", { color: COLORS.muted, size: 9 });
    pdf.moveDown(4);
    return;
  }

  groups.forEach((group) => {
    pdf.addText(
      `${group.label}: ${group.summary.totalQuestions} respostas | ${formatDecimal(group.summary.correctPercent)}% acerto | media ${formatDecimal(group.summary.averageScore)}`,
      { size: 9 },
    );
  });

  pdf.moveDown(4);
}

function addQuestionSection(pdf: SimplePdf, questions: StatsPdfQuestionSummary[]) {
  pdf.addText("Estatisticas por questao", { bold: true, color: COLORS.primary, size: 12 });

  if (questions.length === 0) {
    pdf.addText("Nenhuma questao encontrada neste recorte.", { color: COLORS.muted, size: 9 });
    return;
  }

  questions.forEach((question, index) => {
    pdf.ensureSpace(58);
    pdf.addText(`${index + 1}. ${question.questionId}`, { bold: true, size: 9.4 });
    pdf.addText(
      `${question.temaGeral} | ${question.tema} | ${question.area} | Gabarito ${question.correctOptionId} | ${question.totalQuestions} respostas | ${formatDecimal(question.correctPercent)}% acerto`,
      { size: 8.7 },
    );
    pdf.addText(
      `A: ${question.selectedOptions.A} | B: ${question.selectedOptions.B} | C: ${question.selectedOptions.C} | D: ${question.selectedOptions.D} | Dica: ${question.usedHintQuestions} | Nao respondidas: ${question.expiredQuestions}`,
      { color: COLORS.muted, size: 8.5 },
    );
  });
}

export function generateStatisticsPdfBlob({
  areas,
  days,
  exportedAt,
  filters,
  questions,
  summary,
  temas,
}: {
  areas: StatsPdfGroup[];
  days: StatsPdfGroup[];
  exportedAt: Date;
  filters: string[];
  questions: StatsPdfQuestionSummary[];
  summary: StatsPdfSummary;
  temas: StatsPdfGroup[];
}) {
  const pdf = new SimplePdf();
  const hardestQuestions = [...questions]
    .filter((question) => question.totalQuestions > 0)
    .sort((a, b) => a.correctPercent - b.correctPercent)
    .slice(0, 10)
    .map((question) => ({
      label: question.questionId,
      summary: question,
    }));

  pdf.addText("QuestMED - Relatorio de estatisticas", {
    bold: true,
    color: COLORS.primary,
    size: 18,
  });
  pdf.addText(`Gerado em ${formatDate(exportedAt)}`, { color: COLORS.muted, size: 9.5 });
  pdf.addText(`Filtros: ${filters.join(" | ")}`, { color: COLORS.muted, size: 9.2 });
  pdf.moveDown(8);
  addSummary(pdf, summary);
  pdf.divider();
  addGroupSection(pdf, "Por dia", days);
  addGroupSection(pdf, "Por tema", temas);
  addGroupSection(pdf, "Por area", areas);
  addGroupSection(pdf, "Questoes com menor acerto", hardestQuestions);
  pdf.divider();
  addQuestionSection(pdf, questions);

  return pdf.toBlob();
}

function truncate(text: string, maxLength: number) {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}.` : text;
}

function addVisualHeader(pdf: SimplePdf, title: string, subtitle?: string) {
  pdf.addText(title, { bold: true, color: COLORS.primary, size: 17 });

  if (subtitle) {
    pdf.addText(subtitle, { color: COLORS.muted, size: 9 });
  }

  pdf.moveDown(8);
}

function addVisualMetricGrid(pdf: SimplePdf, summary: StatsPdfSummary) {
  const y = pdf.getY();
  const boxWidth = (CONTENT_WIDTH - 20) / 3;

  pdf.addMetricBox(MARGIN, y, boxWidth, "Respostas", String(summary.totalQuestions));
  pdf.addMetricBox(MARGIN + boxWidth + 10, y, boxWidth, "Acerto", `${formatDecimal(summary.correctPercent)}%`);
  pdf.addMetricBox(MARGIN + (boxWidth + 10) * 2, y, boxWidth, "Media", formatDecimal(summary.averageScore));
  pdf.addMetricBox(MARGIN, y + 62, boxWidth, "Acertos", String(summary.correctQuestions));
  pdf.addMetricBox(MARGIN + boxWidth + 10, y + 62, boxWidth, "Erros", String(summary.incorrectQuestions), COLORS.dangerSoft);
  pdf.addMetricBox(MARGIN + (boxWidth + 10) * 2, y + 62, boxWidth, "Nao respondidas", String(summary.expiredQuestions));
  pdf.setY(y + 126);
}

function addVisualGroupChart(pdf: SimplePdf, title: string, groups: StatsPdfGroup[], limit = 10) {
  pdf.addText(title, { bold: true, color: COLORS.primary, size: 12 });

  if (groups.length === 0) {
    pdf.addText("Sem dados neste recorte.", { color: COLORS.muted, size: 9 });
    pdf.moveDown(6);
    return;
  }

  [...groups]
    .sort((a, b) => b.summary.totalQuestions - a.summary.totalQuestions)
    .slice(0, limit)
    .forEach((group) => {
      const color = group.summary.correctPercent < 50 ? COLORS.danger : COLORS.primary;
      pdf.addBar(group.label, group.summary.correctPercent, group.summary.totalQuestions, color);
    });

  pdf.moveDown(6);
}

function addTopQuestionRanking(pdf: SimplePdf, title: string, questions: StatsPdfQuestionSummary[], color: string) {
  pdf.addText(title, { bold: true, color, size: 12 });

  if (questions.length === 0) {
    pdf.addText("Sem dados neste recorte.", { color: COLORS.muted, size: 9 });
    pdf.moveDown(8);
    return;
  }

  questions.slice(0, 15).forEach((question, index) => {
    pdf.ensureSpace(21);
    pdf.addText(
      `${String(index + 1).padStart(2, "0")}. ${truncate(question.questionId, 48)} | ${question.temaGeral} | ${formatDecimal(question.correctPercent)}% | n=${question.totalQuestions}`,
      { size: 8.4 },
    );
  });

  pdf.moveDown(8);
}

function addThemeCompactTables(pdf: SimplePdf, questions: StatsPdfQuestionSummary[]) {
  const entries: Array<{ kind: "header" | "row"; question?: StatsPdfQuestionSummary; title?: string }> = [];
  const themeOrder = Array.from(new Set(questions.map((question) => question.temaGeral))).sort();

  themeOrder.forEach((theme) => {
    entries.push({ kind: "header", title: theme });
    questions
      .filter((question) => question.temaGeral === theme)
      .sort((a, b) => a.correctPercent - b.correctPercent)
      .forEach((question) => entries.push({ kind: "row", question }));
  });

  if (entries.length === 0) {
    pdf.addText("Sem questoes neste recorte.", { color: COLORS.muted, size: 9 });
    return;
  }

  const rowsPerColumn = 72;
  const rowsPerPage = rowsPerColumn * 2;
  const lineHeight = 9.2;
  const startY = 90;
  const columnX = [MARGIN, MARGIN + 270];

  entries.forEach((entry, index) => {
    const localIndex = index % rowsPerPage;

    if (localIndex === 0) {
      if (index > 0) {
        pdf.forcePage();
      }

      addVisualHeader(pdf, "Tabelas por tema", "Questoes ordenadas por menor percentual de acerto.");
      pdf.addTextAt(columnX[0], 76, "Questao | % | n | dica | A/B/C/D", { bold: true, color: COLORS.muted, size: 6.2 });
      pdf.addTextAt(columnX[1], 76, "Questao | % | n | dica | A/B/C/D", { bold: true, color: COLORS.muted, size: 6.2 });
    }

    const column = localIndex >= rowsPerColumn ? 1 : 0;
    const row = localIndex % rowsPerColumn;
    const y = startY + row * lineHeight;
    const x = columnX[column];

    if (entry.kind === "header") {
      pdf.addTextAt(x, y, String(entry.title).toUpperCase(), { bold: true, color: COLORS.primary, size: 6.6 });
      return;
    }

    if (!entry.question) {
      return;
    }

    const question = entry.question;
    const color = question.correctPercent < 50 ? COLORS.danger : COLORS.ink;

    pdf.addTextAt(
      x,
      y,
      `${truncate(question.questionId, 27)} | ${formatDecimal(question.correctPercent)} | ${question.totalQuestions} | ${question.usedHintQuestions} | ${question.selectedOptions.A}/${question.selectedOptions.B}/${question.selectedOptions.C}/${question.selectedOptions.D}`,
      { color, size: 5.8 },
    );
  });
}

export function generateVisualStatisticsPdfBlob({
  areas,
  days,
  exportedAt,
  filters,
  questions,
  summary,
  temas,
}: {
  areas: StatsPdfGroup[];
  days: StatsPdfGroup[];
  exportedAt: Date;
  filters: string[];
  questions: StatsPdfQuestionSummary[];
  summary: StatsPdfSummary;
  temas: StatsPdfGroup[];
}) {
  const pdf = new SimplePdf();
  const worstQuestions = [...questions]
    .filter((question) => question.totalQuestions > 0)
    .sort((a, b) => a.correctPercent - b.correctPercent)
    .slice(0, 15);
  const bestQuestions = [...questions]
    .filter((question) => question.totalQuestions > 0)
    .sort((a, b) => b.correctPercent - a.correctPercent)
    .slice(0, 15);

  addVisualHeader(
    pdf,
    "QuestMED - Relatorio visual de estatisticas",
    `Gerado em ${formatDate(exportedAt)} | ${filters.join(" | ")}`,
  );
  addVisualMetricGrid(pdf, summary);
  pdf.divider();
  addVisualGroupChart(pdf, "Evolucao por dia", days, 12);

  pdf.forcePage();
  addVisualHeader(pdf, "Graficos por tema e area", "Barras mostram percentual de acerto; n indica volume de respostas.");
  addVisualGroupChart(pdf, "Por tema", temas, 12);
  addVisualGroupChart(pdf, "Por area", areas, 12);

  pdf.forcePage();
  addVisualHeader(pdf, "Questoes criticas", "Top 15 piores e Top 15 melhores por percentual de acerto.");
  addTopQuestionRanking(pdf, "Top 15 menores acertos", worstQuestions, COLORS.danger);
  pdf.divider();
  addTopQuestionRanking(pdf, "Top 15 maiores acertos", bestQuestions, COLORS.success);

  pdf.forcePage();
  addThemeCompactTables(pdf, questions);

  return pdf.toBlob();
}
