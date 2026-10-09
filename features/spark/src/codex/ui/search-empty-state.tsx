import type { ReactNode } from "react";
import { FormattedMessage } from "react-intl";
import { Icon } from "../icons/icon";
import { magnifyingGlassMdLight24 } from "../icons/magnifying-glass-md-light-24";
import { EmptyState } from "./empty-state";

/** No-results state for a Space or Sites search (`space-search-empty-state` chunk). */
export function SearchEmptyState({ query }: { query: string }) {
  return (
    <EmptyState
      className="max-w-80 self-center wrap-anywhere select-none"
      layout="page"
      spacing="default"
      illustration={
        <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-background-secondary-soft">
          <Icon asset={magnifyingGlassMdLight24} />
        </span>
      }
      title={
        <h2>
          <FormattedMessage id="search.empty.title" defaultMessage="No results found" description="Heading when a search in a content collection has no matching items" />
        </h2>
      }
      description={
        <FormattedMessage
          id="spaceSearch.empty.descriptionWithQuery"
          defaultMessage="No matches for “{query}”. <guidance>Try a different search.</guidance>"
          description="Guidance when a Space or Sites search has no matching items. query is the text the user searched for. The guidance tag places the suggestion on a separate line below the no-matches sentence."
          values={{ query, guidance: (chunks: ReactNode[]) => <span key="guidance" className="block">{chunks}</span> }}
        />
      }
    />
  );
}
