import { useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { RunCreateRequestSchema } from '@vantage/shared';
import type { SourceId } from '@vantage/shared';
import { navigate } from '../app/routes';
import { ErrorState } from '../components/ErrorState';
import { ApiError, createRun, getDemoSeller } from '../lib/api';

export interface FormState {
  productName: string;
  problemDescription: string;
  idealCustomer: string;
  competitors: string;
  keywords: string;
  sinceDays: string;
  maxResults: string;
}

type FieldErrors = Record<string, string>;

export const EMPTY_FORM: FormState = {
  productName: '',
  problemDescription: '',
  idealCustomer: '',
  competitors: '',
  keywords: '',
  sinceDays: '90',
  maxResults: '50',
};

const UNAVAILABLE_SOURCES: Array<{ label: string; note: string }> = [
  { label: 'Reddit', note: 'Not connected (waiting for API access)' },
  { label: 'Developer forums', note: 'Coming later' },
  { label: 'Review sites', note: 'Coming later' },
  { label: 'Product Hunt', note: 'Unavailable until API use is permitted; its terms prohibit commercial use without permission' },
];

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

export function buildRequest(form: FormState, sources: SourceId[]): unknown | null {
  if (sources.length === 0) {
    return null;
  }
  const idealCustomer = form.idealCustomer.trim();
  return {
    seller: {
      productName: form.productName.trim(),
      problemDescription: form.problemDescription.trim(),
      ...(idealCustomer ? { idealCustomer } : {}),
      competitors: splitList(form.competitors),
    },
    params: {
      keywords: splitList(form.keywords),
      sinceDays: Number(form.sinceDays),
      maxResults: Number(form.maxResults),
      sources,
    },
  };
}

function fieldKey(path: ReadonlyArray<PropertyKey>): string {
  return path
    .slice(0, 2)
    .map((part) => String(part))
    .join('.');
}

function collectErrors(
  issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }>,
): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of issues) {
    const key = fieldKey(issue.path);
    if (!(key in errors)) {
      errors[key] = issue.message;
    }
  }
  return errors;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

