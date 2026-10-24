function scoreTone(score: number): 'high' | 'mid' | 'low' {
  if (score >= 70) return 'high';
  if (score >= 40) return 'mid';
  return 'low';
}

export function ScoreMeter({ score }: { score: number }) {
  return (
    <span className={`score-meter score-${scoreTone(score)}`} role="img" aria-label={`Score ${score} out of 100`}>
      <span className="score-track" aria-hidden="true">
        <span className="score-fill" style={{ width: `${score}%` }} />
      </span>
      <span className="score-value">{score}</span>
    </span>
  );
}
