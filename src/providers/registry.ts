import { openAlexProvider } from './openalex';
import { semanticScholarProvider } from './semanticscholar';
import type { CitationProvider } from './types';

/** All available data sources. OpenAlex is the default; the list drives the UI picker. */
export const providers: CitationProvider[] = [openAlexProvider, semanticScholarProvider];

export const DEFAULT_PROVIDER_ID = openAlexProvider.id;

export function getProvider(id: string): CitationProvider {
  return providers.find((p) => p.id === id) ?? openAlexProvider;
}
