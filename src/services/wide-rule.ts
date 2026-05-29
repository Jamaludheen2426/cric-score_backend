export type WideRuleMatch = {
  wide_rule?: 'normal' | 'strict' | string | null;
  death_overs_from?: number | string | null;
};

export type WideRuleOver = {
  over_number: number | string;
};

export function isDeathOver(match: WideRuleMatch, over: WideRuleOver) {
  if (match.death_overs_from == null || match.death_overs_from === '') return false;
  return Number(over.over_number) >= Number(match.death_overs_from);
}

export function widePenaltyRuns(match: WideRuleMatch, over: WideRuleOver) {
  return match.wide_rule === 'strict' || isDeathOver(match, over) ? 1 : 0;
}
