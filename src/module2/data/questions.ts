import questionBankData from "./question-bank.json";

export type Area = string;
export type Tema = string;
export type TemaGeral = string;

export type Option = {
  id: "A" | "B" | "C" | "D";
  text: string;
};

export type Question = {
  id: string;
  area: Area;
  Tema: Tema;
  temaGeral?: TemaGeral;
  statement: string;
  attachments?: QuestionAttachment[];
  options: Option[];
  correctOptionId: Option["id"];
  hint: string;
  statistics: Record<Option["id"], number>;
  explanationTitle: string;
  explanation?: string;
  videoId?: string;
  imageUrl?: string;
  imageAlt?: string;
};

export type QuestionAttachment =
  | {
      type: "image";
      src: string;
      alt: string;
      caption?: string;
    }
  | {
      type: "lab-result";
      title: string;
      rows: Array<{
        exam: string;
        value: string;
        reference?: string;
        unit?: string;
      }>;
      caption?: string;
    };

const DAILY_QUESTION_LIMIT = 10;

function shuffleQuestions<T>(questions: T[]) {
  const shuffled = [...questions];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }

  return shuffled;
}

function pickBalancedDailyQuestions(questions: Question[]) {
  const themes = Array.from(new Set(questions.map(getTemaGeral)));
  const buckets = new Map<TemaGeral, Question[]>(
    themes.map((theme) => [theme, shuffleQuestions(questions.filter((question) => getTemaGeral(question) === theme))]),
  );
  const themeOrder = shuffleQuestions(themes);
  const selected: Question[] = [];
  let round = 0;

  while (selected.length < DAILY_QUESTION_LIMIT) {
    const theme = themeOrder[round % themeOrder.length];
    const bucket = buckets.get(theme);
    const question = bucket?.shift();

    if (question) {
      selected.push(question);
    }

    round += 1;

    if (round > questions.length + themeOrder.length) {
      break;
    }
  }

  return selected;
}

export const questionBank = questionBankData as unknown as Question[];
export const dailyQuestions: Question[] = pickBalancedDailyQuestions(questionBank);

export function getTemaGeral(question: Pick<Question, "Tema" | "temaGeral">) {
  return question.temaGeral?.trim() || question.Tema;
}
