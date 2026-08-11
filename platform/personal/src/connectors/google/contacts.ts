/**
 * Google Contacts (People API).
 *
 * The narrowest connector here and the one most carefully bounded. A contact
 * list is other people's personal data, not the user's, and most of what it
 * holds — addresses, phone numbers, birthdays, notes — is information about
 * third parties who never agreed to any of this.
 *
 * So exactly one thing is read: whether a contact carries an explicit
 * relationship label the user themselves set ("Mum", "partner", "manager"). That
 * is a fact about the *user's* life, stated by the user, and it is the only field
 * in the whole API that qualifies. Names without a label are skipped, because a
 * name in an address book says nothing about the relationship.
 */

import { query } from '../google-fetch';
import type { ConnectorFetch, ConnectorReader, ConnectorSignal } from '../types';

const PEOPLE_API = 'https://people.googleapis.com/v1';

const PAGE_SIZE = 200;

interface Person {
  names?: { displayName?: string }[];
  relations?: { person?: string; type?: string }[];
  // `userDefined` is where the Contacts UI stores custom labels.
  userDefined?: { key?: string; value?: string }[];
}

/**
 * Relationship types worth recording, mapped to plain words.
 *
 * Google's `relations.type` is a free-text field with conventional values.
 * Anything not in this table is skipped rather than passed through — an
 * unrecognised label is as likely to be a joke as a relationship, and one that
 * reaches the profile is a bullet the model treats as fact.
 */
const RELATION_LABELS: Record<string, string> = {
  spouse: 'spouse',
  partner: 'partner',
  domesticPartner: 'partner',
  child: 'child',
  parent: 'parent',
  mother: 'mother',
  father: 'father',
  sibling: 'sibling',
  brother: 'brother',
  sister: 'sister',
  manager: 'manager',
  assistant: 'assistant',
  friend: 'friend',
};

export const readContactsSignals = async (
  fetchJson: ConnectorFetch,
  signal?: AbortSignal,
): Promise<ConnectorSignal[]> => {
  const url = `${PEOPLE_API}/people/me/connections${query({
    personFields: 'names,relations',
    pageSize: PAGE_SIZE,
    sortOrder: 'LAST_MODIFIED_DESCENDING',
  })}`;

  const page = await fetchJson<{ connections?: Person[] }>(url, { signal });
  if (!page?.connections) return [];

  const signals: ConnectorSignal[] = [];

  for (const person of page.connections) {
    const name = person.names?.[0]?.displayName?.trim();
    if (!name) continue;
    for (const relation of person.relations ?? []) {
      const label = RELATION_LABELS[relation.type ?? ''];
      if (!label) continue;
      signals.push({
        section: 'relationships',
        text: `${name} is the user's ${label}`,
        source: 'Google Contacts',
        evidence: `Saved in Google Contacts with the relationship "${label}".`,
      });
      break;
    }
    // Six named relationships is already more than the section's cap; reading
    // further pages would only produce bullets that lose the cap fight.
    if (signals.length >= 6) break;
  }

  return signals;
};

export const contactsConnector: ConnectorReader = {
  id: 'contacts',
  readSignals: readContactsSignals,
};