function Field({ id, label, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && !error && (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      )}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

export function SetupPage() {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [selectedSources, setSelectedSources] = useState<SourceId[]>(['hackernews', 'stackexchange']);
  const [sourceError, setSourceError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  const onChange =
    (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>): void => {
      const value = event.target.value;
      setForm((previous) => ({ ...previous, [key]: value }));
    };

  const errorOf = (key: string): string | undefined => fieldErrors[key];
  const describedBy = (id: string, key: string): string =>
    errorOf(key) ? `${id}-error` : `${id}-hint`;

  function updateSource(source: SourceId, checked: boolean): void {
    setSelectedSources((current) => checked
      ? current.includes(source) ? current : [...current, source]
      : current.filter((item) => item !== source));
    if (checked) {
      setSourceError('');
    }
  }

  async function handleLoadDemo(): Promise<void> {
    setLoadingDemo(true);
    setSubmitError(null);
    try {
      const demo = await getDemoSeller();
      setForm({
        productName: demo.seller.productName,
        problemDescription: demo.seller.problemDescription,
        idealCustomer: demo.seller.idealCustomer ?? '',
        competitors: demo.seller.competitors.join(', '),
        keywords: demo.params.keywords.join(', '),
        sinceDays: String(demo.params.sinceDays),
        maxResults: String(demo.params.maxResults),
      });
      setFieldErrors({});
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err
          : new ApiError(err instanceof Error ? err.message : String(err), 0),
      );
    } finally {
      setLoadingDemo(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSubmitError(null);

    const request = buildRequest(form, selectedSources);
    if (request === null) {
      setSourceError('Select at least one source.');
      setFieldErrors({});
      return;
    }
    const parsed = RunCreateRequestSchema.safeParse(request);
    if (!parsed.success) {
      setFieldErrors(collectErrors(parsed.error.issues));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    try {
      const { runId } = await createRun(parsed.data);
      navigate(`/runs/${runId}`);
    } catch (err) {
      setSubmitError(
        err instanceof ApiError
          ? err
          : new ApiError(err instanceof Error ? err.message : String(err), 0),
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="stack">
      <section className="card" aria-labelledby="setup-title">
        <div className="card-head">
          <div>
            <h1 id="setup-title" className="page-title">
              Find buying signals
            </h1>
            <p className="muted">
              Describe what you sell and who needs it. Vantage searches public posts and shows
              why each one matters.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              void handleLoadDemo();
            }}
            disabled={loadingDemo || submitting}
          >
            {loadingDemo ? 'Loading…' : 'Load demo seller'}
          </button>
        </div>

        <form
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
        >
          <h2 className="card-subtitle">Your product</h2>
          <Field
            id="productName"
            label="Product name"
            hint="For example: Beacon Support"
            error={errorOf('seller.productName')}
          >
            <input
              id="productName"
              className="control"
              type="text"
              autoComplete="off"
              value={form.productName}
              onChange={onChange('productName')}
              aria-invalid={errorOf('seller.productName') ? true : undefined}
              aria-describedby={describedBy('productName', 'seller.productName')}
            />
          </Field>

          <Field
            id="problemDescription"
            label="Problem you solve"
            hint="Describe the problem in plain words, the way a customer would."
            error={errorOf('seller.problemDescription')}
          >
            <textarea
              id="problemDescription"
              className="control"
              rows={4}
              value={form.problemDescription}
              onChange={onChange('problemDescription')}
              aria-invalid={errorOf('seller.problemDescription') ? true : undefined}
              aria-describedby={describedBy('problemDescription', 'seller.problemDescription')}
            />
          </Field>

          <Field
            id="idealCustomer"
            label="Ideal customer (optional)"
            error={errorOf('seller.idealCustomer')}
          >
            <input
              id="idealCustomer"
              className="control"
              type="text"
              autoComplete="off"
              value={form.idealCustomer}
              onChange={onChange('idealCustomer')}
              aria-invalid={errorOf('seller.idealCustomer') ? true : undefined}
              aria-describedby={describedBy('idealCustomer', 'seller.idealCustomer')}
            />
          </Field>

          <Field
            id="competitors"
            label="Competitors (optional)"
            hint="Separate names with commas."
            error={errorOf('seller.competitors')}
          >
            <input
              id="competitors"
              className="control"
              type="text"
              autoComplete="off"
              value={form.competitors}
              onChange={onChange('competitors')}
              aria-invalid={errorOf('seller.competitors') ? true : undefined}
              aria-describedby={describedBy('competitors', 'seller.competitors')}
            />
          </Field>

          <h2 className="card-subtitle">Search</h2>
          <Field
            id="keywords"
            label="Keywords"
            hint="Use 2 to 5 short, specific phrases. Long lists dilute the results."
            error={errorOf('params.keywords')}
          >
            <input
              id="keywords"
              className="control"
              type="text"
              autoComplete="off"
              value={form.keywords}
              onChange={onChange('keywords')}
              aria-invalid={errorOf('params.keywords') ? true : undefined}
              aria-describedby={describedBy('keywords', 'params.keywords')}
            />
          </Field>

          <div className="field-row">
            <Field
              id="sinceDays"
            label="Look back"
            hint="Research mode includes posts up to three years old."
              error={errorOf('params.sinceDays')}
            >
            <select
                id="sinceDays"
                className="control"
                value={form.sinceDays}
                onChange={onChange('sinceDays')}
                aria-invalid={errorOf('params.sinceDays') ? true : undefined}
                aria-describedby={describedBy('sinceDays', 'params.sinceDays')}
            >
              <option value="30">30 days</option>
              <option value="90">90 days</option>
              <option value="180">180 days</option>
              <option value="365">1 year</option>
              <option value="730">2 years (research mode)</option>
              <option value="1095">3 years (research mode)</option>
            </select>
            </Field>
            <Field
              id="maxResults"
              label="Max results per source"
              hint="1 to 100"
              error={errorOf('params.maxResults')}
            >
              <input
                id="maxResults"
                className="control"
                type="number"
                min={1}
                max={100}
                value={form.maxResults}
                onChange={onChange('maxResults')}
                aria-invalid={errorOf('params.maxResults') ? true : undefined}
                aria-describedby={describedBy('maxResults', 'params.maxResults')}
              />
            </Field>
          </div>

          <h2 className="card-subtitle">Sources</h2>
          <ul className="source-list">
            <li className="source-row">
              <label htmlFor="source-hackernews">
                <input
                  id="source-hackernews"
                  type="checkbox"
                  checked={selectedSources.includes('hackernews')}
                  onChange={(event) => updateSource('hackernews', event.target.checked)}
                />
                Hacker News
              </label>
              <span className="badge badge-live">Live</span>
            </li>
            <li className="source-row">
              <div>
                <label htmlFor="source-stackexchange">
                  <input
                    id="source-stackexchange"
                    type="checkbox"
                    checked={selectedSources.includes('stackexchange')}
                    aria-describedby="source-stackexchange-hint"
                    onChange={(event) => updateSource('stackexchange', event.target.checked)}
                  />
                  Stack Exchange (Software Recommendations and Software Engineering)
                </label>
                <p className="muted field-hint" id="source-stackexchange-hint">
                  Questions across Software Recommendations and Software Engineering.
                </p>
              </div>
              <span className="badge badge-live">Live</span>
            </li>
            <li className="source-row">
              <div>
                <label htmlFor="source-github">
                  <input
                    id="source-github"
                    type="checkbox"
                    checked={selectedSources.includes('github')}
                    aria-describedby="source-github-hint"
                    onChange={(event) => updateSource('github', event.target.checked)}
                  />
                  GitHub Issues
                </label>
                <p className="muted field-hint" id="source-github-hint">
                  Public issue search. GITHUB_TOKEN is optional and recommended for a higher request limit.
                </p>
              </div>
              <span className="badge badge-live">Live</span>
            </li>
            <li className="source-row">
              <div>
                <label htmlFor="source-devto">
                  <input
                    id="source-devto"
                    type="checkbox"
                    checked={selectedSources.includes('devto')}
                    aria-describedby="source-devto-hint"
                    onChange={(event) => updateSource('devto', event.target.checked)}
                  />
                  DEV Community
                </label>
                <p className="muted field-hint" id="source-devto-hint">
                  Searches published DEV articles; the API response contains descriptions rather than full article bodies.
                </p>
              </div>
              <span className="badge badge-live">Live</span>
            </li>
            <li className="source-row">
              <div>
                <label htmlFor="source-snapshot">
                  <input
                    id="source-snapshot"
                    type="checkbox"
                    checked={selectedSources.includes('snapshot')}
                    aria-describedby="source-snapshot-hint"
                    onChange={(event) => updateSource('snapshot', event.target.checked)}
                  />
                  Sample dataset (synthetic)
                </label>
                <p className="muted field-hint" id="source-snapshot-hint">
                  Labelled test posts written for Vantage. They are not real posts and ignore your keywords.
                </p>
              </div>
              <span className="badge badge-planned">Sample data</span>
            </li>
            {UNAVAILABLE_SOURCES.map((source) => (
              <li key={source.label} className="source-row">
                <span className="source-name">{source.label}</span>
                <span className="badge badge-planned">Unavailable</span>
                <span className="muted">{source.note}</span>
              </li>
            ))}
          </ul>
          {sourceError && <p className="field-error" role="alert">{sourceError}</p>}

          {submitError && (
            <ErrorState
              title="Could not start the run"
              message={submitError.message}
              issues={submitError.issues}
            />
          )}

          <div className="form-actions">
            <button type="submit" className="btn btn-primary" disabled={submitting}>
              {submitting ? 'Starting…' : 'Start search'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
