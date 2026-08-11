/**
 * The categories a profile is not allowed to contain, enforced in code.
 *
 * The source prompt handles this with an instruction: *"You must never infer
 * sensitive data from Search or YouTube. Never include any sensitive data in a
 * response unless explicitly requested."* That instruction ships too — see
 * `PERSONAL_DATA_LADDER` — but an instruction governs one turn's *output*, and
 * this feature's real hazard is upstream of that: once a sensitive inference is
 * written into `Personal/profile.json` it is in a file on disk, in the prompt of
 * every future turn, and in a list the user has to read to discover it.
 *
 * So the same list is applied twice, at two different layers. Here it decides
 * what may be *stored*, in code, where no amount of unusual phrasing in a chat
 * can talk the summarizer past it. A dropped bullet costs a little
 * personalization. A stored one about somebody's health or immigration status is
 * the kind of thing that should never have been written down.
 *
 * ── What this is not ───────────────────────────────────────────────────────────
 * This is a keyword screen, so it is both over- and under-inclusive, and it is
 * worth being honest about which:
 *
 * - It over-blocks. "Is learning Church Slavonic" trips the religion family;
 *   "asked about the criminal justice system" trips the criminal-history family.
 *   Both are legitimate bullets and both get dropped. That is the trade taken on
 *   purpose — the section caps mean a lost bullet is replaced by the next-best
 *   one, and nobody notices.
 * - It under-blocks. Sensitive facts phrased without any of these words get
 *   through, and no word list can fix that. The prompt-level gate is the second
 *   layer for exactly this reason, and the profile being visible and deletable in
 *   Settings is the third.
 *
 * It is not a compliance control and should not be described as one.
 */

/**
 * One family per line of the source prompt's list, in its order.
 *
 * Patterns are matched against the bullet's text AND its evidence, because the
 * evidence field is a quote from the user and is just as capable of carrying the
 * fact as the claim is.
 */
