import type { Audit, AuditAnswer } from './types.js';

export interface AuditQuestion {
  id: string;
  text: string;
  /** Points added to the audit score when the answer is yes. */
  weight: number;
}

/**
 * Eight questions. The weights add up to 100. A question with no answer
 * counts as no, as the spec requires.
 */
export const AUDIT_QUESTIONS: readonly AuditQuestion[] = [
  {
    id: 'access',
    text: 'The drum or main module is accessible without moving the machine.',
    weight: 15,
  },
  {
    id: 'fasteners',
    text: 'Fasteners are standard screws. No glue and no rivets.',
    weight: 15,
  },
  {
    id: 'bearings',
    text: 'Bearings are sold as a separate part.',
    weight: 15,
  },
  {
    id: 'board',
    text: 'The control board is sold as a separate part.',
    weight: 15,
  },
  {
    id: 'seals',
    text: 'The door seal and the pump are sold as spares.',
    weight: 15,
  },
  {
    id: 'errors',
    text: 'Error codes are readable without a service tool.',
    weight: 10,
  },
  {
    id: 'manual',
    text: 'A repair manual or a parts diagram is public.',
    weight: 10,
  },
  {
    id: 'spares',
    text: 'The maker promises spare parts for 5 years or more.',
    weight: 5,
  },
];

export const AUDIT_TOTAL_WEIGHT = AUDIT_QUESTIONS.reduce(
  (total, question) => total + question.weight,
  0,
);

export function auditQuestion(id: string): AuditQuestion | undefined {
  return AUDIT_QUESTIONS.find((question) => question.id === id);
}

/**
 * Score an audit from 0 to 100.
 *
 * An unanswered question counts as no. A null or empty audit returns null so
 * the caller can treat the value as missing data.
 */
export function auditScore(audit: Audit | undefined | null): number | null {
  if (!audit || audit.answers.length === 0) return null;
  const yes = new Set(
    audit.answers.filter((answer) => answer.answer).map((answer) => answer.id),
  );
  let score = 0;
  for (const question of AUDIT_QUESTIONS) {
    if (yes.has(question.id)) score += question.weight;
  }
  return score;
}

export function unansweredQuestions(audit: Audit | undefined | null): string[] {
  if (!audit) return AUDIT_QUESTIONS.map((question) => question.id);
  const answered = new Set(audit.answers.map((answer) => answer.id));
  return AUDIT_QUESTIONS.filter((question) => !answered.has(question.id)).map(
    (question) => question.id,
  );
}

/** Build an audit record from a map of question id to answer. */
export function buildAudit(
  answers: Record<string, boolean>,
  checkedOn: string,
  note?: string,
): Audit {
  const rows: AuditAnswer[] = [];
  for (const question of AUDIT_QUESTIONS) {
    const value = answers[question.id];
    if (typeof value === 'boolean') rows.push({ id: question.id, answer: value });
  }
  return { answers: rows, checkedOn, ...(note ? { note } : {}) };
}