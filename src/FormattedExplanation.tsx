function getExplanationParagraphs(explanation: string) {
  return explanation
    .replace(/\r\n/g, "\n")
    .replace(/([^\n])\s+(?=[A-D]:\s)/g, "$1\n")
    .split(/\n+/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);
}

export default function FormattedExplanation({ explanation }: { explanation: string }) {
  const paragraphs = getExplanationParagraphs(explanation);

  return (
    <div className="explanation-text">
      {paragraphs.map((paragraph, index) => (
        <p key={`${index}-${paragraph.slice(0, 18)}`}>
          {index === 0 ? (
            <>
              <strong>Justificativa:</strong> {paragraph}
            </>
          ) : (
            paragraph
          )}
        </p>
      ))}
    </div>
  );
}