const SENSITIVE_FAMILIES: readonly { readonly label: string; readonly pattern: RegExp }[] = [
  {
    label: 'health',
    pattern:
      /\b(diagnos\w*|symptom\w*|disorder\w*|disease\w*|illness\w*|chronic|disab(?:led|ilit\w+)|therapy|therapist\w*|psychiatr\w*|antidepressant\w*|medication\w*|prescri\w+|dosage\w*|mg\s+daily|depress(?:ed|ion)|anxiety|adhd|autis\w+|bipolar|schizo\w+|ptsd|ocd|cancers?|diabet\w+|asthma|epilep\w+|hiv|std|sti|pregnan\w+|miscarriages?|abortions?|fertility|ivf|eating disorders?|anorexi\w*|bulimi\w*|self[- ]harm|suicid\w+|addict\w+|alcoholi\w+|rehab|overdoses?|surger(?:y|ies)|hospitali[sz]ed)\b/i,
  },
  {
    label: 'national origin',
    pattern: /\b(national origin|born in (?:a )?(?:different|another) country|émigré|emigrated|expatriate)\b/i,
  },
  {
    label: 'race or ethnicity',
    pattern:
      /\b(race|racial|ethnicit\w+|ethnically|caucasian|white|black|african[- ]american|asian|hispanic|latin[aox]|indigenous|native american|aboriginal|desi|mixed[- ]race|person of colou?r|bipoc)\b/i,
  },
  { label: 'citizenship status', pattern: /\b(citizenship|citizen of|naturali[sz]ed|dual national\w*|stateless)\b/i },
  {
    label: 'immigration status',
    pattern:
      /\b(immigration|immigrant|visa|green card|permanent residen\w+|work permit|asylum|refugee|deport\w+|undocumented|passport number|h1b|h-1b|f1 visa|f-1 visa|opt status)\b/i,
  },
  {
    label: 'religious beliefs',
    pattern:
      /\b(religio\w+|faith|church|mosque|synagogue|temple|gurdwara|christian|catholic|protestant|evangelical|muslim|islam\w*|jewish|juda\w+|hindu|sikh|buddhis\w+|jain|atheis\w+|agnostic|baptis\w+|orthodox|prays?|praying|ramadan|lent|shabbat|diwali|kosher|halal)\b/i,
  },
  { label: 'caste', pattern: /\b(caste|dalit|brahmin|kshatriya|vaishya|shudra|scheduled caste|obc)\b/i },
  {
    label: 'sexual orientation',
    pattern:
      /\b(sexual orientation|gay|lesbian|bisexual|bi[- ]curious|homosexual|heterosexual|straight[- ]identif\w+|queer|asexual|pansexual|lgbt\w*)\b/i,
  },
  {
    label: 'sex life',
    pattern: /\b(sex life|sexual\w*|intimac\w+|porn\w*|dating app|hookup|virgin\w*|libido|contracept\w+)\b/i,
  },
  {
    label: 'gender identity',
    pattern: /\b(transgender|trans (?:man|woman|person)|non[- ]?binary|genderqueer|cisgender|deadname|transition\w* (?:medically|socially)|hormone (?:therapy|replacement)|hrt)\b/i,
  },
  {
    label: 'criminal history',
    pattern:
      /\b(criminal|convict\w+|felon\w*|misdemean\w+|arrest\w*|indict\w+|probation|parole|incarcerat\w+|prison|jail|lawsuit|sued|restraining order|assault\w*|victim of|stalk\w+|abuse[dr]?)\b/i,
  },
  {
    label: 'government ID',
    pattern:
      /\b(social security|ssn|national insurance number|aadhaar|pan card|driver'?s licen[cs]e number|passport (?:no|number)|tax id|\d{3}-\d{2}-\d{4})\b/i,
  },
  {
    label: 'authentication details',
    pattern:
      /\b(password|passphrase|passcode|\bpin\b|api[- ]?key|secret[- ]?key|access[- ]?token|refresh[- ]?token|private key|seed phrase|recovery phrase|2fa code|otp)\b/i,
  },
  {
    label: 'financial or legal records',
    pattern:
      /\b(salar\w+|wage|income|net worth|bank account|routing number|iban|credit card|debit card|card number|cvv|credit score|debt|loan|mortgage|bankrupt\w+|foreclos\w+|tax return|will and testament|custody|divorce|alimony|attorney|\b\d{13,19}\b)\b/i,
  },
  {
    label: 'political affiliation',
    pattern:
      /\b(politic\w+|democrat\w*|republican\w*|liberal|conservative|labour party|tory|left[- ]wing|right[- ]wing|socialis\w+|communis\w+|libertarian|voted? for|ballot|activis\w+)\b/i,
  },
  { label: 'trade union membership', pattern: /\b(trade union|labor union|labour union|unioni[sz]ed|shop steward)\b/i },
  {
    label: 'vulnerable group status',
    pattern:
      /\b(homeless\w*|unhoused|low[- ]income|food stamps|snap benefits|welfare|food bank|evict\w+|foster care|orphan\w*|refugee camp)\b/i,
  },
] as const;

export interface SensitiveMatch {
  /** Which family tripped, for the build log. Never shown to the user beside a
   *  bullet — the bullet is gone, and naming the category would restate it. */
  label: string;
}

/**
 * The first sensitive family `text` trips, or `null`.
 *
 * Short-circuits on the first hit: this decides whether to drop, and one reason
 * is as good as five.
 */
export const findSensitiveFamily = (text: string): SensitiveMatch | null => {
  if (!text) return null;
  for (const family of SENSITIVE_FAMILIES) {
    if (family.pattern.test(text)) return { label: family.label };
  }
  return null;
};

/** True when nothing in the claim or its evidence trips the screen. */
export const isStorableClaim = (claim: { text: string; evidence?: string }): boolean =>
  !findSensitiveFamily(claim.text) && !findSensitiveFamily(claim.evidence ?? '');

/**
 * The list as prose, for the prompt.
 *
 * Generated from the same array the code screens with, so the instruction the
 * model is given and the rule that is actually enforced cannot drift apart —
 * which is exactly what happens when a prompt block and a validator are
 * maintained as two separate lists.
 */
export const SENSITIVE_CATEGORY_LINES: readonly string[] = SENSITIVE_FAMILIES.map(
  (family) => family.label,
);
