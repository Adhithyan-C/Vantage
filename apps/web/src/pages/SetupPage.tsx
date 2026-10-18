import { useState } from 'react';
import type { ChangeEvent, FormEvent, ReactNode } from 'react';
import { RunCreateRequestSchema } from '@vantage/shared';
import { navigate } from '../app/routes';
import { ErrorState } from '../components/ErrorState';
import { ApiError, createRun, getDemoSeller } from '../lib/api';

interface FormState {
  productName: string;
  problemDescription: string;
  idealCustomer: string;
  competitors: string;
  keywords: string;
  sinceDays: string;
  maxResults: string;
}

type FieldErrors = Record<string, string>;

const EMPTY_FORM: FormState = {
  productName: '',
  problemDescription: '',
  idealCustomer: '',
  competitors: '',
  keywords: '',
  sinceDays: '90',
  maxResults: '50',
};

const SOURCE_NOTES: Array<{ label: string; note: string; live: boolean }> = [
  { label: 'Hacker News', note: 'Live', live: true },
  { label: 'Reddit', note: 'Not connected (waiting for API access)', live: false },
  { label: 'Developer forums', note: 'Coming later', live: false },
  { label: 'Review sites', note: 'Saved snapshot, coming later', live: false },
];

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function buildRequest(form: FormState): unknown {
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [loadingDemo, setLoadingDemo] = useState(false);
  const [submitError, setSubmitError] = useState<ApiError | null>(null);

  const onChange =
    (key: keyof FormState) =>
    (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
      const value = event.target.value;
      setForm((previous) => ({ ...previous, [key]: value }));
    };

  const errorOf = (key: string): string | undefined => fieldErrors[key];
  const describedBy = (id: string, key: string): string =>
    errorOf(key) ? `${id}-error` : `${id}-hint`;

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

    const parsed = RunCreateRequestSchema.safeParse(buildRequest(form));
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
            hint="Separate phrases with commas, up to 10."
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
              label="Look back (days)"
              hint="1 to 365"
              error={errorOf('params.sinceDays')}
            >
              <input
                id="sinceDays"
                className="control"
                type="number"
                min={1}
                max={365}
                value={form.sinceDays}
                onChange={onChange('sinceDays')}
                aria-invalid={errorOf('params.sinceDays') ? true : undefined}
                aria-describedby={describedBy('sinceDays', 'params.sinceDays')}
              />
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
            {SOURCE_NOTES.map((source) => (
              <li key={source.label} className="source-row">
                <span className="source-name">{source.label}</span>
                <span className={source.live ? 'badge badge-live' : 'badge badge-planned'}>
                  {source.live ? 'Live' : 'Unavailable'}
                </span>
                <span className="muted">{source.note}</span>
              </li>
            ))}
          </ul>

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
